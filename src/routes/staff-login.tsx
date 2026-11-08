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
    [password, setPassword] = useState("");
  // Invited staff choose a POS PIN here; only the account owner signs in with a password.
  const [pin, setPin] = useState(""),
    [pinConfirmation, setPinConfirmation] = useState("");
  const [pinSet, setPinSet] = useState(false);
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
        if (pin !== pinConfirmation) throw Error("The two PINs don't match.");
        const response = await fetch("/api/seramet/public/auth/accept-invitation", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invitationId: invitation.id,
            accessToken: invitation.token,
            pin,
            pinConfirmation,
          }),
          signal: AbortSignal.timeout(20000),
        });
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) throw Error(result.message ?? "Your PIN wasn't confirmed. Try again.");
        setInvitation(null);
        setPin("");
        setPinConfirmation("");
        setPinSet(true);
        window.history.replaceState(null, "", "/staff-login");
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
      title={invitation ? "Choose your PIN" : pinSet ? "Your PIN is set" : "Staff account sign in"}
      subtitle={
        invitation
          ? "You'll use this 6-digit PIN to sign in on the restaurant's POS"
          : "Your assigned restaurant access"
      }
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
      {pinSet ? (
        <p className="text-sm">
          At the restaurant, sign in on the POS with your employee code and the PIN you just chose.
          Keep your PIN to yourself.
        </p>
      ) : invitation ? (
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1">
            New PIN
            <input
              className={authInputClass}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{6}"
              required
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
          <label className="grid gap-1">
            Confirm PIN
            <input
              className={authInputClass}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{6}"
              required
              maxLength={6}
              value={pinConfirmation}
              onChange={(e) => setPinConfirmation(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            6 digits. Avoid easy PINs like 123456 or 111111.
          </p>
          <button
            className={authButtonClass}
            disabled={busy || pin.length !== 6 || pin !== pinConfirmation}
            type="submit"
          >
            {busy ? "Please wait…" : "Set PIN"}
          </button>
        </form>
      ) : restaurants.length ? (
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
          <label className="grid gap-1">
            Password
            <input
              className={authInputClass}
              type="password"
              autoComplete="current-password"
              required
              minLength={10}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className={authButtonClass} disabled={busy} type="submit">
            {busy ? "Please wait…" : "Sign in"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
