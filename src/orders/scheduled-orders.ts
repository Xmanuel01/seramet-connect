import type { TransactionOrder } from "@/lib/transaction-engine";

const minute = 60_000;

/**
 * When a scheduled order must be ready and when the kitchen should get it.
 *
 * Ready time: the app's own pickup time where it gives one; otherwise the time the customer
 * wants it, less the rider's travel time (none for pickup). Kitchen time: the ready time less
 * the prep time and a safety buffer. Nothing is held when the kitchen time has already passed.
 */
export function scheduledOrderTimes(input: {
  scheduledFor?: string;
  scheduledReadyAt?: string;
  pickup: boolean;
  travelMinutes: number;
  prepMinutes: number;
  bufferMinutes: number;
  now?: number;
}) {
  const wanted = parseTime(input.scheduledFor);
  const appReady = parseTime(input.scheduledReadyAt);
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
