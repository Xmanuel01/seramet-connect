import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useInventoryOperations } from "@/inventory/use-inventory-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

type LossKind = "wastage" | "breakage";

type LossRow = {
  branchId: string;
  id: string;
  branch_id: string;
  status: string;
  created_at: string;
  item_name: string | null;
  code: string | null;
  sku: string | null;
  unit_symbol: string | null;
  warehouse_name: string | null;
  warehouseId?: string;
  inventoryItemId?: string;
  quantityMicro?: number;
  reasonCode?: string;
  estimatedCostMinor?: number;
  postedCostMinor?: number;
  movementId?: string;
  requestedBy?: string;
  requestedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  decisionReason?: string | null;
};

const reasonCodes: Record<LossKind, string[]> = {
  wastage: [
    "SPOILAGE",
    "OVERPRODUCTION",
    "PREP_WASTE",
    "SPILLAGE",
    "EXPIRED",
    "QUALITY_REJECT",
    "OTHER",
  ],
  breakage: ["DAMAGED", "DROPPED", "CRACKED", "HANDLING", "QUALITY_REJECT", "OTHER"],
};

export function InventoryLossPage({ kind }: { kind: LossKind }) {
  const { branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const { branchIds, request, post } = useInventoryOperations(authoritative);
  const [rows, setRows] = useState<LossRow[]>([]);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [showForm, setShowForm] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reasonCode, setReasonCode] = useState(reasonCodes[kind][0]!);

  const endpoint = kind === "wastage" ? "wastage" : "breakages";
  const payloadKey = kind === "wastage" ? "wastage" : "breakages";
  const singular = kind === "wastage" ? "Wastage" : "Breakage";

  useEffect(() => {
    if (!branchId && control.data[0]?.branchId) setBranchId(control.data[0].branchId);
  }, [branchId, control.data]);

  const load = useCallback(async () => {
    if (!authoritative) return;
    setStatus("loading");
    try {
      const results = await Promise.all(
        branchIds.map(async (selectedBranchId) => {
          const body = await request<Record<string, LossRow[]>>(
            `/api/seramet/inventory/${endpoint}?branchId=${encodeURIComponent(selectedBranchId)}&limit=200`,
          );
          return (body[payloadKey] ?? []).map((row) => ({ ...row, branchId: selectedBranchId }));
        }),
      );
      setRows(results.flat());
      setStatus("ready");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : `${singular} register could not be loaded`,
      );
      setStatus("error");
    }
  }, [authoritative, endpoint, branchIds, request, payloadKey, singular]);

  useEffect(() => {
    void load();
  }, [load]);

  const branch = control.data.find((row) => row.branchId === branchId);
  const warehouses = branch?.warehouses ?? [];
  const items = useMemo(() => {
    const source = branch?.items ?? [];
    if (!warehouseId) return source;
    return source.filter(
      (item) =>
        item.default_warehouse_id === warehouseId ||
        item.warehouse_id === warehouseId ||
        item.warehouse_count > 0,
    );
  }, [branch?.items, warehouseId]);
  const selectedItem = (branch?.items ?? []).find((item) => item.id === itemId);
  const quantityMicro = Math.round(Number(quantity || 0) * 1_000_000);
  const estimatedCost =
    quantityMicro > 0 && selectedItem
      ? (quantityMicro * Number(selectedItem.average_unit_cost_minor ?? 0)) / 1_000_000 / 100
      : 0;

  const pending = rows.filter((row) => row.status === "PENDING").length;
  const approved = rows.filter((row) => row.status === "APPROVED");
  const approvedValue = approved.reduce(
    (sum, row) => sum + Number(row.postedCostMinor ?? row.estimatedCostMinor ?? 0) / 100,
    0,
  );
  const rejected = rows.filter((row) => row.status === "REJECTED").length;

  async function submit() {
    if (!branchId || !warehouseId || !itemId || quantityMicro <= 0 || !reasonCode) {
      setNotice(
        "Branch, warehouse, inventory item, positive quantity and reason code are required.",
      );
      return;
    }
    try {
      await post(`/api/seramet/inventory/${endpoint}/requests`, {
        branchId,
        warehouseId,
        inventoryItemId: itemId,
        quantityMicro,
        reasonCode,
        idempotencyKey: crypto.randomUUID(),
      });
      setNotice(
        `${singular} submitted for manager approval. Inventory remains unchanged until approval.`,
      );
      setShowForm(false);
      setQuantity("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${singular} request failed`);
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    const decisionReason =
      decision === "reject"
        ? window.prompt(`Reason for rejecting this ${kind} request:`)
        : (window.prompt("Approval note (optional):") ?? "");
    if (decision === "reject" && !decisionReason?.trim()) return;
    try {
      await post(
        `/api/seramet/inventory/${endpoint}/${encodeURIComponent(id)}/${decision}`,
        decisionReason?.trim() ? { reason: decisionReason.trim() } : {},
      );
      setNotice(
        decision === "approve"
          ? `${singular} approved and posted to the immutable inventory ledger.`
          : `${singular} rejected. No inventory movement was posted.`,
      );
      await Promise.all([load(), control.refresh()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${singular} decision failed`);
    }
  }

  return (
    <AppShell
      title={kind === "wastage" ? "Inventory wastage" : "Inventory breakages"}
      subtitle={
        kind === "wastage"
          ? `${branchLabel} - food and stock loss with independent approval and cost impact`
          : `${branchLabel} - damaged inventory with independent approval and stock impact`
      }
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative || control.status !== "ready"}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close form" : `Record ${kind}`}
        </Btn>
      }
    >
      {(notice || control.error || status === "loading") && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || `Loading authoritative ${kind} register...`}
        </div>
      )}

      {kind === "breakage" && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-[12px] text-muted-foreground">
          This register is for inventory items. Fixed assets and non-inventory equipment belong in
          the Assets workflow so stock quantities are not distorted.
        </div>
      )}

      {showForm && (
        <Panel className="mb-4">
          <PanelHead
            title={`Record ${kind}`}
            sub="Submission creates an approval request; stock is deducted only after approval"
          />
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <Select
              label="Branch"
              value={branchId}
              disabled={!isAllBranches}
              onChange={(value) => {
                setBranchId(value);
                setWarehouseId("");
                setItemId("");
              }}
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
              label="Inventory item"
              value={itemId}
              onChange={setItemId}
              options={items.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.sku ?? item.code}`,
              }))}
            />
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Quantity
              <input
                type="number"
                min="0"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className={inputClass}
              />
            </label>
            <Select
              label="Reason code"
              value={reasonCode}
              onChange={setReasonCode}
              options={reasonCodes[kind].map((value) => ({
                value,
                label: value.replaceAll("_", " "),
              }))}
            />
            <div className="flex h-[58px] items-end">
              <div className="flex h-9 w-full items-center rounded-md border border-border bg-secondary/30 px-3 text-[12px] text-muted-foreground">
                Estimated cost: <strong className="ml-1">{ksh(estimatedCost)}</strong>
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Btn variant="primary" onClick={() => void submit()}>
              Submit for approval
            </Btn>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Incidents" value={rows.length} />
        <Metric label="Awaiting approval" value={pending} invert={pending > 0} />
        <Metric
          label="Approved value"
          value={Math.round(approvedValue)}
          money
          invert={approvedValue > 0}
        />
        <Metric label="Rejected" value={rejected} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title={`${singular} register`}
          sub="Approved incidents post a costed stock movement and accounting impact"
        />
        <DataTable
          cols={[
            "Entry",
            "Item",
            "Warehouse",
            { l: "Quantity", r: true },
            "Reason",
            { l: "Cost", r: true },
            "Status",
            "Action",
          ]}
        >
          {rows.map((row) => (
            <tr key={`${row.branchId}:${row.id}`} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{row.id.slice(0, 12)}</TD>
              <TD>{row.item_name ?? row.inventoryItemId ?? "Inventory item"}</TD>
              <TD className="text-muted-foreground">
                {row.warehouse_name ?? row.warehouseId ?? "-"}
              </TD>
              <TD className="num text-right">
                {(Number(row.quantityMicro ?? 0) / 1_000_000).toLocaleString(undefined, {
                  maximumFractionDigits: 3,
                })}{" "}
                {row.unit_symbol ?? "unit"}
              </TD>
              <TD className="text-muted-foreground">
                {(row.reasonCode ?? "-").replaceAll("_", " ")}
              </TD>
              <TD className="num text-right font-semibold">
                {ksh(Number(row.postedCostMinor ?? row.estimatedCostMinor ?? 0) / 100)}
              </TD>
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
                    {row.decisionReason ?? (row.movementId ? "Posted" : "Final")}
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

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary disabled:opacity-60";
