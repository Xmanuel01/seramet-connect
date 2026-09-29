import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarCheck, Clock3, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
  GuestBack,
  GuestButton,
  GuestError,
  GuestField,
  GuestLoading,
  GuestShell,
} from "@/guest/guest-ui";
import type { PublicBranchProfile, ReservationStatus } from "@/guest/types";
import { guestRequest, useGuestQuery } from "@/guest/use-guest";

type Availability = {
  available: boolean;
  startsAt: string;
  endsAt: string;
  partySize: number;
  capacityOptions: Array<{ code: string; capacity: number }>;
  quality: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
};

type ReservationResult = {
  id: string;
  guestName: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  confirmationState: string;
  table?: string;
  manageToken: string;
};

export const Route = createFileRoute("/guest/$restaurant/reserve")({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : "",
  }),
  component: GuestReservation,
});

function GuestReservation() {
  const { restaurant } = Route.useParams();
  const { branch } = Route.useSearch();
  const query = useGuestQuery<{ branches: PublicBranchProfile[] }>(
    branch
      ? `/api/seramet/guest/restaurants/${encodeURIComponent(restaurant)}/${encodeURIComponent(branch)}`
      : null,
  );
  const profile = query.data?.branches[0];
  const defaultDate = useMemo(() => {
    const value = new Date(Date.now() + 86_400_000);
    value.setHours(19, 0, 0, 0);
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }, []);
  const [startsAt, setStartsAt] = useState(defaultDate);
  const [partySize, setPartySize] = useState(2);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [guestName, setGuestName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReservationResult | null>(null);
  const [waitlist, setWaitlist] = useState<{ status: string; estimatedWaitMinutes: number } | null>(
    null,
  );

  const searchAvailability = async () => {
    setBusy("availability");
    setError("");
    try {
      const response = await guestRequest<{ availability: Availability }>(
        `/api/seramet/guest/restaurants/${restaurant}/${branch}/reservations/availability`,
        {
          method: "POST",
          body: JSON.stringify({ startsAt: new Date(startsAt).toISOString(), partySize }),
        },
      );
      setAvailability(response.availability);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Availability could not be checked");
    } finally {
      setBusy("");
    }
  };

  const reserve = async () => {
    setBusy("reserve");
    setError("");
    try {
      const response = await guestRequest<{ reservation: ReservationResult }>(
        `/api/seramet/guest/restaurants/${restaurant}/${branch}/reservations`,
        {
          method: "POST",
          body: JSON.stringify({
            startsAt: new Date(startsAt).toISOString(),
            partySize,
            guestName,
            ...(contactPhone ? { contactPhone } : {}),
            ...(contactEmail ? { contactEmail } : {}),
            ...(notes ? { notes } : {}),
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      setResult(response.reservation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reservation could not be created");
    } finally {
      setBusy("");
    }
  };

  const joinWaitlist = async () => {
    setBusy("waitlist");
    setError("");
    try {
      const response = await guestRequest<{
        waitlist: { status: string; estimatedWaitMinutes: number };
      }>(`/api/seramet/guest/restaurants/${restaurant}/${branch}/waitlist`, {
        method: "POST",
        body: JSON.stringify({ guestName, partySize, ...(contactPhone ? { contactPhone } : {}) }),
      });
      setWaitlist(response.waitlist);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Waitlist entry could not be created");
    } finally {
      setBusy("");
    }
  };

  if (!branch) {
    return (
      <GuestShell>
        <GuestError message="Choose a branch before reserving." />
      </GuestShell>
    );
  }
  if (query.status === "loading")
    return (
      <GuestShell>
        <GuestLoading label="Loading reservation options" />
      </GuestShell>
    );
  if (!profile)
    return (
      <GuestShell>
        <GuestError message={query.error} />
      </GuestShell>
    );
  if (!profile.reservationsEnabled)
    return (
      <GuestShell profile={profile}>
        <GuestError message="Online reservations are not enabled for this branch." />
      </GuestShell>
    );

  return (
    <GuestShell profile={profile}>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <GuestBack restaurant={restaurant} branch={branch} />
        <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-lg border border-black/10 bg-white p-5 sm:p-7">
            <p className="text-xs font-bold uppercase text-[var(--guest-primary)]">Reservations</p>
            <h1 className="mt-2 text-3xl font-extrabold">Find a table</h1>
            <p className="mt-2 text-sm text-black/55">
              Availability is checked against current branch hours, table capacity, and existing
              bookings.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <GuestField
                label="Date and time"
                type="datetime-local"
                value={startsAt}
                min={defaultDate.slice(0, 10)}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                  setAvailability(null);
                }}
              />
              <GuestField
                label="Party size"
                type="number"
                min={1}
                max={100}
                value={partySize}
                onChange={(event) => {
                  setPartySize(Number(event.target.value));
                  setAvailability(null);
                }}
              />
            </div>
            <GuestButton
              className="mt-4 w-full sm:w-auto"
              onClick={searchAvailability}
              disabled={busy !== "" || !startsAt}
            >
              <Clock3 className="h-4 w-4" />{" "}
              {busy === "availability" ? "Checking" : "Check availability"}
            </GuestButton>

            {availability && (
              <div
                className={`mt-5 rounded-md border p-4 ${availability.available ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
              >
                <div className="flex items-center gap-2 font-bold">
                  {availability.available ? (
                    <CalendarCheck className="h-5 w-5 text-emerald-700" />
                  ) : (
                    <Users className="h-5 w-5 text-amber-700" />
                  )}
                  {availability.available
                    ? "A table is available"
                    : "No table is available for this time"}
                </div>
                {availability.available && (
                  <p className="mt-1 text-sm text-black/60">
                    Best available capacity:{" "}
                    {availability.capacityOptions[0]?.capacity ?? partySize} guests.
                  </p>
                )}
              </div>
            )}

            {availability?.available && !result && (
              <div className="mt-6 border-t border-black/10 pt-6">
                <h2 className="text-lg font-extrabold">Your details</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <GuestField
                    label="Name"
                    value={guestName}
                    maxLength={120}
                    onChange={(event) => setGuestName(event.target.value)}
                  />
                  <GuestField
                    label="Phone"
                    type="tel"
                    value={contactPhone}
                    maxLength={40}
                    onChange={(event) => setContactPhone(event.target.value)}
                  />
                  <GuestField
                    label="Email (optional)"
                    type="email"
                    value={contactEmail}
                    maxLength={254}
                    onChange={(event) => setContactEmail(event.target.value)}
                  />
                  <GuestField
                    label="Notes (optional)"
                    value={notes}
                    maxLength={280}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
                <GuestButton
                  className="mt-5 w-full"
                  onClick={reserve}
                  disabled={!guestName.trim() || busy !== ""}
                >
                  {busy === "reserve" ? "Reserving" : "Confirm reservation"}
                </GuestButton>
              </div>
            )}

            {availability && !availability.available && !waitlist && (
              <div className="mt-5">
                <GuestField
                  label="Name"
                  value={guestName}
                  maxLength={120}
                  onChange={(event) => setGuestName(event.target.value)}
                />
                <div className="mt-3">
                  <GuestField
                    label="Phone (optional)"
                    type="tel"
                    value={contactPhone}
                    maxLength={40}
                    onChange={(event) => setContactPhone(event.target.value)}
                  />
                </div>
                <GuestButton
                  className="mt-4 w-full"
                  secondary
                  onClick={joinWaitlist}
                  disabled={!guestName.trim() || busy !== ""}
                >
                  {busy === "waitlist" ? "Joining" : "Join waitlist"}
                </GuestButton>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            {result && (
              <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
                <CalendarCheck className="h-7 w-7 text-emerald-700" />
                <h2 className="mt-3 text-xl font-extrabold">
                  Reservation {result.status.toLowerCase()}
                </h2>
                <p className="mt-1 text-sm text-black/60">
                  {new Date(result.startsAt).toLocaleString()} for {result.partySize} guests.
                </p>
                <Link
                  to="/guest/$restaurant/reservation/$token"
                  params={{ restaurant, token: result.manageToken }}
                  className="mt-4 inline-flex min-h-11 items-center rounded-md bg-[#1c2522] px-4 text-sm font-bold text-white"
                >
                  Manage reservation
                </Link>
              </div>
            )}
            {waitlist && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5">
                <h2 className="font-extrabold">You are on the waitlist</h2>
                <p className="mt-1 text-sm">
                  Estimated wait: {waitlist.estimatedWaitMinutes} minutes. This is an operational
                  estimate, not a confirmed reservation.
                </p>
              </div>
            )}
          </section>
          <aside className="rounded-lg border border-black/10 bg-[#1c2522] p-5 text-white lg:self-start">
            <h2 className="font-extrabold">{profile.branchName}</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">{profile.address}</p>
            <p className="mt-5 text-xs leading-5 text-white/60">
              Your reservation is only confirmed when the status shown here says confirmed. Deposit
              requirements, where configured, use the restaurant's secure payment flow.
            </p>
          </aside>
        </div>
      </main>
    </GuestShell>
  );
}
