import type { TransactionOrder } from "@/lib/transaction-engine";

const minute = 60_000;

/**
 * When a scheduled order must be ready and when the kitchen should get it.
 *
 * Ready time: the app's own pickup time where it gives one; otherwise the time the customer
 * wants it, less the rider's travel time (none for pickup). Kitchen time: the ready time less
 * the prep time and a safety buffer. Nothing is held when the kitchen time has already passed.
 */
export class InvalidScheduledTimeError extends Error {}

export function scheduledOrderTimes(input: {
  scheduledFor?: string;
  scheduledReadyAt?: string;
  pickup: boolean;
  travelMinutes: number;
  prepMinutes: number;
  bufferMinutes: number;
  now?: number;
}) {
  // A time that is sent but unreadable is never treated as "not scheduled": that would cook
  // a pre-order straight away.
  const wanted = parseTime(input.scheduledFor);
  const appReady = parseTime(input.scheduledReadyAt);
  if (
    (input.scheduledFor && wanted === undefined) ||
    (input.scheduledReadyAt && appReady === undefined)
  )
    throw new InvalidScheduledTimeError("The scheduled time is not a valid date");
  if (wanted === undefined && appReady === undefined) return undefined;
  const readyAt =
    appReady ?? wanted! - (input.pickup ? 0 : Math.max(0, input.travelMinutes)) * minute;
  const releaseAt =
    readyAt - (Math.max(0, input.prepMinutes) + Math.max(0, input.bufferMinutes)) * minute;
  return {
    scheduledReadyAt: new Date(readyAt).toISOString(),
    scheduledReleaseAt: new Date(releaseAt).toISOString(),
    hold: releaseAt > (input.now ?? Date.now()),
  };
}

/** A held scheduled order, whether the app sent a customer time, a ready time or both. */
export function isScheduledHold(order: Pick<TransactionOrder, "status" | "externalSource">) {
  const source = order.externalSource;
  return (
    order.status === "HELD" &&
    Boolean(source?.isScheduled || source?.scheduledFor || source?.scheduledReleaseAt)
  );
}

/**
 * Moves a held order's kitchen time with its ready time, keeping the same prep and buffer gap,
 * when staff or the app change when it must be ready.
 */
export function shiftScheduledRelease(
  source: NonNullable<TransactionOrder["externalSource"]>,
  readyAt: string,
) {
  const newReady = parseTime(readyAt);
  const oldReady = parseTime(source.scheduledReadyAt);
  const oldRelease = parseTime(source.scheduledReleaseAt);
  if (newReady === undefined || oldReady === undefined || oldRelease === undefined) return;
  source.scheduledReadyAt = new Date(newReady).toISOString();
  source.scheduledReleaseAt = new Date(newReady - (oldReady - oldRelease)).toISOString();
}

/**
 * The instant a branch means by a date and time typed into a datetime-local field
 * ("2026-11-18T19:30"), read in the branch's time zone rather than the device's.
 */
export function branchLocalTimeToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new InvalidScheduledTimeError("Enter the ready-by date and time");
  const [, y, mo, d, h, mi] = match.map(Number) as [
    unknown,
    number,
    number,
    number,
    number,
    number,
  ];
  const wallClock = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find((row) => row.type === type)?.value);
    return (
      Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - instant
    );
  };
  // Two passes settle the offset even across a daylight-saving change.
  let instant = wallClock - offsetAt(wallClock);
  instant = wallClock - offsetAt(instant);
  return new Date(instant).toISOString();
}

/** Scheduled orders still waiting for the kitchen, soonest first. */
export function upcomingScheduledOrders(orders: TransactionOrder[], branchId?: string) {
  return orders
    .filter(
      (order) =>
        order.status === "HELD" &&
        Boolean(order.externalSource?.scheduledReleaseAt) &&
        (!branchId || order.branchId === branchId),
    )
    .sort((left, right) =>
      left.externalSource!.scheduledReleaseAt!.localeCompare(
        right.externalSource!.scheduledReleaseAt!,
      ),
    );
}

function parseTime(value?: string) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}
