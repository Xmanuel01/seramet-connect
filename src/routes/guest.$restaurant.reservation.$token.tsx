import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarCheck, CalendarClock, CalendarX, CreditCard, Users } from "lucide-react";
import { useState } from "react";
import { GuestButton, GuestError, GuestLoading, GuestMoney, GuestShell } from "@/guest/guest-ui";
import type { ReservationStatus } from "@/guest/types";
import { guestRequest, useGuestQuery } from "@/guest/use-guest";

type ReservationView = {
  id: string;
  restaurant: string;
  restaurantSlug: string;
  branchSlug: string;
  guestName: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  confirmationState: string;
  table?: string;
  deposit?: { amountMinor: number; currency: string; status: string };
};

export const Route = createFileRoute("/guest/$restaurant/reservation/$token")({
  component: ManageReservation,
});

function ManageReservation() {
  const { restaurant, token } = Route.useParams();
  const query = useGuestQuery<{ reservation: ReservationView }>(
    `/api/seramet/guest/reservations/${encodeURIComponent(token)}`,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const reservation = query.data?.reservation;
  const [editing, setEditing] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [customerPhone, setCustomerPhone] = useState("");
  const cancel = async () => {
    setBusy(true);
    try {
      await guestRequest(`/api/seramet/guest/reservations/${encodeURIComponent(token)}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: "Cancelled by guest" }),
      });
      setNotice("Reservation cancelled");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Reservation could not be cancelled");
    } finally {
      setBusy(false);
    }
  };
  const beginEdit = () => {
    if (!reservation) return;
    const local = new Date(reservation.startsAt);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    setStartsAt(local.toISOString().slice(0, 16));
    setPartySize(reservation.partySize);
    setEditing(true);
  };
  const saveChanges = async () => {
    setBusy(true);
    try {
      await guestRequest(`/api/seramet/guest/reservations/${encodeURIComponent(token)}`, {
        method: "PATCH",
        body: JSON.stringify({ startsAt: new Date(startsAt).toISOString(), partySize }),
      });
      setNotice("Reservation updated after a fresh availability check.");
      setEditing(false);
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Reservation could not be changed");
    } finally {
      setBusy(false);
    }
  };
  const payDeposit = async () => {
    setBusy(true);
    try {
      const result = await guestRequest<{ payment: { status?: string } }>(
        `/api/seramet/guest/reservations/${encodeURIComponent(token)}/deposit`,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "PAYMENT_PROMPT",
            idempotencyKey: crypto.randomUUID(),
            ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
          }),
        },
      );
      setNotice(
        `Deposit status: ${result.payment.status ?? "PROCESSING"}. Confirmation comes from the payment provider.`,
      );
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Deposit payment could not be started");
    } finally {
      setBusy(false);
    }
  };
  if (query.status === "loading")
    return (
      <GuestShell>
        <GuestLoading label="Loading reservation" />
      </GuestShell>
    );
  if (!reservation)
    return (
      <GuestShell>
        <GuestError message={query.error} />
      </GuestShell>
    );
  return (
    <GuestShell>
      <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <Link
          to="/guest/$restaurant"
          params={{ restaurant }}
          className="text-sm font-bold text-[var(--guest-primary)]"
        >
          Restaurant home
        </Link>
        <section className="mt-4 rounded-lg border border-black/10 bg-white p-6 sm:p-8">
          <CalendarCheck className="h-8 w-8 text-[var(--guest-primary)]" />
          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold">{reservation.restaurant}</h1>
              <p className="mt-1 text-sm text-black/55">Reservation for {reservation.guestName}</p>
            </div>
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
              {reservation.status.replaceAll("_", " ")}
            </span>
          </div>
          <dl className="mt-6 grid gap-4 border-y border-black/10 py-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-black/50">Date and time</dt>
              <dd className="mt-1 font-bold">{new Date(reservation.startsAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-black/50">Party</dt>
              <dd className="mt-1 flex items-center gap-2 font-bold">
                <Users className="h-4 w-4" />
                {reservation.partySize} guests
              </dd>
            </div>
            <div>
              <dt className="text-black/50">Table</dt>
              <dd className="mt-1 font-bold">{reservation.table ?? "Assigned on arrival"}</dd>
            </div>
            <div>
              <dt className="text-black/50">Confirmation</dt>
              <dd className="mt-1 font-bold">
                {reservation.confirmationState.replaceAll("_", " ")}
              </dd>
            </div>
          </dl>
          {reservation.deposit && (
            <div className="mt-4 rounded-md bg-amber-50 p-4 text-sm">
              <span className="font-bold">Deposit: </span>
              <GuestMoney
                amount={reservation.deposit.amountMinor}
                currency={reservation.deposit.currency}
              />{" "}
              · {reservation.deposit.status}
            </div>
          )}
          {reservation.deposit && ["REQUIRED", "FAILED"].includes(reservation.deposit.status) && (
            <div className="mt-3 grid gap-2 rounded-md border border-black/10 p-3">
              <label className="text-sm font-bold" htmlFor="deposit-phone">
                Payment phone, if required
              </label>
              <input
                id="deposit-phone"
                inputMode="tel"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                className="h-11 rounded-md border border-black/15 px-3"
              />
              <GuestButton onClick={payDeposit} disabled={busy}>
                <CreditCard className="h-4 w-4" />
                Pay reservation deposit
              </GuestButton>
            </div>
          )}
          {editing && (
            <div className="mt-4 grid gap-3 rounded-md border border-black/10 p-4">
              <label className="text-sm font-bold" htmlFor="reservation-date">
                Date and time
              </label>
              <input
                id="reservation-date"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                className="h-11 rounded-md border border-black/15 px-3"
              />
              <label className="text-sm font-bold" htmlFor="reservation-party">
                Party size
              </label>
              <input
                id="reservation-party"
                type="number"
                min={1}
                max={100}
                value={partySize}
                onChange={(event) => setPartySize(Number(event.target.value))}
                className="h-11 rounded-md border border-black/15 px-3"
              />
              <div className="grid grid-cols-2 gap-2">
                <GuestButton secondary onClick={() => setEditing(false)}>
                  Keep current
                </GuestButton>
                <GuestButton onClick={saveChanges} disabled={busy}>
                  Save changes
                </GuestButton>
              </div>
            </div>
          )}
          {notice && (
            <p role="status" className="mt-4 rounded-md bg-black/5 p-3 text-sm">
              {notice}
            </p>
          )}
          {!(["CANCELLED", "COMPLETED", "NO_SHOW"] as ReservationStatus[]).includes(
            reservation.status,
          ) && (
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <GuestButton secondary onClick={beginEdit} disabled={busy || editing}>
                <CalendarClock className="h-4 w-4" />
                Change booking
              </GuestButton>
              <GuestButton secondary onClick={cancel} disabled={busy}>
                <CalendarX className="h-4 w-4" />
                {busy ? "Working" : "Cancel reservation"}
              </GuestButton>
            </div>
          )}
        </section>
      </main>
    </GuestShell>
  );
}
