import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Factory, Play, Plus, Printer, RefreshCw, XCircle } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/Tabs";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QUANTITY_SCALE } from "@/inventory/quantity";
import {
  type ProductionBatchRow,
  type ProductionRecipeOption,
  type ProductionStationOption,
  type ProductionWarehouseOption,
  useProductionControlCentre,
} from "@/inventory/use-production-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/production")({
  head: () => ({
    meta: [
      { title: "Production - Seramet" },
      {
        name: "description",
        content:
          "Authoritative production batch planning, execution, yield control and inventory posting.",
      },
    ],
  }),
  component: Production,
});

function Production() {
  const {
    branchId,
    branchLabel,
    branchRecords,
    currency,
    currentUser,
    hasPermission,
    isAllBranches,
  } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useProductionControlCentre(authoritative);
  const [planOpen, setPlanOpen] = useState(false);
  const [completion, setCompletion] = useState<ProductionBatchRow | null>(null);
  const [cancellation, setCancellation] = useState<ProductionBatchRow | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const branchNames = useMemo(
    () => new Map(branchRecords.map((branch) => [branch.id, branch.name])),
    [branchRecords],
  );
  const activeData = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const rows = useMemo(
    () =>
      control.data
        .flatMap((row) => row.production.batches)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [control.data],
  );
  const todayRows = rows.filter((row) => {
    const businessDate = control.data.find(
      (branch) => branch.branchId === row.branch_id,
    )?.businessDate;
    return businessDate === row.business_date && row.status !== "CANCELLED";
  });
  const completedToday = todayRows.filter((row) => row.status === "COMPLETED");
  const plannedToday = completedToday.reduce((sum, row) => sum + row.planned_quantity_minor, 0);
  const actualToday = completedToday.reduce(
    (sum, row) => sum + Number(row.actual_output_quantity_minor ?? 0),
    0,
  );
  const weightedVariance =
    plannedToday > 0 ? ((actualToday - plannedToday) / plannedToday) * 100 : 0;
  const outputValueMinor = completedToday.reduce(
    (sum, row) => sum + Number(row.output_value_minor ?? 0),
    0,
  );
  const inProgress = rows.filter((row) => row.status === "IN_PROGRESS").length;

  const canPlan =
    authoritative &&
    !isAllBranches &&
    hasPermission(permissions.productionPlan) &&
    Boolean(activeData?.production.recipes.length) &&
    Boolean(activeData?.production.warehouses.length);
  const canStart = authoritative && hasPermission(permissions.productionStart);
  const canComplete = authoritative && hasPermission(permissions.productionComplete);
  const canCancel = authoritative && hasPermission(permissions.productionAdjust);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Production operation failed");
    } finally {
      setBusy(false);
    }
  };

  const startBatch = (batch: ProductionBatchRow) =>
    run(
      () =>
        control.command(`/api/seramet/production/batches/${encodeURIComponent(batch.id)}/start`),
      `${batch.recipe_name} production started.`,
    );

  return (
    <AppShell
      title="Production"
      subtitle={`Kitchen batch control - ${branchLabel}`}
      actions={
        <>
          <Btn
            disabled={!rows.length}
            onClick={() => printProductionSheet(rows, branchNames, branchLabel)}
          >
            <Printer className="h-4 w-4" /> Print sheet
          </Btn>
          <Btn disabled={!authoritative || busy} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn variant="primary" disabled={!canPlan || busy} onClick={() => setPlanOpen(true)}>
            <Plus className="h-4 w-4" /> New production run
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Runs today" value={todayRows.length} />
        <Metric label="Output value" value={Math.round(outputValueMinor / 100)} money />
        <Metric
          label="Yield variance"
          value={Number.isFinite(weightedVariance) ? weightedVariance.toFixed(1) : "0.0"}
          suffix="%"
        />
        <Metric label="Runs in progress" value={inProgress} />
      </div>

      {(notice || control.error || !authoritative || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            control.error ||
            (!authoritative
              ? "Production posting requires the authoritative Seramet server."
              : "All branches is read-only for production actions. Select one branch to plan a batch.")}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Production runs"
          sub="Raw materials post only when a batch is completed; planned and started runs do not move stock."
          right={<Factory className="h-4 w-4 text-primary" />}
        />
        <DataTable
          cols={[
            "Run",
            "Branch",
            "Item",
            { l: "Planned", r: true },
            { l: "Produced", r: true },
            { l: "Variance", r: true },
            { l: "Value", r: true },
            "Warehouse",
            "Status",
            "Actions",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id} className="align-top hover:bg-secondary/50">
              <TD>
                <div className="num font-semibold">{shortId(row.id)}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{row.business_date}</div>
              </TD>
              <TD>{branchNames.get(row.branch_id) ?? row.branch_id}</TD>
              <TD>
                <div className="font-semibold">{row.output_item_name}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{row.recipe_name}</div>
              </TD>
              <TD className="num text-right">
                {formatQuantity(row.planned_quantity_minor)} {row.unit_symbol ?? ""}
              </TD>
              <TD className="num text-right">
                {row.actual_output_quantity_minor === null
                  ? "—"
                  : `${formatQuantity(row.actual_output_quantity_minor)} ${row.unit_symbol ?? ""}`}
              </TD>
              <TD
                className={`num text-right font-semibold ${varianceClass(row.yield_variance_bps)}`}
              >
                {row.yield_variance_bps === null
                  ? "—"
                  : `${(row.yield_variance_bps / 100).toFixed(1)}%`}
              </TD>
              <TD className="num text-right">
                {row.status === "COMPLETED"
                  ? formatMoneyMinor(row.output_value_minor, currency)
                  : "—"}
              </TD>
              <TD>{row.warehouse_name}</TD>
              <TD>
                <Status>{row.status.replaceAll("_", " ")}</Status>
                {row.started_at && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Started {formatDateTime(row.started_at)}
                  </div>
                )}
              </TD>
              <TD>
                <div className="flex min-w-[150px] flex-wrap gap-2">
                  {row.status === "PLANNED" && (
                    <button
                      type="button"
                      disabled={!canStart || busy}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary disabled:opacity-40"
                      onClick={() => void startBatch(row)}
                    >
                      <Play className="h-3 w-3" /> Start
                    </button>
                  )}
                  {["PLANNED", "IN_PROGRESS"].includes(row.status) && (
                    <button
                      type="button"
                      disabled={!canComplete || busy}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary disabled:opacity-40"
                      onClick={() => setCompletion(row)}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Complete
                    </button>
                  )}
                  {["PLANNED", "IN_PROGRESS"].includes(row.status) && (
                    <button
                      type="button"
                      disabled={!canCancel || busy}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger disabled:opacity-40"
                      onClick={() => setCancellation(row)}
                    >
                      <XCircle className="h-3 w-3" /> Cancel
                    </button>
                  )}
                  {["COMPLETED", "CANCELLED"].includes(row.status) && (
                    <span className="text-[11px] text-muted-foreground">Closed</span>
                  )}
                </div>
              </TD>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <TD colSpan={10} className="py-10 text-center text-muted-foreground">
                {control.status === "loading"
                  ? "Loading production history…"
                  : "No production batches have been recorded for the selected branch."}
              </TD>
            </tr>
          )}
        </DataTable>
      </Panel>

      <PlanProductionDialog
        open={planOpen}
        busy={busy}
        recipes={activeData?.production.recipes ?? []}
        warehouses={activeData?.production.warehouses ?? []}
        stations={activeData?.production.stations ?? []}
        onOpenChange={setPlanOpen}
        onSubmit={(draft) =>
          void run(async () => {
            await control.command("/api/seramet/production/batches/plan", {
              branchId,
              warehouseId: draft.warehouseId,
              recipeVersionId: draft.recipe.active_version_id,
              outputItemId: draft.recipe.production_item_id,
              plannedQuantityMicro: toMicro(draft.quantity),
              idempotencyKey: `production-plan:${branchId}:${crypto.randomUUID()}`,
              ...(draft.stationId ? { stationId: draft.stationId } : {}),
            });
            setPlanOpen(false);
          }, `Production run planned by ${currentUser.name}.`)
        }
      />

      <CompleteProductionDialog
        key={completion?.id ?? "complete-none"}
        batch={completion}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setCompletion(null);
        }}
        onSubmit={(quantity) => {
          if (!completion) return;
          void run(async () => {
            await control.command(
              `/api/seramet/production/batches/${encodeURIComponent(completion.id)}/complete`,
              { actualOutputQuantityMicro: toMicro(quantity) },
            );
            setCompletion(null);
          }, `${completion.recipe_name} completed and inventory movements posted.`);
        }}
      />

      <CancelProductionDialog
        key={cancellation?.id ?? "cancel-none"}
        batch={cancellation}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setCancellation(null);
        }}
        onSubmit={(reason) => {
          if (!cancellation) return;
          void run(async () => {
            await control.command(
              `/api/seramet/production/batches/${encodeURIComponent(cancellation.id)}/cancel`,
              { reason },
            );
            setCancellation(null);
          }, `${cancellation.recipe_name} production run cancelled.`);
        }}
      />
    </AppShell>
  );
}

