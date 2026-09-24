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

export const Route = createFileRoute("/par")({
  head: () => ({
    meta: [
      { title: "PAR Levels - Seramet" },
      {
        name: "description",
        content: "Authoritative PAR thresholds, incoming stock and replenishment recommendations.",
      },
    ],
  }),
  component: Par,
});

type ParRow = {
  branchId: string;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_code: string;
  inventory_item_id: string;
  code: string;
  sku: string | null;
  name: string;
  unit_symbol: string | null;
  supplier_name: string | null;
  preferred_supplier_id: string | null;
  on_hand_quantity_minor: number;
  reserved_quantity_minor: number;
  available_quantity_minor: number;
  average_unit_cost_minor: number;
  incoming_quantity_minor: number;
  policy_id: string | null;
  reorder_point_minor: number;
  target_quantity_minor: number;
  safety_stock_minor: number;
  minimum_quantity_minor: number;
  maximum_quantity_minor: number | null;
  recommendation_mode: "MANUAL" | "RECOMMEND" | "AUTO_REQUISITION";
  suggested_quantity_minor: number;
  suggested_value_minor: number;
};

function Par() {
  const { branchLabel } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const operations = useInventoryOperations(authoritative);
  const control = useInventoryControlCentre(authoritative);
  const [rows, setRows] = useState<ParRow[]>([]);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [editing, setEditing] = useState<ParRow | null>(null);
  const [reorder, setReorder] = useState("");
  const [target, setTarget] = useState("");
  const [safety, setSafety] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [mode, setMode] = useState<ParRow["recommendation_mode"]>("RECOMMEND");

  const load = useCallback(async () => {
    if (!authoritative) return;
    setStatus("loading");
    try {
      const result = await Promise.all(
        operations.branchIds.map(async (branchId) => {
          const body = await operations.request<{ policies: Omit<ParRow, "branchId">[] }>(
            `/api/seramet/inventory/par-policies?branchId=${encodeURIComponent(branchId)}`,
          );
          return body.policies.map((row) => ({ ...row, branchId }));
        }),
      );
      setRows(result.flat());
      setStatus("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "PAR policies could not be loaded");
      setStatus("error");
    }
  }, [authoritative, operations.branchIds, operations.request]);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(row: ParRow) {
    setEditing(row);
    setReorder(quantityInput(row.reorder_point_minor));
    setTarget(quantityInput(row.target_quantity_minor));
    setSafety(quantityInput(row.safety_stock_minor));
    setMinimum(quantityInput(row.minimum_quantity_minor));
    setMaximum(row.maximum_quantity_minor == null ? "" : quantityInput(row.maximum_quantity_minor));
    setMode(row.recommendation_mode);
  }

  async function save() {
    if (!editing) return;
    const reorderPointMicro = toMicro(reorder);
    const targetQuantityMicro = toMicro(target);
    const safetyStockMicro = toMicro(safety);
    const minimumQuantityMicro = toMicro(minimum);
    const maximumQuantityMicro = maximum.trim() ? toMicro(maximum) : undefined;
    if (
      reorderPointMicro < 0 ||
      targetQuantityMicro < 0 ||
      safetyStockMicro < 0 ||
      minimumQuantityMicro < 0 ||
      targetQuantityMicro < reorderPointMicro
    ) {
      setNotice("PAR quantities must be non-negative and target cannot be below reorder point.");
      return;
    }
    try {
      await operations.post("/api/seramet/inventory/par-policies", {
        ...(editing.policy_id ? { id: editing.policy_id } : {}),
        branchId: editing.branchId,
        warehouseId: editing.warehouse_id,
        inventoryItemId: editing.inventory_item_id,
        reorderPointMicro,
        targetQuantityMicro,
        safetyStockMicro,
        minimumQuantityMicro,
        ...(maximumQuantityMicro === undefined ? {} : { maximumQuantityMicro }),
        recommendationMode: mode,
      });
      setNotice("PAR policy saved. Replenishment intelligence will use the new thresholds.");
      setEditing(null);
      await Promise.all([load(), control.refresh()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "PAR policy could not be saved");
    }
  }

  const configured = rows.filter((row) => Boolean(row.policy_id)).length;
  const belowReorder = rows.filter(
    (row) =>
      row.reorder_point_minor > 0 && row.available_quantity_minor <= row.reorder_point_minor,
  ).length;
  const suggestedValueMinor = rows.reduce(
    (sum, row) => sum + Number(row.suggested_value_minor ?? 0),
    0,
  );
  const incomingMicro = rows.reduce((sum, row) => sum + Number(row.incoming_quantity_minor ?? 0), 0);
  const displayRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          Number(b.suggested_quantity_minor > 0) - Number(a.suggested_quantity_minor > 0) ||
          a.name.localeCompare(b.name),
      ),
    [rows],
  );

  return (
    <AppShell
      title="PAR levels"
      subtitle={`${branchLabel} - authoritative reorder thresholds and replenishment position`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative}
          onClick={() =>
            void control
              .recalculate()
              .then(() =>
                setNotice(
                  "Inventory intelligence recalculation queued. Purchase recommendations will refresh from current demand, incoming stock and PAR.",
                ),
              )
              .catch((error: unknown) =>
                setNotice(error instanceof Error ? error.message : "Recalculation could not be queued"),
              )
          }
        >
          Recalculate recommendations
        </Btn>
      }
    >
      {(notice || status === "loading" || control.error) && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || "Loading authoritative PAR policies..."}
        </div>
      )}

      {editing && (
        <Panel className="mb-4">
          <PanelHead
            title={`PAR · ${editing.name}`}
            sub={`${editing.warehouse_name} · values use ${editing.unit_symbol ?? "base unit"}`}
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
            <Field label="Reorder point" value={reorder} onChange={setReorder} />
            <Field label="Target / PAR" value={target} onChange={setTarget} />
            <Field label="Safety stock" value={safety} onChange={setSafety} />
            <Field label="Minimum" value={minimum} onChange={setMinimum} />
            <Field label="Maximum" value={maximum} onChange={setMaximum} placeholder="Optional" />
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as ParRow["recommendation_mode"])}
                className={inputClass}
              >
                <option value="MANUAL">Manual</option>
                <option value="RECOMMEND">Recommend</option>
                <option value="AUTO_REQUISITION">Auto requisition</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" onClick={() => void save()}>
              Save PAR
            </Btn>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Configured positions" value={configured} />
        <Metric label="Below reorder" value={belowReorder} invert={belowReorder > 0} />
        <Metric label="Suggested order value" value={suggestedValueMinor / 100} money />
        <Metric
          label="Incoming stock"
          value={(incomingMicro / 1_000_000).toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}
        />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="PAR control table"
          sub="Suggested quantity accounts for available stock plus confirmed incoming purchase orders"
        />
        <DataTable
          cols={[
            "Item",
            "Warehouse",
            { l: "Available", r: true },
            { l: "Incoming", r: true },
            { l: "Reorder", r: true },
            { l: "Target", r: true },
            { l: "Suggested", r: true },
            "Supplier",
            "Mode",
            "Action",
          ]}
        >
          {displayRows.map((row) => {
            const low =
              row.reorder_point_minor > 0 &&
              row.available_quantity_minor <= row.reorder_point_minor;
            return (
              <tr
                key={`${row.branchId}:${row.warehouse_id}:${row.inventory_item_id}`}
                className="hover:bg-secondary/50"
              >
                <TD>
                  <div className="font-semibold">{row.name}</div>
                  <div className="num text-[10px] text-muted-foreground">{row.sku ?? row.code}</div>
                </TD>
                <TD className="text-muted-foreground">{row.warehouse_name}</TD>
                <TD className="num text-right">
                  {quantity(row.available_quantity_minor)} {row.unit_symbol ?? ""}
                </TD>
                <TD className="num text-right">{quantity(row.incoming_quantity_minor)}</TD>
                <TD className="num text-right">{quantity(row.reorder_point_minor)}</TD>
                <TD className="num text-right">{quantity(row.target_quantity_minor)}</TD>
                <TD className="num text-right font-bold">
                  {row.suggested_quantity_minor > 0
                    ? `${quantity(row.suggested_quantity_minor)} · ${ksh(
                        row.suggested_value_minor / 100,
                      )}`
                    : "-"}
                </TD>
                <TD className="text-muted-foreground">{row.supplier_name ?? "Not assigned"}</TD>
                <TD>
                  <Status>{low ? "Attention" : row.recommendation_mode}</Status>
                </TD>
                <TD>
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-primary hover:underline"
                    onClick={() => edit(row)}
                  >
                    Edit PAR
                  </button>
                </TD>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      <input
        type="number"
        min="0"
        step="0.001"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );
}

function quantity(value: number) {
  return (Number(value ?? 0) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function quantityInput(value: number) {
  return String(Number(value ?? 0) / 1_000_000);
}

function toMicro(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000_000) : -1;
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
