import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ChangeEvent } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, RefreshCcw, Upload } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import type { DuplicateStrategy, ImportPreview } from "@/onboarding/types";
import { SetupStatus } from "@/onboarding/ui";
import { useSetupCentre } from "@/onboarding/use-setup-centre";
import { cn } from "@/lib/utils";

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

const menuTemplate = [
  "code,name,category,price,currency,station,recipeReference,sellable,available,description,barcode",
  "ITEM-001,Example item,MAIN,0,,,RECIPE-001,true,true,,",
].join("\n");

function MenuImport() {
  const centre = useSetupCentre();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [strategy, setStrategy] = useState<DuplicateStrategy>("ERROR");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const previewRows = preview?.rows ?? [];
  const committedCount = centre.menuCatalog.length;
  const visibleCatalog = useMemo(() => centre.menuCatalog.slice(0, 100), [centre.menuCatalog]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The menu operation failed");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setNotice("");
    try {
      setPreview(await centre.previewImport(file, "MENU", strategy));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The menu file could not be validated");
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    if (!preview) return;
    void run(async () => {
      const response = await centre.commitImport(preview);
      setPreview(null);
      return response;
    }, "Menu import committed to the authoritative tenant catalog.");
  };

  return (
    <AppShell
      title="Menu import"
      subtitle="Secure preview, validation and explicit server commit"
      actions={
        <>
          <Btn onClick={() => download("seramet-menu-template.csv", menuTemplate)}>
            <Download className="h-4 w-4" />
            Template
          </Btn>
          <Btn onClick={() => void centre.refresh()} disabled={busy} title="Refresh catalog">
            <RefreshCcw className={cn("h-4 w-4", busy && "animate-spin")} />
            Refresh
          </Btn>
          <Btn variant="primary" onClick={commit} disabled={!preview?.canCommit || busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Commit import
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Catalog items" value={committedCount} />
        <Metric label="Rows read" value={preview?.rowCount ?? 0} />
        <Metric label="Valid" value={preview?.validCount ?? 0} />
        <Metric label="Warnings" value={preview?.warningCount ?? 0} />
        <Metric label="Errors" value={preview?.errorCount ?? 0} />
      </div>

      {notice && (
        <div
          className={cn(
            "mt-4 rounded-md border px-4 py-3 text-[13px] font-medium",
            notice.toLowerCase().includes("committed")
              ? "border-success/30 bg-success-soft text-success"
              : "border-warning/30 bg-warning-soft text-warning",
          )}
        >
          {notice}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
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
                onChange={(event) => setStrategy(event.target.value as DuplicateStrategy)}
                className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
              >
                <option value="ERROR">Stop on duplicate</option>
                <option value="UPDATE">Update existing only</option>
                <option value="SKIP">Skip existing</option>
                <option value="CREATE">Create new</option>
              </select>
            </label>
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
              Required: code, name, category and price. Station, recipe, tax and branch availability
              references are validated against configured tenant data.
            </div>
            {preview && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold">{preview.originalName}</div>
                  <div className="text-[11px] text-muted-foreground">Preview {preview.id}</div>
                </div>
                <SetupStatus value={preview.status} />
              </div>
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
                    <TH className="text-right">Price (minor)</TH>
                    <TH>Status</TH>
                    <TH>Validation</TH>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 100).map((row) => (
                    <tr key={`${row.rowNumber}-${row.rowKey}`} className="hover:bg-secondary/40">
                      <TD className="num">{row.rowNumber}</TD>
                      <TD className="font-semibold">{stringValue(row.normalized["code"])}</TD>
                      <TD>{stringValue(row.normalized["name"])}</TD>
                      <TD>{stringValue(row.normalized["categoryCode"])}</TD>
                      <TD className="num text-right">
                        {numberValue(row.normalized["sellingPriceMinor"]).toLocaleString()}
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
                      <TD colSpan={7} className="py-10 text-center text-muted-foreground">
                        Upload a file to create a server-side preview.
                      </TD>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="Authoritative catalog"
              sub="Committed tenant records currently available to operational services"
              right={<Status>{centre.status === "ready" ? "Available" : centre.status}</Status>}
            />
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
                  {!visibleCatalog.length && (
                    <tr>
                      <TD colSpan={6} className="py-10 text-center text-muted-foreground">
                        No committed menu items are available for this tenant.
                      </TD>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
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
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value / 100);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
