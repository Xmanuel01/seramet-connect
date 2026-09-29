import { useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export type InventoryItemDetailPayload = {
  branchId: string;
  item: {
    id: string;
    code: string;
    sku: string | null;
    name: string;
    description: string | null;
    category_id: string | null;
    base_unit_id: string;
    purchase_unit_id: string | null;
    storage_unit_id: string | null;
    issue_unit_id: string | null;
    track_inventory: number;
    track_expiry: number;
    preferred_supplier_id: string | null;
    preferred_supplier_name: string | null;
    default_warehouse_id: string | null;
    barcode: string | null;
    base_unit_symbol: string | null;
  };
  balances: Array<{
    warehouse_id: string;
    warehouse_name: string;
    quantity_minor: number;
    quantity_reserved_minor: number;
    quantity_available_minor: number;
    average_unit_cost_minor: number;
    total_value_minor: number;
    last_movement_at: string | null;
    reorder_point_minor: number | null;
    target_quantity_minor: number | null;
    safety_stock_minor: number | null;
  }>;
  movements: Array<{
    id: string;
    business_date: string | null;
    movement_type: string;
    quantity_minor: number;
    unit_cost_minor: number | null;
    total_cost_minor: number | null;
    source_type: string;
    source_id: string;
    reason: string | null;
    occurred_at: string | null;
    warehouse_id: string;
    actor_id: string | null;
  }>;
  recipes: Array<{
    id: string;
    name: string;
    recipe_version_id: string;
    version: number;
    yield_quantity_minor: number;
    yield_unit_symbol: string | null;
    quantity_minor: number;
    component_unit_symbol: string | null;
  }>;
  generatedAt: string;
};

export function useInventoryItemDetail(enabled: boolean, sku: string) {
  const { activeTenantId, branchId, branchRecords, isAllBranches, currentUser, role } =
    useAppContext();
  const branchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );
  const branchKey = branchIds.join("|");
  const [data, setData] = useState<InventoryItemDetailPayload[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const headers = useMemo<Record<string, string>>(() => {
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

  useEffect(() => {
    if (!enabled || !sku) {
      setData([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError("");
    void Promise.all(
      branchKey
        .split("|")
        .filter(Boolean)
        .map(async (selectedBranchId) => {
          const params = new URLSearchParams({ branchId: selectedBranchId, limit: "100" });
          const response = await fetch(
            `/api/seramet/inventory/items/${encodeURIComponent(sku)}?${params.toString()}`,
            { headers },
          );
          if (response.status === 404) return null;
          const body = (await response.json().catch(() => ({}))) as {
            detail?: InventoryItemDetailPayload;
            message?: string;
            error?: string;
          };
          if (!response.ok || !body.detail) {
            throw new Error(
              body.message ?? body.error ?? `Inventory item query failed (${response.status})`,
            );
          }
          return body.detail;
        }),
    )
      .then((rows) => {
        if (cancelled) return;
        setData(rows.filter((row): row is InventoryItemDetailPayload => Boolean(row)));
        setStatus("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Inventory item query failed");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [branchKey, enabled, headers, sku]);

  return { data, status, error };
}
