import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
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
        content: "Authoritative PAR, reorder, safety and maximum stock policies by warehouse.",
      },
    ],
  }),
  component: Par,
});

function Par() {
  const { branchLabel } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const operations = useInventoryOperations(authoritative);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => operations.data.flatMap((row) => row.parPolicies), [operations.data]);
  const belowPar = rows.filter((row) => row.available_minor < row.target_quantity_minor).length;
  const critical = rows.filter(
    (row) => row.reorder_point_minor > 0 && row.available_minor <= row.reorder_point_minor,
  ).length;
  const suggestedValue = rows.reduce((sum, row) => sum + Number(row.suggested_value_minor ?? 0), 0);

  const recalculate = async () => {
    try {
      await operations.control.recalculate();
      await operations.refresh();
      setNotice("Inventory recommendations recalculation queued.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recalculation failed");
    }
  };

  return (
    <AppShell
      title="PAR levels"
      subtitle={`${branchLabel} - replenishment thresholds and order recommendations`}
      actions={
        <>
          <Btn onClick={() => void recalculate()}>Recalculate recommendations</Btn>
          <Btn
            variant="primary"
            disabled={!authoritative || operations.control.status !== "ready"}
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close form" : "Edit PAR"}
          </Btn>
        </>
      }
    >
      {(notice || operations.error || operations.control.error) && (
        <Notice>{notice || operations.error || operations.control.error}</Notice>
      )}

      {showForm && (
        <ParForm
          branches={operations.control.data}
          busy={operations.status === "loading"}
          onCancel={() => setShowForm(false)}
          onSubmit={async (body) => {
            try {
              await operations.command("/api/seramet/inventory/par-policies", body);
              setNotice("PAR policy saved.");
              setShowForm(false);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "PAR policy could not be saved");
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Stock positions" value={rows.length} />
        <Metric label="Below PAR" value={belowPar} invert={belowPar > 0} />
        <Metric label="Critical" value={critical} invert={critical > 0} />
        <Metric label="Suggested order value" value={suggestedValue / 100} money />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="PAR table"
          sub="Suggested quantity is target stock less currently available stock"
        />
        <DataTable
          cols={[
            "Item",
            "Warehouse",
            { l: "Available", r: true },
            { l: "Reorder", r: true },
            { l: "PAR target", r: true },
            { l: "Max", r: true },
            { l: "Suggested", r: true },
            { l: "Value", r: true },
            "Supplier",
            "Mode",
            "Status",
          ]}
        >
          {rows.map((row) => {
            const state =
              row.available_minor <= 0
                ? "Out of stock"
                : row.reorder_point_minor > 0 && row.available_minor <= row.reorder_point_minor
                  ? "Critical"
                  : row.available_minor < row.target_quantity_minor
                    ? "Low"
                    : "Healthy";
            return (
              <tr key={`${row.warehouse_id}:${row.inventory_item_id}`} className="hover:bg-secondary/50">
                <TD>
                  <div className="font-semibold">{row.item_name}</div>
                  <div className="num text-[10px] text-muted-foreground">{row.sku ?? row.code}</div>
                </TD>
                <TD className="text-muted-foreground">{row.warehouse_name}</TD>
                <TD className="num text-right">{quantity(row.available_minor)} {row.unit_symbol ?? ""}</TD>
                <TD className="num text-right">{quantity(row.reorder_point_minor)}</TD>
                <TD className="num text-right font-semibold">{quantity(row.target_quantity_minor)}</TD>
                <TD className="num text-right">{row.maximum_quantity_minor === null ? "-" : quantity(row.maximum_quantity_minor)}</TD>
                <TD className="num text-right font-bold">{quantity(row.suggested_quantity_minor)}</TD>
                <TD className="num text-right">{ksh(Number(row.suggested_value_minor ?? 0) / 100)}</TD>
                <TD className="text-muted-foreground">{row.preferred_supplier_name ?? "-"}</TD>
                <TD className="text-muted-foreground">{row.recommendation_mode}</TD>
                <TD><Status>{state}</Status></TD>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    </AppShell>
  );
}

function ParForm({
  branches,
  busy,
  onCancel,
  onSubmit,
}: {
  branches: ReturnType<typeof useInventoryOperations>["control"]["data"];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.branchId ?? "");
  const branch = branches.find((row) => row.branchId === branchId) ?? branches[0];
  const [warehouseId, setWarehouseId] = useState(branch?.warehouses[0]?.id ?? "");
  const [itemId, setItemId] = useState(branch?.items[0]?.id ?? "");
  const [minimum, setMinimum] = useState("0");
  const [reorder, setReorder] = useState("0");
  const [target, setTarget] = useState("0");
  const [maximum, setMaximum] = useState("");
  const [safety, setSafety] = useState("0");
  const [mode, setMode] = useState<"MANUAL" | "RECOMMEND" | "AUTO_REQUISITION">("RECOMMEND");

  const setBranch = (next: string) => {
    setBranchId(next);
    const selected = branches.find((row) => row.branchId === next);
    setWarehouseId(selected?.warehouses[0]?.id ?? "");
    setItemId(selected?.items[0]?.id ?? "");
  };

  const valid =
    Boolean(branchId && warehouseId && itemId) &&
    Number(target) >= Number(reorder) &&
    (!maximum.trim() || Number(maximum) >= Number(minimum));

  return (
    <Panel className="mb-4">
      <PanelHead title="Set PAR policy" sub="All quantities are entered in the item's base unit" />
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <Field label="Branch">
          <select value={branchId} onChange={(event) => setBranch(event.target.value)} className={inputClass}>
            {branches.map((row) => <option key={row.branchId} value={row.branchId}>{row.branchId}</option>)}
          </select>
        </Field>
        <Field label="Warehouse">
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className={inputClass}>
            {(branch?.warehouses ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </Field>
        <Field label="Item">
          <select value={itemId} onChange={(event) => setItemId(event.target.value)} className={inputClass}>
            {(branch?.items ?? []).map((row) => <option key={row.id} value={row.id}>{row.name} · {row.base_unit_symbol ?? "unit"}</option>)}
          </select>
        </Field>
        <Field label="Recommendation mode">
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className={inputClass}>
            <option value="MANUAL">Manual</option>
            <option value="RECOMMEND">Recommend</option>
            <option value="AUTO_REQUISITION">Auto requisition</option>
          </select>
        </Field>
        <Field label="Minimum"><input className={inputClass} type="number" min="0" step="0.001" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></Field>
        <Field label="Reorder point"><input className={inputClass} type="number" min="0" step="0.001" value={reorder} onChange={(event) => setReorder(event.target.value)} /></Field>
        <Field label="PAR target"><input className={inputClass} type="number" min="0" step="0.001" value={target} onChange={(event) => setTarget(event.target.value)} /></Field>
        <Field label="Maximum (optional)"><input className={inputClass} type="number" min="0" step="0.001" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></Field>
        <Field label="Safety stock"><input className={inputClass} type="number" min="0" step="0.001" value={safety} onChange={(event) => setSafety(event.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() =>
            void onSubmit({
              branchId,
              warehouseId,
              inventoryItemId: itemId,
              minimumQuantityMicro: micro(minimum),
              reorderPointMicro: micro(reorder),
              targetQuantityMicro: micro(target),
              ...(maximum.trim() ? { maximumQuantityMicro: micro(maximum) } : {}),
              safetyStockMicro: micro(safety),
              recommendationMode: mode,
            })
          }
        >
          Save PAR policy
        </Btn>
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">{label}{children}</label>;
}
function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">{children}</div>;
}
function quantity(value: number) {
  return (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
function micro(value: string) {
  return Math.round(Math.max(0, Number(value || 0)) * 1_000_000);
}
const inputClass = "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
