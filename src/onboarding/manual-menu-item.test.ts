import { describe, expect, it } from "vitest";
import { createManualMenuCsv } from "./manual-menu-item";
import { menuImportHeaders } from "./menu-import-schema";

const item = {
  code: "plt-001",
  name: "Beef Pilau",
  categoryCode: "main",
  basePrice: "450.00",
  currency: "KES",
  stationCode: "MAIN",
};

describe("Manual menu creation reuses the authoritative import contract", () => {
  it("produces the canonical current template and a fully identified sellable item", () => {
    const csv = createManualMenuCsv(item);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(menuImportHeaders.join(","));
    const fields = Object.fromEntries(
      menuImportHeaders.map((header, index) => [header, lines[1]!.split(",")[index]]),
    );
    expect(fields).toMatchObject({
      templateVersion: "3",
      itemCode: "PLT-001",
      name: "Beef Pilau",
      categoryCode: "MAIN",
      basePrice: "450.00",
      currency: "KES",
      stationCode: "MAIN",
      sku: "PLT-001",
      sellable: "true",
      available: "true",
    });
  });

  it("rejects missing identifiers and malformed amounts before server validation", () => {
    expect(() => createManualMenuCsv({ ...item, code: "" })).toThrow(/code/);
    expect(() => createManualMenuCsv({ ...item, categoryCode: "" })).toThrow(/category/);
    expect(() => createManualMenuCsv({ ...item, basePrice: "450;DROP" })).toThrow(/price/);
  });

  it("serializes real branch price, online price, tax and recipe settings", () => {
    const csv = createManualMenuCsv({
      ...item,
      branchPrice: "475.00",
      onlinePrice: "520.00",
      taxCode: "VAT",
      unitOfMeasure: "PCS",
      recipeCode: "RCP-PILAU",
      serviceChargeApplicable: true,
    });
    const values = csv.split("\\n")[1]!.split(",");
    const row = Object.fromEntries(menuImportHeaders.map((header, i) => [header, values[i]]));
    expect(row).toMatchObject({
      branchPrice: "475.00",
      onlinePrice: "520.00",
      taxCode: "VAT",
      unitOfMeasure: "PCS",
      recipeCode: "RCP-PILAU",
      serviceChargeApplicable: "true",
    });
    expect(() => createManualMenuCsv({ ...item, onlinePrice: "-100" })).toThrow(/Online price/);
  });

  it("escapes spreadsheet formula-looking values before serialization", () => {
    const csv = createManualMenuCsv({ ...item, name: "=HYPERLINK()", description: "+command" });
    expect(csv).toContain("'=HYPERLINK()");
    expect(csv).toContain("'+command");
  });
});
