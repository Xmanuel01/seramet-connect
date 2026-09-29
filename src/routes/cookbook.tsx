import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Copy, Pencil, RefreshCw, Send } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QUANTITY_SCALE } from "@/inventory/quantity";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { type CookbookRecipe, useCookbook } from "@/cookbook/use-cookbook";

export const Route = createFileRoute("/cookbook")({
  head: () => ({
    meta: [
      { title: "Cookbook - Seramet" },
      {
        name: "description",
        content: "Published kitchen methods connected to authoritative recipe versions.",
      },
    ],
  }),
  component: Cookbook,
});

function Cookbook() {
  const { branchLabel, hasPermission, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const cookbook = useCookbook(authoritative && !isAllBranches);
  const canManage = hasPermission(permissions.cookbookManage) && !isAllBranches;
  const canPublish = hasPermission(permissions.cookbookPublish) && !isAllBranches;
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CookbookRecipe | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const recipes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cookbook.recipes.filter((recipe) => {
      if (!needle) return true;
      return [
        recipe.name,
        recipe.menu_item_name,
        recipe.production_item_name,
        recipe.menu_item_code,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(needle),
      );
    });
  }, [cookbook.recipes, search]);

  const selected =
    cookbook.recipes.find((recipe) => recipe.id === selectedId) ??
    recipes[0] ??
    cookbook.recipes[0] ??
    null;
  const displayContent = selected
    ? canManage
      ? (selected.latestContent ?? selected.publishedContent)
      : selected.publishedContent
    : null;

  const run = async (task: () => Promise<unknown>, success: string) => {
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
      subtitle={`Kitchen methods and standards - ${branchLabel}`}
      actions={
        <Btn
          disabled={!authoritative || busy || isAllBranches}
          onClick={() => void cookbook.refresh()}
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Btn>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Recipes" value={cookbook.recipes.length} />
        <Metric
          label="Published"
          value={cookbook.recipes.filter((recipe) => recipe.publishedContent).length}
        />
        <Metric
          label="Draft changes"
          value={
            cookbook.recipes.filter((recipe) => recipe.latestContent?.status === "DRAFT").length
          }
        />
        <Metric
          label="Needs method"
          value={cookbook.recipes.filter((recipe) => !recipe.publishedContent).length}
          invert
        />
      </div>

      {(notice || cookbook.error || isAllBranches || !authoritative) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            cookbook.error ||
            (isAllBranches
              ? "Select a branch to view and manage the operational cookbook."
              : "Cookbook requires the authoritative Seramet server.")}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHead
            title="Recipe standards"
            right={
              <input
                className="h-9 w-[170px] rounded-md border border-border bg-card px-3 text-[12px] outline-none"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search..."
              />
            }
          />
          <div className="max-h-[72vh] divide-y divide-border overflow-y-auto">
            {recipes.map((recipe) => {
              const status =
                recipe.latestContent?.status ?? (recipe.publishedContent ? "PUBLISHED" : "MISSING");
              return (
                <button
                  key={recipe.id}
                  type="button"
                  onClick={() => setSelectedId(recipe.id)}
                  className={`w-full px-4 py-3 text-left hover:bg-secondary/50 ${
                    selected?.id === recipe.id ? "bg-accent/40" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-semibold">{recipe.name}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        v{recipe.version} · {formatYield(recipe)}
                      </div>
                    </div>
                    <Status>{status === "MISSING" ? "Needs method" : status}</Status>
                  </div>
                </button>
              );
            })}
            {!recipes.length && (
              <div className="p-8 text-center text-[12px] text-muted-foreground">
                {cookbook.status === "loading" ? "Loading cookbook…" : "No recipes found."}
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title={selected?.name ?? "Cookbook"}
            sub={
              selected
                ? `Recipe v${selected.version} · ${formatYield(selected)}`
                : "Select a recipe standard"
            }
            right={
              selected && canManage ? (
                <div className="flex gap-2">
                  {!selected.latestContent && selected.previousPublishedContent ? (
                    <Btn
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            cookbook.command("/api/seramet/cookbook/copy-previous", {
                              recipeId: selected.id,
                              targetRecipeVersionId: selected.current_version_id,
                              changeSummary: "Copied previous published method for review",
                            }),
                          "Previous published method copied into a draft for this recipe version.",
                        )
                      }
                    >
                      <Copy className="h-4 w-4" /> Copy previous
                    </Btn>
                  ) : null}
                  <Btn disabled={busy} onClick={() => setEditing(selected)}>
                    <Pencil className="h-4 w-4" /> Edit method
                  </Btn>
                </div>
              ) : undefined
            }
          />
          {selected ? (
            <div className="p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div>
                  <SectionTitle>Ingredients</SectionTitle>
                  <div className="mt-2 overflow-hidden rounded-lg border border-border">
                    {selected.ingredients.map((ingredient, index) => (
                      <div
                        key={String(ingredient["id"] ?? index)}
                        className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-[12px] last:border-b-0"
                      >
                        <span className="font-medium">
                          {String(
                            ingredient["inventory_item_name"] ??
                              ingredient["sub_recipe_name"] ??
                              "Unknown ingredient",
                          )}
                        </span>
                        <span className="num text-muted-foreground">
                          {formatMicro(Number(ingredient["quantity_minor"] ?? 0))}{" "}
                          {String(ingredient["unit_symbol"] ?? "")}
                          {Number(ingredient["waste_factor_bps"] ?? 0) > 0
                            ? ` + ${(Number(ingredient["waste_factor_bps"]) / 100).toFixed(1)}% waste`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>

                  <SectionTitle className="mt-5">Method</SectionTitle>
                  {displayContent?.method.length ? (
                    <ol className="mt-3 space-y-3">
                      {displayContent.method.map((step) => (
                        <li key={step.step} className="rounded-lg border border-border p-3">
                          <div className="flex gap-3">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
                              {step.step}
                            </div>
                            <div className="min-w-0">
                              {step.title ? (
                                <div className="font-semibold">{step.title}</div>
                              ) : null}
                              <div className="mt-1 text-[13px] leading-6">{step.instruction}</div>
                              {(step.durationMinutes || step.temperature || step.checkpoint) && (
                                <div className="mt-2 text-[11px] text-muted-foreground">
                                  {[
                                    step.durationMinutes ? `${step.durationMinutes} min` : "",
                                    step.temperature ?? "",
                                    step.checkpoint ?? "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyMethod canManage={canManage} />
                  )}

                  {displayContent?.chefNotes ? (
                    <>
                      <SectionTitle className="mt-5">Chef notes</SectionTitle>
                      <div className="mt-2 whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-[12px] leading-5">
                        {displayContent.chefNotes}
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {displayContent?.imageUrl ? (
                    <img
                      src={displayContent.imageUrl}
                      alt={selected.name}
                      className="aspect-[4/3] w-full rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-border bg-secondary/20">
                      <BookOpen className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                  <Info label="Content status" value={displayContent?.status ?? "Not published"} />
                  <Info
                    label="Prep time"
                    value={displayContent ? `${displayContent.prepMinutes} min` : "—"}
                  />
                  <Info
                    label="Cook time"
                    value={displayContent ? `${displayContent.cookMinutes} min` : "—"}
                  />
                  <Info
                    label="Portion standard"
                    value={displayContent?.portionLabel ?? formatYield(selected)}
                  />
                  <Info
                    label="Revision"
                    value={displayContent ? `r${displayContent.revision}` : "—"}
                  />
                  {displayContent?.sourceDocument ? (
                    <Info label="Source" value={displayContent.sourceDocument} />
                  ) : null}
                  {canPublish && selected.latestContent?.status === "DRAFT" ? (
                    <Btn
                      variant="primary"
                      className="w-full justify-center"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            cookbook.command("/api/seramet/cookbook/publish", {
                              contentVersionId: selected.latestContent!.id,
                              changeSummary:
                                selected.latestContent!.changeSummary ?? "Approved kitchen method",
                            }),
                          "Cookbook method published for kitchen use.",
                        )
                      }
                    >
                      <Send className="h-4 w-4" /> Publish draft
                    </Btn>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Select a recipe from the cookbook.
            </div>
          )}
        </Panel>
      </div>

      {editing ? (
        <CookbookEditor
          recipe={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(body) =>
            void run(async () => {
              await cookbook.command("/api/seramet/cookbook/drafts", body);
              setEditing(null);
            }, "Cookbook draft saved as a new revision.")
          }
        />
      ) : null}
    </AppShell>
  );
}

function CookbookEditor({
  recipe,
  busy,
  onClose,
  onSave,
}: {
  recipe: CookbookRecipe;
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const seed = recipe.latestContent ?? recipe.publishedContent;
  const [prepMinutes, setPrepMinutes] = useState(String(seed?.prepMinutes ?? 0));
  const [cookMinutes, setCookMinutes] = useState(String(seed?.cookMinutes ?? 0));
  const [portionLabel, setPortionLabel] = useState(seed?.portionLabel ?? formatYield(recipe));
  const [imageUrl, setImageUrl] = useState(seed?.imageUrl ?? "");
  const [chefNotes, setChefNotes] = useState(seed?.chefNotes ?? "");
  const [sourceDocument, setSourceDocument] = useState(seed?.sourceDocument ?? "");
  const [sourceReference, setSourceReference] = useState(seed?.sourceReference ?? "");
  const [changeSummary, setChangeSummary] = useState("");
  const [methodText, setMethodText] = useState(
    seed?.method.map((step) => step.instruction).join("\n") ?? "",
  );
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const method = methodText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((instruction, index) => ({ step: index + 1, instruction }));
    if (!method.length) {
      setError("Add at least one cooking step.");
      return;
    }
    if (changeSummary.trim().length < 3) {
      setError("Add a short change summary for the revision history.");
      return;
    }
    onSave({
      recipeId: recipe.id,
      recipeVersionId: recipe.current_version_id,
      prepMinutes: Number(prepMinutes || 0),
      cookMinutes: Number(cookMinutes || 0),
      portionLabel: portionLabel.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      chefNotes: chefNotes.trim() || undefined,
      method,
      media: seed?.media ?? [],
      sourceDocument: sourceDocument.trim() || undefined,
      sourceReference: sourceReference.trim() || undefined,
      changeSummary: changeSummary.trim(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipe.name} · Cookbook method</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
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
            <Field label="Portion / yield label">
              <input
                className={inputClass}
                value={portionLabel}
                onChange={(event) => setPortionLabel(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Method — one step per line">
            <textarea
              className={textareaClass}
              rows={10}
              value={methodText}
              onChange={(event) => setMethodText(event.target.value)}
              placeholder={"Prepare ingredients\nHeat the pan\nCook until ready"}
            />
          </Field>
          <Field label="Chef notes">
            <textarea
              className={textareaClass}
              rows={4}
              value={chefNotes}
              onChange={(event) => setChefNotes(event.target.value)}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Recipe image URL">
              <input
                className={inputClass}
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://..."
              />
            </Field>
            <Field label="Source document">
              <input
                className={inputClass}
                value={sourceDocument}
                onChange={(event) => setSourceDocument(event.target.value)}
                placeholder="Mona Cookbook v1"
              />
            </Field>
          </div>
          <Field label="Source reference">
            <input
              className={inputClass}
              value={sourceReference}
              onChange={(event) => setSourceReference(event.target.value)}
              placeholder="Page, section, document URL or reference"
            />
          </Field>
          <Field label="Change summary">
            <input
              className={inputClass}
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder="Standardized cooking steps and timing"
            />
          </Field>
          {error ? (
            <div className="rounded-md bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Btn type="button" disabled={busy} onClick={onClose}>
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" disabled={busy}>
              Save draft revision
            </Btn>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyMethod({ canManage }: { canManage: boolean }) {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-8 text-center text-[12px] text-muted-foreground">
      {canManage
        ? "No method has been saved for this recipe version yet. Use Edit method to create the first draft."
        : "No published kitchen method is available for this recipe version."}
    </div>
  );
}

function SectionTitle({ children, className = "" }: { children: string; className?: string }) {
  return (
    <h3
      className={`text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground ${className}`}
    >
      {children}
    </h3>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-[13px] font-semibold">{value}</div>
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

function formatYield(recipe: CookbookRecipe) {
  return `${formatMicro(recipe.yield_quantity_minor)} ${recipe.yield_unit_symbol ?? ""}`.trim();
}

function formatMicro(value: number) {
  return (Number(value) / QUANTITY_SCALE).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
const textareaClass =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary";
