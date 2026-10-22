import type { TransactionOrder } from "@/lib/transaction-engine";
import type { OrderChannelDefinition } from "@/platform/types";
import { resolveDeliveryFulfilment } from "./delivery-model";
import { businessDateForTimestamp } from "@/lib/business-date";

export function riderWorkload(input: {
  orders: readonly TransactionOrder[];
  channels: readonly OrderChannelDefinition[];
  branchId: string;
  legacyBranch: string;
  rider: string;
  timezone: string;
  cutoffMinutes: number;
  now?: Date;
}) {
  const today = businessDateForTimestamp(
    input.now ?? new Date(),
    input.timezone,
    input.cutoffMinutes,
  );
  const orders = input.orders.filter((order) => {
    const channel = input.channels.find((item) =>
      [item.id, item.code, item.displayName].includes(order.channel),
    );
    return (
      (order.branchId ? order.branchId === input.branchId : order.branch === input.legacyBranch) &&
      order.delivery?.rider === input.rider &&
      resolveDeliveryFulfilment(order, channel) === "OWN_DELIVERY"
    );
  });
  return {
    today,
    activeTasks: orders.filter(
      (order) =>
        order.delivery?.status !== "DELIVERED" && !["CANCELLED", "REFUNDED"].includes(order.status),
    ).length,
    completedToday: orders.filter(
      (order) =>
        order.delivery?.status === "DELIVERED" &&
        order.delivery.deliveredAt &&
        businessDateForTimestamp(
          order.delivery.deliveredAt,
          input.timezone,
          input.cutoffMinutes,
        ) === today,
    ).length,
  };
}
