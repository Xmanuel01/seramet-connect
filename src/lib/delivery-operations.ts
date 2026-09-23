import type {
  DeliveryCollectionMethod,
  DeliveryCollectionStatus,
  DeliveryFulfilmentOwner,
  TransactionOrder,
} from "@/lib/transaction-engine";
import type { OrderChannelDefinition } from "@/platform/types";

export type DeliveryOwnership = DeliveryFulfilmentOwner | "NONE";

function configuredOwner(channel?: OrderChannelDefinition): DeliveryOwnership | undefined {
  const owner = channel?.metadata["fulfilmentOwner"];
  return owner === "RESTAURANT" || owner === "PROVIDER" || owner === "PICKUP"
    ? owner
    : undefined;
}

export function deliveryOwnership(
  order: TransactionOrder,
  channel?: OrderChannelDefinition,
): DeliveryOwnership {
  if (order.delivery?.fulfilmentOwner) return order.delivery.fulfilmentOwner;

  if (order.externalSource?.fulfilmentType === "OWN_DELIVERY") return "RESTAURANT";
  if (order.externalSource?.fulfilmentType === "PROVIDER_DELIVERY") return "PROVIDER";
  if (order.externalSource?.fulfilmentType === "PICKUP") return "PICKUP";

  if (order.guestContext?.serviceMode === "DIRECT_DELIVERY") return "RESTAURANT";
  if (order.guestContext?.serviceMode === "PICKUP") return "PICKUP";

  const owner = configuredOwner(channel);
  if (owner) return owner;

  if (channel?.channelType === "OWN_DELIVERY") return "RESTAURANT";
  if (channel?.channelType === "MARKETPLACE") return "PROVIDER";

  if (
    channel &&
    ["PHONE", "WHATSAPP", "WEB"].includes(channel.channelType) &&
    (channel.requiresAddress || Boolean(order.delivery))
  ) {
    return "RESTAURANT";
  }

  return order.delivery ? "RESTAURANT" : "NONE";
}

export function isDeliveryOrder(order: TransactionOrder, channel?: OrderChannelDefinition) {
  const owner = deliveryOwnership(order, channel);
  return owner === "RESTAURANT" || owner === "PROVIDER";
}

export function isOwnDelivery(order: TransactionOrder, channel?: OrderChannelDefinition) {
  return deliveryOwnership(order, channel) === "RESTAURANT";
}

export function collectionMethodLabel(method?: DeliveryCollectionMethod) {
  switch (method) {
    case "CUSTOMER_DUE":
      return "Customer due";
    case "COMPANY_TILL_DIRECT":
      return "Company Till direct";
    case "RIDER_CASH":
      return "Cash with rider";
    case "RIDER_MPESA":
      return "M-Pesa to rider";
    case "PREPAID":
      return "Prepaid";
    case "PROVIDER_SETTLEMENT":
      return "Provider settlement";
    default:
      return "Not set";
  }
}

export function collectionStatusLabel(status?: DeliveryCollectionStatus) {
  switch (status) {
    case "NOT_REQUIRED":
      return "No rider remittance";
    case "AWAITING_PAYMENT":
      return "Awaiting company payment";
    case "COLLECTED_BY_RIDER":
      return "With rider";
    case "REMITTED_PENDING_CONFIRMATION":
      return "Remitted - verify";
    case "CONFIRMED":
      return "Confirmed";
    default:
      return "Not set";
  }
}

export function riderLiabilityAmount(order: TransactionOrder) {
  const collection = order.delivery?.collection;
  if (!collection) return 0;
  if (!["RIDER_CASH", "RIDER_MPESA"].includes(collection.method)) return 0;
  return ["COLLECTED_BY_RIDER", "REMITTED_PENDING_CONFIRMATION"].includes(collection.status)
    ? collection.amount
    : 0;
}

export function riderFundsInHandAmount(order: TransactionOrder) {
  const collection = order.delivery?.collection;
  if (!collection) return 0;
  if (!["RIDER_CASH", "RIDER_MPESA"].includes(collection.method)) return 0;
  return collection.status === "COLLECTED_BY_RIDER" ? collection.amount : 0;
}

export function riderRemittancePendingAmount(order: TransactionOrder) {
  const collection = order.delivery?.collection;
  if (!collection) return 0;
  if (!["RIDER_CASH", "RIDER_MPESA"].includes(collection.method)) return 0;
  return collection.status === "REMITTED_PENDING_CONFIRMATION" ? collection.amount : 0;
}
