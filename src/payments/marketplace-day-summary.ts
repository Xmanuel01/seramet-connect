import type { TransactionState } from "@/lib/transaction-engine";
import { businessDateForTimestamp } from "@/lib/business-date";
import { parseMajorAmount, sumMinor } from "@/payments/money";

export type MarketplaceDayRow = {
  connectionId: string;
  providerId: string;
  currency: string;
  received: number;
  accepted: number;
  cancelled: number;
  fulfilled: number;
  openOrderIds: string[];
  grossMinor: number;
  settledMinor: number;
  outstandingMinor: number;
  feesMinor: number;
  carriedOutstandingMinor: number;
};

export function marketplaceDaySummary(
  state: TransactionState,
  input: {
    tenantId: string;
    branchId: string;
    businessDate: string;
    timeZone: string;
    cutoffMinutes: number;
    currency: string;
  },
): MarketplaceDayRow[] {
  if (state.tenantId !== input.tenantId) throw new Error("Cross-tenant marketplace report denied");
  const date = (stamp: string) =>
    businessDateForTimestamp(stamp, input.timeZone, input.cutoffMinutes);
  const rows = new Map<string, MarketplaceDayRow>();
  const rowFor = (connectionId: string, providerId: string, currency: string) => {
    const key = `${connectionId}:${currency}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        connectionId,
        providerId,
        currency,
        received: 0,
        accepted: 0,
        cancelled: 0,
        fulfilled: 0,
        openOrderIds: [],
        grossMinor: 0,
        settledMinor: 0,
        outstandingMinor: 0,
        feesMinor: 0,
        carriedOutstandingMinor: 0,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const order of state.orders) {
    const source = order.externalSource;
    if (
      !source ||
      order.branchId !== input.branchId ||
      date(source.receivedAt) > input.businessDate
    )
      continue;
    const row = rowFor(source.connectionId, source.providerId, input.currency);
    const onDay = date(source.receivedAt) === input.businessDate;
    if (onDay) {
      row.received++;
      if (source.metadata["acceptanceConfirmedAt"]) row.accepted++;
      if (order.status === "CANCELLED") row.cancelled++;
      if (source.completedAt) row.fulfilled++;
    }
    if (order.status !== "CANCELLED" && !source.completedAt) row.openOrderIds.push(order.id);
  }
  for (const balance of state.marketplaceReceivables) {
    if (
      balance.tenantId !== input.tenantId ||
      balance.branchId !== input.branchId ||
      balance.status === "CANCELLED" ||
      date(balance.createdAt) > input.businessDate
    )
      continue;
    const row = rowFor(balance.connectionId, balance.providerId, balance.currency);
    const minor = (amount: number) => parseMajorAmount(amount, balance.currency);
    row.carriedOutstandingMinor = sumMinor([
      row.carriedOutstandingMinor,
      minor(balance.outstandingAmount),
    ]);
    if (date(balance.createdAt) === input.businessDate) {
      row.grossMinor = sumMinor([row.grossMinor, minor(balance.grossAmount)]);
      row.settledMinor = sumMinor([row.settledMinor, minor(balance.settledAmount)]);
      row.outstandingMinor = sumMinor([row.outstandingMinor, minor(balance.outstandingAmount)]);
    }
  }
  for (const charge of state.marketplaceCharges) {
    if (
      charge.tenantId !== input.tenantId ||
      charge.branchId !== input.branchId ||
      date(charge.createdAt) !== input.businessDate
    )
      continue;
    const providerId =
      state.orders.find((order) => order.id === charge.orderId)?.externalSource?.providerId ??
      charge.connectionId;
    const row = rowFor(charge.connectionId, providerId, charge.currency);
    row.feesMinor = sumMinor([row.feesMinor, parseMajorAmount(charge.amount, charge.currency)]);
  }
  return [...rows.values()].sort(
    (a, b) => a.connectionId.localeCompare(b.connectionId) || a.currency.localeCompare(b.currency),
  );
}
