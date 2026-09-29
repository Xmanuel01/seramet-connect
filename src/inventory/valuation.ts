import { quantityCostMinor } from "@/inventory/quantity";

export type InventoryValuationMethod = "WEIGHTED_AVERAGE" | "FIFO";

export type MovementCostContext = {
  quantityBaseMicro: number;
  currentAverageUnitCostMinor: number;
  suppliedUnitCostMinor?: number;
  suppliedTotalCostMinor?: number;
};

export interface InventoryValuationStrategy {
  readonly method: InventoryValuationMethod;
  movementCost(context: MovementCostContext): {
    unitCostMinor: number;
    totalCostMinor: number;
  };
}

export class WeightedAverageValuationStrategy implements InventoryValuationStrategy {
  readonly method = "WEIGHTED_AVERAGE" as const;

  movementCost(context: MovementCostContext) {
    const unitCostMinor = context.suppliedUnitCostMinor ?? context.currentAverageUnitCostMinor;
    const absoluteCost = quantityCostMinor(Math.abs(context.quantityBaseMicro), unitCostMinor);
    return {
      unitCostMinor,
      totalCostMinor:
        context.suppliedTotalCostMinor ?? absoluteCost * Math.sign(context.quantityBaseMicro),
    };
  }
}

export function createInventoryValuationStrategy(method: InventoryValuationMethod) {
  if (method === "WEIGHTED_AVERAGE") return new WeightedAverageValuationStrategy();
  throw new Error("FIFO valuation is not implemented; configure WEIGHTED_AVERAGE");
}
