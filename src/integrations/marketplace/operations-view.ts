import type { TransactionState } from "@/lib/transaction-engine";
import type { ExternalResourceMapping, IntegrationOutbox } from "@/integrations/runtime/models";
import { businessDateForTimestamp } from "@/lib/business-date";
import { marketplaceProgress } from "./order-progress";

export const orderStages = [
  "All active",
  "New",
  "Preparing",
  "Ready",
  "Collected",
  "Scheduled",
  "Completed",
] as const;
export type OrderStage = (typeof orderStages)[number];
export function orderStage(
  order: TransactionState["orders"][number],
  outbox: IntegrationOutbox[],
): OrderStage {
  const progress = marketplaceProgress(order, outbox);
  if (progress.closed) return "Completed";
  if (progress.progress === "Collected") return "Collected";
  if (progress.progress === "Scheduled") return "Scheduled";
  if (progress.progress === "Ready") return "Ready";
  if (["Preparing", "Kitchen queued", "Accepted"].includes(progress.progress)) return "Preparing";
  return "New";
}

export function prepCountdown(order: TransactionState["orders"][number], now: Date) {
  if (order.externalSource?.completedAt || order.status === "CANCELLED") return "Closed";
  if (!order.externalSource?.metadata["acceptanceConfirmedAt"]) return "Awaiting acceptance";
  if (order.externalSource.pickedUpAt) return "Collected";
  if (order.status === "READY") return "Ready for collection";
  const target = order.externalSource.scheduledFor ?? order.externalSource.estimatedReadyAt;
  if (!target || !Number.isFinite(Date.parse(target))) return "Ready time not set";
  const minutes = Math.ceil((Date.parse(target) - now.getTime()) / 60_000);
  return minutes >= 0 ? `${minutes} min remaining` : `${Math.abs(minutes)} min overdue`;
}

export type AvailabilityDuration = "MANUAL" | "30" | "60" | "TODAY";
export function restorationTime(
  duration: AvailabilityDuration,
  now: Date,
  timeZone: string,
): string | undefined {
  if (duration === "MANUAL") return undefined;
  if (duration !== "TODAY")
    return new Date(now.getTime() + Number(duration) * 60_000).toISOString();
  const today = businessDateForTimestamp(now, timeZone);
  // Find the next local midnight, including 23/25-hour daylight-saving days.
  let low = Math.floor(now.getTime() / 1000),
    high = low + 27 * 3600;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (businessDateForTimestamp(new Date(middle * 1000), timeZone) === today) low = middle;
    else high = middle;
  }
  return new Date(high * 1000).toISOString();
}

export function availabilityLabel(mapping?: ExternalResourceMapping) {
  if (!mapping) return "Not linked";
  if (mapping.syncStatus === "FAILED") return "Update failed";
  if (["PENDING", "SYNCING"].includes(mapping.syncStatus ?? "")) return "Updating";
  const desired = mapping.metadata["availabilityOverride"] as { available?: boolean } | undefined;
  if (mapping.syncStatus !== "SYNCED") return "Not verified";
  const actual = (mapping.metadata["lastAvailabilitySync"] ??
    mapping.metadata["lastIncrementalSync"]) as { available?: boolean } | undefined;
  const snapshot = mapping.metadata["lastSyncedSnapshot"] as { available?: boolean } | undefined;
  const available = actual?.available ?? snapshot?.available;
  if (desired && available !== desired.available) return "Not verified";
  return available === true
    ? "Confirmed available"
    : available === false
      ? "Confirmed unavailable"
      : "Menu published";
}
