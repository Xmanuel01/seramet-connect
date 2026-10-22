import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import type { CookbookRecipe } from "@/cookbook/use-cookbook";
import { quantityInput, scaleCookbook, sourceQuantityLabel, type ScaleRequest } from "./scaling";

export function ScaledIngredients({
  recipe,
}: {
  recipe: Pick<CookbookRecipe, "yield_quantity_minor" | "yield_unit_symbol" | "ingredients">;
}) {
  const id = useId();
  const initial: ScaleRequest = {
    mode: "yield",
    ingredientIndex: 0,
    target: quantityInput(recipe.yield_quantity_minor),
  };
  const [request, setRequest] = useState(initial);
  const scaled = scaleCookbook(recipe, request);
  const anchor = recipe.ingredients[request.ingredientIndex];
  const unit = request.mode === "yield" ? recipe.yield_unit_symbol : anchor?.["unit_symbol"];

  return (
    <section aria-label="Ingredient scaling" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase text-muted-foreground">Ingredients</h3>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12px]"
          onClick={() => setRequest(initial)}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-[12px]">
        <legend className="sr-only">Scale by</legend>
        {(["yield", "ingredient"] as const).map((mode) => (
          <label key={mode} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={request.mode === mode}
              onChange={() =>
                setRequest({
                  ...request,
                  mode,
                  target: quantityInput(
                    mode === "yield" ? recipe.yield_quantity_minor : anchor?.["quantity_minor"],
                  ),
                })
              }
            />
            {mode === "yield" ? "Portions / yield" : "Ingredient amount"}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {request.mode === "ingredient" ? (
          <label className="grid min-w-0 gap-1 text-[12px]">
            Base ingredient
            <select
              className={controlClass}
              value={request.ingredientIndex}
              onChange={(event) => {
                const ingredientIndex = Number(event.target.value);
                setRequest({
                  ...request,
                  ingredientIndex,
                  target: quantityInput(recipe.ingredients[ingredientIndex]?.["quantity_minor"]),
                });
              }}
            >
              {recipe.ingredients.map((ingredient, index) => (
                <option key={index} value={index}>
                  {ingredientName(ingredient)} ({sourceQuantityLabel(ingredient["quantity_minor"])}{" "}
                  {String(ingredient["unit_symbol"] ?? "unit unknown")})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="grid min-w-0 gap-1 text-[12px]">
          Target {request.mode === "yield" ? "portions / yield" : "ingredient amount"} (
          {String(unit ?? "unit unknown")})
          <input
            className={controlClass}
            type="number"
            min="0.000001"
            step="0.000001"
            value={request.target}
            aria-invalid={Boolean(scaled.error)}
            aria-describedby={scaled.error ? `${id}-error` : undefined}
            onChange={(event) => setRequest({ ...request, target: event.target.value })}
          />
        </label>
      </div>
      {scaled.error ? (
        <p id={`${id}-error`} role="alert" className="text-[12px] text-danger">
          {scaled.error}
        </p>
      ) : null}
      <div className="text-[12px] text-muted-foreground" aria-live="polite">
        Source yield: {sourceQuantityLabel(recipe.yield_quantity_minor)}{" "}
        {recipe.yield_unit_symbol ?? "unit unknown"}
        {scaled.yieldQuantity !== null
          ? ` | Scaled yield: ${quantityInput(scaled.yieldQuantity)} ${recipe.yield_unit_symbol ?? "unit unknown"}`
          : ""}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-3">Ingredient</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2">Scaled</th>
            </tr>
          </thead>
          <tbody>
            {recipe.ingredients.map((ingredient, index) => (
              <tr
                key={String(ingredient["id"] ?? index)}
                className="border-b border-border last:border-b-0"
              >
                <th scope="row" className="py-2 pr-3 font-medium break-words">
                  {ingredientName(ingredient)}
                  {Number(ingredient["waste_factor_bps"] ?? 0) > 0 ? (
                    <span className="block font-normal text-muted-foreground">
                      + {Number(ingredient["waste_factor_bps"]) / 100}% waste
                    </span>
                  ) : null}
                </th>
                <td className="py-2 pr-3">
                  {sourceQuantityLabel(ingredient["quantity_minor"])}{" "}
                  {String(ingredient["unit_symbol"] ?? "unit unknown")}
                </td>
                <td className="py-2">
                  {scaled.quantities[index] === null
                    ? "Unscaled"
                    : `${quantityInput(scaled.quantities[index])} ${String(ingredient["unit_symbol"] ?? "unit unknown")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!recipe.ingredients.length ? (
        <p className="text-[12px] text-muted-foreground">No ingredients recorded.</p>
      ) : null}
    </section>
  );
}

function ingredientName(ingredient: Record<string, unknown>) {
  return String(
    ingredient["inventory_item_name"] ?? ingredient["sub_recipe_name"] ?? "Unknown ingredient",
  );
}

const controlClass = "h-10 w-full min-w-0 rounded-md border border-border bg-card px-2 text-[13px]";
