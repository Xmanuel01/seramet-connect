import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useInventoryOperations } from "@/inventory/use-inventory-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/adjustments")({
  head: () => ({
    meta: [
      { title: "Stock Adjustments - Seramet" },
      {
        name: "description",
        content: "Approval-gated authoritative stock adjustments with immutable movement history.",
      },
    ],
  }),
  component: Adjustments,
});

type AdjustmentRow = {
  branchId: string;
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  inventory_item_id: string;
  item_name: string;
  code: string;
  sku: string | null;
  unit_symbol: string | null;
  business_date: string;
  quantity_minor: number;
  unit_cost_minor: number | null;
  reason: string;
  status: string;
  requested_by: string;
  requested_by_name: string | null;
  decided_by_name: string | null;
  decision_reason: string | null;
  posted_movement_id: string | null;
  created_at: string;
};

function Adjustments() {
  const { branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const operations = useInventoryOperations(authoritative);
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!branchId && control.data[0]?.branchId) setBranchId(control.data[0].branchId);
  }, [branchId, control.data]);

  const load = useCallback(async () => {
    if (!authoritative) return;
    setStatus("loading");
    try {
      const results = await Promise.all(
        operations.branchIds.map(async (selectedBranchId) => {
          const body = await operations.request<{ adjustments: Omit<AdjustmentRow, "branchId">[] }>(
            `/api/seramet/inventory/adjustments?branchId=${encodeURIComponent(selectedBranchId)}&limit=200`,
          );
          return body.adjustments.map((row) => ({ ...row, branchId: selectedBranchId }));
        }),
      );
      setRows(results.flat());
      setStatus("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Adjustment register could not be loaded");
      setStatus("error");
    }
  }, [authoritative, operations.branchIds, operations.request]);

  useEffect(() => {
    void load();
  }, [load]);

  const branch = control.data.find((row) => row.branchId === branchId);
  const warehouses = branch?.warehouses ?? [];
  const warehouseItems = useMemo(
    () =>
      (branch?.items ?? []).filter(
        (item) =>
          item.default_warehouse_id === warehouseId ||
          item.warehouse_id === warehouseId ||
          item.warehouse_count > 0,
      ),
    [branch?.items, warehouseId],
  );
  const selectedItem = (branch?.items ?? []).find((item) => item.id === itemId);
  const selectedCostMinor = unitCost
    ? Math.round(Number(unitCost) * 100)
    : Number(selectedItem?.average_unit_cost_minor ?? 0);
  const quantityMicro = Math.round(Number(quantity || 0) * 1_000_000);
  const estimatedValue = Math.abs(quantityMicro)
    ? (Math.abs(quantityMicro) * selectedCostMinor) / 1_000_000 / 100
    : 0;

  const pending = rows.filter((row) => row.status === "PENDING").length;
  const rejected = rows.filter((row) => row.status === "REJECTED").length;
  const netValue = rows
    .filter((row) => row.status === "APPROVED")
    .reduce(
      (sum, row) =>
        sum +
        (row.quantity_minor * Number(row.unit_cost_minor ?? 0)) / 1_000_000 / 100,
      0,
    );

  async function submit() {
    if (!branchId || !warehouseId || !itemId || !quantityMicro || !reason.trim()) {
      setNotice("Branch, warehouse, item, non-zero quantity and reason are required.");
      return;
    }
    setNotice("");
    try {
      await operations.post("/api/seramet/inventory/adjustments/requests", {
        branchId,
        warehouseId,
        inventoryItemId: itemId,
        quantityMicro,
        ...(unitCost ? { unitCostMinor: Math.round(Number(unitCost) * 100) } : {}),
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      setNotice("Adjustment submitted for independent approval. Stock has not changed yet.");
      setShowForm(false);
      setQuantity("");
      setUnitCost("");
      setReason("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Adjustment could not be submitted");
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    const decisionReason =
      decision === "reject"
        ? window.prompt("Reason for rejecting this adjustment:")
        : window.prompt("Approval note (optional):") ?? "";
    if (decision === "reject" && !decisionReason?.trim()) return;
    try {
      await operations.post(
        `/api/seramet/inventory/adjustments/${encodeURIComponent(id)}/${decision}`,
        decisionReason?.trim() ? { reason: decisionReason.trim() } : {},
      );
      setNotice(
        decision === "approve"
          ? "Adjustment approved and posted to the immutable inventory ledger."
          : "Adjustment rejected. No stock movement was posted.",
      );
      await Promise.all([load(), control.refresh()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Adjustment decision failed");
    }
  }

  return (
    <AppShell
      title="Stock adjustments"
      subtitle={`${branchLabel} - approval-gated corrections to the authoritative stock ledger`}
      actions={
        <>
          <Btn onClick={() => exportRows(rows)}>Export</Btn>
          <Btn
            variant="primary"
            disabled={!authoritative || control.status !== "ready"}
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close form" : "New adjustment"}
          </Btn>
        </>
      }
    >
      {(notice || control.error || status === "loading") && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || "Loading authoritative adjustment register..."}
        </div>
      )}

      {showForm && (
        <Panel className="mb-4">
          <PanelHead
            title="Request stock adjustment"
            sub="The request does not change stock until a user with approval authority posts it"
          />
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <Select
              label="Branch"
              value={branchId}
              onChange={(value) => {
                setBranchId(value);
                setWarehouseId("");
                setItemId("");
              }}
              disabled={!isAllBranches}
              options={control.data.map((row) => ({ value: row.branchId, label: row.branchId }))}
            />
            <Select
              label="Warehouse"
              value={warehouseId}
              onChange={(value) => {
                setWarehouseId(value);
                setItemId("");
              }}
              options={warehouses.map((row) => ({ value: row.id, label: row.name }))}
            />
            <Select
              label="Item"
              value={itemId}
              onChange={setItemId}
              options={warehouseItems.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.sku ?? item.code}`,
              }))}
            />
            <Field
              label="Quantity change"
              value={quantity}
              onChange={setQuantity}
              type="number"
              placeholder="-2.5 or 3"
            />
            <Field
              label="Unit cost (KES, optional)"
              value={unitCost}
              onChange={setUnitCost}
              type="number"
              placeholder={
                selectedItem ? (selectedItem.average_unit_cost_minor / 100).toFixed(2) : "0.00"
              }
            />
            <Field label="Reason" value={reason} onChange={setReason} placeholder="Required" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-[12px] text-muted-foreground">
              Estimated value impact: <strong>{ksh(estimatedValue)}</strong>
            </span>
            <Btn variant="primary" onClick={() => void submit()}>
              Submit for approval
            </Btn>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Requests" value={rows.length} />
        <Metric label="Awaiting approval" value={pending} invert={pending > 0} />
        <Metric label="Rejected" value={rejected} />
        <Metric label="Net posted impact" value={Math.round(netValue)} money invert={netValue < 0} />
      </div>

      <Panel className="mt-4">
        <PanelHead title="Adjustment register" sub="Terminal decisions and posted movements are immutable" />
        <DataTable
          cols={[
            "Adjustment",
            "Item",
            "Warehouse",
            { l: "Quantity", r: true },
            "Reason",
            "Requested by",
            "Status",
            "Action",
          ]}
        >
          {rows.map((row) => (
            <tr key={`${row.branchId}:${row.id}`} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{row.id.slice(0, 12)}</TD>
              <TD>
                <div className="font-semibold">{row.item_name}</div>
                <div className="num text-[10px] text-muted-foreground">{row.sku ?? row.code}</div>
              </TD>
              <TD className="text-muted-foreground">{row.warehouse_name}</TD>
              <TD
                className={`num text-right font-semibold ${
                  row.quantity_minor > 0 ? "text-success" : "text-danger"
                }`}
              >
                {row.quantity_minor > 0 ? "+" : ""}
                {(row.quantity_minor / 1_000_000).toLocaleString(undefined, {
                  maximumFractionDigits: 3,
                })}{" "}
                {row.unit_symbol ?? "unit"}
              </TD>
              <TD className="max-w-[260px] text-muted-foreground">{row.reason}</TD>
              <TD>{row.requested_by_name ?? row.requested_by}</TD>
              <TD>
                <Status>{row.status}</Status>
              </TD>
              <TD>
                {row.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-primary hover:underline"
                      onClick={() => void decide(row.id, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-danger hover:underline"
                      onClick={() => void decide(row.id, "reject")}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {row.decided_by_name ?? row.decision_reason ?? "Final"}
                  </span>
                )}
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function exportRows(rows: AdjustmentRow[]) {
  const data = [
    ["id", "branch", "warehouse", "item", "quantity", "reason", "status", "business_date"],
    ...rows.map((row) => [
      row.id,
      row.branchId,
      row.warehouse_name,
      row.item_name,
      row.quantity_minor / 1_000_000,
      row.reason,
      row.status,
      row.business_date,
    ]),
  ];
  const csv = data
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `seramet-adjustments-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(href);
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary disabled:opacity-60";
