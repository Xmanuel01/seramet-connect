import type { ReceiptRecord, TransactionState } from "@/lib/transaction-engine";
import { parseMajorAmount, sumMinor } from "./money";

/** Reserve requests against actual collected funds, across all receipts for the invoice. */
export function refundableReceiptMinor(
  state: TransactionState,
  receipt: ReceiptRecord,
  method: string,
  currency: string,
  excludeId?: string,
) {
  const collected = sumMinor(
    state.payments
      .filter(
        (payment) =>
          payment.invoiceId === receipt.invoiceId &&
          payment.method === method &&
          ["SETTLED", "NOT_REQUIRED"].includes(payment.settlementStatus) &&
          (!payment.tenantId || payment.tenantId === state.tenantId),
      )
      .map((payment) => parseMajorAmount(payment.amount, currency)),
  );
  const evidenced = sumMinor(
    receipt.paymentBreakdown
      .filter((payment) => payment.method === method)
      .map((payment) => parseMajorAmount(payment.amount, currency)),
  );
  const reserved = sumMinor(
    state.refunds
      .filter(
        (refund) =>
          refund.invoiceId === receipt.invoiceId &&
          refund.method === method &&
          refund.status !== "REJECTED" &&
          refund.id !== excludeId,
      )
      .map((refund) => Math.max(0, parseMajorAmount(refund.amount, currency))),
  );
  return Math.max(
    0,
    Math.min(collected, evidenced, parseMajorAmount(receipt.paidAmount, currency)) - reserved,
  );
}
