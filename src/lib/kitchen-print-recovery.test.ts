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
