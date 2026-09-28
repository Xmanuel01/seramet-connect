import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Progress } from "@/components/ui/progress";
import {
  estimateImportEtaSeconds,
  summarizeImportProgress,
  type ImportProgressSnapshot,
  type PersistedImportProgress,
} from "@/onboarding/menu-import-progress";
import { ManualMenuItemDialog } from "@/components/app/ManualMenuItemDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import type { DuplicateStrategy, ImportPreview, ImportTargetMode } from "@/onboarding/types";
import { createCanonicalMenuTemplate } from "@/onboarding/menu-import-schema";
import { createHistoricalSalesTemplate } from "@/onboarding/historical-sales-import-schema";
import type { HistoricalSalesPreview } from "@/onboarding/historical-sales-migration-service";
import { SetupStatus } from "@/onboarding/ui";
import { useSetupCentre, type RecentMenuImport } from "@/onboarding/use-setup-centre";
import { useAppContext } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { formatMinor } from "@/payments/money";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/menu-import")({
  head: () => ({
    meta: [
      { title: "Menu Import - Seramet" },
      {
        name: "description",
        content: "Validate, preview and commit menu data to the authoritative tenant catalog.",
      },
    ],
  }),
  component: MenuImport,
});

const PAGE_SIZE = 50;

function MenuImport() {
  const centre = useSetupCentre();
  const { recentMenuImports, inspectImport, importStatus, refreshMenuCatalog, commitImport } =
    centre;
  const { activeTenantId, branchId, isAllBranches, currency, hasPermission } = useAppContext();
  const pendingImportKey = `seramet.menu-import.pending:${activeTenantId}`;
  const canImport = hasPermission(permissions.setupImport);
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [strategy, setStrategy] = useState<DuplicateStrategy>("ERROR");
  const [targetMode, setTargetMode] = useState<ImportTargetMode>("SELECTED_BRANCHES");
  const [masterOnlyAcknowledged, setMasterOnlyAcknowledged] = useState(false);
  const [targetBranchIds, setTargetBranchIds] = useState<string[]>(isAllBranches ? [] : [branchId]);
  const [stationMap, setStationMap] = useState<Record<string, string>>({});
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [mappingOpen, setMappingOpen] = useState(false);
  const [stationReferences, setStationReferences] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("ALL");
  const [catalogAvailability, setCatalogAvailability] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<PersistedImportProgress | null>(null);
  const [recent, setRecent] = useState<RecentMenuImport[]>([]);
  const [recentError, setRecentError] = useState("");
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const lastProgressSample = useRef<ImportProgressSnapshot | null>(null);
  const lastImportedCount = useRef(0);
  const currentProgressImport = useRef<string | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("warning");
  const [historicalPreview, setHistoricalPreview] = useState<HistoricalSalesPreview | null>(null);
  const [previousPosName, setPreviousPosName] = useState("");

  const previewRows =
    preview?.status === "COMMITTING"
      ? (preview.rows ?? []).filter((row) => row.status !== "COMMITTED" && row.status !== "SKIPPED")
      : (preview?.rows ?? []);
  const progressSummary = progress ? summarizeImportProgress(progress) : null;
  const estimatedTime =
    etaSeconds === null
      ? "Calculating from completed items"
      : etaSeconds < 60
        ? `About ${etaSeconds} seconds remaining`
        : `About ${Math.ceil(etaSeconds / 60)} minutes remaining`;
  const committedCount = centre.menuCatalog.length;
  const categoryCodes = [...new Set(centre.menuCatalog.map((item) => item.category_code))].sort();
  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return centre.menuCatalog.filter((item) => {
      if (catalogCategory !== "ALL" && item.category_code !== catalogCategory) return false;
      if (
        !isAllBranches &&
        catalogAvailability === "AVAILABLE" &&
        (item.available === 0 || item.sellable === 0)
      )
        return false;
      if (
        !isAllBranches &&
        catalogAvailability === "UNAVAILABLE" &&
        item.available !== 0 &&
        item.sellable !== 0
      )
        return false;
      if (!query) return true;
      return [item.code, item.sku, item.name, item.category_code].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query),
      );
    });
  }, [catalogQuery, catalogCategory, catalogAvailability, centre.menuCatalog, isAllBranches]);
  const visibleCatalog = filteredCatalog.slice(
    (catalogPage - 1) * PAGE_SIZE,
    catalogPage * PAGE_SIZE,
  );
  const visiblePreviewRows = previewRows.slice(
    (previewPage - 1) * PAGE_SIZE,
    previewPage * PAGE_SIZE,
  );
  const stationOptions = useMemo(() => {
    const selected = new Set(targetBranchIds);
    const values = centre.options.stations.filter((station) => {
      const stationBranch = stringValue(station["branch_id"]);
      return targetMode === "ROW_BRANCHES" || !selected.size || selected.has(stationBranch);
    });
    return [...new Map(values.map((station) => [stringValue(station["code"]), station])).values()];
  }, [centre.options.stations, targetBranchIds, targetMode]);

  useEffect(() => {
    setTargetMode("SELECTED_BRANCHES");
    setMasterOnlyAcknowledged(false);
    setTargetBranchIds(isAllBranches ? [] : [branchId]);
    setPreview(null);
    setCatalogAvailability("ALL");
    setImportOpen(false);
    setManualOpen(false);
  }, [branchId, isAllBranches]);

  useEffect(() => {
    if (!canImport) return;
    let active = true;
    void recentMenuImports()
      .then((items) => {
        if (active) setRecent(items);
      })
      .catch(() => {
        if (active) setRecentError("Import history cannot be retrieved. Do not re-upload yet.");
      });
    return () => {
      active = false;
    };
  }, [canImport, recentMenuImports]);

  const inspectPreviousImport = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const restored = await inspectImport(id);
      setPreview(restored);
      setImportOpen(true);
      setProgress(null);
      setEtaSeconds(null);
      currentProgressImport.current = null;
      if (restored.status === "COMMITTING") {
        window.sessionStorage.setItem(pendingImportKey, restored.id);
      }
      setNotice("Existing import recovered without uploading or creating a new commit.");
      setNoticeTone("success");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Existing import is unavailable. No import was restarted.",
      );
      setNoticeTone("warning");
    } finally {
      setBusy(false);
    }
  };

  // Restore a pending import after refresh without re-uploading or re-committing.
  useEffect(() => {
    const savedId = window.sessionStorage.getItem(pendingImportKey);
    if (!savedId) return;
    let active = true;
    void inspectImport(savedId)
      .then((restored) => {
        if (!active) return;
        setPreview((current) => current ?? restored);
        setImportOpen(true);
        if (restored.status === "COMMITTED" || restored.status === "FAILED") {
          window.sessionStorage.removeItem(pendingImportKey);
        }
      })
      .catch(() => {
        if (active) {
          setNotice(
            "A previous import needs checking, but its server status could not be retrieved. Do not upload it again.",
          );
          setNoticeTone("warning");
        }
      });
    return () => {
      active = false;
    };
  }, [inspectImport, pendingImportKey]);

  useEffect(() => {
    if (preview?.status !== "COMMITTING") return;
    const importId = preview.id;
    if (currentProgressImport.current !== importId) {
      currentProgressImport.current = importId;
      lastProgressSample.current = null;
      lastImportedCount.current = 0;
      setProgress(null);
      setEtaSeconds(null);
    }
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await importStatus(importId);
        if (!active) return;
        const persisted = { ...result.progress, workerStatus: result.worker?.status };
        const sample: ImportProgressSnapshot = {
          processed: persisted.processed,
          total: persisted.total,
          observedAt: Date.now(),
        };
        setProgress(persisted);
        if (result.worker?.status !== "RUNNING") setEtaSeconds(null);
        if (sample.processed > lastImportedCount.current) {
          // Only refresh after actual persisted row results change.
          lastImportedCount.current = sample.processed;
          void inspectImport(importId)
            .then((updated) => {
              if (active) setPreview((current) => (current?.id === importId ? updated : current));
            })
            .catch(() => undefined);
          void refreshMenuCatalog();
        }
        if (
          result.worker?.status === "RUNNING" &&
          lastProgressSample.current &&
          sample.processed > lastProgressSample.current.processed
        ) {
          setEtaSeconds(estimateImportEtaSeconds(lastProgressSample.current, sample));
        }
        if (
          !lastProgressSample.current ||
          sample.processed > lastProgressSample.current.processed
        ) {
          lastProgressSample.current = sample;
        }
        if (result.status === "COMMITTED" && result.verification?.status === "VERIFIED") {
          setPreview((current) =>
            current?.id === importId
              ? {
                  ...current,
                  status: "COMMITTED",
                  canCommit: false,
                  verification: result.verification,
                }
              : current,
          );
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice(
            "Menu import committed and independently verified in the authoritative catalogue.",
          );
          setNoticeTone("success");
          setCompletionOpen(true);
          void refreshMenuCatalog();
        } else if (result.status === "FAILED" || result.worker?.status === "DEAD_LETTER") {
          setPreview((current) =>
            current?.id === importId ? { ...current, status: "FAILED", canCommit: false } : current,
          );
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice(
            "Import failed or exhausted worker retries. Check worker logs and the import audit before starting another import.",
          );
          setNoticeTone("warning");
        } else if (result.status === "COMMITTING") {
          if (!result.worker && Date.now() - Date.parse(result.updatedAt) > 120_000) {
            setNotice(
              "The earlier synchronous import is still marked COMMITTING without a worker job. It may have been interrupted. Do not retry until its committed rows are audited.",
            );
          } else {
            setNotice(
              result.worker
                ? `Import is processing safely in the background (worker: ${result.worker.status}, attempts: ${result.worker.attempts}).`
                : "Server is still processing the existing import. Do not submit it again.",
            );
          }
          setNoticeTone("warning");
        } else if (result.status === "COMMITTED") {
          setNotice(
            "Server shows COMMITTED but its independent verification is unavailable. Review the import audit before proceeding.",
          );
          setNoticeTone("warning");
        } else {
          setNotice(
            "Commit result is still uncertain. Do not retry until the existing server request is resolved.",
          );
          setNoticeTone("warning");
        }
      } catch {
        if (active) {
          setNotice("Cannot check the import status right now. Do not re-upload or retry it.");
          setNoticeTone("warning");
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    importStatus,
    inspectImport,
    refreshMenuCatalog,
    pendingImportKey,
    preview?.id,
    preview?.status,
  ]);

  const invalidatePreview = (
    message = "Import settings changed. Run preview again before commit.",
  ) => {
    if (preview) setNotice(message);
    setNoticeTone("warning");
    setPreview(null);
    setMasterOnlyAcknowledged(false);
    setPreviewPage(1);
  };

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
      setNoticeTone("success");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The menu operation failed");
      setNoticeTone("warning");
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async (file: File) => {
    if (targetMode === "SELECTED_BRANCHES" && !targetBranchIds.length) {
      throw new Error("Select at least one branch or choose Tenant master only.");
    }
    setMasterOnlyAcknowledged(false);
    const result = await centre.previewImport(file, "MENU", strategy, {
      targetMode,
      targetBranchIds: targetMode === "SELECTED_BRANCHES" ? targetBranchIds : [],
      columnMap: Object.fromEntries(
        Object.entries(columnMap).filter(([, source]) => source.trim()),
      ),
      referenceMap: { stations: stationMap },
    });
    setPreview(result);
    setPreviewPage(1);
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
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSourceFile(file);
    setImportOpen(true);
    setBusy(true);
    setNotice("");
    try {
      await runPreview(file);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The menu file could not be validated");
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    if (!preview?.canCommit || busy) return;
    if (preview.targetMode === "TENANT_MASTER" && !masterOnlyAcknowledged) {
      setNoticeTone("warning");
      setNotice("Explicitly confirm master-only imports will not activate products in any branch POS.");
      return;
    }
    const pending = preview;
    setBusy(true);
    setNotice(
      "Submitting the existing preview once. You can track its status without repeating it.",
    );
    setNoticeTone("warning");
    currentProgressImport.current = pending.id;
    lastProgressSample.current = null;
    lastImportedCount.current = 0;
    setProgress(null);
    setEtaSeconds(null);
    window.sessionStorage.setItem(pendingImportKey, pending.id);
    void commitImport(pending)
      .then((response) => {
        if (response.result.queued) {
          setPreview({ ...pending, status: "COMMITTING", canCommit: false });
          setNotice(
            `Menu import queued as ${response.result.jobId ?? "a durable worker job"}. Its status will update automatically.`,
          );
          return;
        }
        if (response.result.verification?.status !== "VERIFIED") {
          throw new Error(
            "Commit returned without verified catalogue confirmation. Inspect the existing import before retrying.",
          );
        }
        setPreview({
          ...pending,
          status: "COMMITTED",
          canCommit: false,
          verification: response.result.verification,
        });
        window.sessionStorage.removeItem(pendingImportKey);
        setNotice("Menu import committed and verified in the authoritative catalogue.");
        setNoticeTone("success");
        setCompletionOpen(true);
      })
      .catch(async (error: unknown) => {
        const result = await importStatus(pending.id).catch(() => null);
        if (result?.status === "COMMITTED" && result.verification?.status === "VERIFIED") {
          setPreview({
            ...pending,
            status: "COMMITTED",
            canCommit: false,
            verification: result.verification,
          });
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice("Menu import was verified despite a lost commit response.");
          setNoticeTone("success");
          void refreshMenuCatalog();
          return;
        }
        if (result?.status === "FAILED") {
          setPreview({ ...pending, status: "FAILED", canCommit: false });
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice("Import failed. Review the failure before revalidating or retrying the file.");
        } else if (!result || result.status === "COMMITTING") {
          setPreview({ ...pending, status: "COMMITTING", canCommit: false });
          setNotice(
            "Commit response was interrupted. Checking the existing import; do not submit it again.",
          );
        } else {
          setPreview({ ...pending, canCommit: false });
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice(
            (error instanceof Error ? error.message : "Import request failed") +
              " Revalidate the existing file only after reviewing this result.",
          );
        }
        setNoticeTone("warning");
      })
      .finally(() => setBusy(false));
  };

  const uploadHistoricalSales = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!previousPosName.trim()) {
      setNotice("Enter the name of the previous POS before selecting its export file.");
      setNoticeTone("warning");
      return;
    }
    await run(async () => {
      setHistoricalPreview(await centre.previewHistoricalSales(file, previousPosName));
    }, "Previous POS sales preview is ready. Nothing has been imported yet.");
  };

  const commitHistoricalSales = () => {
    if (!historicalPreview) return;
    void run(async () => {
      await centre.commitHistoricalSales(historicalPreview);
      setHistoricalPreview({ ...historicalPreview, status: "COMMITTED", canCommit: false });
    }, "Previous POS sales were imported as read-only historical records.");
  };

  return (
    <AppShell
      title="Menu import"
      subtitle="Secure preview, validation and explicit server commit"
      actions={
        <>
          <Btn onClick={() => setManualOpen(true)} disabled={!canImport || busy}>
            <Plus className="h-4 w-4" />
            Add item
          </Btn>
          <Btn variant="primary" onClick={() => setImportOpen(true)} disabled={!canImport || busy}>
            <Upload className="h-4 w-4" />
            Import menu
          </Btn>
          <Btn
            onClick={() => download("seramet-menu-template-v3.csv", createCanonicalMenuTemplate())}
          >
            <Download className="h-4 w-4" />
            Template
          </Btn>
          <Btn onClick={() => void centre.refresh()} disabled={busy} title="Refresh catalog">
            <RefreshCcw className={cn("h-4 w-4", busy && "animate-spin")} />
            Refresh
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric
          label="Catalog items"
          value={centre.menuCatalogStatus === "ready" ? committedCount : "Unavailable"}
        />
        <Metric label="Rows read" value={preview?.rowCount ?? 0} />
        <Metric label="Valid" value={preview?.validCount ?? 0} />
        <Metric label="Warnings" value={preview?.warningCount ?? 0} />
        <Metric label="Errors" value={preview?.errorCount ?? 0} />
      </div>

      {!canImport && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-warning/30 p-3 text-[12px] text-warning"
        >
          Your current role cannot create or import menu items. An authorized account owner must
          grant the menu import permission; do not use a different employee login to bypass it.
        </p>
      )}
      {notice && (
        <div
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

      {canImport && (
        <Panel className="mt-4">
          <PanelHead
            title="Existing menu imports"
            sub="Resume or inspect an existing preview. Never re-upload a file just to check a pending commit."
            right={<History className="h-4 w-4 text-primary" />}
          />
          {recentError && (
            <p className="px-4 py-2 text-[12px] text-warning" role="alert">
              {recentError}
            </p>
          )}
          {recent.length === 0 && !recentError ? (
            <p className="px-4 py-3 text-[12px] text-muted-foreground">
              No recent menu imports found.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="min-w-0 text-[12px]">
                    <p className="truncate font-semibold">{item.originalName}</p>
                    <p className="text-muted-foreground">
                      {item.rowCount} rows · v{item.templateVersion} · {item.status} ·{" "}
                      {item.duplicateStrategy}
                    </p>
                  </div>
                  <Btn disabled={busy} onClick={() => void inspectPreviousImport(item.id)}>
                    {item.status === "COMMITTING" ? "Track existing job" : "Inspect"}
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
      <div className="mt-4 grid gap-4">
        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHead
              title="Authoritative catalog"
              sub={
                isAllBranches
                  ? "Committed tenant-master records; branch activation is shown in branch context"
                  : "Committed records explicitly activated for the current branch"
              }
              right={<Status>{centre.menuCatalogStatus}</Status>}
            />
            <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              {centre.menuCatalogStatus === "ready"
                ? filteredCatalog.length + " authorized catalog items match the selected filters."
                : "The catalogue is not yet available; no item total can be verified."}
            </p>
            <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
              <label className="relative block min-w-48 flex-1 sm:max-w-sm">
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
              <label className="grid gap-1 text-[12px]">
                Category
                <select
                  value={catalogCategory}
                  onChange={(event) => {
                    setCatalogCategory(event.target.value);
                    setCatalogPage(1);
                  }}
                  className="h-9 min-w-36 rounded-md border border-border bg-card px-3"
                >
                  <option value="ALL">All categories</option>
                  {categoryCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[12px]">
                POS availability
                <select
                  disabled={isAllBranches}
                  value={catalogAvailability}
                  onChange={(event) => {
                    setCatalogAvailability(event.target.value);
                    setCatalogPage(1);
                  }}
                  className="h-9 min-w-36 rounded-md border border-border bg-card px-3"
                >
                  <option value="ALL">All</option>
                  <option value="AVAILABLE">Available</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>
              </label>
            </div>
            {centre.menuCatalogStatus === "error" && (
              <div className="border-b border-danger/30 bg-danger-soft px-4 py-3 text-[12px] font-medium text-danger">
                Catalogue could not be loaded: {centre.menuCatalogError}
                <Btn className="ml-3" onClick={() => void centre.refresh()} disabled={busy}>
                  Retry loading
                </Btn>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <TH>Code</TH>
                    <TH>Item</TH>
                    <TH>Category</TH>
                    <TH className="text-right">Price</TH>
                    <TH>Recipe</TH>
                    <TH>Availability</TH>
                  </tr>
                </thead>
                <tbody>
                  {visibleCatalog.map((item) => (
                    <tr key={item.id} className="hover:bg-secondary/40">
                      <TD className="font-semibold">{item.code}</TD>
                      <TD>{item.name}</TD>
                      <TD>{item.category_code}</TD>
                      <TD className="num text-right">
                        {formatMoney(
                          item.branch_price_minor ?? item.selling_price_minor,
                          item.currency,
                        )}
                      </TD>
                      <TD>{item.recipe_reference ?? "Not linked"}</TD>
                      <TD>
                        <Status>
                          {isAllBranches
                            ? "Select branch"
                            : item.available === 0 || item.sellable === 0
                              ? "Unavailable"
                              : "Available"}
                        </Status>
                      </TD>
                    </tr>
                  ))}
                  {!visibleCatalog.length && centre.menuCatalogStatus !== "error" && (
                    <tr>
                      <TD colSpan={6} className="py-10 text-center text-muted-foreground">
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
        </div>
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Previous POS sales migration"
          sub="Optional, one-time transfer of historical sales; it does not replay kitchen, stock, payment or journal activity"
          right={<History className="h-4 w-4 text-primary" />}
        />
        <div className="grid gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            {centre.historicalSalesState?.completed ? (
              <div className="rounded-md border border-success/30 bg-success-soft p-3 text-[12px] font-medium text-success">
                Previous POS sales migration is complete and locked against a second import.
              </div>
            ) : (
              <>
                <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
                  Previous POS name
                  <input
                    value={previousPosName}
                    onChange={(event) => {
                      setPreviousPosName(event.target.value);
                      setHistoricalPreview(null);
                    }}
                    maxLength={120}
                    placeholder="Name shown in the old export"
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
                  />
                </label>
                <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-center text-[12px] font-semibold hover:bg-secondary/60">
                  <Upload className="h-5 w-5 text-primary" />
                  Choose previous POS sales file
                  <span className="font-normal text-muted-foreground">
                    CSV and Excel .xlsx are supported
                  </span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => void uploadHistoricalSales(event)}
                    className="hidden"
                    disabled={busy}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Btn
                    onClick={() =>
                      download(
                        "seramet-previous-pos-sales-template-v1.csv",
                        createHistoricalSalesTemplate(),
                      )
                    }
                  >
                    <Download className="h-4 w-4" />
                    Template
                  </Btn>
                  <Btn
                    onClick={() =>
                      void run(
                        () => centre.skipHistoricalSales("No previous POS sales to migrate"),
                        "Previous POS sales migration skipped. You can return before importing later.",
                      )
                    }
                    disabled={busy}
                  >
                    Skip for now
                  </Btn>
                </div>
                <Btn
                  variant="primary"
                  className="w-full"
                  onClick={commitHistoricalSales}
                  disabled={!historicalPreview?.canCommit || busy}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Import historical sales once
                </Btn>
              </>
            )}
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <TH>Row</TH>
                  <TH>Reference</TH>
                  <TH>Branch</TH>
                  <TH>Date</TH>
                  <TH className="text-right">Gross</TH>
                  <TH className="text-right">Net</TH>
                  <TH>Status</TH>
                  <TH>Validation</TH>
                </tr>
              </thead>
              <tbody>
                {historicalPreview?.rows.slice(0, 25).map((row) => (
                  <tr key={`${row.rowNumber}-${row.rowKey}`}>
                    <TD className="num">{row.rowNumber}</TD>
                    <TD className="font-semibold">{row.normalized.externalSaleReference}</TD>
                    <TD>{row.normalized.branchCode}</TD>
                    <TD>{row.normalized.businessDate}</TD>
                    <TD className="num text-right">
                      {formatMoney(row.normalized.grossSalesMinor, row.normalized.currency)}
                    </TD>
                    <TD className="num text-right">
                      {formatMoney(row.normalized.netSalesMinor, row.normalized.currency)}
                    </TD>
                    <TD>
                      <SetupStatus value={row.status} />
                    </TD>
                    <TD className="max-w-80 text-[11px] text-muted-foreground">
                      {[...row.errors, ...row.warnings].map((issue) => issue.message).join("; ") ||
                        "Validated"}
                    </TD>
                  </tr>
                ))}
                {!historicalPreview?.rows.length && (
                  <tr>
                    <TD colSpan={8} className="py-10 text-center text-muted-foreground">
                      Optional. Export past sales from the old POS, then preview them here before
                      importing.
                    </TD>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Dialog open={importOpen} onOpenChange={(next) => !busy && setImportOpen(next)}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,960px)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import menu</DialogTitle>
            <DialogDescription>
              Set the target, choose a CSV or Excel file, review server validation and explicitly
              confirm. No changes are saved at the preview stage.
            </DialogDescription>
          </DialogHeader>
          <Panel className="h-fit">
            <PanelHead
              title="Import source"
              sub="CSV or XLSX; files are validated before any data changes"
              right={<FileSpreadsheet className="h-4 w-4 text-primary" />}
            />
            <div className="space-y-4 p-4">
              <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
                Existing-code policy
                <select
                  value={strategy}
                  onChange={(event) => {
                    setStrategy(event.target.value as DuplicateStrategy);
                    invalidatePreview();
                  }}
                  className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
                >
                  <option value="ERROR">Stop on duplicate</option>
                  <option value="UPDATE">Update existing only</option>
                  <option value="SKIP">Skip existing</option>
                  <option value="CREATE">Create new</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
                Import target
                <select
                  value={targetMode}
                  onChange={(event) => {
                    setTargetMode(event.target.value as ImportTargetMode);
                    setMasterOnlyAcknowledged(false);
                    invalidatePreview();
                  }}
                  className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
                >
                  <option value="TENANT_MASTER">Tenant master only</option>
                  <option value="SELECTED_BRANCHES">Selected branches</option>
                  <option value="ROW_BRANCHES">Branch code in each row</option>
                </select>
              </label>
              {targetMode === "SELECTED_BRANCHES" && (
                <fieldset className="grid gap-2 rounded-md border border-border p-3">
                  <legend className="px-1 text-[12px] font-semibold text-muted-foreground">
                    Activate for branches
                  </legend>
                  {centre.structure.branches.map((branch) => (
                    <label
                      key={branch.id}
                      className="flex items-center gap-2 text-[12px] font-medium"
                    >
                      <input
                        type="checkbox"
                        checked={targetBranchIds.includes(branch.id)}
                        onChange={(event) => {
                          setTargetBranchIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, branch.id])]
                              : current.filter((id) => id !== branch.id),
                          );
                          invalidatePreview();
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                      {branch.name}
                      <span className="text-muted-foreground">({branch.code})</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <label
                className={cn(
                  "flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-6 text-center text-[13px] font-semibold hover:bg-secondary/60",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <Upload className="h-5 w-5 text-primary" />
                )}
                {busy ? "Validating on server..." : "Choose menu file"}
                <span className="text-[11px] font-normal text-muted-foreground">
                  File size, type, workbook shape and row limits are enforced.
                </span>
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={upload}
                  className="hidden"
                />
              </label>
              <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px] leading-5 text-muted-foreground">
                Required: item code, name, category and base price. Tenant-master items do not
                appear in POS until explicitly activated for a branch. Station, recipe, tax and
                channel references are validated against authoritative configuration.
              </div>
              <div className="rounded-md border border-border p-3">
                <Btn
                  onClick={() => setMappingOpen((previous) => !previous)}
                  title="Map another POS export to Seramet menu fields"
                >
                  {mappingOpen ? "Hide column mapping" : "Match file columns"}
                </Btn>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  For exports from another POS, enter their exact spreadsheet headings. Seramet
                  already recognizes common names such as Name, Category and Price.
                </p>
                {mappingOpen && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                      ["itemCode", "Item code / SKU"],
                      ["name", "Item name"],
                      ["categoryCode", "Category"],
                      ["basePrice", "Selling price"],
                      ["stationCode", "Kitchen / bar station"],
                      ["branchCode", "Location / branch"],
                      ["onlinePrice", "Online price"],
                      ["description", "Description"],
                    ].map(([field, label]) => (
                      <label key={field} className="grid gap-1 text-[12px] font-semibold">
                        {label}
                        <input
                          value={columnMap[field] ?? ""}
                          placeholder="Heading in source file"
                          onChange={(event) => {
                            setColumnMap((previous) => ({
                              ...previous,
                              [field]: event.target.value,
                            }));
                            invalidatePreview(
                              "Column mappings changed. Revalidate the original file before committing.",
                            );
                          }}
                          className="h-9 rounded-md border border-border bg-card px-2"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {stationReferences.length > 0 && (
                <div className="grid gap-3 rounded-md border border-warning/30 bg-warning-soft p-3">
                  <div className="text-[12px] font-semibold text-warning">Map unknown stations</div>
                  {stationReferences.map((source) => (
                    <label key={source} className="grid gap-1 text-[11px] text-muted-foreground">
                      {source}
                      <select
                        value={stationMap[source] ?? ""}
                        onChange={(event) => {
                          setStationMap((current) => ({
                            ...current,
                            [source]: event.target.value,
                          }));
                          invalidatePreview(
                            "Station mapping changed. Run preview again to validate it.",
                          );
                        }}
                        className="h-9 rounded-md border border-border bg-card px-2 text-[12px] text-foreground"
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
                    </label>
                  ))}
                  <Btn
                    onClick={() =>
                      sourceFile &&
                      void run(async () => runPreview(sourceFile), "Preview refreshed.")
                    }
                    disabled={!sourceFile || busy}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Run preview again
                  </Btn>
                </div>
              )}
              {preview && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold">{preview.originalName}</div>
                    <div className="text-[11px] text-muted-foreground">Preview {preview.id}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Template v{preview.templateVersion ?? 1} |{" "}
                      {preview.targetMode ?? "TENANT_MASTER"}
                    </div>
                  </div>
                  <SetupStatus value={preview.status} />
                </div>
              )}
            </div>
          </Panel>
          {preview && (
            <Panel>
              <PanelHead
                title="Import preview"
                sub={
                  preview?.status === "COMMITTING"
                    ? "Server-side import in progress. Do not re-submit the same preview."
                    : "Nothing is persisted until Commit import is selected"
                }
                right={
                  preview ? (
                    <SetupStatus
                      value={
                        preview.status === "COMMITTING"
                          ? "COMMITTING"
                          : preview.canCommit
                            ? "READY"
                            : "BLOCKED"
                      }
                    />
                  ) : (
                    <Status>Pending</Status>
                  )
                }
              />
              {preview.status === "COMMITTING" && progressSummary && (
                <section
                  aria-label="Authoritative import progress"
                  className="space-y-2 border-b border-border px-4 py-3"
                >
                  <div className="flex items-center justify-between text-[12px] font-medium">
                    <span>
                      {progressSummary.stage === "QUEUED"
                        ? "Waiting for the import worker"
                        : progressSummary.stage === "VERIFYING"
                          ? "Verifying the committed menu"
                          : "Importing menu items"}
                    </span>
                    <span className="tabular-nums">{progressSummary.percent}%</span>
                  </div>
                  <Progress
                    value={progressSummary.percent}
                    aria-label="Menu import completion"
                    aria-valuetext={`${progressSummary.processed} of ${progressSummary.total} rows processed`}
                  />
                  <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">
                      {progressSummary.processed}/{progressSummary.total} processed ·{" "}
                      {progress?.created} created · {progress?.updated} updated ·{" "}
                      {progress?.skipped} skipped · {progress?.failed} failed
                    </span>
                    <span>
                      {progress?.workerStatus === "RUNNING" && progressSummary.pending > 0
                        ? estimatedTime
                        : progressSummary.stage === "QUEUED"
                          ? "Waiting for worker; ETA unavailable"
                          : "Awaiting verified completion"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    You can continue in the background. The progress shown is based on rows recorded
                    in the database, not an estimated animation.
                  </p>
                </section>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr>
                      <TH>Row</TH>
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Category</TH>
                      <TH className="text-right">Price</TH>
                      <TH>Action</TH>
                      <TH>Status</TH>
                      <TH>Validation</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePreviewRows.map((row) => (
                      <tr key={`${row.rowNumber}-${row.rowKey}`} className="hover:bg-secondary/40">
                        <TD className="num">{row.rowNumber}</TD>
                        <TD className="font-semibold">{stringValue(row.normalized["code"])}</TD>
                        <TD>{stringValue(row.normalized["name"])}</TD>
                        <TD>{stringValue(row.normalized["categoryCode"])}</TD>
                        <TD className="num text-right">
                          {formatMoney(
                            numberValue(row.normalized["sellingPriceMinor"]),
                            stringValue(row.normalized["currency"]),
                          )}
                        </TD>
                        <TD>
                          <Status>{row.action ?? "Review"}</Status>
                        </TD>
                        <TD>
                          <SetupStatus value={row.status} />
                        </TD>
                        <TD className="max-w-80 text-[11px] text-muted-foreground">
                          {[...row.errors, ...row.warnings]
                            .map((issue) => issue.message)
                            .join("; ") || "Validated"}
                        </TD>
                      </tr>
                    ))}
                    {!previewRows.length && (
                      <tr>
                        <TD colSpan={8} className="py-10 text-center text-muted-foreground">
                          Upload a file to create a server-side preview.
                        </TD>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={previewPage} total={previewRows.length} onPage={setPreviewPage} />
            </Panel>
          )}

          {notice && (
            <p
              role="status"
              className={cn(
                "text-[12px]",
                noticeTone === "success" ? "text-success" : "text-warning",
              )}
            >
              {notice}
            </p>
          )}
          {preview && (
            <div className="space-y-2 rounded-md border border-border p-3 text-[12px]">
              <p className="font-semibold">Activation targets before committing</p>
              {preview.targetMode === "TENANT_MASTER" ? (
                <label className="flex items-start gap-2 text-warning">
                  <input
                    type="checkbox"
                    checked={masterOnlyAcknowledged}
                    onChange={(event) => setMasterOnlyAcknowledged(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  I understand master-only items will NOT appear in branch POS until
                  explicitly activated.
                </label>
              ) : preview.targetMode === "SELECTED_BRANCHES" ? (
                <p>
                  POS activation targets:{" "}
                  {(preview.targetBranchIds ?? [])
                    .map(
                      (id) =>
                        centre.structure.branches.find((branch) => branch.id === id)?.name ??
                        "Unknown branch",
                    )
                    .join(", ") || "NONE — choose branches and revalidate"}
                </p>
              ) : (
                <p>Row-level activation requires each row to specify a validated branch code.</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Btn disabled={busy} onClick={() => setImportOpen(false)}>
              {preview?.status === "COMMITTING" ? "Continue in background" : "Close"}
            </Btn>
            <Btn
              disabled={!sourceFile || busy}
              onClick={() =>
                sourceFile && void run(() => runPreview(sourceFile), "Server preview refreshed.")
              }
            >
              Revalidate
            </Btn>
            <Btn
              variant="primary"
              onClick={commit}
              disabled={
                !preview?.canCommit ||
                !canImport ||
                busy ||
                (preview.targetMode === "TENANT_MASTER" && !masterOnlyAcknowledged)
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Commit import
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={completionOpen} onOpenChange={setCompletionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Menu import completed</DialogTitle>
            <DialogDescription>
              Seramet has independently verified the imported records in the authoritative
              catalogue. Review any skipped or previously existing items before opening sales.
            </DialogDescription>
          </DialogHeader>
          {progressSummary && (
            <p className="text-[13px] tabular-nums" role="status">
              {progressSummary.processed} of {progressSummary.total} processed. {progress?.created}{" "}
              created, {progress?.updated} updated and {progress?.skipped} skipped.
            </p>
          )}
          <DialogFooter>
            <Btn
              variant="primary"
              onClick={() => {
                setCompletionOpen(false);
                setImportOpen(false);
              }}
            >
              View menu
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ManualMenuItemDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        initialBranchId={isAllBranches ? "" : branchId}
        branches={centre.structure.branches
          .filter((branch) => branch.active)
          .map((branch) => ({
            id: branch.id,
            name: branch.name,
          }))}
        currency={centre.profile?.defaultCurrency || currency}
        categoryCodes={categoryCodes}
        stations={centre.options.stations.map((station) => ({
          id: stringValue(station["id"]),
          name: stringValue(station["name"]),
          code: stringValue(station["code"]),
          branch_id: stringValue(station["branch_id"]),
        }))}
        previewImport={(file, targetBranchId) =>
          centre.previewImport(file, "MENU", "ERROR", {
            targetMode: "SELECTED_BRANCHES",
            targetBranchIds: [targetBranchId],
          })
        }
        commitImport={centre.commitImport}
        onCommitted={() => {
          setNotice("Menu item saved and verified. Check the authoritative catalogue.");
          setNoticeTone("success");
        }}
      />
    </AppShell>
  );
}

function download(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatMoney(value: number, currency: string) {
  if (!/^[A-Z]{3}$/.test(currency)) return (value / 100).toLocaleString();
  return formatMinor(value, currency);
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
        {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Btn
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Btn>
        <span className="min-w-16 text-center">
          Page {page} of {pages}
        </span>
        <Btn
          onClick={() => onPage(Math.min(pages, page + 1))}
          disabled={page >= pages}
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Btn>
      </div>
    </div>
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
