import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export type RecipeComponentRow = {
  id: string;
  inventory_item_id: string | null;
  sub_recipe_id: string | null;
  quantity_minor: number;
  unit_id: string;
  waste_factor_bps: number;
  optional: number;
  station_id: string | null;
  unit_symbol: string | null;
  inventory_item_code: string | null;
  inventory_item_sku: string | null;
  inventory_item_name: string | null;
  sub_recipe_name: string | null;
  component_cost_minor: number;
  component_costing_error: string | null;
};

export type RecipeLibraryRow = {
  id: string;
  name: string;
  menu_item_id: string | null;
  production_item_id: string | null;
  branch_override_id: string | null;
  current_version_id: string | null;
  version: number | null;
  yield_quantity_minor: number | null;
  yield_unit_id: string | null;
  yield_unit_symbol: string | null;
  packaging_cost_minor: number | null;
  production_overhead_minor: number | null;
  effective_from: string | null;
  menu_item_code: string | null;
  menu_item_sku: string | null;
  menu_item_name: string | null;
  selling_price_minor: number | null;
  production_item_code: string | null;
  production_item_sku: string | null;
  production_item_name: string | null;
  cost_minor: number;
  available_output_quantity_minor: number;
  costing_error: string | null;
  components: RecipeComponentRow[];
};

export type RecipeInventoryOption = {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  base_unit_id: string;
  base_unit_symbol: string | null;
  default_warehouse_id: string | null;
  available_quantity_minor: number;
  average_unit_cost_minor: number;
};

export type RecipeUnitOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: string;
  base_scale_numerator: number;
  base_scale_denominator: number;
};

export type RecipeMenuOption = {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  category_code: string;
  selling_price_minor: number;
  currency: string;
  available: number;
};

export type RecipeBranchLibrary = {
  branchId: string;
  library: {
    branchId: string;
    recipes: RecipeLibraryRow[];
    inventoryItems: RecipeInventoryOption[];
    units: RecipeUnitOption[];
    menuItems: RecipeMenuOption[];
    generatedAt: string;
  };
};

export function useRecipeControlCentre(enabled: boolean) {
  const { activeTenantId, branchId, branchRecords, isAllBranches, currentUser, role } =
    useAppContext();
  const selectedBranchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );
  const branchKey = selectedBranchIds.join("|");
  const [data, setData] = useState<RecipeBranchLibrary[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const headers = useMemo(() => {
    const token = getSerametAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-user-id": currentUser.id,
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      "x-seramet-user": currentUser.name,
      "x-seramet-role": role,
    };
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, role]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setData([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const branches = branchKey.split("|").filter(Boolean);
      const next = await Promise.all(
        branches.map(async (selectedBranchId): Promise<RecipeBranchLibrary> => {
          const response = await fetch(
            `/api/seramet/inventory/recipes?branchId=${encodeURIComponent(selectedBranchId)}`,
            { headers },
          );
          const payload = (await response.json().catch(() => ({}))) as RecipeBranchLibrary & {
            error?: string;
            message?: string;
          };
          if (!response.ok) {
            throw new Error(
              payload.message ?? payload.error ?? `Recipe query failed (${response.status})`,
            );
          }
          return { branchId: selectedBranchId, library: payload.library };
        }),
      );
      setData(next);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recipe query failed");
      setStatus("error");
    }
  }, [branchKey, enabled, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      if (!enabled) throw new Error("Recipe commands require the authoritative server");
      const response = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
        message?: string;
      };
      if (!response.ok && response.status !== 207) {
        throw new Error(
          payload.message ?? payload.error ?? `Recipe command failed (${response.status})`,
        );
      }
      await refresh();
      return payload;
    },
    [enabled, headers, refresh],
  );

  return { data, status, error, refresh, command };
}
