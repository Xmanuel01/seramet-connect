import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ChangeEvent } from "react";
import { Download, FileSpreadsheet, GitBranch, Upload, XCircle } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { products as seedProducts } from "@/data/mock";
import {
  confirmMenuImport,
  exportMenuErrorReport,
  exportMenuImportTemplate,
  exportMenuToCsv,
  parseMenuFile,
  parseMenuText,
  type MenuImportPreview,
} from "@/lib/menu-import-export";
import { mapImageFilesToMenu, type MenuImageMapping } from "@/lib/menu-image-mapping";
import {
  applyPosMigrationOverrides,
  migrationCoverage,
  posMigrationProfiles,
  previewPosMigrationCsv,
  type PosMigrationEntity,
  type PosMigrationOverride,
} from "@/lib/pos-migration";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/menu-import")({
  head: () => ({
    meta: [
      { title: "Menu Import - Seramet" },
      {
        name: "description",
        content: "Import, validate, preview, confirm and export restaurant menu data.",
      },
    ],
  }),
  component: MenuImport,
});

const sampleCsv = `name,category,price,prep,productionStation,popular,out,westlandsPrice,ngongRoadPrice,westlandsAvailable,ngongRoadAvailable
Chicken Shawarma,Main Meals,850,14,MAIN KITCHEN,yes,no,900,850,yes,yes
Tamarind Juice,Drinks,260,3,BAR,yes,no,280,260,yes,yes
Mini Samosa,Sides,180,6,MAIN KITCHEN,no,no,,,yes,yes`;

const samplePosExport = `PLU,Menu Item,Sales Category,Base Price,Food Cost,Prep Station,SKU,Image URL
MS-001,Chicken Biryani,Main Meals,1200,650,MAIN KITCHEN,FOOD-001,chicken-biryani.jpg
DR-008,Passion Juice,Drinks,300,110,BAR,DRINK-008,passion-juice.jpg`;

