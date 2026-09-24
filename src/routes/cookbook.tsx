import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Flame,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type CookbookContent,
  type CookbookDetail,
  type CookbookMedia,
  type CookbookMethodStep,
  type CookbookOverviewRecipe,
  useCookbook,
} from "@/cookbook/use-cookbook";
import { QUANTITY_SCALE } from "@/inventory/quantity";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/cookbook")({
  head: () => ({
    meta: [
      { title: "Cookbook - Seramet" },
      {
        name: "description",
        content:
          "Published kitchen methods, batch scaling and version-controlled chef instructions.",
      },
    ],
  }),
  component: Cookbook,
});

type MethodDraft = {
  key: string;
  title: string;
  instruction: string;
  timerMinutes: string;
  temperatureC: string;
  stationNote: string;
};

type MediaDraft = {
  key: string;
  kind: CookbookMedia["kind"];
  url: string;
  caption: string;
};

function Cookbook() {
  const { branchId, branchLabel, hasPermission, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const enabled = authoritative && !isAllBranches;
  const cookbook = useCookbook(enabled);
  const [search, setSearch] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [detail, setDetail] = useState<CookbookDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [desiredYield, setDesiredYield] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = enabled && hasPermission(permissions.cookbookManage);
  const canPublish = enabled && hasPermission(permissions.cookbookPublish);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return cookbook.recipes;
    return cookbook.recipes.filter((recipe) =>
      [recipe.target_name, recipe.target_code, recipe.name]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(needle)),
    );
  }, [cookbook.recipes, search]);

  const selected =
    cookbook.recipes.find((recipe) => recipe.id === selectedRecipeId) ??
    rows[0] ??
    cookbook.recipes[0] ??
    null;

  useEffect(() => {
    if (!selected?.id || !enabled) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailStatus("loading");
    setDetailError("");
    void cookbook
      .detail(selected.id)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setDesiredYield(formatQuantity(next.recipe.yield_quantity_minor));
        setDetailStatus("idle");
      })
      .catch((error) => {
        if (!active) return;
        setDetailError(error instanceof Error ? error.message : "Cookbook detail failed");
        setDetailStatus("error");
      });
    return () => {
      active = false;
    };
  }, [cookbook.detail, enabled, selected?.id]);

  const publishedCount = cookbook.recipes.filter(
    (recipe) => recipe.publication_status === "PUBLISHED",
  ).length;
  const draftCount = cookbook.recipes.filter((recipe) =>
    ["DRAFT_CHANGES", "DRAFT_ONLY"].includes(recipe.publication_status),
  ).length;
  const missingCount = cookbook.recipes.filter(
    (recipe) => recipe.publication_status === "MISSING",
  ).length;
  const reviewCount = cookbook.recipes.filter(
    (recipe) => recipe.publication_status !== "PUBLISHED",
  ).length;

  const visibleContent = detail
    ? canManage &&
      detail.draft &&
      (!detail.published || detail.draft.revision > detail.published.revision)
      ? detail.draft
      : detail.published
    : null;

  const desiredMicro = parseDesiredYield(desiredYield);
  const standardMicro = Number(detail?.recipe.yield_quantity_minor ?? 0);
  const scaleRatio = desiredMicro && standardMicro > 0 ? desiredMicro / standardMicro : 1;

  const refreshDetail = async (recipeId = selected?.id) => {
    if (!recipeId) return;
    const next = await cookbook.detail(recipeId);
    setDetail(next);
    setDesiredYield(formatQuantity(next.recipe.yield_quantity_minor));
  };

  const run = async (task: () => Promise<void>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await task();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Cookbook operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Cookbook"
      subtitle={`Published kitchen standards and batch scaling - ${branchLabel}`}
      actions={
        <Btn disabled={!enabled || busy} onClick={() => void cookbook.refresh()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Btn>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Published" value={publishedCount} />
        <Metric label="Drafts" value={draftCount} invert={draftCount > 0} />
        <Metric label="Missing methods" value={missingCount} invert={missingCount > 0} />
        <Metric label="Needs review" value={reviewCount} invert={reviewCount > 0} />
      </div>

      {(notice || cookbook.error || detailError || !authoritative || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            cookbook.error ||
            detailError ||
            (!authoritative
              ? "Cookbook requires the authoritative Seramet server."
              : "Select one branch to open its operational cookbook.")}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHead
            title="Recipe standards"
            sub={`${rows.length} recipe${rows.length === 1 ? "" : "s"}`}
            right={<BookOpen className="h-4 w-4 text-primary" />}
          />
          <div className="border-b border-border p-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search cookbook..."
              className={inputClass}
            />
          </div>
          <div className="max-h-[68vh] divide-y divide-border overflow-y-auto">
            {rows.map((recipe) => (
              <button
                key={recipe.id}
                type="button"
                onClick={() => setSelectedRecipeId(recipe.id)}
                className={`w-full px-4 py-3 text-left transition-colors hover:bg-secondary/50 ${
                  selected?.id === recipe.id ? "bg-accent/40" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold">{recipe.target_name}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {recipe.target_code || "No code"} · v{recipe.version}
                    </div>
                  </div>
                  <Status>{statusLabel(recipe.publication_status)}</Status>
                </div>
              </button>
            ))}
            {!rows.length && (
              <div className="p-8 text-center text-[12px] text-muted-foreground">
                {cookbook.status === "loading"
                  ? "Loading cookbook…"
                  : "No recipes match this search."}
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          {detail && selected ? (
            <>
              <Panel>
                <PanelHead
                  title={detail.recipe.target_name}
                  sub={`${detail.recipe.target_code || "Recipe"} · recipe v${detail.recipe.version}`}
                  right={
                    <div className="flex flex-wrap gap-2">
                      {canManage && (
                        <Btn disabled={busy} onClick={() => setEditorOpen(true)}>
                          <Pencil className="h-4 w-4" />
                          {detail.draft || detail.published ? "Edit method" : "Add method"}
                        </Btn>
                      )}
                      {canPublish && detail.draft && (
                        <Btn
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await cookbook.command("/api/seramet/cookbook/publish", {
                                branchId,
                                contentVersionId: detail.draft!.id,
                                idempotencyKey: `cookbook-publish:${crypto.randomUUID()}`,
                                changeSummary:
                                  detail.draft!.changeSummary ?? "Published kitchen standard",
                              });
                              await refreshDetail(detail.recipe.id);
                            }, "Cookbook revision published for kitchen use.")
                          }
                        >
                          <Send className="h-4 w-4" /> Publish
                        </Btn>
                      )}
                    </div>
                  }
                />
                {!detail.published && detail.previousPublished && (
                  <div className="border-b border-warning/30 bg-warning/10 px-4 py-3 text-[12px]">
                    The costing recipe has a newer active version. Previous published instructions
                    are available as a starting point, but they are intentionally not shown to
                    kitchen users until reviewed and published against this version.
                  </div>
                )}
                {!visibleContent && !detail.previousPublished ? (
                  <div className="p-8 text-center text-[12px] text-muted-foreground">
                    No kitchen method has been authored for this recipe version.
                  </div>
                ) : (
                  <CookbookCard
                    detail={detail}
                    content={visibleContent ?? detail.previousPublished!}
                    desiredYield={desiredYield}
                    onDesiredYield={setDesiredYield}
                    scaleRatio={scaleRatio}
                    usingPrevious={!visibleContent && Boolean(detail.previousPublished)}
                  />
                )}
              </Panel>

              {canManage && detail.history.length > 0 && (
                <Panel>
                  <PanelHead
                    title="Revision history"
                    sub="Append-only kitchen instruction history for this recipe version"
                  />
                  <DataTable cols={["Revision", "State", "Changed by", "Summary", "Created"]}>
                    {detail.history.map((revision) => (
                      <tr key={revision.id}>
                        <TD className="num font-semibold">r{revision.revision}</TD>
                        <TD>
                          <Status>{revision.status}</Status>
                        </TD>
                        <TD>{revision.createdByName ?? revision.createdBy}</TD>
                        <TD className="text-muted-foreground">{revision.changeSummary ?? "—"}</TD>
                        <TD className="text-muted-foreground">
                          {new Date(revision.createdAt).toLocaleString()}
                        </TD>
                      </tr>
                    ))}
                  </DataTable>
                </Panel>
              )}
            </>
          ) : (
            <Panel>
              <div className="p-12 text-center text-[12px] text-muted-foreground">
                {detailStatus === "loading"
                  ? "Loading kitchen standard…"
                  : "Select a recipe to open its cookbook card."}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {detail && (
        <CookbookEditor
          open={editorOpen}
          busy={busy}
          detail={detail}
          canPublish={canPublish}
          onOpenChange={setEditorOpen}
          onSave={(draft, publishNow) =>
            void run(
              async () => {
                const result = await cookbook.command<{ draft: CookbookContent }>(
                  "/api/seramet/cookbook/drafts",
                  {
                    branchId,
                    recipeId: detail.recipe.id,
                    recipeVersionId: detail.recipe.current_version_id,
                    idempotencyKey: `cookbook-draft:${crypto.randomUUID()}`,
                    ...draft,
                  },
                );
                if (publishNow) {
                  await cookbook.command("/api/seramet/cookbook/publish", {
                    branchId,
                    contentVersionId: result.draft.id,
                    idempotencyKey: `cookbook-publish:${crypto.randomUUID()}`,
                    changeSummary: draft.changeSummary || "Published kitchen standard",
                  });
                }
                await refreshDetail(detail.recipe.id);
                setEditorOpen(false);
              },
              publishNow ? "Kitchen method saved and published." : "Cookbook draft saved.",
            )
          }
        />
      )}
    </AppShell>
  );
}

function CookbookCard({
  detail,
  content,
  desiredYield,
  onDesiredYield,
  scaleRatio,
  usingPrevious,
}: {
  detail: CookbookDetail;
  content: CookbookContent;
  desiredYield: string;
  onDesiredYield: (value: string) => void;
  scaleRatio: number;
  usingPrevious: boolean;
}) {
  return (
    <div>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard
          icon={<Scale className="h-4 w-4" />}
          label="Standard yield"
          value={`${formatQuantity(detail.recipe.yield_quantity_minor)} ${
            detail.recipe.yield_unit_symbol ?? ""
          }`}
        />
        <InfoCard
          icon={<Clock3 className="h-4 w-4" />}
          label="Prep"
          value={`${content.prepMinutes} min`}
        />
        <InfoCard
          icon={<Flame className="h-4 w-4" />}
          label="Cook"
          value={`${content.cookMinutes} min`}
        />
        <InfoCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Content"
          value={
            usingPrevious
              ? "Previous version"
              : `r${content.revision} ${content.status.toLowerCase()}`
          }
        />
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
        <div className="space-y-4">
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="text-[12px] font-bold uppercase tracking-wide text-primary">
              Batch calculator
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
                I want to prepare
                <div className="flex">
                  <input
                    className={`${inputClass} rounded-r-none`}
                    type="number"
                    min="0.001"
                    step="0.1"
                    value={desiredYield}
                    onChange={(event) => onDesiredYield(event.target.value)}
                  />
                  <div className="flex h-10 items-center rounded-r-md border border-l-0 border-border bg-secondary px-3 text-[12px] font-semibold">
                    {detail.recipe.yield_unit_symbol ?? "unit"}
                  </div>
                </div>
              </label>
              <div className="pb-2 text-[12px] text-muted-foreground">
                Scale × {Number.isFinite(scaleRatio) ? scaleRatio.toFixed(3) : "1.000"}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="border-b border-border bg-secondary/40 px-4 py-3 text-[12px] font-bold uppercase tracking-wide">
              Scaled ingredients
            </div>
            <div className="divide-y divide-border">
              {detail.components.map((component) => (
                <div
                  key={component.id}
                  className="flex items-start justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <div className="text-[13px] font-semibold">
                      {component.inventory_item_name ?? component.sub_recipe_name ?? "Ingredient"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {component.inventory_item_code ??
                        (component.sub_recipe_id ? "Sub-recipe" : "")}
                      {component.optional ? " · optional" : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[14px] font-bold">
                      {formatQuantity(component.quantity_minor * scaleRatio)}{" "}
                      {component.unit_symbol ?? ""}
                    </div>
                    {component.waste_factor_bps > 0 && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        + {(component.waste_factor_bps / 100).toFixed(1)}% process allowance
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {content.chefNotes && (
            <div className="rounded-lg border border-border bg-secondary/30 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Chef notes
              </div>
              <div className="mt-2 whitespace-pre-wrap text-[13px]">{content.chefNotes}</div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            Method
          </div>
          {content.method.map((step, index) => (
            <div key={step.id ?? index} className="rounded-lg border border-border p-4">
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  {step.title && <div className="text-[13px] font-bold">{step.title}</div>}
                  <div className="mt-1 whitespace-pre-wrap text-[13px] leading-5">
                    {step.instruction}
                  </div>
                  {(step.timerMinutes || step.temperatureC != null || step.stationNote) && (
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                      {step.timerMinutes ? <span>{step.timerMinutes} min</span> : null}
                      {step.temperatureC != null ? <span>{step.temperatureC}°C</span> : null}
                      {step.stationNote ? <span>{step.stationNote}</span> : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {content.portionLabel && (
            <div className="rounded-lg bg-secondary/50 px-4 py-3 text-[12px]">
              Portion standard: <strong>{content.portionLabel}</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CookbookEditor({
  open,
  busy,
  detail,
  canPublish,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  detail: CookbookDetail;
  canPublish: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    draft: {
      prepMinutes: number;
      cookMinutes: number;
      portionLabel?: string;
      imageUrl?: string;
      chefNotes?: string;
      method: CookbookMethodStep[];
      media: CookbookMedia[];
      sourceDocument?: string;
      sourceReference?: string;
      changeSummary?: string;
    },
    publishNow: boolean,
  ) => void;
}) {
  const source = detail.draft ?? detail.published ?? detail.previousPublished;
  const [prepMinutes, setPrepMinutes] = useState(String(source?.prepMinutes ?? 0));
  const [cookMinutes, setCookMinutes] = useState(String(source?.cookMinutes ?? 0));
  const [portionLabel, setPortionLabel] = useState(source?.portionLabel ?? "");
  const [imageUrl, setImageUrl] = useState(source?.imageUrl ?? "");
  const [chefNotes, setChefNotes] = useState(source?.chefNotes ?? "");
  const [sourceDocument, setSourceDocument] = useState(source?.sourceDocument ?? "");
  const [sourceReference, setSourceReference] = useState(source?.sourceReference ?? "");
  const [changeSummary, setChangeSummary] = useState("");
  const [method, setMethod] = useState<MethodDraft[]>(
    source?.method.length ? source.method.map(methodToDraft) : [emptyMethod()],
  );
  const [media, setMedia] = useState<MediaDraft[]>(source?.media.map(mediaToDraft) ?? []);
  const [error, setError] = useState("");

  const submit = (publishNow: boolean) => {
    setError("");
    try {
      const prep = boundedMinutes(prepMinutes, "Prep minutes");
      const cook = boundedMinutes(cookMinutes, "Cook minutes");
      const normalizedMethod = method.map((step, index) => {
        if (!step.instruction.trim())
          throw new Error(`Method step ${index + 1} needs instructions`);
        const timer = optionalNumber(step.timerMinutes, `Step ${index + 1} timer`, 0, 1_440);
        const temperature = optionalNumber(
          step.temperatureC,
          `Step ${index + 1} temperature`,
          -50,
          500,
        );
        return {
          id: step.key,
          ...(step.title.trim() ? { title: step.title.trim() } : {}),
          instruction: step.instruction.trim(),
          ...(timer == null ? {} : { timerMinutes: timer }),
          ...(temperature == null ? {} : { temperatureC: temperature }),
          ...(step.stationNote.trim() ? { stationNote: step.stationNote.trim() } : {}),
        } satisfies CookbookMethodStep;
      });
      const normalizedMedia = media.map((item, index) => {
        if (!item.url.trim())
          throw new Error(`Media item ${index + 1} needs a URL or object reference`);
        return {
          id: item.key,
          kind: item.kind,
          url: item.url.trim(),
          ...(item.caption.trim() ? { caption: item.caption.trim() } : {}),
        } satisfies CookbookMedia;
      });
      onSave(
        {
          prepMinutes: prep,
          cookMinutes: cook,
          ...(portionLabel.trim() ? { portionLabel: portionLabel.trim() } : {}),
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
          ...(chefNotes.trim() ? { chefNotes: chefNotes.trim() } : {}),
          method: normalizedMethod,
          media: normalizedMedia,
          ...(sourceDocument.trim() ? { sourceDocument: sourceDocument.trim() } : {}),
          ...(sourceReference.trim() ? { sourceReference: sourceReference.trim() } : {}),
          ...(changeSummary.trim() ? { changeSummary: changeSummary.trim() } : {}),
        },
        publishNow,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cookbook content is invalid");
    }
  };

  const updateMethod = (key: string, patch: Partial<MethodDraft>) =>
    setMethod((current) =>
      current.map((step) => (step.key === key ? { ...step, ...patch } : step)),
    );
  const updateMedia = (key: string, patch: Partial<MediaDraft>) =>
    setMedia((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kitchen method · {detail.recipe.target_name}</DialogTitle>
        </DialogHeader>

        {source === detail.previousPublished && !detail.published && !detail.draft && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px]">
            This form is prefilled from the previous recipe version. Review quantities and method
            carefully before publishing.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Prep minutes">
            <input
              className={inputClass}
              type="number"
              min="0"
              value={prepMinutes}
              onChange={(event) => setPrepMinutes(event.target.value)}
            />
          </Field>
          <Field label="Cook minutes">
            <input
              className={inputClass}
              type="number"
              min="0"
              value={cookMinutes}
              onChange={(event) => setCookMinutes(event.target.value)}
            />
          </Field>
          <Field label="Portion / serving label">
            <input
              className={inputClass}
              value={portionLabel}
              onChange={(event) => setPortionLabel(event.target.value)}
              placeholder="e.g. 10 portions"
            />
          </Field>
          <Field label="Primary image reference">
            <input
              className={inputClass}
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="URL or stored object reference"
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Chef notes">
            <textarea
              className={textareaClass}
              value={chefNotes}
              onChange={(event) => setChefNotes(event.target.value)}
              placeholder="Quality checkpoints, plating notes, critical warnings..."
            />
          </Field>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-bold">Cooking method</div>
              <div className="text-[11px] text-muted-foreground">
                Ordered operational steps shown to the kitchen team.
              </div>
            </div>
            <Btn onClick={() => setMethod((current) => [...current, emptyMethod()])}>
              <Plus className="h-4 w-4" /> Step
            </Btn>
          </div>
          <div className="divide-y divide-border">
            {method.map((step, index) => (
              <div
                key={step.key}
                className="grid gap-2 p-4 lg:grid-cols-[40px_1fr_110px_110px_36px]"
              >
                <div className="flex h-10 items-center justify-center rounded-md bg-secondary text-[12px] font-bold">
                  {index + 1}
                </div>
                <div className="grid gap-2">
                  <input
                    className={inputClass}
                    value={step.title}
                    onChange={(event) => updateMethod(step.key, { title: event.target.value })}
                    placeholder="Step title (optional)"
                  />
                  <textarea
                    className={textareaClass}
                    value={step.instruction}
                    onChange={(event) =>
                      updateMethod(step.key, { instruction: event.target.value })
                    }
                    placeholder="Describe exactly what the chef should do..."
                  />
                  <input
                    className={inputClass}
                    value={step.stationNote}
                    onChange={(event) =>
                      updateMethod(step.key, { stationNote: event.target.value })
                    }
                    placeholder="Station / checkpoint note"
                  />
                </div>
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  value={step.timerMinutes}
                  onChange={(event) => updateMethod(step.key, { timerMinutes: event.target.value })}
                  placeholder="Minutes"
                  title="Timer minutes"
                />
                <input
                  className={inputClass}
                  type="number"
                  value={step.temperatureC}
                  onChange={(event) => updateMethod(step.key, { temperatureC: event.target.value })}
                  placeholder="°C"
                  title="Temperature Celsius"
                />
                <button
                  type="button"
                  disabled={method.length === 1}
                  onClick={() =>
                    setMethod((current) => current.filter((item) => item.key !== step.key))
                  }
                  className="flex h-10 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:opacity-30"
                  aria-label="Remove method step"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-bold">Media & references</div>
              <div className="text-[11px] text-muted-foreground">
                Optional images, videos or documents linked to the method.
              </div>
            </div>
            <Btn
              onClick={() =>
                setMedia((current) => [
                  ...current,
                  { key: crypto.randomUUID(), kind: "IMAGE", url: "", caption: "" },
                ])
              }
            >
              <Plus className="h-4 w-4" /> Media
            </Btn>
          </div>
          {media.length ? (
            <div className="divide-y divide-border">
              {media.map((item) => (
                <div key={item.key} className="grid gap-2 p-4 md:grid-cols-[120px_1fr_1fr_36px]">
                  <select
                    className={inputClass}
                    value={item.kind}
                    onChange={(event) =>
                      updateMedia(item.key, {
                        kind: event.target.value as CookbookMedia["kind"],
                      })
                    }
                  >
                    <option value="IMAGE">Image</option>
                    <option value="VIDEO">Video</option>
                    <option value="DOCUMENT">Document</option>
                  </select>
                  <input
                    className={inputClass}
                    value={item.url}
                    onChange={(event) => updateMedia(item.key, { url: event.target.value })}
                    placeholder="URL / object reference"
                  />
                  <input
                    className={inputClass}
                    value={item.caption}
                    onChange={(event) => updateMedia(item.key, { caption: event.target.value })}
                    placeholder="Caption"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setMedia((current) =>
                        current.filter((candidate) => candidate.key !== item.key),
                      )
                    }
                    className="flex h-10 items-center justify-center rounded-md text-danger hover:bg-danger/10"
                    aria-label="Remove media"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5 text-center text-[12px] text-muted-foreground">
              No media linked.
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Field label="Source document">
            <input
              className={inputClass}
              value={sourceDocument}
              onChange={(event) => setSourceDocument(event.target.value)}
              placeholder="Cookbook.docx"
            />
          </Field>
          <Field label="Source reference">
            <input
              className={inputClass}
              value={sourceReference}
              onChange={(event) => setSourceReference(event.target.value)}
              placeholder="Page, section or object ID"
            />
          </Field>
          <Field label="Change summary">
            <input
              className={inputClass}
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder="What changed?"
            />
          </Field>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Btn disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <Btn disabled={busy} onClick={() => submit(false)}>
            Save draft
          </Btn>
          {canPublish && (
            <Btn variant="primary" disabled={busy} onClick={() => submit(true)}>
              Save & publish
            </Btn>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[14px] font-bold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function methodToDraft(step: CookbookMethodStep): MethodDraft {
  return {
    key: step.id ?? crypto.randomUUID(),
    title: step.title ?? "",
    instruction: step.instruction,
    timerMinutes: step.timerMinutes == null ? "" : String(step.timerMinutes),
    temperatureC: step.temperatureC == null ? "" : String(step.temperatureC),
    stationNote: step.stationNote ?? "",
  };
}

function mediaToDraft(item: CookbookMedia): MediaDraft {
  return {
    key: item.id ?? crypto.randomUUID(),
    kind: item.kind,
    url: item.url,
    caption: item.caption ?? "",
  };
}

function emptyMethod(): MethodDraft {
  return {
    key: crypto.randomUUID(),
    title: "",
    instruction: "",
    timerMinutes: "",
    temperatureC: "",
    stationNote: "",
  };
}

function boundedMinutes(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_440) {
    throw new Error(`${label} must be a whole number between 0 and 1440`);
  }
  return parsed;
}

function optionalNumber(value: string, label: string, minimum: number, maximum: number) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseDesiredYield(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed * QUANTITY_SCALE;
}

function formatQuantity(value: number) {
  return (Number(value) / QUANTITY_SCALE).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function statusLabel(status: CookbookOverviewRecipe["publication_status"]) {
  if (status === "PUBLISHED") return "Published";
  if (status === "DRAFT_CHANGES") return "Draft changes";
  if (status === "DRAFT_ONLY") return "Draft";
  return "Missing";
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
const textareaClass =
  "min-h-24 w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary";
