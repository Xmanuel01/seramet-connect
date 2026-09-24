import { useCallback, useEffect, useMemo, useState } from "react";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";

export type AdjustmentRow = {
  id: string;
  branch_id: string;
  warehouse_id: string;
  warehouse_name: string;
  inventory_item_id: string;
  code: string;
  sku: string | null;
  item_name: string;
  unit_symbol: string | null;
  quantity_minor: number;
  unit_cost_minor: number | null;
  estimated_value_minor: number;
  reason_code: string;
  notes: string | null;
  status: string;
  requested_by: string;
  approved_by: string | null;
  rejected_by: string | null;
  decision_reason: string | null;
  posted_movement_id: string | null;
  business_date: string;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
};

export type WastageRow = {
  id: string;
  branch_id: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  inventory_item_id: string | null;
  code: string | null;
  sku: string | null;
  item_name: string | null;
  unit_symbol: string | null;
  quantity_minor: number | null;
  reason_code: string | null;
  estimated_cost_minor: number | null;
  status: string;
  requested_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  decision_reason: string | null;
  movement_id: string | null;
  business_date: string | null;
  created_at: string;
  updated_at: string | null;
  decided_at: string | null;
};

export type BreakageRow = {
  id: string;
  branch_id: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  asset_name: string | null;
  quantity_minor: number | null;
  unit_label: string | null;
  reason_code: string | null;
  estimated_value_minor: number | null;
  status: string;
  requested_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  decision_reason: string | null;
  business_date: string | null;
  created_at: string;
  updated_at: string | null;
  decided_at: string | null;
};

export type ParPolicyRow = {
  warehouse_id: string;
  warehouse_name: string;
  inventory_item_id: string;
  code: string;
  sku: string | null;
  item_name: string;
  unit_symbol: string | null;
  on_hand_minor: number;
  reserved_minor: number;
  available_minor: number;
  average_unit_cost_minor: number;
  minimum_quantity_minor: number;
  reorder_point_minor: number;
  target_quantity_minor: number;
  maximum_quantity_minor: number | null;
  safety_stock_minor: number;
  recommendation_mode: string;
  preferred_supplier_name: string | null;
  suggested_quantity_minor: number;
  suggested_value_minor: number;
};

export type TransferRow = {
  id: string;
  transfer_number: string;
  source_branch_id: string;
  source_branch_name: string;
  source_warehouse_id: string;
  source_warehouse_name: string;
  destination_branch_id: string;
  destination_branch_name: string;
  destination_warehouse_id: string;
  destination_warehouse_name: string;
  status: string;
  requested_by: string;
  approved_by: string | null;
  received_by: string | null;
  approval_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  shipment_id: string | null;
  shipment_status: string | null;
  dispatched_at: string | null;
  line_count: number;
  requested_quantity_minor: number;
  sent_quantity_minor: number;
  received_quantity_minor: number;
  shortage_quantity_minor: number;
  sent_value_minor: number;
};

type BranchOperations = {
  branchId: string;
  adjustments: AdjustmentRow[];
  wastage: WastageRow[];
  breakages: BreakageRow[];
  parPolicies: ParPolicyRow[];
  transfers: TransferRow[];
};

export function useInventoryOperations(enabled: boolean) {
  const control = useInventoryControlCentre(enabled);
  const branchIds = useMemo(() => control.data.map((row) => row.branchId), [control.data]);
  const branchKey = branchIds.join("|");
  const [data, setData] = useState<BranchOperations[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const refreshOperations = useCallback(async () => {
    if (!enabled || !branchKey) {
      setData([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const next = await Promise.all(
        branchKey.split("|").filter(Boolean).map(async (branchId): Promise<BranchOperations> => {
          const query = `branchId=${encodeURIComponent(branchId)}&limit=200`;
          const [adjustments, wastage, breakages, par, transfers] = await Promise.all([
            fetchJson<{ adjustments: AdjustmentRow[] }>(
              `/api/seramet/inventory/adjustments?${query}`,
              control.headers,
            ),
            fetchJson<{ wastage: WastageRow[] }>(
              `/api/seramet/inventory/wastage?${query}`,
              control.headers,
            ),
            fetchJson<{ breakages: BreakageRow[] }>(
              `/api/seramet/inventory/breakages?${query}`,
              control.headers,
            ),
            fetchJson<{ policies: ParPolicyRow[] }>(
              `/api/seramet/inventory/par-policies?branchId=${encodeURIComponent(branchId)}`,
              control.headers,
            ),
            fetchJson<{ transfers: TransferRow[] }>(
              `/api/seramet/inventory/transfers?${query}`,
              control.headers,
            ),
          ]);
          return {
            branchId,
            adjustments: adjustments.adjustments,
            wastage: wastage.wastage,
            breakages: breakages.breakages,
            parPolicies: par.policies,
            transfers: transfers.transfers,
          };
        }),
      );
      setData(next);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inventory operations query failed");
      setStatus("error");
    }
  }, [branchKey, control.headers, enabled]);

  useEffect(() => {
    void refreshOperations();
  }, [refreshOperations]);

  const command = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      if (!enabled) throw new Error("Authoritative inventory commands require the server database");
      const response = await fetch(path, {
        method: "POST",
        headers: control.headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Inventory command failed (${response.status})`,
        );
      }
      await Promise.all([control.refresh(), refreshOperations()]);
      return payload;
    },
    [control, enabled, refreshOperations],
  );

  return {
    control,
    data,
    status,
    error,
    refresh: refreshOperations,
    command,
  };
}

async function fetchJson<T>(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? `Inventory query failed (${response.status})`);
  }
  return payload;
}
