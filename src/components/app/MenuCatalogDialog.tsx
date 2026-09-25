import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Plus, Upload, X } from "lucide-react";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { createCanonicalMenuTemplate, menuImportHeaders } from "@/onboarding/menu-import-schema";
import { manualMenuCsv, type ManualMenuItem } from "@/onboarding/manual-menu-draft";
import type { DuplicateStrategy, ImportPreview, ImportTargetMode } from "@/onboarding/types";
import { useSetupCentre } from "@/onboarding/use-setup-centre";
import { formatMinor } from "@/payments/money";

type SetupCentre = ReturnType<typeof useSetupCentre>;
type Inspection = Awaited<ReturnType<SetupCentre["inspectMenuColumns"]>>;
type Props = {
  mode: "manual" | "import";
  centre: SetupCentre;
  onClose: () => void;
  onPreview: (preview: ImportPreview | null) => void;
  onCommitted: (kind: "manual" | "import") => void;
};

const requiredFields = ["itemCode", "name", "categoryCode", "basePrice"] as const;
const optionalFields = [
  "description",
  "currency",
  "stationCode",
  "taxCode",
  "recipeCode",
  "sku",
  "onlinePrice",
  "branchCode",
  "branchPrice",
  "available",
] as const;
const fieldNames: Record<string, string> = {
  itemCode: "Item code",
  name: "Item name",
  categoryCode: "Category",
  basePrice: "Selling price",
  description: "Description",
  currency: "Currency",
  stationCode: "Kitchen/bar station",
  taxCode: "Tax code",
  recipeCode: "Recipe",
  sku: "SKU",
  onlinePrice: "Online price",
  branchCode: "Branch code",
  branchPrice: "Branch price",
  available: "Available",
};

