import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import type { DuplicateStrategy, ImportPreview, ImportTargetMode } from "@/onboarding/types";
import {
  MENU_IMPORT_TEMPLATE_VERSION,
  createCanonicalMenuTemplate,
  csvCell,
  menuImportHeaders,
} from "@/onboarding/menu-import-schema";
import { createHistoricalSalesTemplate } from "@/onboarding/historical-sales-import-schema";
import type { HistoricalSalesPreview } from "@/onboarding/historical-sales-migration-service";
import { SetupStatus } from "@/onboarding/ui";
import { useSetupCentre } from "@/onboarding/use-setup-centre";
import { useAppContext } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { formatMinor } from "@/payments/money";

export const Route = createFileRoute("/menu-import")({
  head: () => ({
    meta: [
      { title: "Menu Management - Seramet" },
      {
        name: "description",
        content: "Create, import, validate and activate authoritative restaurant menu items.",
      },
    ],
  }),
  component: MenuManagement,
});

const PAGE_SIZE = 50;
type Centre = ReturnType<typeof useSetupCentre>;

function MenuManagement() {
  const centre = useSetupCentre();
  const { branchId, branchLabel, isAllBranches } = useAppContext();
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [historicalPreview, setHistoricalPreview] = useState<HistoricalSalesPreview | null>(null);
  const [previousPosName, setPreviousPosName] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return centre.menuCatalog;
    return centre.menuCatalog.filter((item) =>
      [item.code, item.sku, item.name, item.category_code].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [catalogQuery, centre.menuCatalog]);

  const visibleCatalog = filteredCatalog.slice(
    (catalogPage - 1) * PAGE_SIZE,
    catalogPage * PAGE_SIZE,
  );

  useEffect(() => {
    setCatalogPage(1);
  }, [branchId, isAllBranches]);

  const notify = (message: string, tone: "success" | "warning" = "success") => {
    setNotice(message);
    setNoticeTone(tone);
  };

  async function uploadHistoricalSales(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!previousPosName.trim()) {
      notify("Enter the name of the previous POS before selecting its export file.", "warning");
      return;
    }
    setHistoryBusy(true);
    try {
      setHistoricalPreview(await centre.previewHistoricalSales(file, previousPosName));
      notify("Previous POS sales preview is ready. Nothing has been imported yet.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Historical sales preview failed", "warning");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function commitHistoricalSales() {
    if (!historicalPreview || historyBusy) return;
    setHistoryBusy(true);
    try {
      await centre.commitHistoricalSales(historicalPreview);
      setHistoricalPreview({ ...historicalPreview, status: "COMMITTED", canCommit: false });
      notify("Previous POS sales were imported as read-only historical records.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Historical sales import failed", "warning");
    } finally {
      setHistoryBusy(false);
    }
  }

  return (
    <AppShell
      title="Menu management"
      subtitle={
        isAllBranches
          ? "Create and import the tenant menu, then control branch activation"
          : "Create, import and activate menu items - " + branchLabel
      }
      actions={
        <>
          <Btn onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" />
            Add item
          </Btn>
          <Btn variant="primary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import menu
          </Btn>
          <Btn
            onClick={() => download("seramet-menu-template-v3.csv", createCanonicalMenuTemplate())}
          >
            <Download className="h-4 w-4" />
            Template
          </Btn>
          <Btn onClick={() => void centre.refresh()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Catalog items" value={centre.menuCatalog.length} />
        <Metric label="Branches" value={centre.structure.branches.filter((item) => item.active).length} />
        <Metric label="Kitchen / bar stations" value={centre.options.stations.length} />
        <Metric label="Catalog status" value={centre.menuCatalogStatus} />
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            "mt-4 rounded-md border px-4 py-3 text-[13px] font-medium",
            noticeTone === "success"
              ? "border-success/30 bg-success-soft text-success"
              : "border-warning/30 bg-warning-soft text-warning",
          )}
        >
          {notice}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Authoritative catalog"
          sub={
            isAllBranches
              ? "Tenant-master menu records. Open a branch to inspect branch activation and pricing."
              : "Only menu records activated for the selected branch are shown."
          }
          right={<Status>{centre.menuCatalogStatus}</Status>}
        />
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={catalogQuery}
              onChange={(event) => {
                setCatalogQuery(event.target.value);
                setCatalogPage(1);
              }}
              placeholder="Search code, SKU, item or category"
              className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[12px] text-foreground"
            />
          </label>
          <div className="flex gap-2">
            <Btn onClick={() => setManualOpen(true)}>
              <Plus className="h-4 w-4" /> Add item
            </Btn>
            <Btn onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4" /> Import
            </Btn>
          </div>
        </div>
        {centre.menuCatalogStatus === "error" && (
          <div className="border-b border-danger/30 bg-danger-soft px-4 py-3 text-[12px] font-medium text-danger">
            Catalogue could not be loaded: {centre.menuCatalogError}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr>
                <TH>Code</TH>
                <TH>Item</TH>
                <TH>Category</TH>
                <TH className="text-right">Price</TH>
                <TH>Station</TH>
                <TH>Recipe</TH>
                <TH>Availability</TH>
              </tr>
            </thead>
            <tbody>
              {visibleCatalog.map((item) => (
                <tr key={item.id} className="hover:bg-secondary/40">
                  <TD className="font-semibold">{item.code}</TD>
                  <TD>
                    <div className="font-medium">{item.name}</div>
                    {item.sku && <div className="text-[11px] text-muted-foreground">SKU {item.sku}</div>}
                  </TD>
                  <TD>{item.category_code}</TD>
                  <TD className="num text-right">
                    {formatMinor(
                      item.branch_price_minor ?? item.selling_price_minor,
                      item.currency,
                    )}
                  </TD>
                  <TD>{stationName(centre, item.station_id)}</TD>
                  <TD>{item.recipe_reference ?? "Not linked"}</TD>
                  <TD>
                    <Status>
                      {item.available === 0 || item.sellable === 0 ? "Unavailable" : "Available"}
                    </Status>
                  </TD>
                </tr>
              ))}
              {!visibleCatalog.length && centre.menuCatalogStatus !== "error" && (
                <tr>
                  <TD colSpan={7} className="py-12 text-center text-muted-foreground">
                    {catalogQuery
                      ? "No catalogue items match this search."
                      : isAllBranches
                        ? "No committed tenant-master menu items exist yet."
                        : "No menu items are activated for this branch."}
                  </TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={catalogPage} total={filteredCatalog.length} onPage={setCatalogPage} />
      </Panel>

      <details className="mt-4 rounded-xl border border-border bg-card shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold">Previous POS sales migration</div>
            <div className="text-[12px] text-muted-foreground">
              Optional one-time historical migration. It never recreates kitchen, payment or stock events.
            </div>
          </div>
          <History className="h-4 w-4 text-primary" />
        </summary>
        <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
              Previous POS name
              <input
                value={previousPosName}
                onChange={(event) => {
                  setPreviousPosName(event.target.value);
                  setHistoricalPreview(null);
                }}
                maxLength={120}
                placeholder="Previous POS name"
                className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
              />
            </label>
            <label
              className={cn(
                "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-center text-[12px] font-semibold",
                historyBusy && "pointer-events-none opacity-60",
              )}
            >
              {historyBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              Choose historical sales file
              <input
                type="file"
                className="hidden"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={uploadHistoricalSales}
              />
            </label>
            <Btn
              onClick={() =>
                download("seramet-historical-sales-template.csv", createHistoricalSalesTemplate())
              }
            >
              <Download className="h-4 w-4" /> Historical template
            </Btn>
          </div>
          <div className="rounded-md border border-border p-4 text-[12px]">
            {centre.historicalSalesState?.completed ? (
              <p className="font-semibold text-success">
                Historical sales migration is complete and locked against duplicate import.
              </p>
            ) : historicalPreview ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <strong>{historicalPreview.originalName}</strong>
                  <SetupStatus value={historicalPreview.status} />
                </div>
                <p>
                  Rows {historicalPreview.rowCount.toLocaleString()} · Valid{" "}
                  {historicalPreview.validCount.toLocaleString()} · Errors{" "}
                  {historicalPreview.errorCount.toLocaleString()}
                </p>
                <Btn
                  variant="primary"
                  onClick={() => void commitHistoricalSales()}
                  disabled={!historicalPreview.canCommit || historyBusy}
                >
                  Commit historical sales once
                </Btn>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Download the historical template or choose an export from the previous POS.
              </p>
            )}
          </div>
        </div>
      </details>

      {manualOpen && (
        <ManualItemDialog
          centre={centre}
          branchId={branchId}
          isAllBranches={isAllBranches}
          onClose={() => setManualOpen(false)}
          onCommitted={() => {
            setManualOpen(false);
            notify("Menu item committed and verified in the authoritative catalogue.");
          }}
        />
      )}

      {importOpen && (
        <ImportMenuDialog
          centre={centre}
          branchId={branchId}
          isAllBranches={isAllBranches}
          onClose={() => setImportOpen(false)}
          onCommitted={(message, tone = "success") => {
            notify(message, tone);
            if (tone === "success") setImportOpen(false);
          }}
        />
      )}
    </AppShell>
  );
}

function ManualItemDialog({
  centre,
  branchId,
  isAllBranches,
  onClose,
  onCommitted,
}: {
  centre: Centre;
  branchId: string;
  isAllBranches: boolean;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const currency = centre.profile?.defaultCurrency ?? "";
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [menuSection, setMenuSection] = useState("DEFAULT");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [sellable, setSellable] = useState(true);
  const [available, setAvailable] = useState(true);
  const [targetMode, setTargetMode] = useState<ImportTargetMode>(
    isAllBranches ? "TENANT_MASTER" : "SELECTED_BRANCHES",
  );
  const [targetBranchIds, setTargetBranchIds] = useState<string[]>(isAllBranches ? [] : [branchId]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stations = useMemo(() => {
    const selected = new Set(targetBranchIds);
    return centre.options.stations.filter((row) => {
      const stationBranch = stringValue(row["branch_id"]);
      return targetMode !== "SELECTED_BRANCHES" || !selected.size || selected.has(stationBranch);
    });
  }, [centre.options.stations, targetBranchIds, targetMode]);

  const invalidate = () => {
    if (preview) setPreview(null);
    setError("");
  };

  async function validate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!currency) {
      setError("Set the business default currency before creating menu items.");
      return;
    }
    if (targetMode === "SELECTED_BRANCHES" && targetBranchIds.length === 0) {
      setError("Select at least one branch.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const file = manualMenuFile({
        code,
        name,
        sku,
        category,
        menuSection,
        description,
        price,
        currency,
        stationCode,
        sellable,
        available,
      });
      const result = await centre.previewImport(file, "MENU", "ERROR", {
        targetMode,
        targetBranchIds: targetMode === "SELECTED_BRANCHES" ? targetBranchIds : [],
      });
      setPreview(result);
      if (!result.canCommit) {
        setError(
          result.rows
            .flatMap((row) => [...row.errors, ...row.warnings])
            .map((issue) => issue.message)
            .join("; ") || "The item needs correction before it can be saved.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The item could not be validated.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview?.canCommit || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await centre.commitImport(preview);
      if (response.result.queued) {
        setError("Single-item creation was unexpectedly queued. Refresh before trying again.");
        return;
      }
      onCommitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The item could not be committed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add menu item" subtitle="Validate first, then commit the exact reviewed item." onClose={onClose}>
      <form onSubmit={validate} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item name">
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                invalidate();
              }}
              className={inputClass}
              autoFocus
            />
          </Field>
          <Field label="Item code">
            <div className="flex gap-2">
              <input
                required
                maxLength={64}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  invalidate();
                }}
                className={cn(inputClass, "min-w-0 flex-1")}
              />
              <Btn
                onClick={() => {
                  setCode(codeFromName(name));
                  invalidate();
                }}
                disabled={!name.trim()}
              >
                Generate
              </Btn>
            </div>
          </Field>
          <Field label="Category">
            <input
              required
              maxLength={80}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value.toUpperCase());
                invalidate();
              }}
              className={inputClass}
              placeholder="e.g. MAINS"
            />
          </Field>
          <Field label={"Base price" + (currency ? " (" + currency + ")" : "")}>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
                invalidate();
              }}
              className={inputClass}
            />
          </Field>
          <Field label="SKU (optional)">
            <input
              maxLength={80}
              value={sku}
              onChange={(event) => {
                setSku(event.target.value);
                invalidate();
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Menu section">
            <input
              maxLength={80}
              value={menuSection}
              onChange={(event) => {
                setMenuSection(event.target.value);
                invalidate();
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Production station">
            <select
              value={stationCode}
              onChange={(event) => {
                setStationCode(event.target.value);
                invalidate();
              }}
              className={inputClass}
            >
              <option value="">No station yet</option>
              {stations.map((station) => (
                <option key={stringValue(station["id"])} value={stringValue(station["code"])}>
                  {stringValue(station["name"])} ({stringValue(station["code"])})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Activation">
            <select
              value={targetMode}
              onChange={(event) => {
                setTargetMode(event.target.value as ImportTargetMode);
                setTargetBranchIds(
                  event.target.value === "SELECTED_BRANCHES" && !isAllBranches ? [branchId] : [],
                );
                invalidate();
              }}
              className={inputClass}
            >
              <option value="TENANT_MASTER">Tenant master only</option>
              <option value="SELECTED_BRANCHES">Activate selected branches</option>
            </select>
          </Field>
        </div>

        {targetMode === "SELECTED_BRANCHES" && (
          <BranchSelector
            branches={centre.structure.branches}
            selected={targetBranchIds}
            onChange={(next) => {
              setTargetBranchIds(next);
              invalidate();
            }}
          />
        )}

        <Field label="Description (optional)">
          <textarea
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              invalidate();
            }}
            className={textAreaClass}
          />
        </Field>

        <div className="flex flex-wrap gap-4 rounded-md border border-border p-3 text-[12px]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sellable}
              onChange={(event) => {
                setSellable(event.target.checked);
                invalidate();
              }}
              className="h-4 w-4 accent-primary"
            />
            Sellable on POS
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={available}
              onChange={(event) => {
                setAvailable(event.target.checked);
                invalidate();
              }}
              className="h-4 w-4 accent-primary"
            />
            Available after activation
          </label>
        </div>

        {preview && (
          <div className="rounded-md border border-border bg-secondary/30 p-3 text-[12px]">
            <div className="flex items-center justify-between gap-3">
              <strong>Server validation</strong>
              <SetupStatus value={preview.canCommit ? "READY" : "BLOCKED"} />
            </div>
            <p className="mt-2">
              {preview.rows[0]?.action ?? "Review"} ·{" "}
              {preview.rows[0]?.warnings.length ?? 0} warning(s) ·{" "}
              {preview.rows[0]?.errors.length ?? 0} error(s)
            </p>
          </div>
        )}
        {error && <p role="alert" className="rounded-md bg-danger-soft p-3 text-[12px] text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {preview ? "Validate again" : "Validate item"}
          </Btn>
          <Btn variant="primary" onClick={() => void save()} disabled={!preview?.canCommit || busy}>
            <CheckCircle2 className="h-4 w-4" />
            Save item
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

function ImportMenuDialog({
  centre,
  branchId,
  isAllBranches,
  onClose,
  onCommitted,
}: {
  centre: Centre;
  branchId: string;
  isAllBranches: boolean;
  onClose: () => void;
  onCommitted: (message: string, tone?: "success" | "warning") => void;
}) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [strategy, setStrategy] = useState<DuplicateStrategy>("ERROR");
  const [targetMode, setTargetMode] = useState<ImportTargetMode>(
    isAllBranches ? "TENANT_MASTER" : "SELECTED_BRANCHES",
  );
  const [targetBranchIds, setTargetBranchIds] = useState<string[]>(isAllBranches ? [] : [branchId]);
  const [stationMap, setStationMap] = useState<Record<string, string>>({});
  const [stationReferences, setStationReferences] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stationOptions = useMemo(() => {
    const selected = new Set(targetBranchIds);
    const rows = centre.options.stations.filter((station) => {
      const stationBranch = stringValue(station["branch_id"]);
      return targetMode === "ROW_BRANCHES" || !selected.size || selected.has(stationBranch);
    });
    return [...new Map(rows.map((station) => [stringValue(station["code"]), station])).values()];
  }, [centre.options.stations, targetBranchIds, targetMode]);

  function invalidate() {
    setPreview(null);
    setStationReferences([]);
    setError("");
  }

  async function runPreview(file: File) {
    if (targetMode === "SELECTED_BRANCHES" && targetBranchIds.length === 0) {
      throw new Error("Select at least one branch or choose Tenant master only.");
    }
    const result = await centre.previewImport(file, "MENU", strategy, {
      targetMode,
      targetBranchIds: targetMode === "SELECTED_BRANCHES" ? targetBranchIds : [],
      referenceMap: { stations: stationMap },
    });
    setPreview(result);
    setStationReferences(
      [
        ...new Set(
          result.rows.flatMap((row) =>
            row.errors.some((issue) => issue.code === "UNKNOWN_STATION")
              ? [stringValue(row.normalized["stationCode"])]
              : [],
          ),
        ),
      ].filter(Boolean),
    );
    if (!result.canCommit) {
      setError(
        result.errorCount > 0
          ? "The preview contains blocking errors. Correct the configuration or file before commit."
          : "",
      );
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSourceFile(file);
    setBusy(true);
    setError("");
    try {
      await runPreview(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The menu file could not be validated.");
    } finally {
      setBusy(false);
    }
  }

  async function revalidate() {
    if (!sourceFile || busy) return;
    setBusy(true);
    setError("");
    try {
      await runPreview(sourceFile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The menu file could not be validated.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview?.canCommit || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await centre.commitImport(preview);
      if (response.result.queued) {
        setPreview({ ...preview, status: "COMMITTING", canCommit: false });
        onCommitted(
          "Large import queued for durable verification. Do not treat it as committed until the catalogue refresh confirms it.",
          "warning",
        );
        return;
      }
      onCommitted("Menu import committed and verified in the authoritative catalogue.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The menu import could not be committed.");
    } finally {
      setBusy(false);
    }
  }

  const configurationRequired = stationReferences.length > 0;

  return (
    <Modal
      title="Import menu"
      subtitle="Upload → configure → review → commit. Nothing changes before the final commit."
      onClose={onClose}
      wide
    >
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Field label="Existing-code policy">
            <select
              value={strategy}
              onChange={(event) => {
                setStrategy(event.target.value as DuplicateStrategy);
                invalidate();
              }}
              className={inputClass}
            >
              <option value="ERROR">Stop on duplicate</option>
              <option value="UPDATE">Update existing only</option>
              <option value="SKIP">Skip existing</option>
              <option value="CREATE">Create new only</option>
            </select>
          </Field>
          <Field label="Import target">
            <select
              value={targetMode}
              onChange={(event) => {
                setTargetMode(event.target.value as ImportTargetMode);
                setTargetBranchIds(
                  event.target.value === "SELECTED_BRANCHES" && !isAllBranches ? [branchId] : [],
                );
                invalidate();
              }}
              className={inputClass}
            >
              <option value="TENANT_MASTER">Tenant master only</option>
              <option value="SELECTED_BRANCHES">Selected branches</option>
              <option value="ROW_BRANCHES">Branch code in each row</option>
            </select>
          </Field>

          {targetMode === "SELECTED_BRANCHES" && (
            <BranchSelector
              branches={centre.structure.branches}
              selected={targetBranchIds}
              onChange={(next) => {
                setTargetBranchIds(next);
                invalidate();
              }}
            />
          )}

          <label
            className={cn(
              "flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-5 text-center text-[13px] font-semibold hover:bg-secondary/60",
              busy && "pointer-events-none opacity-60",
            )}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5 text-primary" />}
            {sourceFile ? sourceFile.name : "Choose CSV or XLSX"}
            <span className="text-[11px] font-normal text-muted-foreground">
              Server validation enforces file type, row limits, duplicates and authoritative references.
            </span>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={upload}
              className="hidden"
            />
          </label>

          <Btn
            onClick={() => download("seramet-menu-template-v3.csv", createCanonicalMenuTemplate())}
          >
            <Download className="h-4 w-4" /> Download template
          </Btn>
        </div>

        <div className="min-w-0 space-y-4">
          {configurationRequired && (
            <div className="rounded-lg border border-warning/40 bg-warning-soft p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-warning">
                <Settings2 className="h-4 w-4" />
                Configuration required
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                The file references production stations Seramet cannot match. Map them here and
                re-run validation; the source file is not modified.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {stationReferences.map((source) => (
                  <Field key={source} label={"Source station: " + source}>
                    <select
                      value={stationMap[source] ?? ""}
                      onChange={(event) => {
                        setStationMap((current) => ({ ...current, [source]: event.target.value }));
                        setPreview(null);
                      }}
                      className={inputClass}
                    >
                      <option value="">Choose configured station</option>
                      {stationOptions.map((station) => (
                        <option
                          key={stringValue(station["id"])}
                          value={stringValue(station["code"])}
                        >
                          {stringValue(station["name"])} ({stringValue(station["code"])})
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              <Btn
                className="mt-3"
                onClick={() => void revalidate()}
                disabled={
                  busy ||
                  !sourceFile ||
                  stationReferences.some((source) => !stationMap[source])
                }
              >
                <RefreshCcw className="h-4 w-4" /> Re-run configured preview
              </Btn>
            </div>
          )}

          {!preview && !configurationRequired && (
            <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-border p-6 text-center">
              <div>
                <FileSpreadsheet className="mx-auto h-7 w-7 text-primary" />
                <p className="mt-3 text-[13px] font-semibold">Upload a file to create a safe preview</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Seramet will auto-match canonical and supported legacy headings. Any unresolved
                  operational references are configured in this dialog before commit.
                </p>
              </div>
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                <div>
                  <div className="text-[13px] font-semibold">{preview.originalName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {preview.rowCount} rows · {preview.validCount} valid · {preview.warningCount} warnings ·{" "}
                    {preview.errorCount} errors
                  </div>
                </div>
                <SetupStatus value={preview.canCommit ? "READY" : "BLOCKED"} />
              </div>
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <TH>Row</TH>
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Category</TH>
                      <TH>Action</TH>
                      <TH>Validation</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 30).map((row) => (
                      <tr key={row.rowNumber}>
                        <TD>{row.rowNumber}</TD>
                        <TD>{stringValue(row.normalized["code"])}</TD>
                        <TD>{stringValue(row.normalized["name"])}</TD>
                        <TD>{stringValue(row.normalized["categoryCode"])}</TD>
                        <TD><Status>{row.action ?? "Review"}</Status></TD>
                        <TD className="max-w-96 text-[11px] text-muted-foreground">
                          {[...row.errors, ...row.warnings]
                            .map((issue) => issue.message)
                            .join("; ") || "Validated"}
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 30 && (
                <p className="border-t border-border p-3 text-[11px] text-muted-foreground">
                  Showing the first 30 preview rows. All {preview.rowCount} rows are validated server-side.
                </p>
              )}
            </div>
          )}

          {error && <p role="alert" className="rounded-md bg-danger-soft p-3 text-[12px] text-danger">{error}</p>}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => void revalidate()} disabled={!sourceFile || busy}>
          <RefreshCcw className="h-4 w-4" /> Validate
        </Btn>
        <Btn variant="primary" onClick={() => void commit()} disabled={!preview?.canCommit || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Commit import
        </Btn>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-3 sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "max-h-[94vh] w-full overflow-y-auto rounded-xl border border-border bg-card shadow-2xl",
          wide ? "max-w-6xl" : "max-w-3xl",
        )}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-5 py-4">
          <div>
            <h2 className="text-[18px] font-bold">{title}</h2>
            {subtitle && <p className="mt-1 text-[12px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md border border-border hover:bg-secondary"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </section>
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

function BranchSelector({
  branches,
  selected,
  onChange,
}: {
  branches: Centre["structure"]["branches"];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-[12px] font-semibold text-muted-foreground">
        Activate for branches
      </legend>
      {branches
        .filter((branch) => branch.active)
        .map((branch) => (
          <label key={branch.id} className="flex items-center gap-2 text-[12px] font-medium">
            <input
              type="checkbox"
              checked={selected.includes(branch.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...new Set([...selected, branch.id])]
                    : selected.filter((id) => id !== branch.id),
                )
              }
              className="h-4 w-4 accent-primary"
            />
            <span>{branch.name}</span>
            <span className="text-muted-foreground">({branch.code})</span>
          </label>
        ))}
    </fieldset>
  );
}

function manualMenuFile(input: {
  code: string;
  name: string;
  sku: string;
  category: string;
  menuSection: string;
  description: string;
  price: string;
  currency: string;
  stationCode: string;
  sellable: boolean;
  available: boolean;
}) {
  const row: Record<(typeof menuImportHeaders)[number], string> = {
    templateVersion: String(MENU_IMPORT_TEMPLATE_VERSION),
    itemCode: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    categoryCode: input.category.trim().toUpperCase(),
    menuSection: input.menuSection.trim() || "DEFAULT",
    description: input.description.trim(),
    basePrice: input.price.trim(),
    onlinePrice: "",
    currency: input.currency,
    taxCode: "",
    serviceChargeApplicable: "false",
    unitOfMeasure: "",
    stationCode: input.stationCode,
    kitchenPrinterGroup: "",
    recipeCode: "",
    modifierGroupCode: "",
    barcode: "",
    sku: input.sku.trim(),
    sellable: String(input.sellable),
    branchCode: "",
    branchPrice: "",
    available: String(input.available),
    channels: "",
    onlinePriceChannels: "",
    prepMinutes: "0",
    parLevel: "0",
    imageFilename: "",
  };
  const csv = [
    menuImportHeaders.map(csvCell).join(","),
    menuImportHeaders.map((header) => csvCell(row[header])).join(","),
  ].join("\n");
  return new File([csv], (row.itemCode || "menu-item") + ".csv", {
    type: "text/csv",
    lastModified: Date.now(),
  });
}

function codeFromName(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function stationName(centre: Centre, id: string | null) {
  if (!id) return "Not routed";
  const station = centre.options.stations.find((row) => stringValue(row["id"]) === id);
  return station ? stringValue(station["name"]) : id;
}

function download(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Pagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
      <span>
        Page {page} of {pages} · {total.toLocaleString()} items
      </span>
      <div className="flex items-center gap-1">
        <Btn onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages}>
          <ChevronRight className="h-4 w-4" />
        </Btn>
      </div>
    </div>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary";
const textAreaClass =
  "w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus:border-primary";

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
