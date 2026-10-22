import { describe, expect, it } from "vitest";
import { invoiceDisplayName, invoiceSplitAmounts } from "./invoice-split";

describe("custom invoice allocations", () => {
  it.each([
    ["300", "300"],
    ["400", "200"],
  ])("accepts exact two-person amounts %s/%s", (...amounts) => {
    expect(
      invoiceSplitAmounts(
        600,
        "KES",
        amounts.map((amount) => ({ label: "", amount })),
      ).remainingMinor,
    ).toBe(0);
  });
  it("keeps the shortfall visible and supports any number of positive allocations", () => {
    const rows = ["200", "300", "50"].map((amount) => ({ label: "", amount }));
    expect(invoiceSplitAmounts(600, "KES", rows).remainingMinor).toBe(5000);
    expect(
      invoiceSplitAmounts(600, "KES", [...rows, { label: "", amount: "50" }]).remainingMinor,
    ).toBe(0);
    expect(
      invoiceSplitAmounts(
        600,
        "KES",
        Array.from({ length: 60 }, () => ({ label: "", amount: "10" })),
      ).splits,
    ).toHaveLength(60);
    expect(
      invoiceSplitAmounts(600, "KES", [
        { label: "A", amount: "400" },
        { label: "B", amount: "300" },
      ]).remainingMinor,
    ).toBe(-10000);
  });
  it.each(["", "0", "-1", "1e2", "Infinity", "0.001"])(
    "rejects invalid KES amount %s",
    (amount) => {
      expect(() =>
        invoiceSplitAmounts(600, "KES", [
          { label: "A", amount },
          { label: "B", amount: "600" },
        ]),
      ).toThrow();
    },
  );
  it("preserves minor-unit precision and historical identifiers", () => {
    const allocations = invoiceSplitAmounts(0.3, "KES", [
      { label: "A", amount: "0.1" },
      { label: "", amount: "0.2" },
    ]);
    expect(allocations.remainingMinor).toBe(0);
    expect(allocations.splits[1]!.label).toBe("Person 2");
    expect(invoiceDisplayName("BILL-00027")).toBe("Inv-00027");
    expect(invoiceDisplayName("INV-00027")).toBe("Inv-00027");
  });
  it.each([
    ["BILL-00001", "Inv-00001"],
    ["INV-00001", "Inv-00001"],
    ["InV-00001", "Inv-00001"],
    ["INV-00027-S2", "Inv-00027-S2"],
    ["BILL-123456", "Inv-123456"],
  ])("displays compact reference %s without changing its serial", (id, expected) => {
    expect(invoiceDisplayName(id)).toBe(expected);
  });
});