export function MenuCatalogDialog({ mode, centre, onClose, onPreview, onCommitted }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { branchId, currency } = useAppContext();
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<DuplicateStrategy>("ERROR");
  const [targetMode, setTargetMode] = useState<ImportTargetMode>("SELECTED_BRANCHES");
  const [branchIds, setBranchIds] = useState<string[]>(branchId ? [branchId] : []);
  const [stationMap, setStationMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [completed, setCompleted] = useState(false);
  const [manual, setManual] = useState<ManualMenuItem>({
    itemCode: "",
    name: "",
    categoryCode: "",
    basePrice: "",
    currency,
    description: "",
    stationCode: "",
    sellable: true,
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.showModal();
    return () => {
      if (node.open) node.close();
    };
  }, []);

  function invalidate() {
    setPreview(null);
    onPreview(null);
    setMessage("");
    setCompleted(false);
  }

  function setField<K extends keyof ManualMenuItem>(key: K, value: ManualMenuItem[K]) {
    setManual((current) => ({ ...current, [key]: value }));
    invalidate();
  }

  function setMappedField(key: string, value: string) {
    setColumnMap((current) => ({ ...current, [key]: value }));
    invalidate();
  }

  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!selected || stepBusy) return;
    invalidate();
    setFile(selected);
    setInspection(null);
    setWarning("");
    if (selected.size > 12 * 1024 * 1024) {
      setWarning("Choose a file smaller than 12 MB for interactive preview.");
      return;
    }
    setStepBusy(true);
    try {
      const result = await centre.inspectMenuColumns(selected);
      setInspection(result);
      setColumnMap(result.suggestedMap);
    } catch (cause) {
      setWarning(
        cause instanceof Error ? cause.message : "The selected menu file could not be inspected.",
      );
    } finally {
      setStepBusy(false);
    }
  }

  async function makePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stepBusy || completed) return;
    invalidate();
    setWarning("");
    if (targetMode === "SELECTED_BRANCHES" && branchIds.length === 0) {
      setWarning("Select at least one branch before importing items.");
      return;
    }
    let input: File;
    try {
      if (mode === "manual") {
        const csv = manualMenuCsv(manual);
        input = new File([csv], "manual-" + manual.itemCode.trim().toUpperCase() + ".csv", {
          type: "text/csv",
        });
      } else {
        if (!file || !inspection) throw new Error("Choose and inspect a menu file first.");
        const missing = requiredFields.filter((field) => !columnMap[field]);
        if (missing.length) {
          throw new Error(
            "Map these required columns: " + missing.map((field) => fieldNames[field]).join(", "),
          );
        }
        input = file;
      }
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : "The menu item is invalid.");
      return;
    }
    setStepBusy(true);
    try {
      const result = await centre.previewImport(
        input,
        "MENU",
        mode === "manual" ? "CREATE" : strategy,
        {
          targetMode,
          targetBranchIds: targetMode === "SELECTED_BRANCHES" ? branchIds : [],
          ...(mode === "import" ? { columnMap } : {}),
          referenceMap: { stations: stationMap },
        },
      );
      setPreview(result);
      onPreview(result);
      if (result.errorCount > 0) {
        setWarning("Correct the highlighted rows or station mappings and validate again.");
      }
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : "Server preview failed.");
    } finally {
      setStepBusy(false);
    }
  }

  async function commit() {
    if (stepBusy || completed || !preview?.canCommit) return;
    setStepBusy(true);
    setWarning("");
    setMessage("");
    try {
      const { result } = await centre.commitImport(preview);
      if (result.queued) {
        setPreview({ ...preview, status: "COMMITTING", canCommit: false });
        setMessage(
          "The import is queued. It is not available in POS until the server finishes verification.",
        );
        return;
      }
      if (result.status !== "COMMITTED" || result.verification?.status !== "VERIFIED") {
        setPreview({ ...preview, status: "COMMITTING", canCommit: false });
        setWarning(
          "The server has not confirmed completed catalogue verification. Refresh and check import status before retrying.",
        );
        return;
      }
      setPreview({
        ...preview,
        status: "COMMITTED",
        canCommit: false,
        verification: result.verification,
      });
      setCompleted(true);
      await centre.refreshCatalog();
      setMessage("Saved and verified by the server. Confirm its branch availability in the POS.");
      onCommitted(mode);
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : "Commit failed. No success was assumed.");
    } finally {
      setStepBusy(false);
    }
  }

  const stationSources = [
    ...new Set(
      (preview?.rows ?? []).flatMap((row) =>
        row.errors.some((issue) => issue.code === "UNKNOWN_STATION")
          ? [String(row.normalized["stationCode"] ?? "")]
          : [],
      ),
    ),
  ].filter(Boolean);
  const activeStations = centre.options.stations.filter(
    (station) =>
      branchIds.length === 0 ||
      branchIds.includes(String(station["branch_id"])) ||
      targetMode === "ROW_BRANCHES",
  );

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        if (stepBusy) event.preventDefault();
      }}
      onClose={onClose}
      aria-label={mode === "manual" ? "Add menu item" : "Import menu"}
      className="m-auto max-h-[92vh] w-[min(94vw,920px)] overflow-y-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          {mode === "manual" ? (
            <Plus className="h-5 w-5 text-primary" />
          ) : (
            <FileSpreadsheet className="h-5 w-5 text-primary" />
          )}
          <div>
            <h2 className="text-lg font-bold">
              {mode === "manual" ? "Add menu item" : "Import menu items"}
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {mode === "manual"
                ? "Configure, preview and save one real catalog item."
                : "Upload, map columns, validate and explicitly commit."}
            </p>
          </div>
        </div>
        <Btn onClick={onClose} disabled={stepBusy} aria-label="Close menu editor" variant="ghost">
          <X className="h-4 w-4" />
        </Btn>
      </div>
      <form id="menu-draft" onSubmit={(event) => void makePreview(event)} className="space-y-4 p-5">
        {mode === "manual" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Item name *
              <input
                autoFocus
                required
                minLength={2}
                maxLength={160}
                value={manual.name}
                onChange={(event) => setField("name", event.target.value)}
                placeholder="Beef pilau"
                className="h-10 rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Unique item code *
              <input
                required
                maxLength={40}
                value={manual.itemCode}
                onChange={(event) => setField("itemCode", event.target.value)}
                placeholder="PL-001"
                className="h-10 rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Category code *
              <input
                required
                maxLength={40}
                value={manual.categoryCode}
                onChange={(event) => setField("categoryCode", event.target.value)}
                placeholder="MAINS"
                className="h-10 rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Price ({currency}) *
              <input
                required
                type="text"
                inputMode="decimal"
                value={manual.basePrice}
                onChange={(event) => setField("basePrice", event.target.value)}
                placeholder="450"
                className="h-10 rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold sm:col-span-2">
              Description
              <textarea
                rows={2}
                maxLength={2000}
                value={manual.description ?? ""}
                onChange={(event) => setField("description", event.target.value)}
                className="rounded-md border border-border bg-background p-3"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold sm:col-span-2">
              Kitchen / bar station
              <select
                value={manual.stationCode ?? ""}
                onChange={(event) => setField("stationCode", event.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3"
              >
                <option value="">Not assigned (requires review before kitchen orders)</option>
                {activeStations.map((station) => (
                  <option key={String(station["id"])} value={String(station["code"])}>
                    {String(station["name"])} ({String(station["code"])})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12px] font-semibold">
              <input
                type="checkbox"
                checked={manual.sellable}
                onChange={(event) => setField("sellable", event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Available for sale
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-6 text-center text-[13px] font-semibold">
              {stepBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
              {file ? file.name : "Choose CSV or Excel (.xlsx) file"}
              <span className="text-[11px] font-normal">
                The server inspects only the authorized tenant's upload.
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => void inspect(event)}
                disabled={stepBusy}
                className="sr-only"
              />
            </label>
            {inspection && (
              <Panel>
                <PanelHead
                  title="Map spreadsheet columns"
                  sub="Choose which source column supplies each Seramet field."
                />
                <div className="grid gap-3 p-4 sm:grid-cols-2">
                  {[...requiredFields, ...optionalFields].map((field) => (
                    <label key={field} className="grid gap-1 text-[12px] font-semibold">
                      {fieldNames[field]}
                      {requiredFields.some((required) => required === field) ? " *" : ""}
                      <select
                        value={columnMap[field] ?? ""}
                        onChange={(event) => setMappedField(field, event.target.value)}
                        className="h-10 w-full rounded-md border border-border bg-background px-2"
                      >
                        <option value="">Not mapped</option>
                        {inspection.sourceHeaders.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="border-t border-border p-4 text-[11px] text-muted-foreground">
                  <strong>Example row:</strong>{" "}
                  {Object.entries(inspection.samples[0] ?? {})
                    .slice(0, 6)
                    .map(([header, value]) => header + ": " + value)
                    .join(" · ")}
                </div>
              </Panel>
            )}
            <label className="grid gap-1 text-[12px] font-semibold">
              Existing code policy
              <select
                value={strategy}
                onChange={(event) => {
                  setStrategy(event.target.value as DuplicateStrategy);
                  invalidate();
                }}
                className="h-10 rounded-md border border-border bg-background px-3"
              >
                <option value="ERROR">Stop if a code already exists</option>
                <option value="CREATE">Only create new items</option>
                <option value="UPDATE">Only update existing items</option>
                <option value="SKIP">Create new; skip existing items</option>
              </select>
            </label>
          </div>
        )}
        <fieldset className="rounded-md border border-border p-3">
          <legend className="px-1 text-[12px] font-semibold">
            Where should these items appear?
          </legend>
          <div className="mb-3 flex flex-wrap gap-4 text-[12px]">
            {(["SELECTED_BRANCHES", "TENANT_MASTER", "ROW_BRANCHES"] as const)
              .filter((target) => mode === "import" || target !== "ROW_BRANCHES")
              .map((target) => (
                <label key={target} className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={targetMode === target}
                    value={target}
                    onChange={() => {
                      setTargetMode(target);
                      invalidate();
                    }}
                    className="accent-primary"
                  />
                  {target === "SELECTED_BRANCHES"
                    ? "Selected branches"
                    : target === "TENANT_MASTER"
                      ? "Master only (not yet sellable)"
                      : "Branch per spreadsheet row"}
                </label>
              ))}
          </div>
          {targetMode === "SELECTED_BRANCHES" && (
            <div className="flex flex-wrap gap-3">
              {centre.structure.branches.map((branch) => (
                <label key={branch.id} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(branch.id)}
                    onChange={(event) => {
                      setBranchIds((old) =>
                        event.target.checked
                          ? [...new Set([...old, branch.id])]
                          : old.filter((id) => id !== branch.id),
                      );
                      invalidate();
                    }}
                    className="accent-primary"
                  />
                  {branch.name} ({branch.code})
                </label>
              ))}
              {centre.structure.branches.length === 0 && (
                <p className="text-warning">No configured branches were returned. Check Setup.</p>
              )}
            </div>
          )}
          {targetMode === "TENANT_MASTER" && (
            <p className="text-[11px] text-warning">
              Master items will not appear in POS until activated for a branch.
            </p>
          )}
        </fieldset>
        {stationSources.length > 0 && (
          <Panel>
            <PanelHead
              title="Resolve kitchen routing"
              sub="Unknown stations block those rows. Choose a real configured station and validate again."
            />
            <div className="grid gap-2 p-3">
              {stationSources.map((source) => (
                <label key={source} className="grid gap-1 text-[12px]">
                  {source}
                  <select
                    value={stationMap[source] ?? ""}
                    onChange={(event) => {
                      setStationMap((old) => ({ ...old, [source]: event.target.value }));
                      invalidate();
                    }}
                    className="h-9 rounded-md border border-border bg-background px-2"
                  >
                    <option value="">Choose a configured station</option>
                    {activeStations.map((station) => (
                      <option key={String(station["id"])} value={String(station["code"])}>
                        {String(station["name"])} ({String(station["code"])})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </Panel>
        )}
        {preview && (
          <Panel>
            <PanelHead
              title="Server validation"
              sub={
                "Rows " +
                preview.rowCount +
                " · Errors " +
                preview.errorCount +
                " · Warnings " +
                preview.warningCount
              }
              right={<Status>{preview.status}</Status>}
            />
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-secondary">
                  <tr>
                    <th className="p-2">Row</th>
                    <th className="p-2">Item</th>
                    <th className="p-2">Action</th>
                    <th className="p-2">Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 35).map((row) => (
                    <tr key={row.rowKey + ":" + row.rowNumber} className="border-t border-border">
                      <td className="p-2">{row.rowNumber}</td>
                      <td className="p-2">{String(row.normalized["name"] ?? "")}</td>
                      <td className="p-2">{row.action}</td>
                      <td className="p-2">
                        {[...row.errors, ...row.warnings]
                          .map((issue) => issue.message)
                          .join("; ") || "Valid"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 35 && (
                <p className="p-2 text-[11px] text-muted-foreground">
                  First 35 rows shown. The server validates all rows.
                </p>
              )}
            </div>
          </Panel>
        )}
        {warning && (
          <p
            role="alert"
            className="rounded-md border border-warning/30 bg-warning-soft p-3 text-[12px] text-warning"
          >
            {warning}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="rounded-md border border-success/30 bg-success-soft p-3 text-[12px] text-success"
          >
            {message}
          </p>
        )}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card py-3">
          <Btn onClick={onClose} disabled={stepBusy}>
            {completed ? "Close" : "Cancel"}
          </Btn>
          {!completed && (
            <Btn
              type="submit"
              variant="primary"
              disabled={stepBusy || (mode === "import" && !inspection)}
            >
              {stepBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {preview ? "Revalidate" : mode === "manual" ? "Preview item" : "Validate import"}
            </Btn>
          )}
          {preview?.canCommit && !completed && (
            <Btn type="button" onClick={() => void commit()} disabled={stepBusy} variant="primary">
              <CheckCircle2 className="h-4 w-4" />
              {mode === "manual" ? "Save and activate" : "Commit verified import"}
            </Btn>
          )}
        </div>
      </form>
    </dialog>
  );
}
