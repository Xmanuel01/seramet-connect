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
  importPresentationStage,
  summarizeImportProgress,
  type ImportProgressSnapshot,
  type PersistedImportProgress,
} from "@/onboarding/menu-import-progress";
import { ManualMenuItemDialog } from "@/components/app/ManualMenuItemDialog";
import { MenuItemEditDialog } from "@/components/app/MenuItemEditDialog";
import type { SetupMenuCatalogItem } from "@/onboarding/use-setup-centre";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Btn, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
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
      { title: "Imports - Seramet" },
      {
        name: "description",
        content: "Bring your menu and past sales into Seramet from a spreadsheet.",
      },
    ],
  }),
  component: MenuImport,
});

const PAGE_SIZE = 50;

/** One page for every kind of import; each kind is a section. */
const importSections = ["Menu", "Past sales"] as const;
type ImportSection = (typeof importSections)[number];

/** Saved and checked, waiting only to be put on the menu. */
function isReadyForMenu(preview: ImportPreview) {
  return (
    preview.status === "COMMITTED" &&
    preview.verification?.status === "VERIFIED" &&
    preview.publishStatus === "READY"
  );
}

function importStatusLabel(status: string) {
  switch (status) {
    case "VALIDATED":
      return "Ready to import";
    case "COMMITTING":
      return "Importing";
    case "COMMITTED":
      return "Imported";
    case "FAILED":
      return "Did not finish";
    default:
      return "Needs fixing";
  }
}

function rowChangeLabel(action: string | undefined) {
  switch (action) {
    case "CREATE":
      return "New item";
    case "UPDATE":
      return "Update";
    case "SKIP":
    case "NO_CHANGE":
      return "No change";
    default:
      return "";
  }
}

function rowStatusLabel(status: string) {
  switch (status) {
    case "VALID":
      return "Ready";
    case "WARNING":
      return "Check";
    case "COMMITTED":
      return "Imported";
    case "SKIPPED":
      return "Skipped";
    default:
      return "Fix";
  }
}

