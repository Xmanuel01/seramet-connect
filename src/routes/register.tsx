import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AuthShell, authButtonClass, authInputClass } from "@/components/auth/AuthShell";
import { authMutation, authStatus, enterRestaurant } from "@/lib/auth-client";

export const Route = createFileRoute("/register")({ component: RegisterPage });

type Stage = "CHECKING" | "ACCOUNT" | "VERIFY" | "RESTAURANT";

function RegisterPage() {
  const [stage, setStage] = useState<Stage>("CHECKING");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const idempotencyKey = useRef<string | undefined>(undefined);
  idempotencyKey.current ??= crypto.randomUUID();

  useEffect(() => {
    void authStatus()
      .then((status) => {
        if (status.restaurants.length === 1)
          return enterRestaurant(status.restaurants[0]!.tenantId);
        setStage(status.authenticated ? "RESTAURANT" : "ACCOUNT");
      })
      .catch(() => setStage("ACCOUNT"));
  }, []);

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const result = await authMutation("signup", {
        name: String(data.get("name")),
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      setStage(result.authenticated ? "RESTAURANT" : "VERIFY");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account creation failed");
    } finally {
      setBusy(false);
    }
  };

  const createRestaurant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const data = new FormData(event.currentTarget);
    const tradingName = String(data.get("tradingName")).trim();
    const slug = String(data.get("slug")).trim();
    try {
      const response = await fetch("/api/seramet/public/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          administratorName: String(data.get("administratorName")),
          ...(slug ? { slug } : {}),
          legalName: String(data.get("legalName")).trim() || tradingName,
          tradingName,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        organisation?: { tenantId: string; nextPath: string };
      };
      if (!response.ok || !payload.organisation) {
        throw new Error(payload.message ?? "Restaurant creation failed");
      }
      enterRestaurant(payload.organisation.tenantId, payload.organisation.nextPath);
    } catch (error) {
      setMessage(
        error instanceof TypeError
          ? "Seramet could not be reached. Check your connection and try again."
          : error instanceof Error
            ? error.message
            : "Restaurant creation failed",
      );
    } finally {
      setBusy(false);
    }
  };

  if (stage === "CHECKING") {
    return (
      <AuthShell
        title="Create your account"
        subtitle="Checking your secure session..."
        footer={<span />}
      >
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      </AuthShell>
    );
  }

  if (stage === "VERIFY") {
    return (
      <AuthShell
        title="Verify your email"
        subtitle="We sent a verification link to your email address. Verify the account, then sign in to create the restaurant."
        footer={
          <Link to="/login" className="font-semibold text-primary">
            Return to sign in
          </Link>
        }
      >
        <div className="rounded-md border border-border bg-secondary/50 px-4 py-3 text-sm">
          No restaurant or operational records are created until the account is verified.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={stage === "ACCOUNT" ? "Create your account" : "What is your business name?"}
      subtitle={
        stage === "ACCOUNT"
          ? "Start with a verified administrator account."
          : "Start with your restaurant identity. Location and operations come next."
      }
      footer={
        <>
          Already registered?{" "}
          <Link to="/login" className="font-semibold text-primary">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={stage === "ACCOUNT" ? createAccount : createRestaurant} className="space-y-4">
        <label className="block text-sm font-medium">
          Your name
          <input
            name={stage === "ACCOUNT" ? "name" : "administratorName"}
            className={authInputClass}
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
          />
        </label>
        {stage === "ACCOUNT" ? (
          <>
            <label className="block text-sm font-medium">
              Email
              <input
                name="email"
                className={authInputClass}
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                name="password"
                className={authInputClass}
                type="password"
                required
                minLength={10}
                maxLength={200}
                autoComplete="new-password"
              />
            </label>
          </>
        ) : (
          <>
            <div className="rounded-md border border-primary/25 bg-accent px-4 py-3 text-sm leading-6 text-foreground">
              You will be created as the Account Owner with access to all branches. You can invite
              managers and employees after the restaurant has been created.
            </div>
            <label className="block text-sm font-medium">
              Restaurant name
              <input
                name="tradingName"
                className={authInputClass}
                required
                minLength={2}
                maxLength={120}
              />
            </label>
            <label className="block text-sm font-medium">
              Legal business name{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
              <input name="legalName" className={authInputClass} maxLength={160} />
            </label>
            <label className="block text-sm font-medium">
              Public URL name <span className="font-normal text-muted-foreground">(optional)</span>
              <input
                name="slug"
                className={authInputClass}
                maxLength={500}
                placeholder="your-restaurant"
                aria-describedby="public-url-help"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <span
                id="public-url-help"
                className="mt-1.5 block text-xs font-normal leading-5 text-muted-foreground"
              >
                Used for your public menu, ordering and booking link, for example
                /guest/your-restaurant. Leave blank and Seramet creates it from the restaurant name.
              </span>
            </label>
          </>
        )}
        {message && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {message}
          </p>
        )}
        <button className={authButtonClass} type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {stage === "ACCOUNT" ? "Create account" : "Continue to location"}
        </button>
      </form>
    </AuthShell>
  );
}
