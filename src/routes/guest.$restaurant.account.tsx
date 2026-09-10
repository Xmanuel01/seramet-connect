import { Link, createFileRoute } from "@tanstack/react-router";
import { Award, CalendarDays, Link2, ReceiptText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyGuestState, GuestButton, GuestMoney, GuestShell } from "@/guest/guest-ui";
import {
  guestRequest,
  readGuestSession,
  readRecentGuestOrders,
  writeGuestSession,
} from "@/guest/use-guest";

type Portal = {
  displayName: string;
  memberships: Array<{
    programId: string;
    programName: string;
    memberLastFour: string;
    tierName?: string;
    pointsBalance: number;
  }>;
  rewards: Array<{ id: string; programId: string; name: string; type: string; pointsCost: number }>;
  orders: Array<{
    reference: string;
    status: string;
    amountMinor: number;
    currency: string;
    createdAt: string;
  }>;
  reservations: Array<{
    id: string;
    restaurant: string;
    branch: string;
    startsAt: string;
    partySize: number;
    status: string;
  }>;
  quality: "HIGH";
};

type Recent = ReturnType<typeof readRecentGuestOrders>[number];

export const Route = createFileRoute("/guest/$restaurant/account")({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : "",
  }),
  component: GuestActivity,
});

function GuestActivity() {
  const { restaurant } = Route.useParams();
  const { branch } = Route.useSearch();
  const [orders, setOrders] = useState<Recent[]>([]);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [memberToken, setMemberToken] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const effectiveBranch = branch || orders[0]?.branch || "";

  useEffect(() => setOrders(readRecentGuestOrders(restaurant)), [restaurant]);

  const loadPortal = useCallback(async () => {
    if (!effectiveBranch) return;
    const token = readGuestSession(`${restaurant}.${effectiveBranch}`);
    if (!token) return;
    try {
      const result = await guestRequest<{ account: Portal }>(
        "/api/seramet/guest/account",
        {},
        token,
      );
      setPortal(result.account);
      setNotice("");
    } catch {
      setPortal(null);
    }
  }, [effectiveBranch, restaurant]);

  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  const linkMembership = async () => {
    if (!effectiveBranch) return setNotice("Choose a branch before linking membership.");
    if (memberToken.trim().length < 24) return setNotice("Enter the complete membership code.");
    setBusy(true);
    try {
      const key = `${restaurant}.${effectiveBranch}`;
      let token = readGuestSession(key);
      if (!token) {
        const created = await guestRequest<{ session: { token: string } }>(
          `/api/seramet/guest/restaurants/${encodeURIComponent(restaurant)}/${encodeURIComponent(effectiveBranch)}/sessions`,
          { method: "POST", body: JSON.stringify({ sessionType: "PORTAL" }) },
        );
        token = created.session.token;
        writeGuestSession(key, token);
      }
      const result = await guestRequest<{ membership: { displayName: string } }>(
        "/api/seramet/guest/account/membership",
        { method: "POST", body: JSON.stringify({ memberToken: memberToken.trim() }) },
        token,
      );
      setMemberToken("");
      setNotice(`Membership linked for ${result.membership.displayName}.`);
      await loadPortal();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Membership could not be linked");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GuestShell>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          to="/guest/$restaurant"
          params={{ restaurant }}
          className="text-sm font-bold text-[var(--guest-primary)]"
        >
          Restaurant home
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold">Your visits and rewards</h1>
        <p className="mt-2 text-sm text-black/55">
          Link the secure member code issued by the restaurant to see authoritative points and
          eligible rewards. A name or phone number alone cannot link an account.
        </p>

        {!portal && (
          <section className="mt-6 rounded-lg border border-black/10 bg-white p-5">
            <label htmlFor="member-token" className="text-sm font-bold">
              Membership code
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                id="member-token"
                type="password"
                autoComplete="off"
                value={memberToken}
                onChange={(event) => setMemberToken(event.target.value)}
                className="h-11 min-w-0 rounded-md border border-black/15 px-3"
                placeholder="Enter or scan your member code"
              />
              <GuestButton onClick={linkMembership} disabled={busy || !effectiveBranch}>
                <Link2 className="h-4 w-4" />
                {busy ? "Linking" : "Link membership"}
              </GuestButton>
            </div>
            {!effectiveBranch && (
              <p className="mt-3 text-xs text-amber-700">
                Open a branch menu first so the account session is branch scoped.
              </p>
            )}
          </section>
        )}

        {notice && (
          <p role="status" className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            {notice}
          </p>
        )}

        {portal && (
          <>
            <section className="mt-6 border-y border-black/10 py-5">
              <p className="text-xs font-bold uppercase text-black/45">Verified member</p>
              <h2 className="mt-1 text-xl font-extrabold">{portal.displayName}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {portal.memberships.map((membership) => (
                  <article
                    key={membership.programId}
                    className="rounded-lg border border-black/10 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <strong className="text-sm">{membership.programName}</strong>
                        <p className="mt-1 text-xs text-black/50">
                          {membership.tierName ?? "Member"} · •••• {membership.memberLastFour}
                        </p>
                      </div>
                      <Award className="h-5 w-5 text-[var(--guest-accent)]" />
                    </div>
                    <p className="mt-4 text-2xl font-extrabold">{membership.pointsBalance}</p>
                    <p className="text-xs text-black/50">points available</p>
                  </article>
                ))}
              </div>
              {portal.rewards.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-bold">Available rewards</h3>
                  <ul className="mt-2 divide-y divide-black/10 border-y border-black/10">
                    {portal.rewards.map((reward) => (
                      <li key={reward.id} className="flex justify-between gap-3 py-3 text-sm">
                        <span>{reward.name}</span>
                        <strong>{reward.pointsCost} points</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="mt-7">
              <h2 className="text-lg font-extrabold">Account orders</h2>
              <div className="mt-3 grid gap-3">
                {!portal.orders.length && <EmptyGuestState type="orders" />}
                {portal.orders.map((order) => (
                  <article
                    key={`${order.reference}-${order.createdAt}`}
                    className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-black/10 bg-white p-4"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <ReceiptText className="h-5 w-5 shrink-0 text-[var(--guest-primary)]" />
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{order.reference}</strong>
                        <span className="text-xs text-black/45">
                          {order.status.replaceAll("_", " ")}
                        </span>
                      </span>
                    </span>
                    <GuestMoney amount={order.amountMinor} currency={order.currency} />
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-7">
              <h2 className="text-lg font-extrabold">Reservations</h2>
              <div className="mt-3 grid gap-3">
                {!portal.reservations.length && <EmptyGuestState type="reservations" />}
                {portal.reservations.map((reservation) => (
                  <article
                    key={reservation.id}
                    className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-black/10 bg-white p-4"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <CalendarDays className="h-5 w-5 shrink-0 text-[var(--guest-primary)]" />
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{reservation.branch}</strong>
                        <span className="text-xs text-black/45">
                          {new Date(reservation.startsAt).toLocaleString()} ·{" "}
                          {reservation.partySize} guests
                        </span>
                      </span>
                    </span>
                    <strong className="text-xs">{reservation.status.replaceAll("_", " ")}</strong>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="mt-8">
          <h2 className="text-lg font-extrabold">Orders saved on this device</h2>
          <p className="mt-1 text-xs text-black/45">
            These links are convenience data on this browser; restaurant records remain on the
            server.
          </p>
          <div className="mt-3 grid gap-3">
            {!orders.length && <EmptyGuestState type="orders" />}
            {orders.map((order) => (
              <Link
                key={order.trackingToken}
                to="/guest/$restaurant/track/$token"
                params={{ restaurant, token: order.trackingToken }}
                search={{ branch: order.branch }}
                className="flex min-h-16 items-center justify-between rounded-lg border border-black/10 bg-white p-4"
              >
                <span className="flex items-center gap-3">
                  <ReceiptText className="h-5 w-5 text-[var(--guest-primary)]" />
                  <span>
                    <strong className="block text-sm">{order.reference}</strong>
                    <span className="text-xs text-black/45">View live status and payment</span>
                  </span>
                </span>
                <span aria-hidden>›</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </GuestShell>
  );
}
