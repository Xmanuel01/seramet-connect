import { describe, expect, it } from "vitest";
import { invoiceCandidatesForOrder, orderBusinessDate } from "./orders-interface";
import type { BillingRecord, TransactionOrder } from "@/lib/transaction-engine";

const order = {
  id: "ORDER-1",
  tenantId: "tenant-1",
  branchId: "branch-1",
  branch: "Westlands",
} as TransactionOrder;
const bill = (changes: Partial<BillingRecord> = {}) =>
  ({
    id: "BILL-1",
    tenantId: "tenant-1",
    branchId: "branch-1",
    branch: "Westlands",
    orderIds: ["ORDER-1"],
    status: "OPEN",
    ...changes,
  }) as BillingRecord;

describe("Orders Lite interaction safety", () => {
  it("resolves late-night events using the configured restaurant time zone", () => {
    expect(orderBusinessDate({ createdAt: "2026-09-29T22:30:00.000Z" }, "Africa/Nairobi")).toBe(
      "2026-09-30",
    );
    expect(
      orderBusinessDate(
        { createdAt: "2026-09-29T22:30:00.000Z", businessDate: "2026-09-28" },
        "Africa/Nairobi",
      ),
    ).toBe("2026-09-28");
  });
  it("restricts printing to live invoices linked to the exact order and branch", () => {
    const records = [
      bill(),
      bill({ id: "wrong-order", orderIds: ["ORDER-2"] }),
      bill({ id: "wrong-branch", branchId: "branch-2", branch: "Ngong" }),
      bill({ id: "wrong-tenant", tenantId: "tenant-2" }),
      bill({ id: "merged", status: "MERGED" }),
      bill({ id: "draft", status: "DRAFT_BILL" }),
      bill({ id: "void", status: "VOID" }),
    ];
    const matching = invoiceCandidatesForOrder(
      records,
      order,
      (branch) => branch === "branch-1" || branch === "Westlands",
    );
    expect(matching.map((record) => record.id)).toEqual(["BILL-1"]);
  });
  it("retains multiple split invoices so the UI requires an explicit choice", () => {
    const records = [bill(), bill({ id: "BILL-2" })];
    expect(
      invoiceCandidatesForOrder(records, order, (branch) => branch === "branch-1"),
    ).toHaveLength(2);
  });
});
