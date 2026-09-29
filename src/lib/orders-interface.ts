import { currentDateKey } from "@/lib/currency";
import type { BillingRecord, TransactionOrder } from "@/lib/transaction-engine";

/** Respect the restaurant's explicit business date; legacy orders use local event date. */
export function orderBusinessDate(
  order: Pick<TransactionOrder, "businessDate" | "createdAt">,
  timeZone: string,
) {
  return order.businessDate || currentDateKey(new Date(order.createdAt), timeZone);
}

/** Printing a bill never changes order state. Split invoices are deliberately
 * ambiguous: the cashier must choose the exact invoice on the Invoices page.
 */
export function invoiceCandidatesForOrder(
  bills: readonly BillingRecord[],
  order: Pick<TransactionOrder, "id" | "tenantId" | "branchId" | "branch">,
  matchesBranch: (branchIdOrName?: string) => boolean,
) {
  return bills.filter(
    (bill) =>
      bill.orderIds.includes(order.id) &&
      matchesBranch(bill.branchId ?? bill.branch) &&
      (!order.tenantId || bill.tenantId === order.tenantId) &&
      (!order.branchId || (bill.branchId ?? bill.branch) === order.branchId) &&
      !["VOID", "MERGED", "SPLIT", "DRAFT_BILL"].includes(bill.status),
  );
}
