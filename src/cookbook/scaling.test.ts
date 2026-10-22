import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScaledIngredients } from "./ScaledIngredients";
import { quantityInput, scaleCookbook, sourceQuantity, sourceQuantityLabel } from "./scaling";

const recipe = {
  yield_quantity_minor: 1_000_000,
  yield_unit_symbol: "portion",
  ingredients: [
    {
      id: "rice",
      inventory_item_name: "Rice",
      quantity_minor: 2_000_000,
      unit_symbol: "kg",
      waste_factor_bps: 500,
    },
    { id: "oil", inventory_item_name: "Oil", quantity_minor: 300_000, unit_symbol: "ml" },
    {
      id: "sauce",
      sub_recipe_name: "Sauce",
      quantity_minor: "500000",
      unit_symbol: "cup",
      optional: 1,
    },
  ],
};

describe("cookbook scaling", () => {
  it("scales one portion to two without mutating quantities, units or waste", () => {
    const snapshot = structuredClone(recipe);
    const result = scaleCookbook(recipe, { mode: "yield", ingredientIndex: 0, target: "2" });
    expect(result).toEqual({
      error: null,
      yieldQuantity: 2_000_000,
      quantities: [4_000_000, 600_000, 1_000_000],
    });
    expect(recipe).toEqual(snapshot);
  });

  it("scales all ingredients and yield from 2 kg rice to 3 kg, without converting units", () => {
    expect(scaleCookbook(recipe, { mode: "ingredient", ingredientIndex: 0, target: "3" })).toEqual({
      error: null,
      yieldQuantity: 1_500_000,
      quantities: [3_000_000, 450_000, 750_000],
    });
  });

  it("supports fractional targets and a different ingredient anchor", () => {
    expect(
      scaleCookbook(recipe, { mode: "ingredient", ingredientIndex: 2, target: ".25" }).quantities,
    ).toEqual([1_000_000, 150_000, 250_000]);
    expect(
      scaleCookbook(
        { ...recipe, ingredients: [{ quantity_minor: 1_000_000 }] },
        { mode: "yield", ingredientIndex: 0, target: "0.000001" },
      ).quantities,
    ).toEqual([1]);
  });

  it.each([
    "",
    " ",
    "0",
    "-1",
    "NaN",
    "Infinity",
    "1e3",
    "3 kg",
    "300-500",
    "0.0000001",
    "9007199254.740992",
    "999999999999999999999999",
  ])("rejects invalid target %j", (target) => {
    const result = scaleCookbook(recipe, { mode: "yield", ingredientIndex: 0, target });
    expect(result.error).toBeTruthy();
    expect(result.quantities).toEqual([null, null, null]);
    expect(result.yieldQuantity).toBeNull();
  });

  it.each([
    null,
    undefined,
    "",
    "300-500",
    "to taste",
    NaN,
    Infinity,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("preserves ambiguous or invalid source %j instead of inventing zero", (quantity) => {
    const source = { ...recipe, ingredients: [{ quantity_minor: quantity, unit_symbol: "ml" }] };
    expect(sourceQuantity(quantity)).toBeNull();
    const result = scaleCookbook(source, { mode: "yield", ingredientIndex: 0, target: "2" });
    expect(result).toEqual({ error: null, quantities: [null], yieldQuantity: 2_000_000 });
    expect(source.ingredients[0].quantity_minor).toBe(quantity);
  });

  it("keeps zero quantities as zero but rejects zero as an anchor", () => {
    const source = { ...recipe, ingredients: [{ quantity_minor: 0, unit_symbol: "kg" }] };
    expect(
      scaleCookbook(source, { mode: "yield", ingredientIndex: 0, target: "2" }).quantities,
    ).toEqual([0]);
    expect(
      scaleCookbook(source, { mode: "ingredient", ingredientIndex: 0, target: "2" }).error,
    ).toBeTruthy();
  });

  it("allows ingredient scaling with an unknown yield without inventing portions", () => {
    const result = scaleCookbook(
      { ...recipe, yield_quantity_minor: null },
      { mode: "ingredient", ingredientIndex: 0, target: "3" },
    );
    expect(result).toEqual({
      error: null,
      quantities: [3_000_000, 450_000, 750_000],
      yieldQuantity: null,
    });
  });

  it("rejects missing anchors and missing units rather than assuming portions or kg", () => {
    expect(
      scaleCookbook(recipe, { mode: "ingredient", ingredientIndex: 9, target: "3" }).error,
    ).toBeTruthy();
    expect(
      scaleCookbook(
        { ...recipe, yield_unit_symbol: null },
        { mode: "yield", ingredientIndex: 0, target: "2" },
      ).error,
    ).toBeTruthy();
    expect(
      scaleCookbook(
        { ...recipe, ingredients: [{ quantity_minor: 1_000_000 }] },
        { mode: "ingredient", ingredientIndex: 0, target: "2" },
      ).error,
    ).toBeTruthy();
  });

  it("rounds rational results once at micro precision and prevents silent underflow", () => {
    expect(
      scaleCookbook(
        { ...recipe, yield_quantity_minor: 3_000_000 },
        { mode: "yield", ingredientIndex: 0, target: "1" },
      ).quantities,
    ).toEqual([666667, 100000, 166667]);
    expect(
      scaleCookbook(
        { ...recipe, ingredients: [{ quantity_minor: 1 }] },
        { mode: "yield", ingredientIndex: 0, target: ".1" },
      ).error,
    ).toContain("precision");
  });

  it("rejects overflow without exposing a partially scaled batch", () => {
    const result = scaleCookbook(recipe, {
      mode: "yield",
      ingredientIndex: 0,
      target: "9007199254.740991",
    });
    expect(result.error).toContain("range");
    expect(result.quantities).toEqual([null, null, null]);
  });

  it("always recalculates from source rather than accumulating rounding", () => {
    scaleCookbook(recipe, { mode: "ingredient", ingredientIndex: 0, target: "3" });
    expect(
      scaleCookbook(recipe, { mode: "yield", ingredientIndex: 0, target: "1" }).quantities,
    ).toEqual([2_000_000, 300_000, 500_000]);
  });

  it("shows all six source decimal places and preserves raw ambiguous labels", () => {
    expect(quantityInput(1_000_001)).toBe("1.000001");
    expect(quantityInput(Number.MAX_SAFE_INTEGER)).toBe("9007199254.740991");
    expect(sourceQuantityLabel("300-500")).toBe("300-500");
    expect(sourceQuantityLabel("to taste")).toBe("to taste");
    expect(sourceQuantityLabel(null)).toBe("Not specified");
    expect(sourceQuantityLabel(0)).toBe("0");
  });
});

describe("cookbook scaling markup", () => {
  it("renders labeled controls, source/scaled columns, units, waste, and sub-recipes", () => {
    const html = renderToStaticMarkup(createElement(ScaledIngredients, { recipe }));
    expect(html).toContain("Portions / yield");
    expect(html).toContain("Ingredient amount");
    expect(html).toContain("Target portions / yield (portion)");
    expect(html).toContain("Source</th>");
    expect(html).toContain("Scaled</th>");
    expect(html).toContain("2 kg");
    expect(html).toContain("5% waste");
    expect(html).toContain("Sauce");
    expect(html).toContain("Reset");
    expect(html).not.toContain('role="alert"');
  });

  it("shows ambiguous sources unchanged and announces invalid bases accessibly", () => {
    const html = renderToStaticMarkup(
      createElement(ScaledIngredients, {
        recipe: {
          ...recipe,
          yield_quantity_minor: 0,
          ingredients: [
            { inventory_item_name: "Oil", quantity_minor: "300-500", unit_symbol: "ml" },
          ],
        },
      }),
    );
    expect(html).toContain("300-500 ml");
    expect(html).toContain("Unscaled");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain("NaN");
  });
});
