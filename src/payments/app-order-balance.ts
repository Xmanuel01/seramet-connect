import type { TransactionState } from "@/lib/transaction-engine";
import { majorFromMinor } from "@/payments/money";

/**
 * What is still to come in for a delivery-app invoice, split by who owes it: the app (cleared
 * when its payout is matched) and the customer (cleared at the counter with what was paid).
 * The split comes from the order itself, so any mix of prepaid and pay-on-delivery works.
 */
export type AppOrderBalance = {
  orderId: string;
  providerId: string;
  currency: string;
  /** Still expected in the app's payout. */
  appOwes: number;
  /** Still to be paid to the restaurant by the customer or the courier. */
  toCollect: number;
  /** Already received at the restaurant or by a rider. */
  collected: number;
  obligationId?: string;
};

export function appOrderBalance(
  state: Pick<TransactionState, "marketplaceReceivables" | "paymentOperations">,
  invoiceId: string,
): AppOrderBalance | undefined {
  const receivable = state.marketplaceReceivables.find(
    (row) => row.invoiceId === invoiceId && row.status !== "CANCELLED",
  );
  if (!receivable) return undefined;
  const obligation = state.paymentOperations?.custodyObligations.find(
    (row) => row.orderId === receivable.orderId && !["CANCELLED", "DISPUTED"].includes(row.status),
  );
  const expectedFromApp = receivable.platformExpectedAmount ?? receivable.externallyCollectedAmount;
  return {
    orderId: receivable.orderId,
    providerId: receivable.providerId,
    currency: receivable.currency,
    appOwes: Math.max(0, expectedFromApp - receivable.settledAmount),
    toCollect: obligation
      ? majorFromMinor(
          Math.max(0, obligation.amountDueMinor - obligation.collectedMinor),
          obligation.currency,
        )
      : 0,
    collected: obligation ? majorFromMinor(obligation.collectedMinor, obligation.currency) : 0,
    ...(obligation ? { obligationId: obligation.id } : {}),
  };
}

/** One short status for lists: what is still open on a delivery-app invoice. */
export function appOrderBalanceLabel(balance: AppOrderBalance) {
  if (balance.toCollect > 0 && balance.appOwes > 0) return "To collect + owed by app";
  if (balance.toCollect > 0) return "To collect";
  if (balance.appOwes > 0) return "Owed by app";
  return "Settled";
}
