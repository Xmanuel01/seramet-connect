import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChefHat,
  ClipboardList,
  Pencil,
  Play,
  Printer,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import {
  type PrepLibrary,
  type PrepStation,
  type PrepTask,
  type PrepWarehouse,
  usePrep,
} from "@/prep/use-prep";

export const Route = createFileRoute("/prep")({
  head: () => ({
    meta: [
      { title: "Prep List - Seramet" },
      {
        name: "description",
        content:
          "Authoritative daily prep recommendations connected to recipes, Cookbook standards and production.",
      },
    ],
  }),
  component: Prep,
});

function Prep() {
  const { branchLabel, hasPermission, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const prep = usePrep(authoritative && !isAllBranches);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<PrepTask | null>(null);
  const [adjusting, setAdjusting] = useState<PrepTask | null>(null);
  const [approving, setApproving] = useState<PrepTask | null>(null);
  const [completing, setCompleting] = useState<PrepTask | null>(null);
  const [dismissing, setDismissing] = useState<PrepTask | null>(null);

  const tasks = useMemo(() => prep.data?.tasks ?? [], [prep.data?.tasks]);
  const actionable = tasks.filter((task) => task.status !== "DISMISSED");
  const completed = actionable.filter((task) => task.status === "COMPLETED").length;
  const inProgress = actionable.filter((task) => task.status === "STARTED").length;
  const completion = actionable.length ? Math.round((completed / actionable.length) * 100) : 0;
  const methodMissing = actionable.filter((task) => !task.cookbookPublished).length;

  const sections = useMemo(() => {
    const grouped = new Map<string, PrepTask[]>();
    for (const task of tasks) {
      const label = task.stationName ?? "Unassigned station";
      grouped.set(label, [...(grouped.get(label) ?? []), task]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [tasks]);

  const canPlan = authoritative && !isAllBranches && hasPermission(permissions.productionPlan);
  const canStart = authoritative && !isAllBranches && hasPermission(permissions.productionStart);
  const canComplete =
    authoritative && !isAllBranches && hasPermission(permissions.productionComplete);
  const canDismiss =
    authoritative && !isAllBranches && hasPermission(permissions.productionAdjust);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Prep operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Prep list"
      subtitle={"Forecast → recipe → Cookbook → production · " + branchLabel}
      actions={
        <>
          <Btn disabled={!tasks.length} onClick={() => printPrepSheet(prep.data, branchLabel)}>
            <Printer className="h-4 w-4" /> Print
          </Btn>
          <Btn disabled={!authoritative || busy || isAllBranches} onClick={() => void prep.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!canPlan || busy}
            onClick={() =>
              void run(
                () => prep.regenerate(),
                "Prep recalculation queued and the latest recommendations reloaded.",
              )
            }
          >
            <RefreshCw className="h-4 w-4" /> Regenerate
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Tasks today" value={actionable.length} />
        <Metric label="Completed" value={completed} />
        <Metric label="In progress" value={inProgress} />
        <Metric label="Prep completion" value={completion} suffix="%" />
        <Metric label="Missing method" value={methodMissing} invert={methodMissing > 0} />
      </div>

      {(notice || prep.error || !authoritative || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            prep.error ||
            (!authoritative
              ? "Prep execution requires the authoritative Seramet server."
              : "Select one branch to execute a prep plan.")}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {sections.map(([station, stationTasks]) => (
          <Panel key={station}>
            <PanelHead
              title={station}
              sub={
                stationTasks.length +
                " task" +
                (stationTasks.length === 1 ? "" : "s") +
                " · " +
                stationTasks.filter((task) => task.status === "COMPLETED").length +
                " completed"
              }
              right={<ChefHat className="h-4 w-4 text-primary" />}
            />
            <div className="divide-y divide-border">
              {stationTasks.map((task) => (
                <PrepTaskCard
                  key={task.id}
                  task={task}
                  busy={busy}
                  canPlan={canPlan}
                  canStart={canStart}
                  canComplete={canComplete}
                  canDismiss={canDismiss}
                  onView={() => setDetail(task)}
                  onAdjust={() => setAdjusting(task)}
                  onApprove={() => setApproving(task)}
                  onStart={() =>
                    void run(
                      () =>
                        prep.command("/api/seramet/prep/" + encodeURIComponent(task.id) + "/start", {
                          expectedRevision: task.revision,
                        }),
                      task.recipeName + " prep started.",
                    )
                  }
                  onComplete={() => setCompleting(task)}
                  onDismiss={() => setDismissing(task)}
                />
              ))}
            </div>
          </Panel>
        ))}
      </div>

      {!sections.length && (
        <Panel className="mt-4">
          <div className="p-12 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" />
            <div className="mt-3 text-sm font-semibold">No prep recommendations for today</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              Regenerate after recipes, sales history and prepared stock have been configured.
            </div>
          </div>
        </Panel>
      )}

      {detail ? <PrepDetail task={detail} onClose={() => setDetail(null)} /> : null}

      {adjusting ? (
        <AdjustDialog
          key={adjusting.id}
          task={adjusting}
          stations={prep.data?.stations ?? []}
          busy={busy}
          onClose={() => setAdjusting(null)}
          onSubmit={(body) =>
            void run(async () => {
              await prep.command(
                "/api/seramet/prep/" + encodeURIComponent(adjusting.id) + "/adjust",
                body,
              );
              setAdjusting(null);
            }, adjusting.recipeName + " prep target updated.")
          }
        />
      ) : null}

      {approving ? (
        <ApproveDialog
          key={approving.id}
          task={approving}
          warehouses={prep.data?.warehouses ?? []}
          busy={busy}
          onClose={() => setApproving(null)}
          onSubmit={(warehouseId) =>
            void run(async () => {
              await prep.command(
                "/api/seramet/prep/" + encodeURIComponent(approving.id) + "/approve",
                {
                  expectedRevision: approving.revision,
                  warehouseId,
                },
              );
              setApproving(null);
            }, approving.recipeName + " approved and linked to a planned production batch.")
          }
        />
      ) : null}

      {completing ? (
        <CompleteDialog
          key={completing.id}
          task={completing}
          busy={busy}
          onClose={() => setCompleting(null)}
          onSubmit={(actualOutputQuantityMicro) =>
            void run(async () => {
              await prep.command(
                "/api/seramet/prep/" + encodeURIComponent(completing.id) + "/complete",
                {
                  expectedRevision: completing.revision,
                  actualOutputQuantityMicro,
                },
              );
              setCompleting(null);
            }, completing.recipeName + " completed and inventory posted.")
          }
        />
      ) : null}

      {dismissing ? (
        <DismissDialog
          key={dismissing.id}
          task={dismissing}
          busy={busy}
          onClose={() => setDismissing(null)}
          onSubmit={(reason) =>
            void run(async () => {
              await prep.command(
                "/api/seramet/prep/" + encodeURIComponent(dismissing.id) + "/dismiss",
                {
                  expectedRevision: dismissing.revision,
                  reason,
                },
              );
              setDismissing(null);
            }, dismissing.recipeName + " removed from today's active prep plan.")
          }
        />
      ) : null}
    </AppShell>
  );
}

function PrepTaskCard({
  task,
  busy,
  canPlan,
  canStart,
  canComplete,
  canDismiss,
  onView,
  onAdjust,
  onApprove,
  onStart,
  onComplete,
  onDismiss,
}: {
  task: PrepTask;
  busy: boolean;
  canPlan: boolean;
  canStart: boolean;
  canComplete: boolean;
  canDismiss: boolean;
  onView: () => void;
  onAdjust: () => void;
  onApprove: () => void;
  onStart: () => void;
  onComplete: () => void;
  onDismiss: () => void;
}) {
  const executable =
    task.cookbookPublished && task.recipeVersionCurrent && task.effectiveTargetMicro > 0;
  return (
    <article className={task.status === "DISMISSED" ? "px-4 py-4 opacity-60" : "px-4 py-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{task.recipeName}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Recipe v{task.recipeVersion} · {task.outputItemName}
            {task.dueAt ? " · due " + formatDateTime(task.dueAt) : ""}
          </div>
        </div>
        <Status>{task.status}</Status>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Mini label="Recommended" value={quantity(task.recommendedBatchMicro, task)} />
        <Mini label="Prep target" value={quantity(task.effectiveTargetMicro, task)} />
        <Mini label="Prepared" value={quantity(task.preparedAvailableMicro, task)} />
        <Mini label="Forecast need" value={quantity(task.forecastRequiredMicro, task)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <Badge good={task.cookbookPublished}>
          {task.cookbookPublished
            ? "Cookbook r" + task.cookbook?.revision
            : "Published method missing"}
        </Badge>
        <Badge good={task.recipeVersionCurrent}>
          {task.recipeVersionCurrent ? "Current recipe" : "Recipe changed"}
        </Badge>
        <Badge good={task.quality !== "INSUFFICIENT_DATA"}>{task.quality}</Badge>
        {task.productionStatus ? <Badge good>{task.productionStatus}</Badge> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <Action onClick={onView}>View standard</Action>
        {["RECOMMENDED", "ADJUSTED"].includes(task.status) && canPlan ? (
          <Action onClick={onAdjust} disabled={busy}>
            <Pencil className="h-3 w-3" /> Adjust
          </Action>
        ) : null}
        {["RECOMMENDED", "ADJUSTED"].includes(task.status) && canPlan ? (
          <Action onClick={onApprove} disabled={busy || !executable}>
            <ShieldCheck className="h-3 w-3" /> Approve
          </Action>
        ) : null}
        {task.status === "APPROVED" && canStart ? (
          <Action onClick={onStart} disabled={busy || !executable}>
            <Play className="h-3 w-3" /> Start prep
          </Action>
        ) : null}
        {task.status === "STARTED" && canComplete ? (
          <Action onClick={onComplete} disabled={busy}>
            <CheckCircle2 className="h-3 w-3" /> Complete
          </Action>
        ) : null}
        {task.status !== "COMPLETED" && task.status !== "DISMISSED" && canDismiss ? (
          <Action danger onClick={onDismiss} disabled={busy}>
            <XCircle className="h-3 w-3" /> Dismiss
          </Action>
        ) : null}
      </div>

      {!task.cookbookPublished && ["RECOMMENDED", "ADJUSTED", "APPROVED"].includes(task.status) ? (
        <div className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-[11px] text-warning">
          Publish the Cookbook method for recipe v{task.recipeVersion} before this prep task can be
          approved or started.
        </div>
      ) : null}
    </article>
  );
}

function PrepDetail({ task, onClose }: { task: PrepTask; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task.recipeName} · Prep standard</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-3">
          <Info label="Target" value={quantity(task.effectiveTargetMicro, task)} />
          <Info label="Recipe version" value={"v" + task.recipeVersion} />
          <Info label="Cookbook" value={task.cookbook ? "r" + task.cookbook.revision : "Missing"} />
        </div>

        <Section title="Scaled ingredients">
          <div className="overflow-hidden rounded-lg border border-border">
            {task.ingredients.map((ingredient) => (
              <div
                key={ingredient.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border px-3 py-2 text-[12px] last:border-b-0"
              >
                <div>
                  <div className="font-semibold">{ingredient.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {ingredient.optional ? "Optional" : "Required"}
                    {ingredient.wasteFactorBps > 0
                      ? " · includes " + (ingredient.wasteFactorBps / 100).toFixed(1) + "% process allowance"
                      : ""}
                  </div>
                </div>
                <div className="num text-right font-semibold">
                  {formatMicro(ingredient.requiredWithWasteMicro)} {ingredient.unitSymbol ?? ""}
                </div>
              </div>
            ))}
            {!task.ingredients.length ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                No recipe components are configured.
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="Published method">
          {task.cookbook?.method.length ? (
            <ol className="space-y-3">
              {task.cookbook.method.map((step, index) => (
                <li key={String(step.step ?? index + 1)} className="flex gap-3 rounded-lg border border-border p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
                    {step.step ?? index + 1}
                  </span>
                  <div>
                    {step.title ? <div className="font-semibold">{step.title}</div> : null}
                    <div className="text-[13px] leading-6">
                      {step.instruction ?? "No instruction text"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {[
                        step.durationMinutes ? step.durationMinutes + " min" : "",
                        step.temperature ?? "",
                        step.checkpoint ?? "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">
              No published method exists for this recipe version.
            </div>
          )}
        </Section>

        {task.cookbook?.chefNotes ? (
          <Section title="Chef notes">
            <div className="whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-[12px] leading-5">
              {task.cookbook.chefNotes}
            </div>
          </Section>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <Info
            label="Prep / cook time"
            value={
              task.cookbook
                ? task.cookbook.prepMinutes + " / " + task.cookbook.cookMinutes + " min"
                : "—"
            }
          />
          <Info label="Station" value={task.stationName ?? "Unassigned"} />
          <Info label="Warehouse" value={task.warehouseName ?? "Not approved yet"} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({
  task,
  stations,
  busy,
  onClose,
  onSubmit,
}: {
  task: PrepTask;
  stations: PrepStation[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [quantityValue, setQuantityValue] = useState(formatMicro(task.effectiveTargetMicro));
  const [stationId, setStationId] = useState(task.stationId ?? "");
  const [dueAt, setDueAt] = useState(task.dueAt ? toLocalDateTime(task.dueAt) : "");
  const [reason, setReason] = useState(task.adjustmentReason ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = toMicro(quantityValue);
    if (target <= 0 || reason.trim().length < 3) return;
    onSubmit({
      expectedRevision: task.revision,
      targetQuantityMicro: target,
      stationId: stationId || null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      reason: reason.trim(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust prep · {task.recipeName}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label={"Target output (" + (task.yieldUnitSymbol ?? "units") + ")"}>
            <input className={inputClass} type="number" min="0.000001" step="0.001" value={quantityValue} onChange={(event) => setQuantityValue(event.target.value)} />
          </Field>
          <Field label="Station">
            <select className={inputClass} value={stationId} onChange={(event) => setStationId(event.target.value)}>
              <option value="">Unassigned</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>{station.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Due time">
            <input className={inputClass} type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </Field>
          <Field label="Reason for adjustment">
            <textarea className={textareaClass} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expected covers, event demand, stock position…" />
          </Field>
          <div className="rounded-md bg-secondary/50 p-3 text-[12px] text-muted-foreground">
            Ingredient quantities will be rescaled automatically from the authoritative recipe.
          </div>
          <DialogActions busy={busy} onClose={onClose} submitLabel="Save adjustment" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({
  task,
  warehouses,
  busy,
  onClose,
  onSubmit,
}: {
  task: PrepTask;
  warehouses: PrepWarehouse[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (warehouseId: string) => void;
}) {
  const preferred =
    task.defaultWarehouseId && warehouses.some((row) => row.id === task.defaultWarehouseId)
      ? task.defaultWarehouseId
      : warehouses[0]?.id ?? "";
  const [warehouseId, setWarehouseId] = useState(preferred);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve prep · {task.recipeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Info label="Approved target" value={quantity(task.effectiveTargetMicro, task)} />
          <Field label="Production warehouse">
            <select className={inputClass} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
          </Field>
          <div className="rounded-md bg-secondary/50 p-3 text-[12px] text-muted-foreground">
            Approval creates the linked PLANNED production batch. Stock is not moved until completion.
          </div>
          <div className="flex justify-end gap-2">
            <Btn disabled={busy} onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" disabled={busy || !warehouseId} onClick={() => onSubmit(warehouseId)}>
              Approve
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({
  task,
  busy,
  onClose,
  onSubmit,
}: {
  task: PrepTask;
  busy: boolean;
  onClose: () => void;
  onSubmit: (actualOutputQuantityMicro: number) => void;
}) {
  const [actual, setActual] = useState(formatMicro(task.effectiveTargetMicro));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete prep · {task.recipeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={"Actual output (" + (task.yieldUnitSymbol ?? "units") + ")"}>
            <input className={inputClass} type="number" min="0.000001" step="0.001" value={actual} onChange={(event) => setActual(event.target.value)} />
          </Field>
          <div className="rounded-md bg-warning/10 p-3 text-[12px] text-warning">
            Completing posts ingredient consumption and finished prepared stock to inventory.
          </div>
          <div className="flex justify-end gap-2">
            <Btn disabled={busy} onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" disabled={busy || toMicro(actual) <= 0} onClick={() => onSubmit(toMicro(actual))}>
              Complete & post stock
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DismissDialog({
  task,
  busy,
  onClose,
  onSubmit,
}: {
  task: PrepTask;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss prep · {task.recipeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Reason">
            <textarea className={textareaClass} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Already prepared, demand changed, item unavailable…" />
          </Field>
          {task.productionBatchId ? (
            <div className="rounded-md bg-warning/10 p-3 text-[12px] text-warning">
              The linked production batch will also be cancelled.
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Btn disabled={busy} onClick={onClose}>Cancel</Btn>
            <Btn disabled={busy || reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>
              Dismiss task
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DialogActions({
  busy,
  onClose,
  submitLabel,
}: {
  busy: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Btn type="button" disabled={busy} onClick={onClose}>Cancel</Btn>
      <Btn type="submit" variant="primary" disabled={busy}>{submitLabel}</Btn>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">{label}{children}</label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/45 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="num mt-1 text-[12px] font-semibold">{value}</div>
    </div>
  );
}

function Badge({ children, good = false }: { children: ReactNode; good?: boolean }) {
  return (
    <span className={good ? "rounded-full bg-success/10 px-2 py-1 text-success" : "rounded-full bg-warning/10 px-2 py-1 text-warning"}>
      {children}
    </span>
  );
}

function Action({
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1 text-[11px] font-semibold disabled:opacity-40 " +
        (danger ? "text-danger" : "text-primary")
      }
    >
      {children}
    </button>
  );
}

function quantity(value: number, task: PrepTask) {
  return formatMicro(value) + " " + (task.yieldUnitSymbol ?? "");
}

function formatMicro(value: number) {
  return (Number(value) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function toMicro(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function printPrepSheet(data: PrepLibrary | null, branchLabel: string) {
  if (!data?.tasks.length || typeof window === "undefined") return;
  const active = data.tasks.filter((task) => task.status !== "DISMISSED");
  const rows = active
    .map(
      (task) =>
        "<section><h2>" +
        escapeHtml(task.recipeName) +
        " <small>v" +
        task.recipeVersion +
        " · " +
        escapeHtml(task.status) +
        "</small></h2>" +
        "<p><strong>Target:</strong> " +
        escapeHtml(quantity(task.effectiveTargetMicro, task)) +
        " · <strong>Station:</strong> " +
        escapeHtml(task.stationName ?? "Unassigned") +
        (task.dueAt ? " · <strong>Due:</strong> " + escapeHtml(formatDateTime(task.dueAt)) : "") +
        "</p><h3>Ingredients</h3><ul>" +
        task.ingredients
          .map(
            (ingredient) =>
              "<li>" +
              escapeHtml(ingredient.name) +
              " — " +
              escapeHtml(formatMicro(ingredient.requiredWithWasteMicro)) +
              " " +
              escapeHtml(ingredient.unitSymbol ?? "") +
              "</li>",
          )
          .join("") +
        "</ul><h3>Method</h3><ol>" +
        (task.cookbook?.method ?? [])
          .map((step) => "<li>" + escapeHtml(step.instruction ?? "") + "</li>")
          .join("") +
        "</ol></section>",
    )
    .join("");
  const popup = window.open("", "_blank", "noopener,noreferrer,width=900,height=900");
  if (!popup) return;
  popup.document.write(
    "<!doctype html><html><head><title>Prep List</title><style>" +
      "body{font-family:Arial,sans-serif;margin:28px;color:#111}h1{margin-bottom:4px}small{font-weight:normal;color:#666}" +
      "section{break-inside:avoid;border-top:1px solid #ccc;padding:14px 0}h2{font-size:18px;margin:0 0 6px}" +
      "h3{font-size:12px;text-transform:uppercase;margin:12px 0 4px}p,li{font-size:12px;line-height:1.5}" +
      "</style></head><body><h1>Seramet Prep List</h1><p>" +
      escapeHtml(branchLabel) +
      " · " +
      escapeHtml(data.businessDate) +
      "</p>" +
      rows +
      "<script>window.onload=()=>window.print()</script></body></html>",
  );
  popup.document.close();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char] ?? char;
  });
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
const textareaClass =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary";
