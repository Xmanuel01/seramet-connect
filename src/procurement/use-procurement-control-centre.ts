import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export type ProcurementOrderRow = {
  id: string;
  purchase_order_number: string;
  supplier_id: string;
  supplier_name: string;
  warehouse_id: string;
  requisition_id: string | null;
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
    tax_minor: number;
    discount_minor: number;
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

export type ProcurementRequisitionRow = {
  id: string;
  requisition_number: string;
  warehouse_id: string;
  status: string;
  source_type: string;
  requested_by: string;
  required_at: string | null;
  created_at: string;
  approved_at: string | null;
  approval_reason: string | null;
  lines: Array<{
    id: string;
    inventory_item_id: string;
    item_name: string;
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
  supplier_id: string;
  supplier_name: string;
  warehouse_id: string;
  status: string;
  received_at: string;
  received_quantity_minor: number;
  accepted_quantity_minor: number;
  rejected_quantity_minor: number;
  total_minor: number;
};

export type ProcurementSupplierInvoiceRow = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  purchase_order_id: string;
  purchase_order_number: string;
  goods_receipt_id: string;
  receipt_number: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  status: string;
  created_at: string;
  match_status: string | null;
  ordered_total_minor: number | null;
  received_total_minor: number | null;
  invoiced_total_minor: number | null;
  variance_minor: number | null;
};

export type ProcurementCatalogItem = {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  base_unit_id: string;
  purchase_unit_id: string | null;
  track_expiry: number;
  base_unit_symbol: string | null;
  purchase_unit_symbol: string | null;
  preferred_supplier_id: string | null;
  default_warehouse_id: string | null;
};

export type ProcurementWarehouse = {
  id: string;
  code: string;
  name: string;
  branch_id: string;
  location_type: string;
};

export type ProcurementBranchPayload = {
  branchId: string;
  purchaseOrders: ProcurementOrderRow[];
  suppliers: ProcurementSupplierRow[];
  requisitions: ProcurementRequisitionRow[];
  receipts: ProcurementReceiptRow[];
  supplierInvoices: ProcurementSupplierInvoiceRow[];
  items: ProcurementCatalogItem[];
  warehouses: ProcurementWarehouse[];
};

export function useProcurementControlCentre(enabled = true) {
  const { activeTenantId, branchId, branchRecords, isAllBranches, currentUser, role } =
    useAppContext();
  const selectedBranchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );
  const branchKey = selectedBranchIds.join("|");
  const [data, setData] = useState<ProcurementBranchPayload[]>([]);
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
      setData([]);
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const branchIds = branchKey.split("|").filter(Boolean);
      const next = await Promise.all(
        branchIds.map(async (selectedBranchId) => {
          const params = new URLSearchParams({ branchId: selectedBranchId, limit: "100" });
          const response = await fetch(`/api/seramet/procurement/overview?${params.toString()}`, {
            headers,
          });
          const payload = (await response.json().catch(() => ({}))) as {
            overview?: ProcurementBranchPayload;
            error?: string;
            message?: string;
          };
          if (!response.ok || !payload.overview) {
            throw new Error(
              payload.message ?? payload.error ?? `Procurement query failed (${response.status})`,
            );
          }
          return payload.overview;
        }),
      );
      setData(next);
      setStatus("ready");
    } catch (cause) {
      setData([]);
      setError(cause instanceof Error ? cause.message : "Procurement server query failed");
      setStatus("error");
    }
  }, [branchKey, enabled, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      if (!enabled)
        throw new Error("Authoritative procurement commands require the server database");
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
          payload.message ?? payload.error ?? `Procurement command failed (${response.status})`,
        );
      }
      await refresh();
      return payload;
    },
    [enabled, headers, refresh],
  );

  return { data, status, error, refresh, command, headers };
}
