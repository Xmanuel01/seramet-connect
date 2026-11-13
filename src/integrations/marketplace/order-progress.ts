import type { TransactionState } from "@/lib/transaction-engine";
import type { IntegrationOutbox } from "@/integrations/runtime/models";

type Order = TransactionState["orders"][number];

// Fulfilment, provider acknowledgement and money are independent state machines.
export function marketplaceProgress(order: Order, outbox: IntegrationOutbox[]) {
  const source = order.externalSource;
  const actions = outbox.filter(
    (record) =>
      record.connectionId === source?.connectionId &&
      record.resourceId === source?.externalOrderId &&
      ["ORDER_ACCEPTED", "ORDER_REJECTED"].includes(record.eventType),
  );
  const failed = actions.some((record) => record.status === "DEAD_LETTER");
  const accepted =
    Boolean(source?.metadata?.["acceptanceConfirmedAt"]) ||
    actions.some(
      (record) => record.eventType === "ORDER_ACCEPTED" && record.status === "PROCESSED",
    );
  const rejected = actions.some(
    (record) => record.eventType === "ORDER_REJECTED" && record.status === "PROCESSED",
  );
  const pending = actions.some((record) =>
    ["PENDING", "PROCESSING", "RETRY_PENDING"].includes(record.status),
  );
  const provider = failed
    ? "Needs attention"
    : pending
      ? "Confirmation pending"
      : rejected
        ? "Rejected"
        : accepted
          ? "Accepted"
          : "Not verified";
  const cancelled = order.status === "CANCELLED";
  const fulfilled = Boolean(source?.completedAt);
  const collected = Boolean(source?.pickedUpAt);
  const progress = cancelled
    ? "Cancelled"
    : fulfilled
      ? "Fulfilled"
      : collected
        ? "Collected"
        : order.status === "READY"
          ? "Ready"
          : order.status === "IN_PROGRESS"
            ? "Preparing"
            : order.status === "SENT_TO_KITCHEN"
              ? "Kitchen queued"
              : order.status === "HELD" && source?.scheduledFor && accepted
                ? "Scheduled"
                : accepted
                  ? "Accepted"
                  : "Review";
  return { provider, progress, closed: cancelled || fulfilled || rejected, needsAttention: failed };
}
