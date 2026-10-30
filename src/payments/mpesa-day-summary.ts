import { businessDateForTimestamp } from "@/lib/business-date";
import type { TransactionState } from "@/lib/transaction-engine";
import { sumMinor } from "@/payments/money";
import { unallocatedDirectPayments } from "@/payments/mpesa-matching";
import type { PaymentTransaction } from "@/payments/types";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export type MpesaChannel = "PROMPT" | "QR" | "DIRECT" | "CODE";

export type MpesaDaySummary = {
  currency: string;
  receivedMinor: number;
  count: number;
  channels: Array<{ channel: MpesaChannel; count: number; amountMinor: number }>;
  onBillsMinor: number;
  // Every M-Pesa payment for the branch not yet on a bill, up to this date (carried over).
  stillToMatch: Array<{
    transactionId: string;
    receipt?: string;
    businessDate: string;
    unallocatedMinor: number;
    payerName?: string;
  }>;
  stillToMatchMinor: number;
  failedPrompts: Array<{
    intentId: string;
    invoiceId?: string;
    amountMinor: number;
    reason: string;
  }>;
};

export const mpesaChannelLabels: Record<MpesaChannel, string> = {
  PROMPT: "Payment prompt (STK)",
  QR: "QR code",
  DIRECT: "Paid to till or Paybill",
  CODE: "Code typed by cashier",
};

/** Payment methods that collect through M-Pesa: linked to a Daraja connection or named M-Pesa. */
export function mpesaMethodIds(tenantId: string) {
  const configuration = getConfigurationRepository();
  const darajaConnections = new Set(
    configuration
      .listConnections(tenantId)
      .filter((connection) => connection.providerId === "provider-daraja")
      .map((connection) => connection.id),
  );
  return new Set(
    configuration
      .listPaymentMethods(tenantId, true)
      .filter(
        (method) =>
          (method.providerConnectionId && darajaConnections.has(method.providerConnectionId)) ||
          /m-?pesa/i.test(`${method.code} ${method.displayName}`),
      )
      .map((method) => method.id),
  );
}

function channelOf(payment: PaymentTransaction, operation: unknown): MpesaChannel {
  if (payment.metadata["directPayment"] === true) return "DIRECT";
  if (payment.metadata["verifiedPendingTransactionId"] || !payment.intentId) return "CODE";
  return operation === "QR_PAYMENT" ? "QR" : "PROMPT";
}

/**
 * What M-Pesa brought in for one branch and business date, how much of it is on bills, what is
 * still to match (including earlier days), and which prompts failed and why.
 */
export function mpesaDaySummary(
  state: TransactionState,
  scope: {
    tenantId: string;
    branchId: string;
    businessDate: string;
    timeZone: string;
    businessDayCutoffMinutes: number;
    currency: string;
  },
): MpesaDaySummary | undefined {
  const methods = mpesaMethodIds(scope.tenantId);
  if (!methods.size) return undefined;
  const configuration = getConfigurationRepository();
  const operationOf = new Map(
    configuration
      .listPaymentMethods(scope.tenantId, true)
      .map((method) => [method.id, method.metadata["providerOperation"]]),
  );
  const dateOf = (timestamp: string) =>
    businessDateForTimestamp(timestamp, scope.timeZone, scope.businessDayCutoffMinutes);
  const operations = state.paymentOperations;
  const received = (operations?.transactions ?? []).filter(
    (payment) =>
      payment.tenantId === scope.tenantId &&
      payment.branchId === scope.branchId &&
      payment.direction === "COLLECTION" &&
      ["CONFIRMED", "MANUALLY_CONFIRMED"].includes(payment.status) &&
      methods.has(payment.paymentMethodId) &&
      dateOf(payment.occurredAt) === scope.businessDate,
  );
  const channels = (["PROMPT", "QR", "DIRECT", "CODE"] as const)
    .map((channel) => {
      const rows = received.filter(
        (payment) => channelOf(payment, operationOf.get(payment.paymentMethodId)) === channel,
      );
      return {
        channel,
        count: rows.length,
        amountMinor: sumMinor(rows.map((payment) => payment.amountMinor)),
      };
    })
    .filter((row) => row.count > 0);
  const stillToMatch = unallocatedDirectPayments(state, scope.tenantId)
    .filter(
      (payment) =>
        payment.branchId === scope.branchId && dateOf(payment.occurredAt) <= scope.businessDate,
    )
    .map((payment) => {
      const payerName = payment.metadata["payerName"];
      return {
        transactionId: payment.id,
        ...(payment.providerTransactionId ? { receipt: payment.providerTransactionId } : {}),
        businessDate: dateOf(payment.occurredAt),
        unallocatedMinor: payment.unallocatedAmountMinor,
        ...(typeof payerName === "string" ? { payerName } : {}),
      };
    });
  const failedPrompts = (operations?.intents ?? [])
    .filter(
      (intent) =>
        intent.tenantId === scope.tenantId &&
        intent.branchId === scope.branchId &&
        intent.status === "FAILED" &&
        methods.has(intent.paymentMethodId) &&
        dateOf(intent.updatedAt) === scope.businessDate,
    )
    .map((intent) => {
      const reason = intent.metadata["failureReason"];
      return {
        intentId: intent.id,
        ...(intent.invoiceIds[0] ? { invoiceId: intent.invoiceIds[0] } : {}),
        amountMinor: intent.amountRequestedMinor,
        reason: typeof reason === "string" ? reason : "Not completed",
      };
    });
  if (!received.length && !stillToMatch.length && !failedPrompts.length) return undefined;
  const receivedMinor = sumMinor(received.map((payment) => payment.amountMinor));
  return {
    currency: scope.currency,
    receivedMinor,
    count: received.length,
    channels,
    onBillsMinor: sumMinor(
      received.map((payment) => payment.amountMinor - payment.unallocatedAmountMinor),
    ),
    stillToMatch,
    stillToMatchMinor: sumMinor(stillToMatch.map((payment) => payment.unallocatedMinor)),
    failedPrompts,
  };
}
