import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import type { InventorySummary } from "@/inventory/types";

export type InventoryListRow = {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  category_id: string | null;
  base_unit_id: string;
  purchase_unit_id: string | null;
  track_expiry: number;
  warehouse_id: string;
  quantity_minor: number;
  quantity_reserved_minor: number;
  quantity_available_minor: number;
  average_unit_cost_minor: number;
  total_value_minor: number;
  last_movement_at: string | null;
  reorder_point_minor: number | null;
  target_quantity_minor: number | null;
  safety_stock_minor: number | null;
};

export type ProcurementOrderRow = {
  id: string;
  purchase_order_number: string;
  supplier_id: string;
  supplier_name: string;
  warehouse_id: string;
  status: string;
  currency: string;
  total_minor: number;
  expected_at: string | null;
  created_at: string;
  approved_at: string | null;
  received_at: string | null;
  lines: Array<{
    id: string;
    inventory_item_id: string;
    item_name: string;
    sku: string | null;
    unit_symbol: string | null;
    ordered_quantity_minor: number;
    received_purchase_quantity_minor: number;
    unit_price_minor: number;
    line_total_minor: number;
  }>;
};

export type ProcurementSupplierRow = {
  id: string;
  code: string;
  name: string;
  lead_time_days: number;
  payment_terms_days: number;
  currency: string;
  order_count: number;
  ordered_minor: number;
  outstanding_minor: number;
  on_time_count: number;
  received_count: number;
};

export type FoodCostControlData = {
  branchId: string;
  movements: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  qualityIssues: Array<Record<string, unknown>>;
  menuProfitability: Array<Record<string, unknown>>;
  recipes: Array<Record<string, unknown>>;
  consumption: Array<Record<string, unknown>>;
  prepRecommendations: Array<Record<string, unknown>>;
  generatedAt: string;
};

type BranchPayload = {
  branchId: string;
  summary: InventorySummary;
  items: InventoryListRow[];
  units: Array<{
    id: string;
    code: string;
    name: string;
    symbol: string;
    dimension: string;
    base_scale_numerator: number;
    base_scale_denominator: number;
  }>;
  procurement: {
    branchId: string;
    purchaseOrders: ProcurementOrderRow[];
    suppliers: ProcurementSupplierRow[];
    requisitions: Array<Record<string, unknown>>;
    receipts: Array<Record<string, unknown>>;
  };
  controlCentre: FoodCostControlData;
};

export function useInventoryControlCentre(enabled: boolean) {
  const { activeTenantId, branchId, branchRecords, isAllBranches, currentUser, role } =
    useAppContext();
  const selectedBranchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );
  const branchKey = selectedBranchIds.join("|");
  const [data, setData] = useState<BranchPayload[]>([]);
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
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const branchIds = branchKey.split("|").filter(Boolean);
      const next = await Promise.all(
        branchIds.map(async (selectedBranchId): Promise<BranchPayload> => {
          const query = `branchId=${encodeURIComponent(selectedBranchId)}&limit=100`;
          const [
            summaryResponse,
            itemsResponse,
            unitsResponse,
            procurementResponse,
            controlResponse,
          ] = await Promise.all([
            fetch(
              `/api/seramet/inventory/summary?branchId=${encodeURIComponent(selectedBranchId)}`,
              { headers },
            ),
            fetch(`/api/seramet/inventory/items?${query}`, { headers }),
            fetch("/api/seramet/inventory/units", { headers }),
            fetch(`/api/seramet/procurement/overview?${query}`, { headers }),
            fetch(`/api/seramet/inventory/control-centre?${query}`, { headers }),
          ]);
          for (const response of [
            summaryResponse,
            itemsResponse,
            unitsResponse,
            procurementResponse,
            controlResponse,
          ]) {
            if (!response.ok) throw new Error(`Inventory server query failed (${response.status})`);
          }
          const summaryBody = (await summaryResponse.json()) as { summary: InventorySummary };
          const itemsBody = (await itemsResponse.json()) as { items: InventoryListRow[] };
          const unitsBody = (await unitsResponse.json()) as { units: BranchPayload["units"] };
          const procurementBody = (await procurementResponse.json()) as {
            overview: BranchPayload["procurement"];
          };
          const controlBody = (await controlResponse.json()) as {
            controlCentre: FoodCostControlData;
          };
          return {
            branchId: selectedBranchId,
            summary: summaryBody.summary,
            items: itemsBody.items,
            units: unitsBody.units,
            procurement: procurementBody.overview,
            controlCentre: controlBody.controlCentre,
          };
        }),
      );
      setData(next);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inventory server query failed");
      setStatus("error");
    }
  }, [branchKey, enabled, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recalculate = useCallback(async () => {
    if (!enabled) return;
    const response = await fetch("/api/seramet/inventory/recalculate", {
      method: "POST",
      headers,
      body: JSON.stringify(isAllBranches ? {} : { branchId }),
    });
    if (!response.ok)
      throw new Error(`Inventory recalculation could not be queued (${response.status})`);
  }, [branchId, enabled, headers, isAllBranches]);

  const command = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      if (!enabled) throw new Error("Authoritative inventory commands require the server database");
      const response = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Inventory command failed (${response.status})`,
        );
      }
      await refresh();
      return payload;
    },
    [enabled, headers, refresh],
  );

  return { data, status, error, refresh, recalculate, command };
}
