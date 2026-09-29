import { describe, expect, it } from "vitest";
import { cashCount } from "./cash-count";

describe("physical cash count precision", () => {
  it("preserves zero and uses the configured currency precision", () => {
    expect(cashCount("0", 0.1, "KES")).toMatchObject({ physicalCount: 0, varianceMinor: -10 });
    expect(cashCount("1.001", 1.002, "KWD")).toMatchObject({
      physicalCount: 1.001,
      varianceMinor: -1,
    });
    expect(() => cashCount("1.1", 1, "JPY")).toThrow();
  });
  it("rejects unsafe ranges and malformed input", () => {
    for (const value of [Infinity, NaN, {}, "9007199254740992", "0x10", "+1", "1 00", "-0.01"]) {
      expect(() => cashCount(value, 100, "KES")).toThrow();
    }
  });
});
