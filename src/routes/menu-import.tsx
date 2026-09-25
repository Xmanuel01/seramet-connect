import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  Plus,
  RefreshCcw,
  Search,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { MenuCatalogDialog } from "@/components/app/MenuCatalogDialog";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import type { ImportPreview } from "@/onboarding/types";
import { createCanonicalMenuTemplate } from "@/onboarding/menu-import-schema";
import { createHistoricalSalesTemplate } from "@/onboarding/historical-sales-import-schema";
import type { HistoricalSalesPreview } from "@/onboarding/historical-sales-migration-service";
import { SetupStatus } from "@/onboarding/ui";
import { useSetupCentre } from "@/onboarding/use-setup-centre";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { cn } from "@/lib/utils";
import { formatMinor } from "@/payments/money";

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
  const { activeTenantId, branchId, isAllBranches, hasPermission } = useAppContext();
  const canManageMenu = hasPermission(permissions.setupImport);
  const [dialogMode, setDialogMode] = useState<"manual" | "import" | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("warning");
  const [historicalPreview, setHistoricalPreview] = useState<HistoricalSalesPreview | null>(null);
  const [previousPosName, setPreviousPosName] = useState("");

  const previewRows = preview?.rows ?? [];
  const committedCount = centre.menuCatalog.length;
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
  const visiblePreviewRows = previewRows.slice(
    (previewPage - 1) * PAGE_SIZE,
    previewPage * PAGE_SIZE,
  );

  useEffect(() => {
    setPreview(null);
    setPreviewPage(1);
    setCatalogPage(1);
    setDialogMode(null);
  }, [activeTenantId, branchId, isAllBranches]);

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
      title="Menu catalog"
      subtitle="Manage real POS items with manual creation or a verified spreadsheet import"
      actions={
        <>
          <Btn
            variant="primary"
            disabled={!canManageMenu || busy}
            onClick={() => setDialogMode("manual")}
          >
            <Plus className="h-4 w-4" />
            Add item
          </Btn>
          <Btn disabled={!canManageMenu || busy} onClick={() => setDialogMode("import")}>
            <Upload className="h-4 w-4" />
            Import menu
          </Btn>
          <Btn
            onClick={() => download("seramet-menu-template-v3.csv", createCanonicalMenuTemplate())}
          >
            <Download className="h-4 w-4" />
            Template
          </Btn>
          <Btn onClick={() => void centre.refreshCatalog()} disabled={busy} title="Refresh catalog">
            <RefreshCcw className="h-4 w-4" />
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

      {dialogMode && (
        <MenuCatalogDialog
          key={activeTenantId + ":" + branchId + ":" + dialogMode}
          mode={dialogMode}
          centre={centre}
          onClose={() => setDialogMode(null)}
          onPreview={(next) => {
            setPreview(next);
            setPreviewPage(1);
          }}
          onCommitted={(kind) => {
            setNotice(
              kind === "manual"
                ? "Item creation confirmed by the server. Verify its branch visibility and kitchen routing."
                : "Import verified by the server. Check its branch availability before live service.",
            );
            setNoticeTone("success");
          }}
        />
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

      <div className="mt-4 grid gap-4">
        <Panel>
          <PanelHead
            title="Catalog management"
            sub="Manual creation and spreadsheet configuration now open in a focused dialog."
            right={<FileSpreadsheet className="h-4 w-4 text-primary" />}
          />
          <div className="flex flex-wrap items-center gap-2 p-4">
            <Btn
              variant="primary"
              disabled={!canManageMenu || busy}
              onClick={() => setDialogMode("manual")}
            >
              <Plus className="h-4 w-4" />
              Add menu item
            </Btn>
            <Btn disabled={!canManageMenu || busy} onClick={() => setDialogMode("import")}>
              <Upload className="h-4 w-4" />
              Import CSV / Excel
            </Btn>
            {!canManageMenu && (
              <span className="text-[12px] text-muted-foreground">
                Your role needs setup import permission to modify the menu.
              </span>
            )}
          </div>
        </Panel>

        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHead
              title="Import preview"
              sub="Nothing is persisted until Commit import is selected"
              right={
                preview ? (
                  <SetupStatus value={preview.canCommit ? "READY" : "BLOCKED"} />
                ) : (
                  <Status>Pending</Status>
                )
              }
            />
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
            <div className="border-b border-border p-3">
              <label className="relative block max-w-sm">
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
            </div>
            {centre.menuCatalogStatus === "error" && (
              <div className="border-b border-danger/30 bg-danger-soft px-4 py-3 text-[12px] font-medium text-danger">
                Catalogue could not be loaded: {centre.menuCatalogError}
                <Btn className="ml-3" onClick={() => void centre.refreshCatalog()}>
                  Retry catalog
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
                          {item.available === 0 || item.sellable === 0
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
