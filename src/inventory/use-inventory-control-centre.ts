import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { requireInventoryResponse } from "./inventory-response";
import type { InventorySummary } from "@/inventory/types";

export type InventoryListRow = {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  base_unit_id: string;
  purchase_unit_id: string | null;
  track_inventory: number;
  track_expiry: number;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
  default_warehouse_id: string | null;
  warehouse_id: string | null;
  base_unit_symbol: string | null;
  warehouse_count: number;
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
  requisition_id: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approval_reason: string | null;
  status: string;
  currency: string;
  total_minor: number;
  expected_at: string | null;
  created_at: string;
  approved_at: string | null;
  received_at: string | null;
  over_receipt_policy: "REJECT_OVER_RECEIPT" | "ALLOW_WITH_APPROVAL" | "ALLOW_WITH_TOLERANCE";
  over_receipt_tolerance_bps: number;
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

export type ProcurementRequisitionRow = {
  id: string;
  warehouse_id: string;
  requisition_number: string;
  status: string;
  source_type: string;
  requested_by: string;
  required_at: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  approval_reason: string | null;
  lines: Array<{
    id: string;
    inventory_item_id: string;
    item_name: string;
    sku: string | null;
    requested_quantity_minor: number;
    ordered_quantity_minor: number;
    unit_id: string;
    unit_symbol: string | null;
    notes: string | null;
  }>;
};

export type ProcurementReceiptRow = {
  id: string;
  receipt_number: string;
  purchase_order_id: string;
  purchase_order_number: string;
  currency: string;
  supplier_id: string;
  supplier_name: string;
  warehouse_id: string;
  status: string;
  business_date: string;
  received_by: string;
  received_at: string;
  line_count: number;
  received_quantity_minor: number;
  accepted_quantity_minor: number;
  rejected_quantity_minor: number;
  total_minor: number;
  invoice_linked: number;
};

export type ProcurementSupplierInvoiceRow = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  purchase_order_id: string | null;
  purchase_order_number: string | null;
  goods_receipt_id: string | null;
  receipt_number: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  status: string;
  journal_entry_id: string | null;
  created_at: string;
  updated_at: string;
  match_status: string | null;
  ordered_total_minor: number | null;
  received_total_minor: number | null;
  invoiced_total_minor: number | null;
  variance_minor: number | null;
};

export type ProcurementSupplierRow = {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  phone: string | null;
  email: string | null;
  tax_number: string | null;
  address: string | null;
  lead_time_days: number;
  payment_terms_days: number;
  currency: string | null;
  minimum_order_minor: number;
  active: number;
  created_at: string;
  updated_at: string;
  order_count: number;
  ordered_minor: number;
  outstanding_minor: number;
  on_time_count: number;
  received_count: number;
};

export type ProcurementSupplierItemRow = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  inventory_item_id: string;
  item_name: string;
  sku: string | null;
  supplier_sku: string | null;
  purchase_unit_id: string;
  purchase_unit_symbol: string | null;
  contract_price_minor: number | null;
  minimum_quantity_minor: number | null;
  lead_time_days: number | null;
  preferred: number;
  active: number;
  created_at: string;
  updated_at: string;
};

export type InventoryMovementRow = {
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
  inventory_item_id: string;
  code: string;
  sku: string | null;
  name: string;
  unit_symbol: string | null;
};

export type FoodCostControlData = {
  branchId: string;
  movements: InventoryMovementRow[];
  recommendations: Array<Record<string, unknown>>;
  qualityIssues: Array<Record<string, unknown>>;
  menuProfitability: Array<Record<string, unknown>>;
  recipes: Array<Record<string, unknown>>;
  consumption: Array<Record<string, unknown>>;
  prepRecommendations: Array<Record<string, unknown>>;
  generatedAt: string;
};

export type InventoryBranchPayload = {
  branchId: string;
  summary: InventorySummary;
  items: InventoryListRow[];
  categories: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    item_count: number;
    stock_value_minor: number;
    low_stock_count: number;
    out_of_stock_count: number;
  }>;
  warehouses: Array<{
    id: string;
    code: string;
    name: string;
    branch_id: string;
    location_type: "MAIN" | "KITCHEN" | "BAR" | "COLD" | "TRANSIT" | "OTHER";
    active: number;
    created_at: string | null;
    updated_at: string | null;
    archived_at: string | null;
    stocked_item_count: number;
    stock_value_minor: number;
  }>;
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
    supplierItems: ProcurementSupplierItemRow[];
    requisitions: ProcurementRequisitionRow[];
    receipts: ProcurementReceiptRow[];
    supplierInvoices: ProcurementSupplierInvoiceRow[];
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
  const [data, setData] = useState<InventoryBranchPayload[]>([]);
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
        branchIds.map(async (selectedBranchId): Promise<InventoryBranchPayload> => {
          const query = `branchId=${encodeURIComponent(selectedBranchId)}&limit=100`;
          const [
            summaryResponse,
            items,
            categoriesResponse,
            warehousesResponse,
            unitsResponse,
            procurementResponse,
            controlResponse,
          ] = await Promise.all([
            fetch(
              `/api/seramet/inventory/summary?branchId=${encodeURIComponent(selectedBranchId)}`,
              { headers },
            ),
            fetchInventoryItems(headers, selectedBranchId),
            fetch(
              `/api/seramet/inventory/categories?branchId=${encodeURIComponent(selectedBranchId)}`,
              { headers },
            ),
            fetch(
              `/api/seramet/inventory/warehouses?branchId=${encodeURIComponent(selectedBranchId)}`,
              { headers },
            ),
            fetch("/api/seramet/inventory/units", { headers }),
            fetch(`/api/seramet/procurement/overview?${query}`, { headers }),
            fetch(`/api/seramet/inventory/control-centre?${query}`, { headers }),
          ]);
          for (const [response, resource] of [
            [summaryResponse, "Inventory summary"],
            [categoriesResponse, "Inventory categories"],
            [warehousesResponse, "Inventory locations"],
            [unitsResponse, "Inventory units"],
            [procurementResponse, "Procurement overview"],
            [controlResponse, "Inventory cost control"],
          ] as const) {
            await requireInventoryResponse(response, resource);
          }
          const summaryBody = (await summaryResponse.json()) as { summary: InventorySummary };
          const categoriesBody = (await categoriesResponse.json()) as {
            categories: InventoryBranchPayload["categories"];
          };
          const warehousesBody = (await warehousesResponse.json()) as {
            warehouses: InventoryBranchPayload["warehouses"];
          };
          const unitsBody = (await unitsResponse.json()) as {
            units: InventoryBranchPayload["units"];
          };
          const procurementBody = (await procurementResponse.json()) as {
            overview: InventoryBranchPayload["procurement"];
          };
          const controlBody = (await controlResponse.json()) as {
            controlCentre: FoodCostControlData;
          };
          return {
            branchId: selectedBranchId,
            summary: summaryBody.summary,
            items,
            categories: categoriesBody.categories,
            warehouses: warehousesBody.warehouses,
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

  return { data, status, error, refresh, recalculate, command, headers };
}

async function fetchInventoryItems(headers: Record<string, string>, branchId: string) {
  const items: InventoryListRow[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ branchId, limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/seramet/inventory/items?${params.toString()}`, { headers });
    await requireInventoryResponse(response, "Inventory items");
    const body = (await response.json()) as {
      items: InventoryListRow[];
      nextCursor: string | null;
    };
    items.push(...body.items);
    cursor = body.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error("Inventory pagination returned a repeated cursor");
      }
      seenCursors.add(cursor);
    }
  } while (cursor);
  return items;
}