function PlanProductionDialog({
  open,
  busy,
  recipes,
  warehouses,
  stations,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  recipes: ProductionRecipeOption[];
  warehouses: ProductionWarehouseOption[];
  stations: ProductionStationOption[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: {
    recipe: ProductionRecipeOption;
    warehouseId: string;
    stationId: string;
    quantity: string;
  }) => void;
}) {
  const [recipeId, setRecipeId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [stationId, setStationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const recipe = recipes.find((candidate) => candidate.id === recipeId) ?? recipes[0];
  const resolvedQuantity = quantity || (recipe ? formatQuantity(recipe.yield_quantity_minor) : "");

  const chooseRecipe = (nextId: string) => {
    setRecipeId(nextId);
    const selected = recipes.find((candidate) => candidate.id === nextId);
    if (!selected) return;
    setQuantity(formatQuantity(selected.yield_quantity_minor));
    if (
      selected.default_warehouse_id &&
      warehouses.some((warehouse) => warehouse.id === selected.default_warehouse_id)
    ) {
      setWarehouseId(selected.default_warehouse_id);
    }
  };

  const resolvedWarehouse = warehouseId || recipe?.default_warehouse_id || warehouses[0]?.id || "";
  const valid = Boolean(recipe && resolvedWarehouse && Number(resolvedQuantity) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan production run</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Recipe">
            <select
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={recipe?.id ?? ""}
              onChange={(event) => chooseRecipe(event.target.value)}
            >
              {recipes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} → {option.output_item_name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Planned output">
              <input
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                type="number"
                min="0.000001"
                step="0.001"
                value={resolvedQuantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <Field label="Unit">
              <div className="flex h-10 items-center rounded-md border border-border bg-secondary/40 px-3 text-sm">
                {recipe?.yield_unit_symbol ?? recipe?.yield_unit_id ?? "—"}
              </div>
            </Field>
          </div>
          <Field label="Warehouse">
            <select
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={resolvedWarehouse}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Production station (optional)">
            <select
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
            >
              <option value="">No station</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="rounded-md bg-secondary/50 p-3 text-[12px] text-muted-foreground">
            Planning does not deduct stock. Ingredient consumption and finished output are posted
            atomically only when the run is completed.
          </div>
          <div className="flex justify-end gap-2">
            <Btn disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              disabled={busy || !valid}
              onClick={() =>
                recipe &&
                onSubmit({
                  recipe,
                  warehouseId: resolvedWarehouse,
                  stationId,
                  quantity: resolvedQuantity,
                })
              }
            >
              Plan run
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompleteProductionDialog({
  batch,
  busy,
  onOpenChange,
  onSubmit,
}: {
  batch: ProductionBatchRow | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (quantity: string) => void;
}) {
  const [quantity, setQuantity] = useState(
    batch ? formatQuantity(batch.planned_quantity_minor) : "",
  );
  return (
    <Dialog open={Boolean(batch)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete production run</DialogTitle>
        </DialogHeader>
        {batch && (
          <div className="space-y-4">
            <div className="rounded-md bg-secondary/50 p-3 text-sm">
              <div className="font-semibold">{batch.output_item_name}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                Planned {formatQuantity(batch.planned_quantity_minor)} {batch.unit_symbol ?? ""}
              </div>
            </div>
            <Field label="Actual output produced">
              <input
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                type="number"
                min="0.000001"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <div className="rounded-md border border-border p-3 text-[12px] text-muted-foreground">
              Completing the batch posts recipe ingredient consumption and the finished output to
              inventory. This cannot be cancelled afterward.
            </div>
            <div className="flex justify-end gap-2">
              <Btn disabled={busy} onClick={() => onOpenChange(false)}>
                Back
              </Btn>
              <Btn
                variant="primary"
                disabled={busy || !(Number(quantity) > 0)}
                onClick={() => onSubmit(quantity)}
              >
                Complete & post stock
              </Btn>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelProductionDialog({
  batch,
  busy,
  onOpenChange,
  onSubmit,
}: {
  batch: ProductionBatchRow | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={Boolean(batch)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel production run</DialogTitle>
        </DialogHeader>
        {batch && (
          <div className="space-y-4">
            <div className="text-sm">
              Cancel <strong>{batch.output_item_name}</strong>? No inventory movement will be
              created.
            </div>
            <Field label="Reason">
              <textarea
                className="min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this run being cancelled?"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Btn disabled={busy} onClick={() => onOpenChange(false)}>
                Back
              </Btn>
              <Btn
                variant="primary"
                disabled={busy || reason.trim().length < 2}
                onClick={() => onSubmit(reason.trim())}
              >
                Cancel run
              </Btn>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function toMicro(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Quantity must be greater than zero");
  }
  const scaled = Math.round(number * QUANTITY_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    throw new Error("Quantity is outside the supported range");
  }
  return scaled;
}

function formatQuantity(value: number) {
  return (Number(value) / QUANTITY_SCALE).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function varianceClass(value: number | null) {
  if (value === null) return "text-muted-foreground";
  if (value < -500) return "text-danger";
  if (value < 0) return "text-warning";
  return "text-success";
}

function formatMoneyMinor(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value) / 100);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function printProductionSheet(
  rows: ProductionBatchRow[],
  branchNames: Map<string, string>,
  branchLabel: string,
) {
  const printable = window.open("", "_blank", "width=1000,height=760");
  if (!printable) return;
  printable.opener = null;
  const body = rows
    .slice(0, 100)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(shortId(row.id))}</td>
        <td>${escapeHtml(branchNames.get(row.branch_id) ?? row.branch_id)}</td>
        <td>${escapeHtml(row.output_item_name)}</td>
        <td>${escapeHtml(formatQuantity(row.planned_quantity_minor))} ${escapeHtml(row.unit_symbol ?? "")}</td>
        <td>${row.actual_output_quantity_minor === null ? "—" : escapeHtml(formatQuantity(row.actual_output_quantity_minor))}</td>
        <td>${escapeHtml(row.status.replaceAll("_", " "))}</td>
        <td>${escapeHtml(row.business_date)}</td>
      </tr>`,
    )
    .join("");
  printable.document.write(`<!doctype html>
<html><head><title>Seramet Production Sheet</title>
<style>
body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0}p{color:#555;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:18px;font-size:11px}th,td{border:1px solid #bbb;padding:7px;text-align:left}
th{background:#f3f3f3}@media print{body{padding:0}}
</style></head><body>
<h1>Seramet Production Sheet</h1>
<p>${escapeHtml(branchLabel)} · Printed ${escapeHtml(new Date().toLocaleString())}</p>
<table><thead><tr><th>Run</th><th>Branch</th><th>Item</th><th>Planned</th><th>Produced</th><th>Status</th><th>Business date</th></tr></thead>
<tbody>${body}</tbody></table>
<script>window.onload=()=>{window.print();}</script>
</body></html>`);
  printable.document.close();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return replacements[character] ?? character;
  });
}
