import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export type ProductionBatchRow = {
  id: string;
  branch_id: string;
  warehouse_id: string;
  warehouse_name: string;
  recipe_version_id: string;
  recipe_id: string;
  recipe_name: string;
  planned_quantity_minor: number;
  actual_output_quantity_minor: number | null;
  output_item_id: string;
  output_item_name: string;
  unit_symbol: string | null;
  station_id: string | null;
  employee_id: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  started_at: string | null;
  completed_at: string | null;
  business_date: string;
  expected_yield_minor: number;
  yield_variance_bps: number | null;
  output_value_minor: number;
  created_at: string;
  updated_at: string;
};

export type ProductionRecipeOption = {
  id: string;
  name: string;
  production_item_id: string;
  output_item_name: string;
  default_warehouse_id: string | null;
  active_version_id: string;
  version: number;
  yield_quantity_minor: number;
  yield_unit_id: string;
  yield_unit_symbol: string | null;
};

export type ProductionWarehouseOption = {
  id: string;
  code: string;
  name: string;
};

export type ProductionStationOption = {
  id: string;
  code: string;
  name: string;
  station_type: string;
};

export type ProductionBranchData = {
  branchId: string;
  businessDate: string;
  production: {
    branchId: string;
    batches: ProductionBatchRow[];
    recipes: ProductionRecipeOption[];
    warehouses: ProductionWarehouseOption[];
    stations: ProductionStationOption[];
    generatedAt: string;
  };
};

export function useProductionControlCentre(enabled: boolean) {
  const { activeTenantId, branchId, branchRecords, isAllBranches, currentUser, role } =
    useAppContext();
  const selectedBranchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );
  const branchKey = selectedBranchIds.join("|");
  const [data, setData] = useState<ProductionBranchData[]>([]);
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
      setStatus("idle");
      setData([]);
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const branchIds = branchKey.split("|").filter(Boolean);
      const next = await Promise.all(
        branchIds.map(async (selectedBranchId): Promise<ProductionBranchData> => {
          const response = await fetch(
            `/api/seramet/production/overview?branchId=${encodeURIComponent(selectedBranchId)}&limit=200`,
            { headers },
          );
          const payload = (await response.json().catch(() => ({}))) as ProductionBranchData & {
            message?: string;
            error?: string;
          };
          if (!response.ok) {
            throw new Error(
              payload.message ?? payload.error ?? `Production query failed (${response.status})`,
            );
          }
          return payload;
        }),
      );
      setData(next);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Production query failed");
      setStatus("error");
    }
  }, [branchKey, enabled, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = useCallback(
    async <T>(path: string, body?: unknown): Promise<T> => {
      if (!enabled) throw new Error("Production commands require the authoritative server");
      const response = await fetch(path, {
        method: "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Production command failed (${response.status})`,
        );
      }
      await refresh();
      return payload;
    },
    [enabled, headers, refresh],
  );

  return { data, status, error, refresh, command };
}
