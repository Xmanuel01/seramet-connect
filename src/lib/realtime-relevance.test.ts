import { describe, expect, it } from "vitest";
import { changesRecords, changesTransactions } from "@/lib/realtime-relevance";

describe("live event relevance", () => {
  it("refetches transactions only for a newer transaction revision", () => {
    const command = (revision: number) => ({
      topic: "transactions",
      eventType: "submitOrder",
      payload: { revision },
    });
    expect(changesTransactions(command(24), 23)).toBe(true);
    // Our own command's echo, or an older one, changes nothing.
    expect(changesTransactions(command(23), 23)).toBe(false);
    expect(changesTransactions(command(20), 23)).toBe(false);
    // Background jobs never move the transaction snapshot.
    expect(
      changesTransactions({ topic: "workers", eventType: "OUTBOX_DISPATCH_COMPLETED" }, 23),
    ).toBe(false);
  });

  it("stays safe when an event is unknown or incomplete", () => {
    expect(changesTransactions(undefined, 23)).toBe(true);
    expect(changesTransactions({ topic: "transactions" }, 23)).toBe(true);
    expect(changesTransactions({ topic: "configuration", eventType: "X" }, 23)).toBe(true);
    expect(changesRecords(null)).toBe(true);
  });

  it("lets documents follow money jobs but not other background work", () => {
    expect(changesRecords({ topic: "workers", eventType: "PAYMENT_SETTLEMENT_COMPLETED" })).toBe(
      true,
    );
    expect(changesRecords({ topic: "workers", eventType: "DAILY_CLOSING_COMPLETED" })).toBe(true);
    expect(changesRecords({ topic: "workers", eventType: "NOTIFICATION_DISPATCH_COMPLETED" })).toBe(
      false,
    );
    expect(changesRecords({ topic: "transactions", eventType: "submitOrder" })).toBe(true);
  });
});
