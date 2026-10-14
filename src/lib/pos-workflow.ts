import { businessDateForTimestamp } from "@/lib/business-date";
import type { TransactionOrder, BillingRecord } from "@/lib/transaction-engine";
import { currentDateKey } from "@/lib/currency";

/**
 * The POS Orders badge counts only orders that still require cashier dispatch.
 * Kitchen work and billing remain authoritative, but live in their own screens.
 */
export function pendingPosOrders<T extends Pick<TransactionOrder, "id" | "status">>(
  orders: readonly T[],
  bills: readonly Pick<BillingRecord, "orderIds">[],
): T[] {
  const billedIds = new Set(bills.flatMap((bill) => bill.orderIds));
  return orders.filter(
    (order) => (order.status === "HELD" || order.status === "OPEN") && !billedIds.has(order.id),
  );
}

/** Kitchen orders can be billed even after leaving the POS entry queue. */
export function unbilledKitchenOrders<T extends Pick<TransactionOrder, "id" | "status">>(
  orders: readonly T[],
  bills: readonly Pick<BillingRecord, "orderIds">[],
): T[] {
  const billedIds = new Set(bills.flatMap((bill) => bill.orderIds));
  return orders.filter(
    (order) =>
      ["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(order.status) &&
      !billedIds.has(order.id),
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
    hourCycle: "h23",
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

/**
 * Prefer the business date assigned by the server. The timestamp fallback is
 * for legacy records only and mirrors the authoritative branch cutoff rule.
 */
export function recordBusinessDate(
  businessDate: string | undefined,
  timestamp: string,
  timezone: string,
  cutoffMinutes = 0,
) {
  if (businessDate) return businessDate;
  return businessDateForTimestamp(timestamp, timezone, cutoffMinutes);
}
