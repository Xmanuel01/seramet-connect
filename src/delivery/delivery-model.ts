import type { TransactionOrder, TransactionState } from "@/lib/transaction-engine";
import { majorFromMinor } from "@/payments/money";
import type { CustodyObligation } from "@/payments/types";
import type { OrderChannelDefinition } from "@/platform/types";

export type DeliveryFulfilment = "OWN_DELIVERY" | "PROVIDER_DELIVERY" | "PICKUP" | "NOT_DELIVERY";

function configuredFulfilment(channel?: OrderChannelDefinition): DeliveryFulfilment | undefined {
  if (!channel) return undefined;
  const configured = String(
    channel.metadata["defaultFulfilment"] ?? channel.metadata["fulfilmentOwner"] ?? "",
  ).toUpperCase();
  if (["RESTAURANT", "OWN_DELIVERY", "OWN"].includes(configured)) return "OWN_DELIVERY";
  if (["PROVIDER", "PLATFORM", "PROVIDER_DELIVERY"].includes(configured)) {
    return "PROVIDER_DELIVERY";
  }
  if (configured === "PICKUP") return "PICKUP";
  if (channel.metadata["riderManagedExternally"] === true) return "PROVIDER_DELIVERY";
  return undefined;
}

export function resolveDeliveryFulfilment(
  order: TransactionOrder,
  channel?: OrderChannelDefinition,
): DeliveryFulfilment {
  if (order.externalSource?.fulfilmentType === "PICKUP") return "PICKUP";
  if (order.guestContext?.serviceMode === "PICKUP") return "PICKUP";

  const configured = configuredFulfilment(channel);
  if (configured) return configured;

  if (order.externalSource?.fulfilmentType) return order.externalSource.fulfilmentType;
  if (order.guestContext?.serviceMode === "DIRECT_DELIVERY") return "OWN_DELIVERY";
  if (channel?.channelType === "OWN_DELIVERY") return "OWN_DELIVERY";
  if (channel?.channelType === "MARKETPLACE") return "PROVIDER_DELIVERY";
  return "NOT_DELIVERY";
}

export function custodyObligationForOrder(
  state: TransactionState,
  order: TransactionOrder,
): CustodyObligation | undefined {
  const operations = state.paymentOperations;
  if (!operations) return undefined;
  return operations.custodyObligations.find(
    (obligation) =>
      obligation.id === order.externalSource?.custodyObligationId ||
      obligation.orderId === order.id,
  );
}

export function customerCollectedAmount(state: TransactionState, order: TransactionOrder) {
  const obligation = custodyObligationForOrder(state, order);
  return obligation ? majorFromMinor(obligation.collectedMinor, obligation.currency) : 0;
}

export function cashDueRemaining(state: TransactionState, order: TransactionOrder) {
  const obligation = custodyObligationForOrder(state, order);
  return obligation
    ? majorFromMinor(
        Math.max(0, obligation.amountDueMinor - obligation.collectedMinor),
        obligation.currency,
      )
    : 0;
}

export function riderHeldAmount(state: TransactionState, order: TransactionOrder) {
  const obligation = custodyObligationForOrder(state, order);
  const operations = state.paymentOperations;
  if (!obligation || !operations) return 0;
  const minor = operations.custodyMovements
    .filter(
      (movement) =>
        movement.obligationId === obligation.id &&
        movement.type === "CUSTOMER_COLLECTION" &&
        movement.toHolder === "RIDER",
    )
    .reduce((sum, movement) => sum + movement.amountMinor, 0);
  return majorFromMinor(minor, obligation.currency);
}

export function riderRemittedForOrder(state: TransactionState, order: TransactionOrder) {
  const obligation = custodyObligationForOrder(state, order);
  const operations = state.paymentOperations;
  if (!obligation || !operations) return 0;
  const minor = operations.custodyMovements
    .filter(
      (movement) =>
        movement.obligationId === obligation.id &&
        movement.fromHolder === "RIDER" &&
        ["CASH_DRAWER", "MOBILE_MONEY_TILL", "BANK", "OTHER"].includes(movement.toHolder),
    )
    .reduce((sum, movement) => sum + movement.amountMinor, 0);
  return majorFromMinor(minor, obligation.currency);
}

export function riderOutstandingForOrder(state: TransactionState, order: TransactionOrder) {
  return Math.max(0, riderHeldAmount(state, order) - riderRemittedForOrder(state, order));
}

export function directCompanyCollectedAmount(state: TransactionState, order: TransactionOrder) {
  const obligation = custodyObligationForOrder(state, order);
  const operations = state.paymentOperations;
  if (!obligation || !operations) return 0;
  const minor = operations.custodyMovements
    .filter(
      (movement) =>
        movement.obligationId === obligation.id &&
        movement.type === "CUSTOMER_COLLECTION" &&
        movement.fromHolder === "CUSTOMER" &&
        ["CASH_DRAWER", "MOBILE_MONEY_TILL", "BANK"].includes(movement.toHolder),
    )
    .reduce((sum, movement) => sum + movement.amountMinor, 0);
  return majorFromMinor(minor, obligation.currency);
}

export function deliveryFundsStatus(state: TransactionState, order: TransactionOrder) {
  const obligation = custodyObligationForOrder(state, order);
  if (!obligation) {
    if (order.externalSource?.externallyPaid || order.paymentStatus === "PROVIDER_RECEIVABLE") {
      return "Platform collected";
    }
    if (order.paymentStatus === "PAID") return "Cleared";
    return "No cash-due obligation";
  }

  const riderOutstanding = riderOutstandingForOrder(state, order);
  if (riderOutstanding > 0) return "Rider remittance pending";

  const remaining = cashDueRemaining(state, order);
  if (remaining > 0) {
    return customerCollectedAmount(state, order) > 0 ? "Partially collected" : "Collection due";
  }

  if (riderHeldAmount(state, order) > 0) return "Rider remitted";
  if (directCompanyCollectedAmount(state, order) > 0) return "Company collection recorded";
  return obligation.status.replaceAll("_", " ").toLowerCase();
}
