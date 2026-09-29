import type { TransactionOrder, BillingRecord } from "@/lib/transaction-engine";
import { currentDateKey } from "@/lib/currency";

/**
 * The POS queue holds orders through kitchen production until they have an
 * invoice. Dispatching a KOT must not hide an order that still needs billing.
 * Callers pass orders already scoped to the active tenant and branch.
 */
const POS_UNBILLED_KITCHEN_STATUSES = new Set([
  "SENT_TO_KITCHEN",
  "IN_PROGRESS",
  "READY",
  "SERVED",
]);

export function pendingPosOrders<T extends Pick<TransactionOrder, "id" | "status">>(
  orders: readonly T[],
  bills: readonly Pick<BillingRecord, "orderIds">[],
): T[] {
  const billedIds = new Set(bills.flatMap((bill) => bill.orderIds));
  return orders.filter(
    (order) =>
      !billedIds.has(order.id) &&
      (order.status === "HELD" ||
        order.status === "OPEN" ||
        POS_UNBILLED_KITCHEN_STATUSES.has(order.status)),
  );
}

/** Kitchen orders awaiting billing are visible in both POS and Invoices. */
export function unbilledKitchenOrders<T extends Pick<TransactionOrder, "id" | "status">>(
  orders: readonly T[],
  bills: readonly Pick<BillingRecord, "orderIds">[],
): T[] {
  const billedIds = new Set(bills.flatMap((bill) => bill.orderIds));
  return orders.filter(
    (order) => POS_UNBILLED_KITCHEN_STATUSES.has(order.status) && !billedIds.has(order.id),
  );
}

function validTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A Kenyan business whose onboarding still has the UTC default displays in EAT
 * unless its branch has explicitly configured a non-UTC IANA timezone.
 * Do not alter stored event timestamps, which remain UTC.
 */
export function resolvePosTimeZone(
  branchTimezone: string | undefined,
  tenantTimezone: string | undefined,
  tenantCountryCode: string | undefined,
  tenantCurrency?: string,
): string {
  const isKenyan =
    tenantCountryCode?.toUpperCase() === "KE" ||
    (!tenantCountryCode && tenantCurrency?.toUpperCase() === "KES");
  if (isKenyan) {
    if (validTimeZone(branchTimezone) && branchTimezone !== "UTC") return branchTimezone;
    if (validTimeZone(tenantTimezone) && tenantTimezone !== "UTC") return tenantTimezone;
    return "Africa/Nairobi";
  }
  if (validTimeZone(branchTimezone)) return branchTimezone;
  if (validTimeZone(tenantTimezone)) return tenantTimezone;
  return "UTC";
}

export function formatPosClock(date: Date, locale: string, timezone: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(date);
}

/** Invoice lists use authoritative restaurant business dates, never raw UTC day slices. */
export function invoiceBusinessDate(
  invoice: Pick<BillingRecord, "businessDate" | "issuedAt">,
  timezone: string,
) {
  return invoice.businessDate || currentDateKey(new Date(invoice.issuedAt), timezone);
}
