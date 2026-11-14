import { describe, expect, it } from "vitest";
import { marketplaceProgress } from "./order-progress";
import type { TransactionState } from "@/lib/transaction-engine";
import type { IntegrationOutbox } from "@/integrations/runtime/models";

const order = (status: string, extra = {}) =>
  ({
    status,
    externalSource: { connectionId: "connection", externalOrderId: "external", ...extra },
  }) as TransactionState["orders"][number];
const action = (status: IntegrationOutbox["status"], extra = {}) =>
  ({
    connectionId: "connection",
    resourceId: "external",
    eventType: "ORDER_ACCEPTED",
    status,
    ...extra,
  }) as IntegrationOutbox;

describe("marketplace progress", () => {
  it("does not infer acceptance from kitchen state or a local timestamp", () => {
    expect(
      marketplaceProgress(order("SENT_TO_KITCHEN", { acceptedAt: "2026-11-13" }), []),
    ).toMatchObject({ provider: "Not verified", progress: "Kitchen queued" });
  });
  it("does not infer fulfilment from payment", () => {
    expect(marketplaceProgress(order("PAID"), [])).toMatchObject({
      closed: false,
      progress: "Review",
    });
  });
  it("distinguishes pending, failed and acknowledged acceptance", () => {
    expect(marketplaceProgress(order("HELD"), [action("PENDING")]).provider).toBe(
      "Confirmation pending",
    );
    expect(marketplaceProgress(order("HELD"), [action("DEAD_LETTER")]).needsAttention).toBe(true);
    expect(marketplaceProgress(order("HELD"), [action("PROCESSED")]).provider).toBe("Accepted");
  });
  it("never borrows another connection's confirmation", () => {
    expect(
      marketplaceProgress(order("HELD"), [action("PROCESSED", { connectionId: "other" })]).provider,
    ).toBe("Not verified");
  });
  it("keeps collected orders open until fulfilment is recorded", () => {
    expect(marketplaceProgress(order("SERVED", { pickedUpAt: "2026-11-13" }), [])).toMatchObject({
      closed: false,
      progress: "Collected",
    });
    expect(marketplaceProgress(order("SERVED", { completedAt: "2026-11-13" }), []).closed).toBe(
      true,
    );
  });
});
