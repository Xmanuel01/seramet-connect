import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Delete, RefreshCcw, Wifi, WifiOff } from "lucide-react";
import { Logo } from "@/components/app/Logo";
import { StartupScreen } from "@/components/auth/StartupScreen";
import {
  deviceStartup,
  employeePinLogin,
  markInteractiveSignIn,
  clearInteractiveSignIn,
  type DeviceStartup,
} from "@/lib/auth-client";
import { pinAfterIdentityChange, shouldCapturePinKeyboardEvent } from "@/lib/pos-login-input";

export const Route = createFileRoute("/pos-login")({
  head: () => ({ meta: [{ title: "Seramet" }] }),
  component: PosLoginPage,
});

function PosLoginPage() {
  const [startup, setStartup] = useState<DeviceStartup>();
  const [startupPending, setStartupPending] = useState(true);
  const [startupSettled, setStartupSettled] = useState(false);
  const startupRequest = useRef<AbortController | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [mustChangePin, setMustChangePin] = useState(false);
  const [replacementPin, setReplacementPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const identifierRef = useRef<HTMLInputElement>(null);
  const deviceContextRef = useRef("");
  const submittingRef = useRef(false);
  const requiredLength = startup?.policy?.pinLength ?? 6;
  const deviceReady = startup?.state === "ACTIVE" && Boolean(startup.device) && !startupPending;
  const entryDisabled = busy || !deviceReady;
  const connectionVerified = online && Boolean(startup);

  const load = useCallback(async () => {
    if (startupRequest.current) return;
    const controller = new AbortController();
    startupRequest.current = controller;
    setStartupPending(true);
    setStartup(undefined);
    setPin("");
    setMustChangePin(false);
    setReplacementPin("");
    setConfirmation("");
    setMessage("");
    try {
      const result = await deviceStartup(controller.signal);
      if (controller.signal.aborted || startupRequest.current !== controller) return;
      const nextDeviceContext = `${result.device?.id ?? result.state}:${result.policy?.pinLength ?? ""}`;
      if (deviceContextRef.current && deviceContextRef.current !== nextDeviceContext) {
        setPin("");
        setMustChangePin(false);
        setReplacementPin("");
        setConfirmation("");
      }
      deviceContextRef.current = nextDeviceContext;
      setStartup(result);
      if (result.state !== "ACTIVE") setMessage(deviceMessage(result.state));
    } catch {
      if (!controller.signal.aborted && startupRequest.current === controller)
        setMessage("We couldn't connect to Seramet. Please try again.");
    } finally {
      if (startupRequest.current === controller) {
        startupRequest.current = null;
        if (!controller.signal.aborted) {
          setStartupPending(false);
          setStartupSettled(true);
        }
      }
    }
  }, []);

  const appendDigit = useCallback(
    (digit: string) => {
      if (!deviceReady) return;
      setMessage("");
      setPin((current) => (current.length < requiredLength ? `${current}${digit}` : current));
    },
    [deviceReady, requiredLength],
  );

  const submit = useCallback(async () => {
    if (submittingRef.current || !deviceReady) return;
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
    submittingRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await employeePinLogin(identifier, pin);
      if (result.mustChangePin) {
        clearInteractiveSignIn();
        setMustChangePin(true);
        return;
      }
      if (result.employee?.tenantId)
        window.localStorage.setItem("seramet.session.tenant-id", result.employee.tenantId);
      markInteractiveSignIn();
      window.location.assign(result.nextPath ?? "/pos");
    } catch (error) {
      setPin("");
      setMessage(error instanceof Error ? error.message : "Employee sign-in failed");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }, [deviceReady, identifier, online, pin, requiredLength]);

  useEffect(() => {
    void load();
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      startupRequest.current?.abort();
      startupRequest.current = null;
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, [load]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (busy || mustChangePin || !deviceReady) return;
      if (!shouldCapturePinKeyboardEvent(event.target)) return;
      if (/^\d$/.test(event.key)) appendDigit(event.key);
      if (event.key === "Backspace") setPin((current) => current.slice(0, -1));
      if (event.key === "Escape") setPin("");
      if (event.key === "Enter" && pin.length === requiredLength) void submit();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [appendDigit, busy, deviceReady, mustChangePin, pin.length, requiredLength, submit]);

  const maskedPin = useMemo(
    () => Array.from({ length: requiredLength }, (_, index) => index < pin.length),
    [pin.length, requiredLength],
  );

  const tenantName = startup?.device?.tenantName.trim() ?? "";
  const branchName = startup?.device?.branchName.trim() ?? "";
  const showTenantName =
    Boolean(tenantName) &&
    tenantName.localeCompare(branchName, undefined, { sensitivity: "base" }) !== 0;

  if (!startupSettled) return <StartupScreen />;

  if (mustChangePin)
    return (
      <ScreenMessage
        title="Replace temporary PIN"
        detail="Choose your own PIN before accessing Seramet."
      >
        <form
          className="mt-5 grid gap-4 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            if (submittingRef.current) return;
            submittingRef.current = true;
            setBusy(true);
            setMessage("");
            void (async () => {
              try {
                const response = await fetch("/api/seramet/public/employee/change-pin", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "content-type": "application/json" },
                  signal: AbortSignal.timeout(15000),
                  body: JSON.stringify({
                    currentPin: pin,
                    pin: replacementPin,
                    pinConfirmation: confirmation,
                  }),
                });
                const value = (await response.json().catch(() => ({}))) as { message?: string };
                if (!response.ok)
                  throw new Error(
                    value.message ??
                      "PIN change was not confirmed. Sign in again with your new PIN or ask a manager for a reset.",
                  );
                setMustChangePin(false);
                setPin("");
                setReplacementPin("");
                setConfirmation("");
                setMessage("PIN changed. Sign in with your new PIN.");
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "PIN change was not confirmed. Sign in again or ask a manager.",
                );
              } finally {
                submittingRef.current = false;
                setBusy(false);
              }
            })();
          }}
        >
          <label className="grid gap-1 text-sm font-semibold">
            New PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              required
              minLength={requiredLength}
              maxLength={requiredLength}
              className="h-12 rounded-md border border-input bg-background px-3"
              value={replacementPin}
              onChange={(event) => setReplacementPin(event.target.value.replace(/\D/g, ""))}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Confirm new PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              required
              minLength={requiredLength}
              maxLength={requiredLength}
              className="h-12 rounded-md border border-input bg-background px-3"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, ""))}
            />
          </label>
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={
              busy || replacementPin.length !== requiredLength || confirmation !== replacementPin
            }
            className="h-12 rounded-md bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Change PIN"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMustChangePin(false);
              setPin("");
              setReplacementPin("");
              setConfirmation("");
              setMessage("");
            }}
            className="h-11 text-sm font-semibold text-primary"
          >
            Return to sign in
          </button>
        </form>
      </ScreenMessage>
    );

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <div
            className={`flex items-center gap-2 text-xs font-semibold ${connectionVerified ? "text-success" : "text-muted-foreground"}`}
          >
            {connectionVerified ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {startupPending
              ? "Connecting"
              : !online
                ? "Offline"
                : connectionVerified
                  ? "Online"
                  : "Connection unavailable"}
          </div>
        </header>
        <div className="grid flex-1 place-items-center py-8">
          <section className="grid w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-card shadow-card md:grid-cols-[1fr_1.12fr]">
            <div className="border-b border-border bg-surface p-6 md:border-r md:border-b-0 md:p-8">
              <div className="flex items-center gap-3" aria-label="Seramet">
                <Logo compact />
                <span className="text-xl font-bold text-foreground">SERAMET</span>
              </div>
              <h1 className="mt-7 text-3xl font-bold">Employee sign in</h1>
              {!deviceReady && (
                <div
                  role="status"
                  className="mt-4 border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground"
                >
                  <p>
                    {startupPending
                      ? "Connecting to Seramet..."
                      : message ||
                        (startup
                          ? deviceMessage(startup.state)
                          : "Sign in is temporarily unavailable.")}
                  </p>
                  <button
                    type="button"
                    disabled={startupPending || busy}
                    onClick={() => void load()}
                    className="mt-2 inline-flex min-h-9 items-center gap-2 font-semibold text-primary disabled:opacity-50"
                  >
                    <RefreshCcw
                      className={`h-4 w-4 ${startupPending ? "motion-safe:animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    {startupPending ? "Connecting" : "Try again"}
                  </button>
                </div>
              )}
              <p className="mt-4 leading-6">
                <strong className="block text-base text-foreground">{branchName}</strong>
                {showTenantName ? (
                  <span className="block text-sm text-muted-foreground">{tenantName}</span>
                ) : null}
              </p>
              <label className="mt-7 block text-sm font-semibold">
                Email or employee code
                <input
                  ref={identifierRef}
                  value={identifier}
                  disabled={entryDisabled}
                  onChange={(event) => {
                    const nextIdentifier = event.target.value;
                    setPin((current) =>
                      pinAfterIdentityChange(identifier, nextIdentifier, current),
                    );
                    setIdentifier(nextIdentifier);
                  }}
                  autoComplete="username"
                  maxLength={254}
                  className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
              {deviceReady && startup?.employees?.length ? (
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  aria-label="Employees available on this device"
                >
                  {startup.employees.map((employee) => (
                    <button
                      key={employee.employeeCode}
                      type="button"
                      disabled={entryDisabled}
                      className="rounded-md border border-border bg-card px-3 py-2 text-left text-xs font-semibold hover:border-primary"
                      onClick={() => {
                        setPin((current) =>
                          pinAfterIdentityChange(identifier, employee.employeeCode, current),
                        );
                        setIdentifier(employee.employeeCode);
                      }}
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
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-primary">
                <a href="/staff-login">Staff sign in</a>
                <a href="/register">Create account</a>
              </div>
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
                    disabled={entryDisabled}
                    onClick={() => appendDigit(digit)}
                  />
                ))}
                <Key
                  label="Clear"
                  secondary
                  disabled={entryDisabled || !pin}
                  onClick={() => setPin("")}
                />
                <Key label="0" disabled={entryDisabled} onClick={() => appendDigit("0")} />
                <Key
                  label="Delete"
                  icon={<Delete className="h-5 w-5" />}
                  disabled={entryDisabled || !pin}
                  onClick={() => setPin((current) => current.slice(0, -1))}
                />
              </div>
              {message && deviceReady ? (
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
                disabled={entryDisabled || pin.length !== requiredLength}
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
