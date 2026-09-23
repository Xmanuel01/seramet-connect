import type { Product } from "@/lib/menu-product";
import type { ProductionStatus, TransactionLine, TransactionOrder } from "@/lib/transaction-engine";
import type { Station } from "@/platform/types";

export type KitchenState = Exclude<ProductionStatus, "CANCELLED">;
export type KitchenSlaState = "ON_TIME" | "APPROACHING" | "LATE" | "UNTARGETED";

export type KitchenTicket = {
  id: string;
  orderId: string;
  station: string;
  stationLabel: string;
  stationConfigured: boolean;
  table: string;
  startedAt: string;
  ageMinutes: number;
  targetMinutes: number | null;
  slaState: KitchenSlaState;
  state: KitchenState;
  items: Array<{
    id: string;
    label: string;
    note?: string;
  }>;
  orderNote?: string;
  paymentStatus: TransactionOrder["paymentStatus"];
};

export function shouldShowKitchenOrder(order: TransactionOrder) {
  if (order.status === "CANCELLED" || order.status === "REFUNDED") return false;
  return !isProductionComplete(order);
}

export function isProductionComplete(order: TransactionOrder) {
  const production = order.lines.filter(isProductionLine);
  if (production.length === 0) return true;
  return production.every(
    (line) => line.productionStatus === "SERVED" || line.productionStatus === "CANCELLED",
  );
}

export function buildKitchenTickets(
  order: TransactionOrder,
  configuredStations: readonly Station[],
  menuItems: readonly Product[],
  nowMs = Date.now(),
): KitchenTicket[] {
  const grouped = new Map<string, TransactionLine[]>();
  for (const line of order.lines) {
    if (!isProductionLine(line) || line.productionStatus === "CANCELLED") continue;
    const station = line.productionStation!.trim();
    grouped.set(station, [...(grouped.get(station) ?? []), line]);
  }

  return [...grouped.entries()].map(([station, lines]) => {
    const configured = configuredStation(configuredStations, station);
    const startedAt = ticketStart(order, lines);
    const ageMinutes = minutesBetween(startedAt, nowMs);
    const targetMinutes = ticketTargetMinutes(order, lines, menuItems, startedAt);
    return {
      id: `${order.id}:${station}`,
      orderId: order.id,
      station,
      stationLabel: configured?.name ?? station,
      stationConfigured: Boolean(configured),
      table: order.table ?? `ORDER ${order.id.replace("ORD-", "")}`,
      startedAt,
      ageMinutes,
      targetMinutes,
      slaState: slaState(ageMinutes, targetMinutes),
      state: aggregateState(lines),
      items: lines.map((line) => ({
        id: line.id,
        label: `${line.name} x${line.quantity}`,
        ...(line.itemNote ? { note: line.itemNote } : {}),
      })),
      ...(order.kitchenNote ? { orderNote: order.kitchenNote } : {}),
      paymentStatus: order.paymentStatus,
    };
  });
}

export function aggregateState(lines: readonly TransactionLine[]): KitchenState {
  const active = lines.filter((line) => line.productionStatus !== "CANCELLED");
  if (active.length === 0) return "SERVED";
  const statuses = active.map((line) => line.productionStatus ?? "NEW");
  if (statuses.every((status) => status === "SERVED")) return "SERVED";
  if (statuses.every((status) => status === "READY" || status === "SERVED")) return "READY";
  if (statuses.some((status) => status === "PREPARING")) return "PREPARING";
  return "NEW";
}

export function nextForwardKitchenState(state: KitchenState): KitchenState | null {
  if (state === "NEW") return "PREPARING";
  if (state === "PREPARING") return "READY";
  if (state === "READY") return "SERVED";
  return null;
}

export function configuredStation(
  stations: readonly Station[],
  productionStation: string,
): Station | undefined {
  const target = normalizeStation(productionStation);
  return stations.find(
    (station) =>
      station.active &&
      (normalizeStation(station.code) === target || normalizeStation(station.name) === target),
  );
}

function isProductionLine(line: TransactionLine) {
  const station = line.productionStation?.trim();
  return Boolean(station && normalizeStation(station) !== "NONE");
}

function ticketStart(order: TransactionOrder, lines: readonly TransactionLine[]) {
  const sentTimes = lines
    .map((line) => line.sentAt)
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value!))))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return sentTimes[0] ?? order.createdAt;
}

function ticketTargetMinutes(
  order: TransactionOrder,
  lines: readonly TransactionLine[],
  menuItems: readonly Product[],
  startedAt: string,
) {
  const targets = lines
    .map((line) => {
      const product = menuItems.find(
        (item) =>
          (line.productId && item.id === line.productId) ||
          normalizeStation(item.name) === normalizeStation(line.name),
      );
      return product && Number.isFinite(product.prep) && product.prep > 0 ? product.prep : null;
    })
    .filter((value): value is number => value !== null);

  if (targets.length > 0) return Math.max(...targets);

  const estimatedReadyAt = order.externalSource?.estimatedReadyAt;
  if (!estimatedReadyAt) return null;
  const start = Date.parse(startedAt);
  const ready = Date.parse(estimatedReadyAt);
  if (!Number.isFinite(start) || !Number.isFinite(ready) || ready <= start) return null;
  return Math.max(1, Math.ceil((ready - start) / 60_000));
}

function slaState(ageMinutes: number, targetMinutes: number | null): KitchenSlaState {
  if (!targetMinutes) return "UNTARGETED";
  if (ageMinutes >= targetMinutes) return "LATE";
  if (ageMinutes >= Math.max(1, Math.floor(targetMinutes * 0.8))) return "APPROACHING";
  return "ON_TIME";
}

function minutesBetween(startedAt: string, nowMs: number) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((nowMs - start) / 60_000));
}

function normalizeStation(value: string) {
  return value.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ").toUpperCase();
}
