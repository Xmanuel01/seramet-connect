import { describe, expect, it } from "vitest";
import { kitchenPrintRecoveryItems } from "./kitchen-print-recovery";

describe("durable KOT recovery visibility", () => {
  const obligations = [
    { id: "original-pending", branchId: "westlands", status: "PENDING" },
    { id: "amendment-claimed", branchId: "westlands", status: "CLAIMED" },
    { id: "reprint-uncertain", branchId: "westlands", status: "UNCERTAIN" },
    { id: "delivered", branchId: "westlands", status: "BRIDGE_ACCEPTED" },
    { id: "other-branch", branchId: "ngong", status: "PENDING" },
  ] as const;

  it("surfaces only unresolved tickets for the cashier's authorized branch", () => {
    expect(kitchenPrintRecoveryItems(obligations, "westlands").map((item) => item.id)).toEqual([
      "original-pending",
      "amendment-claimed",
      "reprint-uncertain",
    ]);
    expect(kitchenPrintRecoveryItems(obligations, "ngong").map((item) => item.id)).toEqual([
      "other-branch",
    ]);
  });

  it("clears a warning only when the server records bridge acceptance", () => {
    const settled = obligations.map((item) =>
      item.id === "original-pending" ? { ...item, status: "BRIDGE_ACCEPTED" as const } : item,
    );
    expect(kitchenPrintRecoveryItems(settled, "westlands")).toHaveLength(2);
    expect(kitchenPrintRecoveryItems(settled, "other-branch")).toHaveLength(0);
  });
});

describe("unconfirmed kitchen tickets retire once their order moves on", () => {
  const ticket = (id: string, orderId: string) =>
    ({ id, orderId, branchId: "westlands", status: "UNCERTAIN" }) as const;
  const tickets = [
    ticket("open", "ORD-1"),
    ticket("billed", "ORD-2"),
    ticket("yesterday", "ORD-3"),
  ];
  const orders = [
    { id: "ORD-1", status: "SENT_TO_KITCHEN", businessDate: "2026-11-10" },
    { id: "ORD-2", status: "BILL_REQUESTED", businessDate: "2026-11-10" },
    { id: "ORD-3", status: "SENT_TO_KITCHEN", businessDate: "2026-11-09" },
  ] as const;

  it("keeps only tickets for orders still open in the kitchen today", () => {
    expect(
      kitchenPrintRecoveryItems(tickets, "westlands", { orders, today: "2026-11-10" }).map(
        (item) => item.id,
      ),
    ).toEqual(["open"]);
  });

  it("keeps every unconfirmed ticket when order details aren't available", () => {
    expect(kitchenPrintRecoveryItems(tickets, "westlands")).toHaveLength(3);
  });
});
