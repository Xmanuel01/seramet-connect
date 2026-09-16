import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { AuthShell, authButtonClass, authInputClass } from "@/components/auth/AuthShell";
import {
  authMutation,
  authStatus,
  deviceStartup,
  enterRestaurant,
  type AuthRestaurant,
} from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [restaurants, setRestaurants] = useState<AuthRestaurant[]>([]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("account") === "1") return;
    void deviceStartup()
      .then((device) => {
        if (device.state === "ACTIVE") window.location.assign("/pos-login");
      })
      .catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      await authMutation("login", { email, password });
      const status = await authStatus();
      if (!status.restaurants.length) {
        window.location.assign("/register");
        return;
      }
      if (status.restaurants.length === 1) {
        enterRestaurant(status.restaurants[0]!.tenantId);
        return;
      }
      setRestaurants(status.restaurants);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your verified account to access the restaurants and branches assigned to you."
      footer={
        <>
          New to Seramet?{" "}
          <Link to="/register" className="font-semibold text-primary">
            Create a restaurant
          </Link>
        </>
      }
    >
      {restaurants.length ? (
        <div className="space-y-2">
          <p className="mb-3 text-sm font-medium">Choose a restaurant</p>
          {restaurants.map((restaurant) => (
            <button
              key={restaurant.tenantId}
              type="button"
              onClick={() => enterRestaurant(restaurant.tenantId)}
              className="flex w-full items-center justify-between rounded-md border border-border px-3 py-3 text-left text-sm transition hover:border-primary hover:bg-accent/50"
            >
              <span className="font-semibold">{restaurant.name}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            Email
            <input
              className={authInputClass}
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              className={authInputClass}
              type="password"
              autoComplete="current-password"
              required
              minLength={10}
              maxLength={200}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {message && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {message}
            </p>
          )}
          <button className={authButtonClass} type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>
      )}
    </AuthShell>
  );
}
