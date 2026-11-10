import { businessDateForTimestamp } from "@/lib/business-date";
import type {
  TransactionOrder,
  BillingRecord,
  KitchenPrintObligation,
} from "@/lib/transaction-engine";
import { currentDateKey } from "@/lib/currency";

/** Orders still on the till: held, or sent to the kitchen and not yet billed. */
export function pendingPosOrders<T extends Pick<TransactionOrder, "id" | "status">>(
  orders: readonly T[],
  bills: readonly Pick<BillingRecord, "orderIds">[],
): T[] {
  const billedIds = new Set(bills.flatMap((bill) => bill.orderIds));
  return orders.filter(
    (order) =>
      ["HELD", "OPEN", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(
        order.status,
      ) && !billedIds.has(order.id),
  );
}

/** Server acknowledgement survives terminal changes; local queue presence does not. */
export function acknowledgedKitchenDispatch(
  order: TransactionOrder,
  obligations: readonly KitchenPrintObligation[],
  tenantId: string,
  branchId: string,
) {
  if (
    order.tenantId !== tenantId ||
    order.branchId !== branchId ||
    !["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED", "BILL_REQUESTED"].includes(order.status)
  )
    return false;
  const lines = order.lines.filter(
    (line) =>
      line.sentAt && line.productionStatus !== "CANCELLED" && line.productionStation !== "NONE",
  );
  const tickets = obligations.filter(
    (ticket) =>
      ticket.tenantId === tenantId &&
      ticket.branchId === branchId &&
      ticket.orderId === order.id &&
      ticket.kind !== "REPRINT",
  );
  if (
    !lines.length ||
    !tickets.length ||
    tickets.some((ticket) => ticket.status !== "BRIDGE_ACCEPTED" && ticket.status !== "BYPASSED")
  )
    return false;
  return lines.every(
    (line) =>
      tickets.reduce(
        (quantity, ticket) =>
          quantity +
          ticket.lines
            .filter((sent) => sent.id === line.id)
            .reduce((sum, sent) => sum + sent.quantity, 0),
        0,
      ) >= line.quantity,
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

function utcTimeZone(value: string) {
  return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone === "UTC";
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
    if (validTimeZone(branchTimezone) && !utcTimeZone(branchTimezone)) return branchTimezone;
    if (validTimeZone(tenantTimezone) && !utcTimeZone(tenantTimezone)) return tenantTimezone;
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

/**
 * The branch's business day right now. Until the branch cutoff it is still the previous
 * date, so documents made after midnight stay under "today". Pass the resolved branch
 * timezone (the app context's). A missing or invalid cutoff uses the server's 4am default,
 * and an invalid timezone falls back to UTC, so a bad setting never breaks a page.
 */
export function branchBusinessToday(
  cutoffMinutes: unknown,
  resolvedTimeZone: string,
  now = new Date(),
) {
  const cutoff = Number(cutoffMinutes ?? DEFAULT_BUSINESS_DAY_CUTOFF_MINUTES);
  return businessDateForTimestamp(
    now,
    validTimeZone(resolvedTimeZone) ? resolvedTimeZone : "UTC",
    Number.isInteger(cutoff) && cutoff >= 0 && cutoff < 1_440
      ? cutoff
      : DEFAULT_BUSINESS_DAY_CUTOFF_MINUTES,
  );
}

/** branches.business_day_cutoff_minutes defaults to 240 in the schema. */
const DEFAULT_BUSINESS_DAY_CUTOFF_MINUTES = 240;
