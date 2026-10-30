import type { BillingRecord, TransactionState } from "@/lib/transaction-engine";
import { parseMajorAmount } from "@/payments/money";
import type { PaymentTransaction } from "@/payments/types";

// How M-Pesa money that arrived without a Seramet prompt is matched to bills.
//
// Applied automatically only with proof: the receipt code a cashier typed, or a Paybill account
// number naming the bill with the exact amount. Everything else is a suggestion for a person to
// confirm, and amount differences are never settled automatically.

/** A payment's receipt or a typed code, compared without spaces, dashes or case. */
export function normalizedCode(value: string | undefined) {
  return (value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Direct payments still holding money that has not been applied to a bill. */
export function unallocatedDirectPayments(state: TransactionState, tenantId: string) {
  return (state.paymentOperations?.transactions ?? []).filter(
    (item) =>
      item.tenantId === tenantId &&
      item.direction === "COLLECTION" &&
      item.status === "CONFIRMED" &&
      item.metadata["directPayment"] === true &&
      item.unallocatedAmountMinor > 0,
  );
}

/** The direct payment carrying this M-Pesa receipt code, if it has arrived. */
export function directPaymentByReceipt(
  state: TransactionState,
  tenantId: string,
  code: string,
  providerConnectionId?: string,
) {
  const wanted = normalizedCode(code);
  if (!wanted) return undefined;
  return (state.paymentOperations?.transactions ?? []).find(
    (item) =>
      item.tenantId === tenantId &&
      item.metadata["directPayment"] === true &&
      (!providerConnectionId || item.providerConnectionId === providerConnectionId) &&
      normalizedCode(item.providerTransactionId) === wanted,
  );
}

/** A typed code waiting for M-Pesa's notification of the same receipt. */
export function unverifiedByReceipt(
  state: TransactionState,
  tenantId: string,
  providerConnectionId: string,
  receipt: string,
) {
  const wanted = normalizedCode(receipt);
  return (state.paymentOperations?.transactions ?? []).find(
    (item) =>
      item.tenantId === tenantId &&
      item.status === "UNVERIFIED" &&
      item.providerConnectionId === providerConnectionId &&
      normalizedCode(item.customerReference) === wanted,
  );
}

export function openBalanceMinor(bill: BillingRecord, currency: string) {
  return parseMajorAmount(Math.max(0, bill.total - bill.paid), currency);
}

function openBills(state: TransactionState, tenantId: string, branchId: string) {
  return state.bills.filter(
    (bill) =>
      (bill.tenantId ?? tenantId) === tenantId &&
      bill.branchId === branchId &&
      ["OPEN", "PARTIAL", "PENDING"].includes(bill.status),
  );
}

/**
 * The one open bill a Paybill account number names, when the payment covers its balance exactly.
 * References may be shortened to Daraja's last 12 characters, so they are compared as suffixes.
 */
export function billNamedByReference(state: TransactionState, payment: PaymentTransaction) {
  const typed = normalizedCode(payment.merchantReference);
  if (typed.length < 4 || typed === normalizedCode(payment.providerTransactionId)) return undefined;
  const matches = openBills(state, payment.tenantId, payment.branchId).filter((bill) => {
    const id = normalizedCode(bill.id);
    return (
      id.length >= typed.length &&
      id.endsWith(typed) &&
      openBalanceMinor(bill, payment.currency) === payment.unallocatedAmountMinor
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export type MatchSuggestion = {
  invoiceId: string;
  table?: string;
  issuedAt: string;
  balanceMinor: number;
  minutesApart: number;
};

export type UnmatchedPayment = {
  transactionId: string;
  receipt?: string;
  amountMinor: number;
  unallocatedMinor: number;
  currency: string;
  occurredAt: string;
  payerName?: string;
  customerReference?: string;
  accountReference?: string;
  suggestions: MatchSuggestion[];
};

// A bill issued shortly before the payment, or just after it (customers sometimes pay first).
const BEFORE_MINUTES = 90;
const AFTER_MINUTES = 15;

/**
 * Unmatched direct payments for a branch, each with the open bills of exactly the same balance
 * issued around the time of payment, closest first.
 */
export function unmatchedDirectPayments(
  state: TransactionState,
  tenantId: string,
  branchId: string,
): UnmatchedPayment[] {
  const bills = openBills(state, tenantId, branchId);
  return unallocatedDirectPayments(state, tenantId)
    .filter((payment) => payment.branchId === branchId)
    .map((payment) => {
      const paidAt = Date.parse(payment.occurredAt);
      const suggestions = bills
        .map((bill) => ({
          bill,
          balanceMinor: openBalanceMinor(bill, payment.currency),
          minutesApart: (paidAt - Date.parse(bill.issuedAt)) / 60_000,
        }))
        .filter(
          (item) =>
            item.balanceMinor === payment.unallocatedAmountMinor &&
            item.minutesApart <= BEFORE_MINUTES &&
            item.minutesApart >= -AFTER_MINUTES,
        )
        .sort((left, right) => Math.abs(left.minutesApart) - Math.abs(right.minutesApart))
        .map(({ bill, balanceMinor, minutesApart }) => ({
          invoiceId: bill.id,
          ...(bill.table ? { table: bill.table } : {}),
          issuedAt: bill.issuedAt,
          balanceMinor,
          minutesApart: Math.round(minutesApart),
        }));
      const payerName = payment.metadata["payerName"];
      return {
        transactionId: payment.id,
        ...(payment.providerTransactionId ? { receipt: payment.providerTransactionId } : {}),
        amountMinor: payment.amountMinor,
        unallocatedMinor: payment.unallocatedAmountMinor,
        currency: payment.currency,
        occurredAt: payment.occurredAt,
        ...(typeof payerName === "string" ? { payerName } : {}),
        ...(payment.customerReference ? { customerReference: payment.customerReference } : {}),
        ...(payment.merchantReference !== payment.providerTransactionId
          ? { accountReference: payment.merchantReference }
          : {}),
        suggestions,
      };
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
