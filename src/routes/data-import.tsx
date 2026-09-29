import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ChangeEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Download, FileText, ScanLine, Upload } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { importDatasets, type ImportDataset, type ImportDatasetId } from "@/lib/import-datasets";
import {
  emptyPreview,
  fileToDataUrl,
  importErrorReportCsv,
  importSourceKind,
  importTemplateCsv,
  parseImportText,
  parseSpreadsheetImport,
  previewToCsv,
  validateImportRows,
  type ImportPreview,
} from "@/lib/data-import";
import { parseCsvRows } from "@/lib/menu-import-export";
import { extractDocumentTable } from "@/lib/document-extract.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/data-import")({
  head: () => ({
    meta: [
      { title: "Import Centre - Seramet" },
      {
        name: "description",
        content:
          "Import menu, inventory, accounting, finance, CRM and HR data from Excel, CSV, PDF and scanned documents.",
      },
      { property: "og:title", content: "Seramet Import Centre" },
      {
        property: "og:description",
        content: "Bring spreadsheets, PDFs and photographed documents into Seramet with validation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportCentre,
});

type Committed = {
  id: string;
  dataset: string;
  source: string;
  kind: string;
  rows: number;
  at: string;
};

function download(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function ImportCentre() {
  const extract = useServerFn(extractDocumentTable);
  const [datasetId, setDatasetId] = useState<ImportDatasetId>("menu");
  const dataset: ImportDataset =
    importDatasets.find((item) => item.id === datasetId) ?? importDatasets[0]!;
  const [pasted, setPasted] = useState(dataset.sampleCsv);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState("");
  const [committed, setCommitted] = useState<Committed[]>([]);

  const errors = preview?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = preview?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const columns = useMemo(() => dataset.fields.map((field) => field.key), [dataset]);

  const switchDataset = (id: ImportDatasetId) => {
    const next = importDatasets.find((item) => item.id === id) ?? dataset;
    setDatasetId(id);
    setPasted(next.sampleCsv);
    setPreview(null);
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const kind = importSourceKind(file.name, file.type);
    if (!kind) {
      setPreview(
        emptyPreview(dataset, file.name, "Upload an Excel, CSV, PDF or photo/scan of the document"),
      );
      return;
    }
    try {
      if (kind === "csv" || kind === "xlsx") {
        setBusy(`Reading ${file.name}…`);
        setPreview(await parseSpreadsheetImport(file, dataset));
        return;
      }
      setBusy(`Reading text from ${file.name}…`);
      const result = await extract({
        data: {
          fileName: file.name,
          mimeType: file.type || (kind === "pdf" ? "application/pdf" : "image/png"),
          dataUrl: await fileToDataUrl(file),
          datasetLabel: dataset.label,
          columns,
        },
      });
      if (!result.ok) {
        setPreview(emptyPreview(dataset, file.name, result.error ?? "Could not read this document"));
        return;
      }
      setPreview(
        validateImportRows(parseCsvRows(result.csv), dataset, file.name, kind, {
          model: result.model,
          notes: result.notes,
        }),
      );
    } catch {
      setPreview(emptyPreview(dataset, file.name, "Something went wrong while reading this file"));
    } finally {
      setBusy("");
    }
  };

  const confirmImport = () => {
    if (!preview?.canConfirm) return;
    setCommitted((current) => [
      {
        id: `${Date.now()}`,
        dataset: dataset.label,
        source: preview.sourceName,
        kind: preview.sourceKind.toUpperCase(),
        rows: preview.validRows,
        at: new Date().toLocaleString("en-KE"),
      },
      ...current,
    ]);
  };

  return (
    <AppShell
      title="Import Centre"
      subtitle="Excel, CSV, PDF and scanned documents across every Seramet module"
      actions={
        <Btn onClick={() => download(`${dataset.id}-template.csv`, importTemplateCsv(dataset))}>
          <Download size={14} /> Template
        </Btn>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Modules supported" value={importDatasets.length} />
        <Metric label="Rows in preview" value={preview?.rowsRead ?? 0} />
        <Metric label="Ready to import" value={preview?.validRows ?? 0} />
        <Metric label="Imports confirmed" value={committed.length} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {importDatasets.map((item) => (
          <button
            key={item.id}
            onClick={() => switchDataset(item.id)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors",
              item.id === datasetId
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead title={`${dataset.label} import`} sub={dataset.target} />
          <div className="p-4">
            <p className="text-[13px] text-muted-foreground">{dataset.description}</p>

            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-8 text-center">
              <Upload size={18} className="text-primary" />
              <span className="mt-2 text-[13px] font-bold">
                Upload Excel, CSV, PDF, photo or scan
              </span>
              <span className="mt-1 text-[12px] text-muted-foreground">
                .xlsx .csv .pdf .jpg .png — scanned and photographed pages are read automatically
              </span>
              <input
                type="file"
                className="hidden"
                accept=".csv,.txt,.xlsx,.xls,.pdf,image/*"
                onChange={onUpload}
              />
            </label>

            {busy && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-secondary/60 px-3 py-2 text-[12px] font-semibold">
                <ScanLine size={14} className="text-primary" /> {busy}
              </div>
            )}

            <div className="mt-4">
              <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                Or paste rows
              </div>
              <textarea
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                rows={5}
                className="mt-2 w-full rounded-md border border-border bg-card p-3 font-mono text-[12px]"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn variant="primary" onClick={() => setPreview(parseImportText(pasted, dataset))}>
                  Validate rows
                </Btn>
                <Btn onClick={() => setPasted(dataset.sampleCsv)}>Reset sample</Btn>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Expected columns" sub={`${dataset.module} module`} />
          <div className="p-4 space-y-2">
            {dataset.fields.map((field) => (
              <div
                key={field.key}
                className="flex items-center justify-between rounded-md bg-secondary/40 px-3 py-2 text-[12px]"
              >
                <span className="font-semibold">{field.label}</span>
                <Status>{field.required ? "Required" : "Optional"}</Status>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {preview && (
        <Panel className="mt-4">
          <PanelHead
            title={`Preview — ${preview.sourceName}`}
            sub={`${preview.sourceKind.toUpperCase()} · ${preview.validRows} of ${preview.rowsRead} rows ready${
              preview.extraction ? ` · ${preview.extraction.notes}` : ""
            }`}
          />
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <Btn
              variant="primary"
              className={cn(!preview.canConfirm && "pointer-events-none opacity-50")}
              onClick={confirmImport}
            >
              <CheckCircle2 size={14} /> Confirm import
            </Btn>
            <Btn
              onClick={() => download(`${dataset.id}-import.csv`, previewToCsv(preview, dataset))}
            >
              <FileText size={14} /> Download clean CSV
            </Btn>
            {preview.issues.length > 0 && (
              <Btn
                onClick={() =>
                  download(`${dataset.id}-import-issues.csv`, importErrorReportCsv(preview))
                }
              >
                <AlertTriangle size={14} /> Issue report
              </Btn>
            )}
            <span className="text-[12px] text-muted-foreground">
              {errors.length} errors · {warnings.length} warnings
            </span>
          </div>

          {preview.issues.length > 0 && (
            <ul className="space-y-1 border-b border-border px-4 py-3 text-[12px]">
              {preview.issues.slice(0, 8).map((issue, index) => (
                <li key={`${issue.row}-${issue.field}-${index}`} className="flex gap-2">
                  <Status>{issue.severity === "error" ? "Error" : "Warning"}</Status>
                  <span className="text-muted-foreground">
                    Row {issue.row} · {issue.field} — {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  {dataset.fields.map((field) => (
                    <TH key={field.key}>{field.label}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 25).map((row, index) => (
                  <tr key={index} className="hover:bg-secondary/50">
                    {dataset.fields.map((field) => (
                      <TD key={field.key}>{row[field.key] || "—"}</TD>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {committed.length > 0 && (
        <Panel className="mt-4">
          <PanelHead title="Confirmed imports" sub="Audit trail for this session" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <TH>Module</TH>
                  <TH>Source</TH>
                  <TH>Format</TH>
                  <TH className="text-right">Rows</TH>
                  <TH>Imported</TH>
                </tr>
              </thead>
              <tbody>
                {committed.map((entry) => (
                  <tr key={entry.id} className="hover:bg-secondary/50">
                    <TD className="font-semibold">{entry.dataset}</TD>
                    <TD className="text-muted-foreground">{entry.source}</TD>
                    <TD>
                      <Status>{entry.kind}</Status>
                    </TD>
                    <TD className="num text-right font-semibold">{entry.rows}</TD>
                    <TD className="num text-muted-foreground">{entry.at}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
