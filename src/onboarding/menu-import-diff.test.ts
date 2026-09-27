import { describe, expect, it } from "vitest";
import { classifyMenuItemChange, type ComparedMenuItem } from "@/onboarding/menu-import-diff";

const current: ComparedMenuItem = {
  code: "PILAU-001",
  name: "Beef Pilau",
  categoryCode: "MAINS",
  sellingPriceMinor: 65000,
  currency: "KES",
  description: "Standard beef pilau",
  stationId: "kitchen-main",
  available: true,
  branchPriceMinor: 65000,
};

describe("conservative imported menu item difference classification", () => {
  it("identifies new items without pretending that they are duplicates", () => {
    expect(classifyMenuItemChange({ ...current, code: "NEW-001" }, null)).toEqual({
      classification: "NEW",
      changes: [],
    });
  });

  it("automatically recognizes identical records despite category-code casing", () => {
    expect(
      classifyMenuItemChange({ ...current, code: "pilau-001", categoryCode: "mains" }, current),
    ).toMatchObject({ classification: "IDENTICAL", changes: [] });
  });

  it("requires explicit review for price, kitchen station or branch availability changes", () => {
    const result = classifyMenuItemChange(
      {
        ...current,
        sellingPriceMinor: 70000,
        stationId: "kitchen-b",
        available: false,
      },
      current,
    );
    expect(result.classification).toBe("MATERIAL_CHANGE");
    expect(result.changes.map(({ field }) => field)).toEqual([
      "sellingPriceMinor",
      "stationId",
      "available",
    ]);
  });

  it("never overwrites a changed description without explicit review", () => {
    const result = classifyMenuItemChange(
      { ...current, description: "New display description" },
      current,
    );
    expect(result).toMatchObject({
      classification: "COSMETIC_CHANGE",
      changes: [{ field: "description", material: false }],
    });
  });

  it("does not interpret empty optional CSV cells as data-clearing instructions", () => {
    const result = classifyMenuItemChange(
      { ...current, description: "", stationId: undefined },
      current,
    );
    expect(result).toMatchObject({ classification: "IDENTICAL", changes: [] });
  });
});