function MenuImport() {
  const [menuProducts, setMenuProducts] = useState(seedProducts);
  const [preview, setPreview] = useState<MenuImportPreview>(() =>
    parseMenuText(sampleCsv, "Sample menu.csv"),
  );
  const [csvText, setCsvText] = useState(sampleCsv);
  const [confirmed, setConfirmed] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageMappings, setImageMappings] = useState<MenuImageMapping[]>([]);
  const [migrationText, setMigrationText] = useState(samplePosExport);
  const [migrationProfileId, setMigrationProfileId] = useState(
    posMigrationProfiles[1]?.id ?? posMigrationProfiles[0]!.id,
  );
  const [migrationEntity, setMigrationEntity] = useState<PosMigrationEntity>("Items");
  const [migrationOverrides, setMigrationOverrides] = useState<Record<string, string>>({});
  const errors = preview.issues.filter((issue) => issue.severity === "error");
  const warnings = preview.issues.filter((issue) => issue.severity === "warning");
  const exportCsv = useMemo(() => exportMenuToCsv(menuProducts), [menuProducts]);
  const selectedMigrationProfile =
    posMigrationProfiles.find((profile) => profile.id === migrationProfileId) ??
    posMigrationProfiles[0]!;
  const migrationPlan = useMemo(() => {
    const basePlan = previewPosMigrationCsv(
      migrationText,
      "existing-pos-export.csv",
      selectedMigrationProfile,
    );
    const overrides: PosMigrationOverride[] = Object.entries(migrationOverrides).map(
      ([key, sourceColumn]) => {
        const [entity, targetField] = key.split("::") as [PosMigrationEntity, string];
        return { entity, targetField, ...(sourceColumn ? { sourceColumn } : {}) };
      },
    );
    return applyPosMigrationOverrides(basePlan, overrides);
  }, [migrationOverrides, migrationText, selectedMigrationProfile]);
  const migrationCoverageSummary = useMemo(() => migrationCoverage(migrationPlan), [migrationPlan]);
  const activeMigrationEntity =
    migrationPlan.entities.find((entity) => entity.entity === migrationEntity) ??
    migrationPlan.entities[0]!;

  const validateText = () => {
    setPreview(parseMenuText(csvText, "Pasted CSV"));
    setConfirmed("");
  };

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      setPreview(await parseMenuFile(file));
      setConfirmed("");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const confirmImport = () => {
    const result = confirmMenuImport(menuProducts, preview);
    setMenuProducts(result.products);
    setConfirmed(result.message);
  };

  const downloadCsv = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    setImageBusy(true);
    try {
      const mappings = await mapImageFilesToMenu(files, menuProducts);
      const matchedImages = mappings.filter(
        (mapping) => mapping.status === "Matched" && mapping.productId && mapping.compressedUrl,
      );
      setImageMappings(mappings);
      setMenuProducts((current) =>
        current.map((product) => {
          const mapping = matchedImages.find((item) => item.productId === product.id);
          return mapping
            ? { ...product, imageFilename: mapping.fileName, imageUrl: mapping.compressedUrl }
            : product;
        }),
      );
      setConfirmed(
        matchedImages.length
          ? `${matchedImages.length} matched menu image${matchedImages.length === 1 ? "" : "s"} applied to menu items.`
          : "No uploaded images matched the current menu items.",
      );
    } finally {
      setImageBusy(false);
      event.target.value = "";
    }
  };

  const overrideMigrationMapping = (
    entity: PosMigrationEntity,
    targetField: string,
    sourceColumn: string,
  ) => {
    const key = `${entity}::${targetField}`;
    setMigrationOverrides((current) => ({ ...current, [key]: sourceColumn }));
  };

  return (
    <AppShell
      title="Menu import"
      subtitle="Excel/CSV validation, preview, confirmation and export"
      actions={
        <>
          <Btn
            onClick={() =>
              downloadCsv("seramet-menu-import-template.csv", exportMenuImportTemplate())
            }
          >
            <Download className="h-4 w-4" />
            Template
          </Btn>
          <Btn onClick={() => downloadCsv("seramet-menu-export.csv", exportCsv)}>
            <Download className="h-4 w-4" />
            Export menu
          </Btn>
          <Btn variant="primary" onClick={confirmImport}>
            Confirm import
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Rows read" value={preview.rowsRead} />
        <Metric label="Valid rows" value={preview.validRows} />
        <Metric label="Categories" value={preview.categories.length} />
        <Metric label="Errors" value={errors.length} invert />
        <Metric label="Warnings" value={warnings.length} invert />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel>
          <PanelHead
            title="Import source"
            sub="Upload .xlsx or .csv, or paste CSV data"
            right={<FileSpreadsheet className="h-4 w-4 text-primary" />}
          />
          <div className="space-y-4 p-4">
            <label
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] font-semibold hover:bg-secondary",
                busy && "opacity-60",
              )}
            >
              <Upload className="h-4 w-4 text-primary" />
              {busy ? "Reading file..." : "Upload Excel or CSV menu"}
              <input
                type="file"
                accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={uploadFile}
                className="hidden"
              />
            </label>
            <label className="grid gap-2 text-[12px] font-semibold text-muted-foreground">
              Paste CSV
              <textarea
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                className="min-h-44 rounded-md border border-border bg-card p-3 font-mono text-[12px] text-foreground outline-none"
              />
            </label>
            <div className="flex gap-2">
              <Btn onClick={validateText}>Validate pasted CSV</Btn>
              <Btn onClick={() => setCsvText(sampleCsv)}>Load sample</Btn>
            </div>
            <label
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-center text-[13px] font-semibold hover:bg-secondary",
                imageBusy && "opacity-60",
              )}
            >
              <Upload className="h-4 w-4 text-primary" />
              {imageBusy ? "Compressing images..." : "Bulk upload menu images"}
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={uploadImages}
                className="hidden"
              />
            </label>
            <div className="rounded-lg border border-border bg-secondary/40 p-3 text-[12px] text-muted-foreground">
              Required columns: name, category, price. Optional columns include prep,
              productionStation, popular, out, branch prices, branch availability and imageFilename.
            </div>
            {confirmed && (
              <div className="rounded-lg border border-success/30 bg-success-soft p-3 text-[13px] font-semibold text-success">
                {confirmed}
              </div>
            )}
          </div>
        </Panel>

        <div className="grid gap-4">
          <Panel>
            <PanelHead
              title="Validation preview"
              sub={`${preview.sourceName} - ${preview.sourceType.toUpperCase()} - ${preview.importedAt}`}
              right={<Status>{preview.canConfirm ? "Approved" : "Rejected"}</Status>}
            />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Category</TH>
                    <TH className="text-right">Price</TH>
                    <TH className="text-right">Prep</TH>
                    <TH>Station</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {preview.products.slice(0, 10).map((item) => (
                    <tr key={item.id} className="hover:bg-secondary/50">
                      <TD className="font-semibold">{item.name}</TD>
                      <TD>{item.category}</TD>
                      <TD className="num text-right">{item.price.toLocaleString()}</TD>
                      <TD className="num text-right">{item.prep} min</TD>
                      <TD>{item.productionStation}</TD>
                      <TD>
                        <Status>Approved</Status>
                      </TD>
                    </tr>
                  ))}
                  {preview.products.length === 0 && (
                    <tr>
                      <TD className="text-muted-foreground" colSpan={6}>
                        No valid rows to preview.
                      </TD>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="Error report"
              sub="Errors block confirmation; warnings stay visible after validation"
              right={
                <>
                  <Btn
                    onClick={() =>
                      downloadCsv("seramet-menu-error-report.csv", exportMenuErrorReport(preview))
                    }
                  >
                    Download report
                  </Btn>
                  <XCircle className="h-4 w-4 text-danger" />
                </>
              }
            />
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <TH>Row</TH>
                    <TH>Field</TH>
                    <TH>Severity</TH>
                    <TH>Message</TH>
                  </tr>
                </thead>
                <tbody>
                  {preview.issues.map((issue, index) => (
                    <tr
                      key={`${issue.row}-${issue.field}-${index}`}
                      className="hover:bg-secondary/50"
                    >
                      <TD className="num">{issue.row || "-"}</TD>
                      <TD className="font-semibold">{issue.field}</TD>
                      <TD>
                        <Status>{issue.severity === "error" ? "Rejected" : "Warning"}</Status>
                      </TD>
                      <TD className="text-muted-foreground">{issue.message}</TD>
                    </tr>
                  ))}
                  {preview.issues.length === 0 && (
                    <tr>
                      <TD className="text-muted-foreground" colSpan={4}>
                        No errors or warnings found.
                      </TD>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="Menu image mapping"
              sub="Bulk image filenames are matched to item code, SKU, item ID or item name"
              right={
                <Status>
                  {imageMappings.filter((item) => item.status === "Matched").length} matched
                </Status>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <TH>Image</TH>
                    <TH>File</TH>
                    <TH>Matched item</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Size</TH>
                  </tr>
                </thead>
                <tbody>
                  {imageMappings.map((mapping) => (
                    <tr key={mapping.fileName} className="hover:bg-secondary/50">
                      <TD>
                        {mapping.compressedUrl ? (
                          <img
                            src={mapping.compressedUrl}
                            alt=""
                            className="h-10 w-10 rounded-md border border-border object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-md border border-border bg-secondary" />
                        )}
                      </TD>
                      <TD className="font-semibold">{mapping.fileName}</TD>
                      <TD className="text-muted-foreground">
                        {mapping.itemName ?? "No menu match"}
                      </TD>
                      <TD>
                        <Status>{mapping.status === "Matched" ? "Approved" : "Warning"}</Status>
                      </TD>
                      <TD className="num text-right">
                        {mapping.compressedBytes && mapping.originalBytes
                          ? `${Math.round(mapping.compressedBytes / 1024)} KB / ${Math.round(mapping.originalBytes / 1024)} KB`
                          : "-"}
                      </TD>
                    </tr>
                  ))}
                  {imageMappings.length === 0 && (
                    <tr>
                      <TD className="text-muted-foreground" colSpan={5}>
                        Upload images named by item code, SKU, product ID or item name to preview
                        mappings.
                      </TD>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="Existing POS migration mapping"
              sub="Map legacy POS exports into Seramet entities before confirming migration"
              right={
                <>
                  <Status>{migrationCoverageSummary.percent}% mapped</Status>
                  <GitBranch className="h-4 w-4 text-primary" />
                </>
              }
            />
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-3">
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  POS export profile
                  <select
                    value={migrationProfileId}
                    onChange={(event) => {
                      setMigrationProfileId(event.target.value);
                      setMigrationOverrides({});
                    }}
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                  >
                    {posMigrationProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.vendor}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-[12px] font-semibold text-muted-foreground">
                  Paste existing POS CSV
                  <textarea
                    value={migrationText}
                    onChange={(event) => {
                      setMigrationText(event.target.value);
                      setMigrationOverrides({});
                    }}
                    className="min-h-40 rounded-md border border-border bg-card p-3 font-mono text-[12px] text-foreground outline-none"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Metric
                    label="Mapped fields"
                    value={`${migrationCoverageSummary.mapped}/${migrationCoverageSummary.total}`}
                  />
                  <Metric
                    label="Importable entities"
                    value={migrationCoverageSummary.importableEntities}
                  />
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-[12px] text-muted-foreground">
                  Covers items, categories, prices, customers, suppliers, opening stock, employees
                  and historical sales. Required fields must be mapped before that entity can
                  migrate.
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-3 flex gap-1.5 overflow-x-auto">
                  {migrationPlan.entities.map((entity) => (
                    <button
                      key={entity.entity}
                      onClick={() => setMigrationEntity(entity.entity)}
                      className={cn(
                        "shrink-0 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold",
                        migrationEntity === entity.entity
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {entity.entity}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr>
                        <TH>Seramet field</TH>
                        <TH>Source column</TH>
                        <TH className="text-right">Confidence</TH>
                        <TH>Status</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {activeMigrationEntity.mappings.map((mapping) => (
                        <tr key={mapping.targetField} className="hover:bg-secondary/50">
                          <TD className="font-semibold">
                            {mapping.targetField}
                            {mapping.required ? " *" : ""}
                          </TD>
                          <TD>
                            <select
                              value={mapping.sourceColumn ?? ""}
                              onChange={(event) =>
                                overrideMigrationMapping(
                                  activeMigrationEntity.entity,
                                  mapping.targetField,
                                  event.target.value,
                                )
                              }
                              className="h-8 w-full rounded-md border border-border bg-card px-2 text-[12px] text-foreground outline-none"
                            >
                              <option value="">Not mapped</option>
                              {activeMigrationEntity.sourceColumns.map((column) => (
                                <option key={column} value={column}>
                                  {column}
                                </option>
                              ))}
                            </select>
                          </TD>
                          <TD className="num text-right">{mapping.confidence}%</TD>
                          <TD>
                            <Status>
                              {mapping.status === "Mapped"
                                ? "Approved"
                                : mapping.status === "Missing"
                                  ? "Rejected"
                                  : "Warning"}
                            </Status>
                          </TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
