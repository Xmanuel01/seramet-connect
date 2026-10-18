import { multiplyDivide, QUANTITY_SCALE } from "@/inventory/quantity";

export type ScaleRequest = {
  mode: "yield" | "ingredient";
  ingredientIndex: number;
  target: string;
};

export function sourceQuantity(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null;
}

export function quantityInput(value: unknown): string {
  const quantity = sourceQuantity(value);
  if (quantity === null) return "";
  const micro = BigInt(quantity);
  const fraction = String(micro % BigInt(QUANTITY_SCALE))
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${micro / BigInt(QUANTITY_SCALE)}${fraction ? `.${fraction}` : ""}`;
}

export function sourceQuantityLabel(value: unknown): string {
  return quantityInput(value) || (value == null || value === "" ? "Not specified" : String(value));
}

function targetQuantity(value: string): number | null {
  const match = /^(\d{0,10})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const micro =
    BigInt(match[1] || "0") * BigInt(QUANTITY_SCALE) + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micro <= 0n || micro > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(micro);
}

export function scaleCookbook(
  recipe: {
    yield_quantity_minor: unknown;
    yield_unit_symbol: string | null;
    ingredients: ReadonlyArray<Record<string, unknown>>;
  },
  request: ScaleRequest,
) {
  const unavailable = {
    quantities: recipe.ingredients.map(() => null as number | null),
    yieldQuantity: null as number | null,
  };
  const anchor = request.mode === "ingredient" ? recipe.ingredients[request.ingredientIndex] : null;
  const base = sourceQuantity(
    request.mode === "yield" ? recipe.yield_quantity_minor : anchor?.["quantity_minor"],
  );
  const unit = request.mode === "yield" ? recipe.yield_unit_symbol : anchor?.["unit_symbol"];
  if (base === null || base <= 0 || typeof unit !== "string" || !unit.trim()) {
    return { ...unavailable, error: "Scaling requires a known positive base quantity and unit." };
  }
  const target = targetQuantity(request.target);
  if (target === null) {
    return {
      ...unavailable,
      error: "Enter a positive amount with at most 6 decimal places, within the supported range.",
    };
  }
  try {
    const scale = (value: unknown): number | null => {
      const quantity = sourceQuantity(value);
      if (quantity === null) return null;
      const result = multiplyDivide(quantity, target, base, "Scaled quantity");
      if (quantity > 0 && result === 0)
        throw new Error("Scaled quantity is below the supported precision.");
      return result;
    };
    return {
      quantities: recipe.ingredients.map((ingredient) => scale(ingredient["quantity_minor"])),
      yieldQuantity: scale(recipe.yield_quantity_minor),
      error: null,
    };
  } catch (error) {
    return {
      ...unavailable,
      error: error instanceof Error ? error.message : "Quantity cannot be scaled.",
    };
  }
}
