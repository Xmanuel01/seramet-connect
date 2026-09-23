import type {
  DeliveryCollectionMethod,
  TransactionOrder,
  TransactionState,
} from "@/lib/transaction-engine";
import type { OrderChannelDefinition } from "@/platform/types";

export type DeliveryFulfilment =
  | "OWN_DELIVERY"
  | "PROVIDER_DELIVERY"
  | "PICKUP"
  | "NOT_DELIVERY";

function configuredFulfilment(channel?: OrderChannelDefinition): DeliveryFulfilment | undefined {
  if (!channel) return undefined;
  const configured = String(
    channel.metadata["defaultFulfilment"] ??
      channel.metadata["fulfilmentOwner"] ??
      "",
  ).toUpperCase();
  if (["RESTAURANT", "OWN_DELIVERY", "OWN"].includes(configured)) return "OWN_DELIVERY";
  if (["PROVIDER", "PLATFORM", "PROVIDER_DELIVERY"].includes(configured))
    return "PROVIDER_DELIVERY";
  if (configured === "PICKUP") return "PICKUP";
  if (channel.metadata["riderManagedExternally"] === true) return "PROVIDER_DELIVERY";
  return undefined;
}

export function resolveDeliveryFulfilment(
  order: TransactionOrder,
  channel?: OrderChannelDefinition,
): DeliveryFulfilment {
  if (order.externalSource?.fulfilmentType) return order.externalSource.fulfilmentType;
  if (order.guestContext?.serviceMode === "PICKUP") return "PICKUP";
  if (order.guestContext?.serviceMode === "DIRECT_DELIVERY") return "OWN_DELIVERY";

  const configured = configuredFulfilment(channel);
  if (configured) return configured;

  if (channel?.channelType === "OWN_DELIVERY") return "OWN_DELIVERY";
  if (channel?.channelType === "MARKETPLACE") return "PROVIDER_DELIVERY";
  return "NOT_DELIVERY";
}

export function riderHeldCollectionMethod(method: DeliveryCollectionMethod) {
  return method === "CASH_TO_RIDER" || method === "RIDER_MPESA";
}

export function customerCollectedAmount(order: TransactionOrder) {
  return (order.delivery?.collections ?? []).reduce(
    (sum, collection) => sum + collection.amount,
    0,
  );
}

export function riderHeldAmount(order: TransactionOrder) {
  return (order.delivery?.collections ?? [])
    .filter((collection) => riderHeldCollectionMethod(collection.method))
    .reduce((sum, collection) => sum + collection.amount, 0);
}

export function riderRemittedForOrder(state: TransactionState, orderId: string) {
  return (state.riderRemittances ?? []).reduce(
    (sum, remittance) =>
      sum +
      remittance.allocations
        .filter((allocation) => allocation.orderId === orderId)
        .reduce((allocated, allocation) => allocated + allocation.amount, 0),
    0,
  );
}

export function riderOutstandingForOrder(state: TransactionState, order: TransactionOrder) {
  return Math.max(0, riderHeldAmount(order) - riderRemittedForOrder(state, order.id));
}

export function deliveryFundsStatus(state: TransactionState, order: TransactionOrder) {
  const collections = order.delivery?.collections ?? [];
  const outstanding = riderOutstandingForOrder(state, order);
  if (outstanding > 0) return "Remittance pending";
  if (collections.length > 0) return "Cleared";
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PROVIDER_RECEIVABLE")
    return "Paid outside rider";
  return "Payment not recorded";
}
