export type CostMaterial = {
  id: string;
  name: string;
  category: string;
  unit: string;
  costPerUnit: number;
  yieldPct: number;
  par: number;
  mainStore: number;
  kitchen: number;
  counter: number;
  supplier: string;
  status: string;
};

export type CostBomLine = {
  id: string;
  materialId: string;
  qty: number;
  station: string;
};

export type CostRecipe = {
  productId: string;
  targetFoodCostPct: number;
  expectedSales: number;
  actualIssueMultiplier: number;
  lines: CostBomLine[];
};

export type CostStockEntry = {
  id: string;
  date: string;
  type: "Receive" | "Issue to kitchen" | "Waste" | "Return to store";
  materialId: string;
  qty: number;
  note: string;
  by: string;
};

export type CostControlSnapshot = {
  id: string;
  tenantId: string;
  branchId: string;
  materials: CostMaterial[];
  recipes: CostRecipe[];
  stockEntries: CostStockEntry[];
  updatedAt: string;
  updatedBy: string;
};
