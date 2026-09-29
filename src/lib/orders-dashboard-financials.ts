import { currentDateKey } from "@/lib/currency";
import type { BillingRecord, TransactionState } from "@/lib/transaction-engine";
import { majorFromMinor, parseMajorAmount, sumMinor } from "@/payments/money";

type BranchMatcher = (branchIdOrName?: string) => boolean;

export type OrdersDashboardFinancials = {
  activeOrderValue: number;
  invoiceOutstanding: number;
  paidInvoiceSales: number;
  providerReceivables: number;
  completedRefunds: number;
};

/**
 * These metrics represent distinct financial populations; never derive sales or
 * receivables from order totals, and never add these figures together.
 *
 * Period semantics: orders use their creation business date, invoices their
 * issuance business date, and completed refunds their completion business date.
 * "Paid invoice sales" reflects invoices ISSUED in the selected period that
 * currently have PAID status. It is not a payment-date cash-flow or a formal
 * accounting revenue-recognition report; use Finance journals for those.
 */
export function ordersDashboardFinancials(
  state: Pick<TransactionState, "orders" | "bills" | "refunds" | "marketplaceReceivables">,
  matchesBranch: BranchMatcher,
  periodDate: string,
  timeZone: string,
  currency: string,
): OrdersDashboardFinancials {
  const matchesDate = (date: string | undefined, timestamp: string) =>
    !periodDate || (date || currentDateKey(new Date(timestamp), timeZone)) === periodDate;
  const amount = (value: number) => parseMajorAmount(value, currency);

  const activeOrderValueMinor = sumMinor(
    state.orders
      .filter(
        (order) =>
          matchesBranch(order.branchId ?? order.branch) &&
          matchesDate(order.businessDate, order.createdAt) &&
          ["HELD", "OPEN", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(
            order.status,
          ),
      )
      .map((order) => amount(order.total)),
  );

  // Only live, issued invoice records contribute. MERGED and SPLIT sources are
  // excluded to avoid duplicating the replacement invoices' balances and sales.
  const bills = state.bills.filter(
    (bill) =>
      matchesBranch(bill.branchId ?? bill.branch) &&
      matchesDate(bill.businessDate, bill.issuedAt) &&
      !["DRAFT_BILL", "VOID", "MERGED", "SPLIT"].includes(bill.status),
  );

  const due = (bill: BillingRecord) => Math.max(0, amount(bill.total) - amount(bill.paid));

  const invoiceOutstandingMinor = sumMinor(
    bills
      .filter((bill) =>
        ["UNPAID", "PARTIAL"].includes(bill.paymentStatus),
      )
      .map(due),
  );
  const paidInvoiceSalesMinor = sumMinor(
    bills.filter((bill) => bill.paymentStatus === "PAID").map((bill) => amount(bill.total)),
  );
  // Provider receivables are governed by their own settlement ledger, not
  // an invoice's "paid" field, which does not reflect provider remittances.
  const periodProviderInvoiceIds = new Set(
    bills.filter((bill) => bill.paymentStatus === "PROVIDER_RECEIVABLE").map((bill) => bill.id),
  );
  const providerReceivablesMinor = sumMinor(
    state.marketplaceReceivables
      .filter(
        (receivable) =>
          matchesBranch(receivable.branchId ?? receivable.branch) &&
          periodProviderInvoiceIds.has(receivable.invoiceId) &&
          !["CANCELLED", "SETTLED"].includes(receivable.status),
      )
      .map((receivable) => amount(Math.max(0, receivable.outstandingAmount))),
  );
  const completedRefundsMinor = sumMinor(
    state.refunds
      .filter(
        (refund) =>
          matchesBranch(refund.branchId ?? refund.branch) &&
          refund.status === "COMPLETED" &&
          matchesDate(refund.businessDate, refund.completedAt ?? refund.createdAt),
      )
      .map((refund) => amount(refund.amount)),
  );

  return {
    activeOrderValue: majorFromMinor(activeOrderValueMinor, currency),
    invoiceOutstanding: majorFromMinor(invoiceOutstandingMinor, currency),
    paidInvoiceSales: majorFromMinor(paidInvoiceSalesMinor, currency),
    providerReceivables: majorFromMinor(providerReceivablesMinor, currency),
    completedRefunds: majorFromMinor(completedRefundsMinor, currency),
  };
}