function MenuImport() {
  const centre = useSetupCentre();
  const {
    recentMenuImports,
    inspectImport,
    importStatus,
    refreshMenuCatalog,
    commitImport,
    publishImport,
  } = centre;
  const { activeTenantId, branchId, isAllBranches, currency, hasPermission } = useAppContext();
  const pendingImportKey = `seramet.menu-import.pending:${activeTenantId}`;
  const canManageMenu = hasPermission(permissions.setupImport);
  const canImport = canManageMenu && centre.fileImportCapability.available;
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SetupMenuCatalogItem | null>(null);
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
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const lastProgressSample = useRef<ImportProgressSnapshot | null>(null);
  const lastImportedCount = useRef(0);
  const currentProgressImport = useRef<string | null>(null);
  const [section, setSection] = useState<ImportSection>("Menu");
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Imports already added to the menu from this page, so each is only sent once.
  const addedToMenu = useRef(new Set<string>());
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
      .catch(() => undefined);
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
      if (isReadyForMenu(restored)) addToMenu(restored);
      else setNotice("");
      setNoticeTone("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That import can't be opened right now.");
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
        if (isReadyForMenu(restored)) {
          addToMenu(restored);
        } else if (restored.publishStatus === "PUBLISHED") {
          setNotice("Menu imported. Your items are ready.");
          setNoticeTone("success");
          window.sessionStorage.removeItem(pendingImportKey);
        } else if (restored.status === "FAILED" || restored.rowCount === 0) {
          // An empty import has nothing to resume; stop reopening it.
          window.sessionStorage.removeItem(pendingImportKey);
        }
      })
      .catch(() => {
        if (active) {
          setNotice("Your last import is still being checked. This page will update.");
          setNoticeTone("warning");
        }
      });
    return () => {
      active = false;
    };
    // Runs once per import to pick up where the page left off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectImport, pendingImportKey]);

  useEffect(() => {
    if (preview?.status !== "COMMITTING" && preview?.publishStatus !== "PUBLISHING") return;
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
          // Progress counts are authoritative. Inspect the full snapshot only in
          // the terminal branches below, so an older inspection cannot stop polling.
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
        const stage = importPresentationStage(result);
        if (stage === "PUBLISHED") {
          const published = await inspectImport(importId);
          if (!active) return;
          setPreview(published);
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice("Menu imported. Your items are ready.");
          setNoticeTone("success");
          setImportOpen(false);
          void refreshMenuCatalog();
        } else if (stage === "PUBLISHING") {
          setPreview((current) =>
            current?.id === importId
              ? { ...current, status: "COMMITTED", publishStatus: "PUBLISHING" }
              : current,
          );
          setNotice("Adding your items to the menu…");
          setNoticeTone("warning");
        } else if (stage === "STAGED") {
          // Saved and checked: add the items to the menu without a second confirmation.
          const staged = await inspectImport(importId);
          if (!active) return;
          addToMenu(staged);
        } else if (result.status === "FAILED" || result.worker?.status === "DEAD_LETTER") {
          setPreview((current) =>
            current?.id === importId ? { ...current, status: "FAILED", canCommit: false } : current,
          );
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice(
            "The import did not finish, so nothing was added to your menu. Check the file and try again.",
          );
          setNoticeTone("warning");
        } else {
          setNotice("Importing your menu. You can keep working; this finishes by itself.");
          setNoticeTone("warning");
        }
      } catch {
        if (active) {
          setNotice(
            "Can't check the import right now. It keeps running and this page will update.",
          );
          setNoticeTone("warning");
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // addToMenu only reads refs and stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    importStatus,
    inspectImport,
    refreshMenuCatalog,
    pendingImportKey,
    preview?.id,
    preview?.publishStatus,
    preview?.status,
  ]);

  const invalidatePreview = (
    message = "Options changed. Choose the file again to re-check it.",
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
      throw new Error("Choose at least one branch for these items.");
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
      setNotice("Tick the box to confirm these items won't show at any branch yet.");
      return;
    }
    const pending = preview;
    setBusy(true);
    setNotice("Importing your menu…");
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
          setNotice("Importing your menu. You can keep working; this finishes by itself.");
          return;
        }
        // Already saved by an earlier attempt: carry on from where it stopped.
        setPreview({ ...pending, status: "COMMITTING", canCommit: false });
      })
      .catch(async (error: unknown) => {
        const result = await importStatus(pending.id).catch(() => null);
        if (result?.status === "FAILED") {
          setPreview({ ...pending, status: "FAILED", canCommit: false });
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice(
            "The import did not finish, so nothing was added to your menu. Check the file and try again.",
          );
        } else if (!result || result.status === "COMMITTING" || result.status === "COMMITTED") {
          // The request was cut off but the import carried on: keep following it.
          setPreview({ ...pending, status: "COMMITTING", canCommit: false });
          setNotice("Importing your menu. You can keep working; this finishes by itself.");
        } else {
          setPreview({ ...pending, canCommit: false });
          window.sessionStorage.removeItem(pendingImportKey);
          setNotice(error instanceof Error ? error.message : "The import could not start.");
        }
        setNoticeTone("warning");
      })
      .finally(() => setBusy(false));
  };

  // A saved, checked import goes onto the menu by itself; the server does the same after a
  // fresh import, and repeating the request is harmless.
  function addToMenu(staged: ImportPreview) {
    setPreview({ ...staged, publishStatus: "PUBLISHING" });
    setNotice("Adding your items to the menu…");
    setNoticeTone("warning");
    window.sessionStorage.setItem(pendingImportKey, staged.id);
    if (!staged.publishKey || addedToMenu.current.has(staged.id)) return;
    addedToMenu.current.add(staged.id);
    void publishImport(staged)
      .then((response) => {
        if (response.result?.status !== "PUBLISHED") return;
        setPreview({ ...staged, publishStatus: "PUBLISHED" });
        window.sessionStorage.removeItem(pendingImportKey);
        setNotice("Menu imported. Your items are ready.");
        setNoticeTone("success");
        setImportOpen(false);
        void refreshMenuCatalog();
      })
      .catch(() => {
        // The status check keeps following the import and reports how it ends.
      });
  }

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
    }, "Check the preview, then import. Nothing has been saved yet.");
  };

  const commitHistoricalSales = () => {
    if (!historicalPreview) return;
    void run(async () => {
      await centre.commitHistoricalSales(historicalPreview);
      setHistoricalPreview({ ...historicalPreview, status: "COMMITTED", canCommit: false });
    }, "Past sales imported. They show in your reports.");
  };

  return (
    <AppShell
      title="Imports"
      actions={
        <>
          <Btn onClick={() => setManualOpen(true)} disabled={!canManageMenu || busy}>
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
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border" role="tablist">
        {importSections.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={section === name}
            onClick={() => setSection(name)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
              section === name
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {!canImport && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-warning/30 p-3 text-[12px] text-warning"
        >
          {canManageMenu
            ? centre.fileImportCapability.reason
            : "Your role can't import or add menu items. Ask the account owner for access."}
        </p>
      )}
      {notice && !importOpen && (
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

      {section === "Menu" && canImport && recent.length > 0 && (
        <Panel className="mt-4">
          <PanelHead title="Recent imports" right={<History className="h-4 w-4 text-primary" />} />
          {
            <div className="divide-y divide-border">
              {recent.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="min-w-0 text-[12px]">
                    <p className="truncate font-semibold">{item.originalName}</p>
                    <p className="text-muted-foreground">
                      {item.rowCount} items · {importStatusLabel(item.status)}
                    </p>
                  </div>
                  <Btn disabled={busy} onClick={() => void inspectPreviousImport(item.id)}>
                    Open
                  </Btn>
                </div>
              ))}
            </div>
          }
        </Panel>
      )}
      <div className={cn("mt-4 grid gap-4", section !== "Menu" && "hidden")}>
        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHead
              title="Your menu"
              sub={
                centre.menuCatalogStatus === "ready"
                  ? `${filteredCatalog.length} of ${committedCount} items${isAllBranches ? "" : " at this branch"}`
                  : "Loading your menu…"
              }
            />
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
                Your menu could not be loaded.
                <Btn className="ml-3" onClick={() => void centre.refresh()} disabled={busy}>
                  Try again
                </Btn>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <TH className="w-12">
                      <span className="sr-only">Photo</span>
                    </TH>
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
                    <tr
                      key={item.id}
                      tabIndex={0}
                      aria-label={`Edit ${item.name}`}
                      onClick={() => setEditingItem(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setEditingItem(item);
                        }
                      }}
                      className="cursor-pointer hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:outline-none"
                    >
                      <TD>
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            loading="lazy"
                            className="h-9 w-9 rounded-md object-cover"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-md bg-secondary" />
                        )}
                      </TD>
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
                      <TD colSpan={7} className="py-10 text-center text-muted-foreground">
                        {catalogQuery
                          ? "No items match this search."
                          : isAllBranches
                            ? "No menu items yet. Import a file or add an item."
                            : "No menu items at this branch yet. Import a file or add an item."}
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

      <Panel className={cn("mt-4", section !== "Past sales" && "hidden")}>
        <PanelHead
          title="Past sales from your old POS"
          sub="Optional and done once. Past sales appear in reports only; stock and accounts are not changed."
          right={<History className="h-4 w-4 text-primary" />}
        />
        <div className="grid gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            {centre.historicalSalesState?.completed ? (
              <div className="rounded-md border border-success/30 bg-success-soft p-3 text-[12px] font-medium text-success">
                Your past sales are already imported.
              </div>
            ) : (
              <>
                {!centre.fileImportCapability.available && (
                  <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-[12px] font-medium text-warning">
                    {centre.fileImportCapability.reason}
                  </div>
                )}
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
                <label
                  className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-center text-[12px] font-semibold ${
                    centre.fileImportCapability.available
                      ? "cursor-pointer hover:bg-secondary/60"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
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
                    disabled={busy || !centre.fileImportCapability.available}
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
                        "Skipped. You can import past sales later from this page.",
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
                  Import past sales
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
              Choose a CSV or Excel file, check the preview, then import.
            </DialogDescription>
          </DialogHeader>
          <Panel className="h-fit">
            <div className="space-y-4 p-4">
              <label
                className={cn(
                  "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-6 text-center text-[13px] font-semibold hover:bg-secondary/60",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                )}
                {busy ? "Checking…" : preview ? "Choose a different file" : "Choose menu file"}
                <span className="text-[11px] font-normal text-muted-foreground">
                  CSV or Excel (.xlsx). Each item needs a code, name, category and price.
                </span>
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={upload}
                  className="hidden"
                />
              </label>
              <Btn onClick={() => setOptionsOpen((previous) => !previous)}>
                {optionsOpen ? "Hide options" : "More options"}
              </Btn>
              <div className={cn("space-y-4", !optionsOpen && "hidden")}>
                <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
                  If an item is already on your menu
                  <select
                    value={strategy}
                    onChange={(event) => {
                      setStrategy(event.target.value as DuplicateStrategy);
                      invalidatePreview();
                    }}
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
                  >
                    <option value="ERROR">Show it as a problem</option>
                    <option value="UPDATE">Update it</option>
                    <option value="SKIP">Leave it as it is</option>
                    <option value="CREATE">Add it as a new item</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
                  Where the items go
                  <select
                    value={targetMode}
                    onChange={(event) => {
                      setTargetMode(event.target.value as ImportTargetMode);
                      setMasterOnlyAcknowledged(false);
                      invalidatePreview();
                    }}
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
                  >
                    <option value="SELECTED_BRANCHES">The branches I choose</option>
                    <option value="ROW_BRANCHES">The branch named in each row of the file</option>
                    <option value="TENANT_MASTER">Save only, don't show at any branch yet</option>
                  </select>
                </label>
                {targetMode === "SELECTED_BRANCHES" && (
                  <fieldset className="grid gap-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-[12px] font-semibold text-muted-foreground">
                      Branches
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
                <div className="rounded-md border border-border p-3">
                  <Btn onClick={() => setMappingOpen((previous) => !previous)}>
                    {mappingOpen ? "Hide column names" : "My file uses different column names"}
                  </Btn>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Only needed for files from another POS. Common names such as Name, Category and
                    Price are recognised already.
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
                            placeholder="Column name in your file"
                            onChange={(event) => {
                              setColumnMap((previous) => ({
                                ...previous,
                                [field]: event.target.value,
                              }));
                              invalidatePreview(
                                "Columns changed. Check the file again before importing.",
                              );
                            }}
                            className="h-9 rounded-md border border-border bg-card px-2"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {stationReferences.length > 0 && (
                <div className="grid gap-3 rounded-md border border-warning/30 bg-warning-soft p-3">
                  <div className="text-[12px] font-semibold text-warning">
                    Choose the kitchen or bar station for these names in your file
                  </div>
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
                          invalidatePreview("Station chosen. Check the file again.");
                        }}
                        className="h-9 rounded-md border border-border bg-card px-2 text-[12px] text-foreground"
                      >
                        <option value="">Choose a station</option>
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
                      void run(async () => runPreview(sourceFile), "File checked again.")
                    }
                    disabled={!sourceFile || busy}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Check again
                  </Btn>
                </div>
              )}
              {preview && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold">{preview.originalName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {preview.validCount} of {preview.rowCount} items ready
                      {preview.errorCount ? ` · ${preview.errorCount} to fix` : ""}
                      {preview.warningCount ? ` · ${preview.warningCount} to check` : ""}
                    </div>
                  </div>
                  <Status>{importStatusLabel(preview.status)}</Status>
                </div>
              )}
            </div>
          </Panel>
          {preview && (
            <Panel>
              <PanelHead
                title="Preview"
                sub={
                  preview.status === "COMMITTING" || preview.publishStatus === "PUBLISHING"
                    ? "Importing…"
                    : preview.publishStatus === "PUBLISHED"
                      ? "Imported"
                      : preview.canCommit
                        ? "Nothing is saved until you press Import"
                        : "Fix the rows marked below, then choose the file again"
                }
              />
              {preview.status === "COMMITTING" && progressSummary && (
                <section
                  aria-label="Import progress"
                  className="space-y-2 border-b border-border px-4 py-3"
                >
                  <div className="flex items-center justify-between text-[12px] font-medium">
                    <span>
                      {progressSummary.stage === "QUEUED"
                        ? "Starting…"
                        : progressSummary.stage === "VERIFYING"
                          ? "Checking your menu"
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
                      {progressSummary.processed} of {progressSummary.total} items
                    </span>
                    <span>
                      {progress?.workerStatus === "RUNNING" && progressSummary.pending > 0
                        ? estimatedTime
                        : "You can close this and keep working"}
                    </span>
                  </div>
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
                      <TH>Change</TH>
                      <TH>Status</TH>
                      <TH>Notes</TH>
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
                        <TD>{rowChangeLabel(row.action)}</TD>
                        <TD>
                          <Status>{rowStatusLabel(row.status)}</Status>
                        </TD>
                        <TD className="max-w-80 text-[11px] text-muted-foreground">
                          {[...row.errors, ...row.warnings]
                            .map((issue) => issue.message)
                            .join("; ")}
                        </TD>
                      </tr>
                    ))}
                    {!previewRows.length && (
                      <tr>
                        <TD colSpan={8} className="py-10 text-center text-muted-foreground">
                          {preview && preview.rowCount === 0
                            ? "This file has no item rows. Put the headings in the first row of the first sheet, or upload the CSV template."
                            : "Choose a file to see a preview."}
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
              <p className="font-semibold">Where these items will show</p>
              {preview.targetMode === "TENANT_MASTER" ? (
                <label className="flex items-start gap-2 text-warning">
                  <input
                    type="checkbox"
                    checked={masterOnlyAcknowledged}
                    onChange={(event) => setMasterOnlyAcknowledged(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  These items are saved but won't show at any branch until I turn them on.
                </label>
              ) : preview.targetMode === "SELECTED_BRANCHES" ? (
                <p>
                  {(preview.targetBranchIds ?? [])
                    .map(
                      (id) =>
                        centre.structure.branches.find((branch) => branch.id === id)?.name ??
                        "Unknown branch",
                    )
                    .join(", ") || "No branch chosen. Choose a branch under More options."}
                </p>
              ) : (
                <p>At the branch named in each row of your file.</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Btn disabled={busy} onClick={() => setImportOpen(false)}>
              Close
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
              {preview?.canCommit ? `Import ${preview.validCount} items` : "Import"}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MenuItemEditDialog
        item={editingItem}
        onClose={() => setEditingItem(null)}
        branchId={isAllBranches ? "" : branchId}
        branchName={
          centre.structure.branches.find((branch) => branch.id === branchId)?.name ?? "this branch"
        }
        categoryCodes={categoryCodes}
        stations={centre.options.stations
          .filter((station) => !isAllBranches && stringValue(station["branch_id"]) === branchId)
          .map((station) => ({
            id: stringValue(station["id"]),
            label: stringValue(station["name"]) || stringValue(station["code"]),
          }))}
        taxRules={centre.options.taxRules
          .filter(
            (rule) =>
              stringValue(rule["rule_type"]) === "TAX" &&
              (!stringValue(rule["branch_id"]) ||
                isAllBranches ||
                stringValue(rule["branch_id"]) === branchId),
          )
          .map((rule) => ({
            id: stringValue(rule["id"]),
            label: stringValue(rule["name"]) || stringValue(rule["code"]),
          }))}
        canEdit={canManageMenu}
        saveItem={centre.updateMenuItem}
        uploadImage={centre.uploadMenuImage}
        onSaved={(name) => {
          setNotice(`${name} saved.`);
          setNoticeTone("success");
        }}
      />
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
        createItem={centre.createManualMenuItem}
        onCommitted={() => {
          setNotice("Menu item saved.");
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
