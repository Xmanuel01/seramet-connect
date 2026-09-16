import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Delete, LockKeyhole, RefreshCcw, Wifi, WifiOff } from "lucide-react";
import { Logo } from "@/components/app/Logo";
import { deviceStartup, employeePinLogin, type DeviceStartup } from "@/lib/auth-client";

export const Route = createFileRoute("/pos-login")({
  head: () => ({ meta: [{ title: "Employee sign in - Seramet" }] }),
  component: PosLoginPage,
});

function PosLoginPage() {
  const [startup, setStartup] = useState<DeviceStartup>();
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const identifierRef = useRef<HTMLInputElement>(null);
  const requiredLength = startup?.policy?.pinLength ?? 6;

  const load = useCallback(async () => {
    setMessage("");
    try {
      const result = await deviceStartup();
      setStartup(result);
      if (result.state !== "ACTIVE") setMessage(deviceMessage(result.state));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Device status is unavailable");
    }
  }, []);

  const appendDigit = useCallback(
    (digit: string) => {
      setMessage("");
      setPin((current) => (current.length < requiredLength ? `${current}${digit}` : current));
    },
    [requiredLength],
  );

  const submit = useCallback(async () => {
    if (!identifier.trim()) {
      setMessage("Enter your email or employee code.");
      identifierRef.current?.focus();
      return;
    }
    if (pin.length !== requiredLength) {
      setMessage(`Enter your ${requiredLength}-digit PIN.`);
      return;
    }
    if (!online) {
      setMessage("Employee sign-in requires a secure server connection.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await employeePinLogin(identifier, pin);
      window.location.assign(result.nextPath ?? "/pos");
    } catch (error) {
      setPin("");
      setMessage(error instanceof Error ? error.message : "Employee sign-in failed");
    } finally {
      setBusy(false);
    }
  }, [identifier, online, pin, requiredLength]);

  useEffect(() => {
    void load();
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, [load]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (busy || startup?.state !== "ACTIVE") return;
      if (/^\d$/.test(event.key)) appendDigit(event.key);
      if (event.key === "Backspace") setPin((current) => current.slice(0, -1));
      if (event.key === "Escape") setPin("");
      if (event.key === "Enter" && pin.length === requiredLength) void submit();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [appendDigit, busy, pin.length, requiredLength, startup?.state, submit]);

  const maskedPin = useMemo(
    () => Array.from({ length: requiredLength }, (_, index) => index < pin.length),
    [pin.length, requiredLength],
  );

  if (!startup) {
    return <ScreenMessage title="Checking this POS" detail="Validating the registered device..." />;
  }

  if (startup.state !== "ACTIVE" || !startup.device) {
    return (
      <ScreenMessage
        title="Device activation required"
        detail={message || deviceMessage(startup.state)}
      >
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <a
            className="h-11 rounded-md bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground"
            href="/login?account=1"
          >
            Administrator sign in
          </a>
          <button
            className="h-11 rounded-md border border-border bg-card px-4 text-sm font-semibold"
            onClick={() => void load()}
          >
            <RefreshCcw className="mr-2 inline h-4 w-4" /> Check again
          </button>
        </div>
      </ScreenMessage>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <Logo />
          <div
            className={`flex items-center gap-2 text-xs font-semibold ${online ? "text-success" : "text-danger"}`}
          >
            {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {online ? "Online" : "Offline"}
          </div>
        </header>
        <div className="grid flex-1 place-items-center py-8">
          <section className="grid w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-card shadow-card md:grid-cols-[1fr_1.12fr]">
            <div className="border-b border-border bg-surface p-6 md:border-r md:border-b-0 md:p-8">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-accent text-primary">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <p className="mt-6 text-xs font-bold uppercase text-primary">{startup.device.name}</p>
              <h1 className="mt-2 text-2xl font-bold">Employee sign in</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {startup.device.tenantName}
                <br />
                <strong className="text-foreground">{startup.device.branchName}</strong>
              </p>
              <label className="mt-7 block text-sm font-semibold">
                Email or employee code
                <input
                  ref={identifierRef}
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  maxLength={254}
                  className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
              {startup.employees?.length ? (
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  aria-label="Employees available on this device"
                >
                  {startup.employees.map((employee) => (
                    <button
                      key={employee.employeeCode}
                      type="button"
                      className="rounded-md border border-border bg-card px-3 py-2 text-left text-xs font-semibold hover:border-primary"
                      onClick={() => setIdentifier(employee.employeeCode)}
                    >
                      {employee.displayName}
                    </button>
                  ))}
                </div>
              ) : null}
              <a
                href="/login?account=1"
                className="mt-6 inline-block text-sm font-semibold text-primary"
              >
                Use administrator account
              </a>
            </div>
            <div className="p-6 sm:p-8">
              <div className="flex justify-center gap-3" aria-label="PIN entry">
                {maskedPin.map((filled, index) => (
                  <span
                    key={index}
                    className={`h-3 w-3 rounded-full border border-primary ${filled ? "bg-primary" : "bg-transparent"}`}
                  />
                ))}
              </div>
              <div className="mx-auto mt-7 grid w-full max-w-[286px] grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <Key
                    key={digit}
                    label={digit}
                    disabled={busy}
                    onClick={() => appendDigit(digit)}
                  />
                ))}
                <Key label="Clear" secondary disabled={busy || !pin} onClick={() => setPin("")} />
                <Key label="0" disabled={busy} onClick={() => appendDigit("0")} />
                <Key
                  label="Delete"
                  icon={<Delete className="h-5 w-5" />}
                  disabled={busy || !pin}
                  onClick={() => setPin((current) => current.slice(0, -1))}
                />
              </div>
              {message ? (
                <p
                  role="alert"
                  className="mt-5 rounded-md bg-danger-soft px-3 py-2 text-center text-sm text-danger"
                >
                  {message}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || pin.length !== requiredLength}
                className="mt-5 h-11 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Signing in..." : "Sign in"}
              </button>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Forgot PIN? Ask an authorized manager to issue a temporary reset.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Key({
  label,
  icon,
  secondary,
  disabled,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  secondary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`aspect-square min-h-16 rounded-full border text-lg font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40 ${secondary ? "border-transparent bg-transparent text-xs text-muted-foreground" : "border-border bg-secondary text-foreground hover:border-primary hover:bg-accent"}`}
    >
      <span className="grid place-items-center">{icon ?? label}</span>
    </button>
  );
}

function ScreenMessage({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-card">
        <Logo />
        <h1 className="mt-7 text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        {children}
      </section>
    </main>
  );
}

function deviceMessage(state: DeviceStartup["state"]) {
  if (state === "LOCKED") return "This device is locked. An administrator must review it.";
  if (state === "REVOKED") return "This device has been revoked and cannot sign in employees.";
  if (state === "RETIRED") return "This device has been retired.";
  if (state === "ACTIVATION_PENDING") return "Device activation is waiting for an administrator.";
  return "This browser is not registered as a Seramet POS device.";
}
