import { describe, expect, it } from "vitest";
import {
  createEmptyTransactionState,
  type MarketplaceReceivable,
  type TransactionState,
} from "@/lib/transaction-engine";
import { marketplaceDaySummary } from "./marketplace-day-summary";

const input = {
  tenantId: "tenant",
  branchId: "branch",
  businessDate: "2026-11-13",
  timeZone: "Africa/Nairobi",
  cutoffMinutes: 240,
  currency: "KES",
};
function balance(
  id: string,
  overrides: Partial<MarketplaceReceivable> = {},
): MarketplaceReceivable {
  return {
    id,
    tenantId: "tenant",
    branchId: "branch",
    branch: "Branch",
    orderId: id,
    invoiceId: id,
    connectionId: "uber",
    providerId: "provider-uber-eats",
    externalOrderId: id,
    currency: "KES",
    grossAmount: 1000,
    externallyCollectedAmount: 1000,
    settledAmount: 200,
    outstandingAmount: 800,
    status: "PARTIALLY_SETTLED",
    receivableAccount: "Marketplace receivables",
    createdAt: "2026-11-13T01:00:00Z",
    updatedAt: "2026-11-13T05:00:00Z",
    metadata: {},
    ...overrides,
  };
}
function order(id: string, stamp: string, source = {}, status = "HELD") {
  return {
    id,
    tenantId: "tenant",
    branchId: "branch",
    status,
    externalSource: {
      connectionId: "uber",
      providerId: "provider-uber-eats",
      receivedAt: stamp,
      metadata: {},
      ...source,
    },
  } as TransactionState["orders"][number];
}

describe("marketplace daily closing", () => {
  it("uses the branch cutoff, carries older open orders and separates payment from fulfillment", () => {
    const state = createEmptyTransactionState("tenant");
    state.orders = [
      order("old", "2026-11-13T00:59:59Z"),
      order(
        "today",
        "2026-11-13T01:00:00Z",
        { metadata: { acceptanceConfirmedAt: "2026-11-13T01:01:00Z" } },
        "PAID",
      ),
      order("done", "2026-11-13T01:00:00Z", { completedAt: "2026-11-13T03:00:00Z" }),
      order("cancelled", "2026-11-13T02:00:00Z", {}, "CANCELLED"),
      order("future", "2026-11-14T01:00:00Z"),
    ];
    expect(marketplaceDaySummary(state, input)[0]).toMatchObject({
      received: 3,
      accepted: 1,
      fulfilled: 1,
      cancelled: 1,
      openOrderIds: ["old", "today"],
    });
  });
  it("keeps currencies, branches and unpaid carry-forward separate without creating collections", () => {
    const state = createEmptyTransactionState("tenant");
    state.marketplaceReceivables = [
      balance("today"),
      balance("old", { createdAt: "2026-11-12T01:00:00Z" }),
      balance("usd", { currency: "USD", grossAmount: 10, outstandingAmount: 8, settledAmount: 2 }),
      balance("foreign-branch", { branchId: "other" }),
      balance("foreign-tenant", { tenantId: "other" }),
      balance("cancelled", { status: "CANCELLED" }),
    ];
    state.marketplaceCharges = [
      {
        id: "commission",
        tenantId: "tenant",
        branchId: "branch",
        orderId: "today",
        connectionId: "uber",
        type: "COMMISSION",
        description: "Commission",
        amount: 150,
        currency: "KES",
        source: "PROVIDER_REPORT",
        metadata: {},
        createdAt: "2026-11-13T05:00:00Z",
      },
    ];
    const before = structuredClone(state);
    const summary = marketplaceDaySummary(state, input);
    expect(summary).toHaveLength(2);
    expect(summary.find((row) => row.currency === "KES")).toMatchObject({
      grossMinor: 100000,
      settledMinor: 20000,
      outstandingMinor: 80000,
      carriedOutstandingMinor: 160000,
      feesMinor: 15000,
    });
    expect(summary.find((row) => row.currency === "USD")).toMatchObject({
      grossMinor: 1000,
      outstandingMinor: 800,
    });
    expect(state).toEqual(before);
    expect(state.receipts).toHaveLength(0);
    expect(() => marketplaceDaySummary(state, { ...input, tenantId: "other" })).toThrow(
      "Cross-tenant",
    );
  });
});
