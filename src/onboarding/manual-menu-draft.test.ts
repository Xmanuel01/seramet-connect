import { describe, expect, it } from "vitest";
import { manualMenuCsv } from "./manual-menu-draft";

const example = {
  itemCode: "PL-001",
  name: "Beef pilau",
  categoryCode: "MAINS",
  basePrice: "450",
  currency: "KES",
  sellable: true,
};

describe("manual menu creation using the authoritative import contract", () => {
  it("produces canonical versioned menu data with branch activation handled separately", () => {
    const csv = manualMenuCsv(example);
    expect(csv).toContain("templateVersion,itemCode,name,categoryCode");
    expect(csv).toContain("3,PL-001,Beef pilau,MAINS");
    expect(csv).toContain("450");
    expect(csv).not.toContain("undefined");
  });

  it("escapes spreadsheet formulas and quoted names", () => {
    const csv = manualMenuCsv({ ...example, name: '=HYPERLINK("unsafe")' });
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""unsafe""');
  });

  it("rejects invalid prices and unstable codes before the server validates them", () => {
    expect(() => manualMenuCsv({ ...example, basePrice: "-100" })).toThrow();
    expect(() => manualMenuCsv({ ...example, itemCode: "bad space" })).toThrow();
    expect(() => manualMenuCsv({ ...example, currency: "" })).toThrow();
  });
});
