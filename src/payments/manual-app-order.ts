import { TransactionEngine, type TransactionState } from "@/lib/transaction-engine";
import { custodyLedger } from "@/payments/custody-ledger";
import { majorFromMinor, parseMajorAmount } from "@/payments/money";
import type { OrderChannelDefinition, PaymentMethodDefinition } from "@/platform/types";

/** What the cashier types for a delivery-app order that did not arrive by connection. */
export type ManualAppOrderInput = {
  /** The app's own order number, as shown on its tablet or receipt. */
  externalOrderId: string;
  /** Part the customer pays on delivery; the rest was paid in the app. */
  dueOnDeliveryMinor?: number;
  /** For a scheduled app order: when its rider collects it. The kitchen gets it beforehand. */
  readyBy?: string;
};

const maxScheduleAheadMs = 7 * 24 * 60 * 60_000;

export function parseManualAppOrder(value: unknown): ManualAppOrderInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const externalOrderId =
    typeof row["externalOrderId"] === "string" ? row["externalOrderId"].trim() : "";
  const due = row["dueOnDeliveryMinor"] === undefined ? 0 : Number(row["dueOnDeliveryMinor"]);
  if (!externalOrderId || externalOrderId.length > 80)
    throw new Error("Enter the delivery app's order number (up to 80 characters)");
  if (!Number.isSafeInteger(due) || due < 0)
    throw new Error("The amount due on delivery must be zero or more");
  const readyByText = typeof row["readyBy"] === "string" ? row["readyBy"].trim() : "";
  if (!readyByText) return { externalOrderId, dueOnDeliveryMinor: due };
  const readyBy = Date.parse(readyByText);
  if (!Number.isFinite(readyBy) || readyBy <= Date.now())
    throw new Error("The ready-by time must be later than now");
  if (readyBy - Date.now() > maxScheduleAheadMs)
    throw new Error("A scheduled order can be at most 7 days ahead");
  return {
    externalOrderId,
    dueOnDeliveryMinor: due,
    readyBy: new Date(readyBy).toISOString(),
  };
}

/**
 * The ledger account for money a delivery app owes: the channel's chosen account, else the
 * restaurant's customer receivables account that every payment method posts to.
 */
export function appReceivableAccount(
  methods: Pick<PaymentMethodDefinition, "enabled" | "receivableAccountId">[],
  chosen?: string,
) {
  const account =
    chosen ??
    methods.find((method) => method.enabled && method.receivableAccountId)?.receivableAccountId;
  if (!account)
    throw new Error("Set up the customer receivables account before taking delivery-app orders");
  return account;
}

/**
 * Books a hand-typed delivery-app order as owed by the app instead of a till sale: its invoice
 * waits for the app's payout, and any pay-on-delivery part waits to be collected. Amendments
 * are refused once booked, because the app's amount is fixed by the app.
 */
export function recordManualAppOrder(
  state: TransactionState,
  orderId: string,
  input: ManualAppOrderInput,
  context: {
    channel: OrderChannelDefinition;
    currency: string;
    receivableAccount: string;
    /** Set when the order waits for the kitchen until its scheduled time. */
    schedule?: { scheduledReadyAt: string; scheduledReleaseAt: string };
  },
) {
  const order = state.orders.find((row) => row.id === orderId);
  if (!order) throw new Error(`Order ${orderId} was not found`);
  const connectionId = `manual:${context.channel.id}`;
  const duplicate = state.orders.find(
    (row) =>
      row.id !== orderId &&
      row.status !== "CANCELLED" &&
      row.externalSource?.connectionId === connectionId &&
      row.externalSource.externalOrderId.toUpperCase() === input.externalOrderId.toUpperCase(),
  );
  if (duplicate)
    throw new Error(
      `${context.channel.displayName} order ${input.externalOrderId} is already ${duplicate.id}`,
    );
  const totalMinor = parseMajorAmount(order.total, context.currency);
  const dueMinor = input.dueOnDeliveryMinor ?? 0;
  if (dueMinor > totalMinor)
    throw new Error("The amount due on delivery is more than the order total");
  const paidInApp = majorFromMinor(totalMinor - dueMinor, context.currency);
  order.externalSource = {
    connectionId,
    providerId: context.channel.code,
    externalStoreId: "",
    externalOrderId: input.externalOrderId,
    providerDisplayReference: input.externalOrderId,
    externallyPaid: dueMinor === 0,
    externallyCollectedAmount: paidInApp,
    platformCollectedAmount: paidInApp,
    collectionMode:
      dueMinor === 0 ? "PLATFORM_PREPAID" : dueMinor === totalMinor ? "CASH_DUE" : "MIXED",
    ...(dueMinor ? { cashAmountDue: majorFromMinor(dueMinor, context.currency) } : {}),
    fulfilmentType: "PROVIDER_DELIVERY",
    isScheduled: Boolean(input.readyBy),
    ...(context.schedule
      ? {
          scheduledReadyAt: context.schedule.scheduledReadyAt,
          scheduledReleaseAt: context.schedule.scheduledReleaseAt,
          estimatedReadyAt: context.schedule.scheduledReadyAt,
        }
      : {}),
    receivedAt: order.createdAt,
    // Typed in from the app's tablet, so it is already accepted there; the scheduled release
    // job sends it to the kitchen when its time comes.
    metadata: {
      manualEntry: true,
      ...(context.schedule ? { acceptanceConfirmedAt: order.createdAt } : {}),
    },
  };
  let next = TransactionEngine.recordMarketplaceReceivable(state, orderId, {
    connectionId,
    providerId: context.channel.code,
    externalOrderId: input.externalOrderId,
    providerDisplayReference: input.externalOrderId,
    currency: context.currency,
    externallyCollectedAmount: paidInApp,
    receivableAccount: context.receivableAccount,
    metadata: { manualEntry: true },
  });
  if (dueMinor > 0) {
    next = custodyLedger.createObligation(next, {
      tenantId: order.tenantId ?? next.tenantId!,
      branchId: order.branchId!,
      orderId,
      connectionId,
      providerId: context.channel.code,
      externalOrderId: input.externalOrderId,
      currency: context.currency,
      collectionMode: dueMinor === totalMinor ? "CASH_DUE" : "MIXED",
      amountDueMinor: dueMinor,
      merchantAmountDueMinor: dueMinor,
    });
    const obligation = next.paymentOperations?.custodyObligations.find(
      (row) => row.orderId === orderId,
    );
    const saved = next.orders.find((row) => row.id === orderId);
    if (obligation && saved?.externalSource)
      saved.externalSource.custodyObligationId = obligation.id;
  }
  return next;
}
