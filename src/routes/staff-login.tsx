import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell, authButtonClass, authInputClass } from "@/components/auth/AuthShell";
import {
  authMutation,
  authStatus,
  enterRestaurant,
  markInteractiveSignIn,
  type AuthRestaurant,
} from "@/lib/auth-client";
export const Route = createFileRoute("/staff-login")({ component: StaffLogin });
function StaffLogin() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [invitation, setInvitation] = useState<{ id: string; token: string } | null>(null);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [restaurants, setRestaurants] = useState<AuthRestaurant[]>([]);
  useEffect(() => {
    const url = new URL(window.location.href),
      id = url.searchParams.get("invitation");
    const fragment = new URLSearchParams(url.hash.slice(1));
    const token = fragment.get("access_token");
    if (url.hash) window.history.replaceState(null, "", url.pathname + url.search);
    if (id && token) setInvitation({ id, token });
    else if (id)
      setMessage(
        "Open the latest invitation link from your email, or sign in if your account is already activated.",
      );
  }, []);
  const enter = (tenantId: string) => {
    markInteractiveSignIn();
    void enterRestaurant(tenantId, "/attendance");
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (invitation) {
        if (password !== confirmation) throw Error("Passwords do not match.");
        const response = await fetch("/api/seramet/public/auth/accept-invitation", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invitationId: invitation.id,
            accessToken: invitation.token,
            password,
          }),
          signal: AbortSignal.timeout(20000),
        });
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) throw Error(result.message ?? "Account activation was not confirmed.");
        setInvitation(null);
        setPassword("");
        setConfirmation("");
        window.history.replaceState(null, "", "/staff-login");
        setMessage("Account activated. Sign in with your email and new password.");
        return;
      }
      await authMutation("login", { email, password });
      setPassword("");
      const status = await authStatus();
      if (!status.restaurants.length)
        throw Error(
          "No active employee assignment is available. Contact your supervisor; do not create another restaurant.",
        );
      if (status.restaurants.length === 1) {
        enter(status.restaurants[0]!.tenantId);
        return;
      }
      setRestaurants(status.restaurants);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Staff sign-in unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title={invitation ? "Activate staff account" : "Staff account sign in"}
      subtitle="Your assigned restaurant access"
      footer={
        <Link to="/pos-login" className="font-semibold text-primary">
          Back to employee PIN sign in
        </Link>
      }
    >
      {message && (
        <p role="status" className="mb-4 text-sm">
          {message}
        </p>
      )}
      {restaurants.length ? (
        <div className="grid gap-2">
          {restaurants.map((restaurant) => (
            <button
              key={restaurant.tenantId}
              className={authButtonClass}
              onClick={() => enter(restaurant.tenantId)}
            >
              {restaurant.name}
            </button>
          ))}
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={submit}>
          {!invitation && (
            <label className="grid gap-1">
              Email
              <input
                className={authInputClass}
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          <label className="grid gap-1">
            {invitation ? "New password" : "Password"}
            <input
              className={authInputClass}
              type="password"
              autoComplete={invitation ? "new-password" : "current-password"}
              required
              minLength={10}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {invitation && (
            <label className="grid gap-1">
              Confirm password
              <input
                className={authInputClass}
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={200}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          <button
            className={authButtonClass}
            disabled={busy || (!!invitation && password !== confirmation)}
            type="submit"
          >
            {busy ? "Please wait…" : invitation ? "Activate account" : "Sign in"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
