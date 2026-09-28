import { describe, expect, it } from "vitest";
import { scopedFinancePeriod } from "@/finance/finance-period-state";

describe("finance period changes follow the authorized branch", () => {
  const atBoundary = new Date("2026-09-30T22:30:00.000Z");

  it("resets another branch's edited dates to the selected branch's business date", () => {
    const previous = {
      scopeKey: "tenant:A:Africa/Nairobi:240",
      from: "2026-01-01",
      to: "2026-01-31",
    };
    const next = scopedFinancePeriod(
      previous,
      "tenant:B:Africa/Nairobi:240",
      atBoundary,
      "Africa/Nairobi",
      240,
    );
    expect(next).toEqual({
      scopeKey: "tenant:B:Africa/Nairobi:240",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("preserves deliberately edited date filters in the same branch", () => {
    const previous = {
      scopeKey: "tenant:A:Africa/Nairobi:240",
      from: "2026-06-15",
      to: "2026-06-30",
    };
    expect(
      scopedFinancePeriod(previous, previous.scopeKey, atBoundary, "Africa/Nairobi", 240),
    ).toBe(previous);
  });

  it("resets a previous tenant period even when the branch ID matches", () => {
    const prior = { scopeKey: "tenant1:A:UTC:0", from: "2025-01-01", to: "2025-01-31" };
    const next = scopedFinancePeriod(
      prior,
      "tenant2:A:Africa/Nairobi:240",
      atBoundary,
      "Africa/Nairobi",
      240,
    );
    expect(next.from).toBe("2026-09-01");
    expect(next.to).toBe("2026-09-30");
  });
});
