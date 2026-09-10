import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  HardDrive,
  Link2,
  Loader2,
  Play,
  Printer,
  RefreshCcw,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import type {
  DuplicateStrategy,
  ImportKind,
  ImportPreview,
  SetupSection,
} from "@/onboarding/types";
import { SetupStageIcon, SetupStatus, SetupTab } from "@/onboarding/ui";
import { useSetupCentre } from "@/onboarding/use-setup-centre";
import { OnboardingWizard } from "@/onboarding/OnboardingWizard";
import { formatMinor, parseMajorAmount } from "@/payments/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/seramet-setup")({
  head: () => ({
    meta: [
      { title: "Setup Centre - Seramet" },
      {
        name: "description",
        content: "Authoritative restaurant onboarding, validation, testing and go-live readiness.",
      },
    ],
  }),
  component: SetupCentre,
});

const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
const labelClass = "grid min-w-0 gap-1.5 text-[12px] font-semibold text-muted-foreground";
const importSection: Partial<Record<SetupSection, ImportKind>> = {
  MENU: "MENU",
  INVENTORY: "INVENTORY",
  SUPPLIERS: "SUPPLIER",
  USERS_ROLES: "STAFF",
};
const documentTypes = [
  "KOT",
  "BAR_TICKET",
  "ADDITION_TICKET",
  "CANCEL_ITEM_TICKET",
  "REPRINT_KOT",
  "BILL",
  "RECEIPT",
  "INVOICE",
  "CREDIT_NOTE",
  "PURCHASE_ORDER",
  "GOODS_RECEIPT",
  "SUPPLIER_RETURN",
  "SHIFT_CLOSE",
  "EOD_REPORT",
];

function SetupCentre() {
  const navigate = useNavigate();
  const centre = useSetupCentre();
  const [section, setSection] = useState<SetupSection>("BUSINESS_PROFILE");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("ERROR");
  const [business, setBusiness] = useState({
    legalName: "",
    tradingName: "",
    countryCode: "",
    defaultCurrency: "",
    timezone: "",
    locale: "",
    accountingMode: "",
    defaultDocumentFooter: "",
  });
  const [brand, setBrand] = useState({ code: "", name: "" });
  const [branch, setBranch] = useState({
    brandId: "",
    code: "",
    name: "",
    timezone: "",
    cutoff: "",
    negativeStockPolicy: "",
    warehouseCode: "",
    warehouseName: "",
  });
  const [account, setAccount] = useState({ mappingKey: "", accountId: "" });
  const [taxRule, setTaxRule] = useState({
    ruleType: "TAX",
    code: "",
    name: "",
    rate: "",
    mode: "EXCLUSIVE",
    effectiveFrom: "",
    accountId: "",
  });
  const [providerId, setProviderId] = useState("");
  const [providerBranchId, setProviderBranchId] = useState("");
  const [providerEnvironment, setProviderEnvironment] = useState("SANDBOX");
  const [providerConfiguration, setProviderConfiguration] = useState<Record<string, string>>({});
  const [providerCredentials, setProviderCredentials] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState({
    connectionId: "",
    resourceType: "STORE",
    internalId: "",
    externalId: "",
  });
  const [device, setDevice] = useState({
    branchId: "",
    deviceType: "PRINTER",
    name: "",
    role: "",
    stationId: "",
    paperSize: "80mm",
  });
  const [document, setDocument] = useState({
    branchId: "",
    documentType: "KOT",
    layoutVersion: "seramet-approved-v1",
    width: "80mm",
    footerMessage: "",
  });
  const [opening, setOpening] = useState({
    branchId: "",
    warehouseId: "",
    inventoryItemId: "",
    unitId: "",
    businessDate: "",
    quantity: "",
    unitCost: "",
  });
  const [fxRate, setFxRate] = useState({
    tenderCurrency: "",
    rate: "",
    validHours: "24",
    reason: "",
  });

  useEffect(() => {
    if (!centre.profile) return;
    setBusiness({
      legalName: centre.profile.legalName,
      tradingName: centre.profile.tradingName,
      countryCode: centre.profile.countryCode,
      defaultCurrency: centre.profile.defaultCurrency,
      timezone: centre.profile.timezone,
      locale: centre.profile.locale,
      accountingMode: centre.profile.accountingMode,
      defaultDocumentFooter: centre.profile.defaultDocumentFooter ?? "",
    });
    setDocument((current) => ({
      ...current,
      footerMessage: current.footerMessage || centre.profile?.defaultDocumentFooter || "",
    }));
  }, [centre.profile]);

  const provider = centre.providers.find((candidate) => candidate.id === providerId);
  const sectionStage = centre.setup?.stages.find((stage) => stage.section === section);
  const sectionResults = centre.setup?.results.filter((result) => result.section === section) ?? [];
  const blockers = centre.setup?.results.filter((result) => result.status === "BLOCKED") ?? [];
  const importKind = importSection[section];
  const score = ((centre.setup?.overallScoreBps ?? 0) / 100).toFixed(0);
  const healthFailures = centre.integrations.filter((row) => row.health !== "HEALTHY").length;
  const offlineDevices = centre.devices.filter((row) => row.health !== "ONLINE").length;
  const selectedBranch = centre.structure.branches.find(
    (candidate) => candidate.id === opening.branchId,
  );
  const currency = centre.profile?.defaultCurrency ?? "";

  const run = async (task: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setNotice("");
    try {
      await task();
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Setup command failed");
    } finally {
      setBusy(false);
    }
  };

  const saveBusiness = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        centre.command("/api/seramet/setup/business-profile", {
          ...business,
          contact: {},
          legalIdentifiers: {},
          fiscalSettings: {},
          documentBranding: {},
        }),
      "Business profile saved to the authoritative tenant configuration.",
    );
  };
  const createBrand = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => centre.command("/api/seramet/setup/brands", brand),
      "Brand created for this organisation.",
    );
  };
  const createBranch = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        centre.command("/api/seramet/setup/branches", {
          brandId: branch.brandId,
          code: branch.code,
          name: branch.name,
          timezone: branch.timezone,
          businessDayCutoffMinutes: Number(branch.cutoff),
          negativeStockPolicy: branch.negativeStockPolicy,
          paymentsRequired: true,
          inventoryEnabled: true,
          recipesRequired: true,
          printingRequired: true,
          kdsRequired: false,
          ...(branch.warehouseCode && branch.warehouseName
            ? { createWarehouse: { code: branch.warehouseCode, name: branch.warehouseName } }
            : {}),
        }),
      "Branch and operating policy created.",
    );
  };
  const uploadImport = async (file: File) => {
    if (!importKind) return;
    setBusy(true);
    setNotice("");
    try {
      const next = await centre.previewImport(file, importKind, duplicateStrategy);
      setPreview(next);
      setNotice(
        next.canCommit ? "Preview ready for explicit commit." : "Preview contains blocking errors.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import preview failed");
    } finally {
      setBusy(false);
    }
  };
  const saveProvider = (event: FormEvent) => {
    event.preventDefault();
    if (!provider) return;
    const configuration = Object.fromEntries(
      Object.entries(providerConfiguration).map(([key, value]) => [
        key,
        provider.configurationSchema[key]?.type === "boolean" ? value === "true" : value,
      ]),
    );
    void run(async () => {
      await centre.command("/api/seramet/setup/provider-connections", {
        providerId: provider.id,
        ...(providerBranchId ? { branchId: providerBranchId } : {}),
        environment: providerEnvironment,
        configuration,
        ...(Object.values(providerCredentials).some(Boolean)
          ? { credentials: providerCredentials }
          : {}),
        enabled: true,
      });
      setProviderCredentials({});
    }, `${provider.displayName} configuration stored. Credential values were not returned.`);
  };
  const saveMapping = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        centre.command("/api/seramet/setup/provider-mappings", {
          ...mapping,
          status: "MAPPED",
          reviewConfirmed: true,
          confidenceBps: 10000,
        }),
      "Reviewed external mapping committed.",
    );
  };
  const saveDevice = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => centre.command("/api/seramet/setup/devices", { ...device, capabilities: [] }),
      "Device registered with UNKNOWN health until a trusted agent reports.",
    );
  };
  const saveDocument = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        centre.command("/api/seramet/setup/document-templates", {
          ...document,
          ...(document.branchId ? { branchId: document.branchId } : {}),
          active: true,
          copies: 1,
          showCustomer: true,
          showTable: true,
          showCashier: true,
          showKotPrices: false,
          showQrCode: document.documentType === "BILL",
          configuration: {},
        }),
      "Document template configuration saved.",
    );
  };
  const saveOpeningStock = (event: FormEvent) => {
    event.preventDefault();
    if (!currency) return setNotice("Configure the tenant currency before opening stock.");
    void run(
      () =>
        centre.command("/api/seramet/setup/opening-stock", {
          branchId: opening.branchId,
          warehouseId: opening.warehouseId,
          businessDate: opening.businessDate,
          currency,
          idempotencyKey: `opening:${opening.branchId}:${opening.warehouseId}:${opening.businessDate}:${opening.inventoryItemId}`,
          lines: [
            {
              inventoryItemId: opening.inventoryItemId,
              unitId: opening.unitId,
              quantityMicro: parseMicroUnits(opening.quantity),
              unitCostMinor: parseMajorAmount(opening.unitCost, currency),
            },
          ],
        }),
      "Opening stock batch prepared for approval.",
    );
  };
  const configureAccount = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        centre.command("/api/seramet/setup/account-mappings", {
          mappingKey: account.mappingKey,
          accountId: account.accountId,
          requirement: "REQUIRED",
          financeSignoff: "APPROVED",
        }),
      "Required account mapping saved with finance sign-off.",
    );
  };
  const configureTax = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        centre.command("/api/seramet/setup/tax-service-rules", {
          ruleType: taxRule.ruleType,
          code: taxRule.code,
          name: taxRule.name,
          rateBps: parseRateBps(taxRule.rate),
          calculationMode: taxRule.mode,
          effectiveFrom: taxRule.effectiveFrom,
          ...(taxRule.accountId ? { accountId: taxRule.accountId } : {}),
          active: true,
        }),
      "Tax or service charge rule saved.",
    );
  };
  const configureFxRate = (event: FormEvent) => {
    event.preventDefault();
    if (!currency || !fxRate.tenderCurrency) return;
    let ratio: { numerator: number; denominator: number };
    try {
      ratio = decimalRateRatio(fxRate.rate);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Exchange rate is invalid.");
      return;
    }
    const validHours = Number(fxRate.validHours);
    if (!Number.isSafeInteger(validHours) || validHours < 1 || validHours > 720) {
      setNotice("Rate validity must be between 1 and 720 hours.");
      return;
    }
    const effectiveFrom = new Date();
    const effectiveUntil = new Date(effectiveFrom.getTime() + validHours * 3_600_000);
    void run(
      () =>
        centre.command("/api/seramet/setup/fx-rates/manual", {
          baseCurrency: currency,
          tenderCurrency: fxRate.tenderCurrency,
          rateNumerator: ratio.numerator,
          rateDenominator: ratio.denominator,
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveUntil: effectiveUntil.toISOString(),
          reason: fxRate.reason,
          idempotencyKey: `manual-fx:${currency}:${fxRate.tenderCurrency}:${crypto.randomUUID()}`,
        }),
      "Authorized exchange rate saved with an immutable audit record.",
    );
  };

  if (centre.status === "loading" && !centre.setup)
    return (
      <AppShell title="Setup Centre" subtitle="Loading authoritative setup state">
        <Panel className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </Panel>
      </AppShell>
    );

  if (centre.onboarding && centre.onboarding.status !== "COMPLETED") {
    return <OnboardingWizard centre={centre} />;
  }

  return (
    <AppShell
      title="Setup Centre"
      subtitle={`${centre.setup?.organisationName ?? "Organisation"} · ${centre.setup?.goLiveState.replaceAll("_", " ") ?? "SETUP"}`}
      actions={
        <>
          <SetupStatus value={centre.setup?.status ?? "BLOCKED"} />
          <Btn onClick={() => void centre.refresh()} disabled={busy} title="Refresh readiness">
            <RefreshCcw className={cn("h-4 w-4", busy && "animate-spin")} />
            Refresh
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Readiness" value={`${score}%`} />
        <Metric label="Blockers" value={blockers.length} invert={blockers.length > 0} />
        <Metric label="Branches" value={centre.setup?.counts.branches ?? 0} />
        <Metric label="Menu items" value={centre.setup?.counts.menuItems ?? 0} />
        <Metric label="Integration issues" value={healthFailures} invert={healthFailures > 0} />
        <Metric label="Device issues" value={offlineDevices} invert={offlineDevices > 0} />
      </div>
      {notice && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] font-semibold">
          {notice.toLowerCase().includes("fail") || notice.toLowerCase().includes("required") ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          )}
          <span className="min-w-0 break-words">{notice}</span>
        </div>
      )}
      <div className="mt-4 overflow-x-auto border-b border-border xl:hidden">
        <div className="flex min-w-max">
          {centre.setup?.stages.map((stage) => (
            <SetupTab
              key={stage.section}
              active={section === stage.section}
              onClick={() => setSection(stage.section)}
            >
              {stage.label}
            </SetupTab>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Panel className="hidden self-start p-2 xl:block">
          <nav className="space-y-0.5">
            {centre.setup?.stages.map((stage) => (
              <button
                type="button"
                key={stage.section}
                onClick={() => setSection(stage.section)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] font-semibold",
                  section === stage.section
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <SetupStageIcon status={stage.status} />
                <span className="min-w-0 flex-1 truncate">{stage.label}</span>
                <span className="num text-[10px]">{Math.round(stage.progressBps / 100)}%</span>
              </button>
            ))}
          </nav>
        </Panel>
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHead
              title={sectionStage?.label ?? "Setup"}
              sub={`${sectionStage?.blockers ?? 0} blockers · ${sectionStage?.warnings ?? 0} warnings`}
              right={<SetupStatus value={sectionStage?.readinessStatus ?? "BLOCKED"} />}
            />
            {sectionResults.length > 0 && (
              <div className="divide-y divide-border">
                {sectionResults.map((result) => (
                  <div
                    key={result.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold">{result.message}</div>
                      {result.status !== "READY" && (
                        <div className="mt-1 text-[12px] text-muted-foreground">
                          {result.recommendedAction}
                        </div>
                      )}
                    </div>
                    <SetupStatus value={result.status} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {section === "BUSINESS_PROFILE" && (
            <Panel>
              <PanelHead
                title="Business identity"
                sub="Tenant-level legal, fiscal and document defaults"
                right={<Building2 className="h-4 w-4 text-primary" />}
              />
              <form onSubmit={saveBusiness} className="grid gap-3 p-4 md:grid-cols-2">
                <Field
                  label="Legal name"
                  value={business.legalName}
                  onChange={(value) => setBusiness({ ...business, legalName: value })}
                />
                <Field
                  label="Trading name"
                  value={business.tradingName}
                  onChange={(value) => setBusiness({ ...business, tradingName: value })}
                />
                <label className={labelClass}>
                  Country
                  <select
                    required
                    value={business.countryCode}
                    disabled
                    onChange={() => undefined}
                    className={inputClass}
                  >
                    <option value="">Select country</option>
                    {centre.countries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name} ({country.callingCode})
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    Confirmed during guided location onboarding.
                  </span>
                </label>
                <label className={labelClass}>
                  Base currency
                  <select
                    required
                    value={business.defaultCurrency}
                    disabled
                    onChange={() => undefined}
                    className={inputClass}
                  >
                    <option value="">Select currency</option>
                    {centre.currencies.map((currencyOption) => (
                      <option key={currencyOption.code} value={currencyOption.code}>
                        {currencyOption.code} - {currencyOption.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    Managed by the controlled currency workflow and locked after financial activity.
                  </span>
                </label>
                <Field
                  label="Timezone"
                  value={business.timezone}
                  onChange={(value) => setBusiness({ ...business, timezone: value })}
                />
                <Field
                  label="Locale"
                  value={business.locale}
                  onChange={(value) => setBusiness({ ...business, locale: value })}
                />
                <label className={labelClass}>
                  Accounting mode
                  <select
                    required
                    value={business.accountingMode}
                    onChange={(event) =>
                      setBusiness({ ...business, accountingMode: event.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="">Select mode</option>
                    <option value="PERPETUAL">Perpetual</option>
                    <option value="PERIODIC">Periodic</option>
                  </select>
                </label>
                <Field
                  label="Default document footer"
                  value={business.defaultDocumentFooter}
                  onChange={(value) => setBusiness({ ...business, defaultDocumentFooter: value })}
                />
                <div className="md:col-span-2 flex justify-end">
                  <Btn type="submit" variant="primary" disabled={busy}>
                    <Save className="h-4 w-4" />
                    Save profile
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          {section === "BRANCHES" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel>
                <PanelHead title="Brands" sub={`${centre.structure.brands.length} configured`} />
                <form onSubmit={createBrand} className="grid gap-3 p-4">
                  <Field
                    label="Brand code"
                    value={brand.code}
                    onChange={(value) => setBrand({ ...brand, code: value })}
                  />
                  <Field
                    label="Brand name"
                    value={brand.name}
                    onChange={(value) => setBrand({ ...brand, name: value })}
                  />
                  <Btn type="submit" variant="primary" disabled={busy}>
                    Create brand
                  </Btn>
                </form>
              </Panel>
              <Panel>
                <PanelHead title="New branch" sub="Operating policy and warehouse" />
                <form onSubmit={createBranch} className="grid gap-3 p-4 md:grid-cols-2">
                  <label className={cn(labelClass, "md:col-span-2")}>
                    Brand
                    <select
                      required
                      value={branch.brandId}
                      onChange={(event) => setBranch({ ...branch, brandId: event.target.value })}
                      className={inputClass}
                    >
                      <option value="">Select brand</option>
                      {centre.structure.brands
                        .filter((item) => item.active)
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Field
                    label="Branch code"
                    value={branch.code}
                    onChange={(value) => setBranch({ ...branch, code: value })}
                  />
                  <Field
                    label="Branch name"
                    value={branch.name}
                    onChange={(value) => setBranch({ ...branch, name: value })}
                  />
                  <Field
                    label="Timezone"
                    value={branch.timezone}
                    onChange={(value) => setBranch({ ...branch, timezone: value })}
                  />
                  <Field
                    label="Business-day cutoff (minutes)"
                    type="number"
                    value={branch.cutoff}
                    onChange={(value) => setBranch({ ...branch, cutoff: value })}
                    min="0"
                    max="1439"
                  />
                  <label className={cn(labelClass, "md:col-span-2")}>
                    Negative stock policy
                    <select
                      required
                      value={branch.negativeStockPolicy}
                      onChange={(event) =>
                        setBranch({ ...branch, negativeStockPolicy: event.target.value })
                      }
                      className={inputClass}
                    >
                      <option value="">Select policy</option>
                      <option value="BLOCK">Block</option>
                      <option value="MANAGER_OVERRIDE">Manager override</option>
                      <option value="ALLOW_WITH_ALERT">Allow with alert</option>
                    </select>
                  </label>
                  <Field
                    label="Warehouse code"
                    value={branch.warehouseCode}
                    onChange={(value) => setBranch({ ...branch, warehouseCode: value })}
                  />
                  <Field
                    label="Warehouse name"
                    value={branch.warehouseName}
                    onChange={(value) => setBranch({ ...branch, warehouseName: value })}
                  />
                  <div className="md:col-span-2">
                    <Btn type="submit" variant="primary" disabled={busy}>
                      Create branch
                    </Btn>
                  </div>
                </form>
              </Panel>
            </div>
          )}
          {importKind && (
            <ImportPanel
              kind={importKind}
              busy={busy}
              preview={preview?.kind === importKind ? preview : null}
              duplicateStrategy={duplicateStrategy}
              setDuplicateStrategy={setDuplicateStrategy}
              onFile={uploadImport}
              onCommit={() =>
                preview &&
                void run(() => centre.commitImport(preview), "Import commit accepted and audited.")
              }
            />
          )}
          {section === "RECIPES_UOM" && (
            <Panel>
              <PanelHead
                title="Recipe and UOM validation"
                sub="Missing recipes, costs, yields, conversions and dependency cycles"
              />
              <div className="flex flex-wrap gap-2 p-4">
                <Btn
                  onClick={() =>
                    void run(
                      () =>
                        centre.command("/api/seramet/setup/tests", {
                          testType: "ORDER",
                          targetType: "RECIPE_VALIDATION",
                          idempotencyKey: `recipe-validation:${Date.now()}`,
                        }),
                      "Recipe validation test recorded.",
                    )
                  }
                >
                  <Play className="h-4 w-4" />
                  Run validation
                </Btn>
                <Btn onClick={() => void navigate({ to: "/cost-control" })}>
                  Open Cost Control
                  <ArrowRight className="h-4 w-4" />
                </Btn>
              </div>
            </Panel>
          )}
          {section === "ACCOUNTING" && (
            <Panel>
              <PanelHead
                title="Required account mapping"
                sub="Configuration-driven posting targets with finance sign-off"
              />
              <form onSubmit={configureAccount} className="grid gap-3 p-4 md:grid-cols-2">
                <Field
                  label="Mapping key"
                  value={account.mappingKey}
                  onChange={(value) => setAccount({ ...account, mappingKey: value.toUpperCase() })}
                />
                <label className={labelClass}>
                  Account
                  <select
                    required
                    value={account.accountId}
                    onChange={(event) => setAccount({ ...account, accountId: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Select configured account</option>
                    {centre.options.accounts.map((item) => (
                      <option key={String(item["id"])} value={String(item["id"])}>
                        {String(item["code"])} · {String(item["name"])}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-2">
                  <Btn type="submit" variant="primary" disabled={busy}>
                    Save mapping
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          {section === "TAX_SERVICE" && (
            <Panel>
              <PanelHead
                title="Tax and service charge"
                sub="Scoped rates, effective dates, accounting and rounding"
              />
              <form onSubmit={configureTax} className="grid gap-3 p-4 md:grid-cols-2">
                <label className={labelClass}>
                  Rule type
                  <select
                    value={taxRule.ruleType}
                    onChange={(event) => setTaxRule({ ...taxRule, ruleType: event.target.value })}
                    className={inputClass}
                  >
                    <option value="TAX">Tax</option>
                    <option value="SERVICE_CHARGE">Service charge</option>
                  </select>
                </label>
                <Field
                  label="Code"
                  value={taxRule.code}
                  onChange={(value) => setTaxRule({ ...taxRule, code: value })}
                />
                <Field
                  label="Name"
                  value={taxRule.name}
                  onChange={(value) => setTaxRule({ ...taxRule, name: value })}
                />
                <Field
                  label="Rate (%)"
                  value={taxRule.rate}
                  onChange={(value) => setTaxRule({ ...taxRule, rate: value })}
                />
                <label className={labelClass}>
                  Calculation
                  <select
                    value={taxRule.mode}
                    onChange={(event) => setTaxRule({ ...taxRule, mode: event.target.value })}
                    className={inputClass}
                  >
                    <option value="EXCLUSIVE">Exclusive</option>
                    <option value="INCLUSIVE">Inclusive</option>
                  </select>
                </label>
                <Field
                  label="Effective from"
                  type="date"
                  value={taxRule.effectiveFrom}
                  onChange={(value) => setTaxRule({ ...taxRule, effectiveFrom: value })}
                />
                <label className={cn(labelClass, "md:col-span-2")}>
                  Account mapping
                  <select
                    value={taxRule.accountId}
                    onChange={(event) => setTaxRule({ ...taxRule, accountId: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">No account selected</option>
                    {centre.options.accounts.map((item) => (
                      <option key={String(item["id"])} value={String(item["id"])}>
                        {String(item["code"])} · {String(item["name"])}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-2">
                  <Btn type="submit" variant="primary" disabled={busy}>
                    Save rule
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          {(section === "PAYMENTS" || section === "DELIVERY_INTEGRATIONS") && (
            <>
              {section === "PAYMENTS" && (
                <Panel>
                  <PanelHead
                    title="Accepted currency rates"
                    sub="Authorized operational rates for configured secondary cash currencies"
                  />
                  <form onSubmit={configureFxRate} className="grid gap-3 p-4 md:grid-cols-2">
                    <label className={labelClass}>
                      Tender currency
                      <select
                        value={fxRate.tenderCurrency}
                        onChange={(event) =>
                          setFxRate({ ...fxRate, tenderCurrency: event.target.value })
                        }
                        className={inputClass}
                        required
                      >
                        <option value="">Select secondary currency</option>
                        {centre.onboarding?.acceptedCurrencies
                          .filter((item) => !item.isBase && item.status === "ACTIVE")
                          .map((item) => (
                            <option key={item.code} value={item.code}>
                              {item.code} - {item.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Field
                      label={`Base ${currency || "currency"} per 1 tender unit`}
                      value={fxRate.rate}
                      onChange={(value) => setFxRate({ ...fxRate, rate: value })}
                    />
                    <Field
                      label="Valid for hours"
                      type="number"
                      min="1"
                      max="720"
                      value={fxRate.validHours}
                      onChange={(value) => setFxRate({ ...fxRate, validHours: value })}
                    />
                    <Field
                      label="Reason / source"
                      value={fxRate.reason}
                      onChange={(value) => setFxRate({ ...fxRate, reason: value })}
                      maxLength={500}
                    />
                    <div className="md:col-span-2">
                      <Btn type="submit" variant="primary" disabled={busy}>
                        Save authorized rate
                      </Btn>
                    </div>
                  </form>
                </Panel>
              )}
              <ProviderPanel
                category={section === "PAYMENTS" ? "PAYMENT" : "DELIVERY"}
                centre={centre}
                providerId={providerId}
                setProviderId={(value) => {
                  setProviderId(value);
                  setProviderConfiguration({});
                  setProviderCredentials({});
                }}
                providerBranchId={providerBranchId}
                setProviderBranchId={setProviderBranchId}
                environment={providerEnvironment}
                setEnvironment={setProviderEnvironment}
                configuration={providerConfiguration}
                setConfiguration={setProviderConfiguration}
                credentials={providerCredentials}
                setCredentials={setProviderCredentials}
                onSubmit={saveProvider}
                busy={busy}
              />
            </>
          )}
          {section === "KITCHEN_STATIONS" && (
            <MappingPanel
              centre={centre}
              mapping={mapping}
              setMapping={setMapping}
              onSubmit={saveMapping}
              busy={busy}
            />
          )}
          {section === "PRINTERS_DEVICES" && (
            <DevicePanel
              centre={centre}
              device={device}
              setDevice={setDevice}
              onSubmit={saveDevice}
              busy={busy}
              onTest={(targetId) =>
                void run(
                  () => centre.runTest({ testType: "PRINT", targetType: "DEVICE", targetId }),
                  "Test print result recorded without a financial transaction.",
                )
              }
            />
          )}
          {section === "DOCUMENTS" && (
            <Panel>
              <PanelHead
                title="Document templates"
                sub="Seramet print identity with tenant and branch branding"
                right={<Printer className="h-4 w-4 text-primary" />}
              />
              <form onSubmit={saveDocument} className="grid gap-3 p-4 md:grid-cols-2">
                <label className={labelClass}>
                  Scope
                  <select
                    value={document.branchId}
                    onChange={(event) => setDocument({ ...document, branchId: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Tenant default</option>
                    {centre.structure.branches.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Document type
                  <select
                    value={document.documentType}
                    onChange={(event) =>
                      setDocument({ ...document, documentType: event.target.value })
                    }
                    className={inputClass}
                  >
                    {documentTypes.map((item) => (
                      <option key={item}>{item.replaceAll("_", " ")}</option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Layout version"
                  value={document.layoutVersion}
                  onChange={(value) => setDocument({ ...document, layoutVersion: value })}
                />
                <Field
                  label="Paper width / layout"
                  value={document.width}
                  onChange={(value) => setDocument({ ...document, width: value })}
                />
                <div className="md:col-span-2">
                  <Field
                    label="Footer message"
                    value={document.footerMessage}
                    onChange={(value) => setDocument({ ...document, footerMessage: value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Btn type="submit" variant="primary" disabled={busy}>
                    Save template
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          {section === "OPENING_STOCK" && (
            <OpeningStockPanel
              centre={centre}
              value={opening}
              setValue={setOpening}
              onSubmit={saveOpeningStock}
              busy={busy}
              currency={currency}
              selectedBranch={selectedBranch?.name ?? ""}
              onApprove={(id) =>
                void run(
                  () =>
                    centre.command(`/api/seramet/setup/opening-stock/${id}/approve`, {
                      reason: "Opening stock reviewed and approved",
                    }),
                  "Opening stock approved.",
                )
              }
              onPost={(id) =>
                void run(
                  () => centre.command(`/api/seramet/setup/opening-stock/${id}/post`, {}),
                  "Opening movements posted and reconciled.",
                )
              }
            />
          )}
          {section === "TESTING" && (
            <Panel>
              <PanelHead
                title="Safe onboarding tests"
                sub="Test records remain isolated from finance, inventory, settlement and tax"
                right={<Play className="h-4 w-4 text-primary" />}
              />
              <div className="flex flex-wrap gap-2 p-4">
                <Btn
                  onClick={() =>
                    void run(
                      () => centre.runTest({ testType: "ORDER", targetType: "POS_ROUTING" }),
                      "Sandbox order test completed without financial facts.",
                    )
                  }
                >
                  <Play className="h-4 w-4" />
                  Test order
                </Btn>
                {centre.devices.slice(0, 3).map((item) => (
                  <Btn
                    key={item.deviceId}
                    onClick={() =>
                      void run(
                        () =>
                          centre.runTest({
                            testType: "PRINT",
                            targetType: item.deviceType,
                            targetId: item.deviceId,
                          }),
                        `Test print recorded for ${item.name}.`,
                      )
                    }
                  >
                    <Printer className="h-4 w-4" />
                    {item.name}
                  </Btn>
                ))}
              </div>
            </Panel>
          )}
          {section === "READINESS" && (
            <>
              <Panel>
                <PanelHead
                  title="Readiness evidence"
                  sub="Deterministic weighted checks; blockers override the score"
                  right={<ShieldCheck className="h-4 w-4 text-primary" />}
                />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px]">
                    <thead>
                      <tr>
                        <TH>Section</TH>
                        <TH>Status</TH>
                        <TH className="text-right">Progress</TH>
                        <TH className="text-right">Weight</TH>
                        <TH className="text-right">Issues</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {centre.setup?.stages.map((stage) => (
                        <tr key={stage.section}>
                          <TD className="font-semibold">{stage.label}</TD>
                          <TD>
                            <SetupStatus value={stage.readinessStatus} />
                          </TD>
                          <TD className="num text-right">{Math.round(stage.progressBps / 100)}%</TD>
                          <TD className="num text-right">{stage.weightBps}</TD>
                          <TD className="num text-right">{stage.blockers + stage.warnings}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel>
                <PanelHead
                  title="Support and deployment health"
                  sub="Actual schema, worker, backup and redaction state"
                  right={<HardDrive className="h-4 w-4 text-primary" />}
                />
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric
                    label="Schema"
                    value={
                      centre.diagnostics
                        ? `${centre.diagnostics.schema.current}/${centre.diagnostics.schema.required}`
                        : "Restricted"
                    }
                  />
                  <Metric label="Database" value={centre.diagnostics?.database ?? "Restricted"} />
                  <Metric
                    label="Worker issues"
                    value={
                      (centre.diagnostics?.workers["FAILED"] ?? 0) +
                      (centre.diagnostics?.workers["DEAD_LETTER"] ?? 0)
                    }
                  />
                  <Metric
                    label="Backup"
                    value={centre.diagnostics?.backup.status ?? "Restricted"}
                  />
                </div>
                {centre.diagnostics && (
                  <div className="flex flex-wrap gap-2 border-t border-border p-4">
                    <Btn
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            centre.command("/api/seramet/setup/diagnostics/exports", {
                              scope: { setup: true, workers: true, integrations: true },
                              idempotencyKey: `diagnostics:${Date.now()}`,
                            }),
                          "Redacted support diagnostics export queued.",
                        )
                      }
                    >
                      Export diagnostics
                    </Btn>
                    <Btn
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            centre.command("/api/seramet/setup/exports", {
                              entityTypes: [
                                "menu",
                                "inventory",
                                "suppliers",
                                "orders",
                                "invoices",
                                "payments",
                                "journals",
                                "audit",
                              ],
                              rowLimit: 10000,
                              idempotencyKey: `tenant-export:${Date.now()}`,
                            }),
                          "Audited tenant data export queued.",
                        )
                      }
                    >
                      Export tenant data
                    </Btn>
                    <span className="self-center text-[11px] text-muted-foreground">
                      {centre.diagnostics.appVersion} · {centre.diagnostics.buildId} ·{" "}
                      {centre.diagnostics.environment}
                    </span>
                  </div>
                )}
              </Panel>
            </>
          )}
          {section === "GO_LIVE" && (
            <Panel>
              <PanelHead
                title="Go-live control"
                sub="Authoritative state transitions with security and schema locks"
                right={<ShieldCheck className="h-4 w-4 text-primary" />}
              />
              <div className="space-y-4 p-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Btn
                    onClick={() =>
                      void run(
                        () => centre.transitionGoLive("READY_FOR_REVIEW"),
                        "Moved to readiness review.",
                      )
                    }
                  >
                    Ready for review
                  </Btn>
                  <Btn
                    onClick={() =>
                      void run(
                        () => centre.transitionGoLive("READY_FOR_GO_LIVE"),
                        "Marked ready for go-live approval.",
                      )
                    }
                  >
                    Ready for go-live
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={blockers.length > 0}
                    onClick={() =>
                      void run(() => centre.transitionGoLive("LIVE"), "Restaurant is now LIVE.")
                    }
                  >
                    Go live
                  </Btn>
                </div>
                {blockers.length > 0 && (
                  <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-[12px] font-semibold text-danger">
                    Resolve {blockers.length} blocker{blockers.length === 1 ? "" : "s"} before LIVE.
                    Security and schema blockers are never overridable.
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function decimalRateRatio(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) {
    throw new Error("Enter a positive exchange rate with up to 8 decimal places.");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  if (numerator <= 0n || numerator > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Exchange rate is outside the supported precision range.");
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: Number(numerator / divisor),
    denominator: Number(denominator / divisor),
  };
}

function greatestCommonDivisor(left: bigint, right: bigint) {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  min?: string;
  max?: string;
  maxLength?: number;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        required
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        {...props}
      />
    </label>
  );
}

function ImportPanel({
  kind,
  busy,
  preview,
  duplicateStrategy,
  setDuplicateStrategy,
  onFile,
  onCommit,
}: {
  kind: ImportKind;
  busy: boolean;
  preview: ImportPreview | null;
  duplicateStrategy: DuplicateStrategy;
  setDuplicateStrategy: (value: DuplicateStrategy) => void;
  onFile: (file: File) => Promise<void>;
  onCommit: () => void;
}) {
  return (
    <Panel>
      <PanelHead
        title={`${kind.replaceAll("_", " ")} import`}
        sub="Secure upload, parse, preview, validation and explicit idempotent commit"
        right={<FileSpreadsheet className="h-4 w-4 text-primary" />}
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          <label className={labelClass}>
            Duplicate strategy
            <select
              value={duplicateStrategy}
              onChange={(event) => setDuplicateStrategy(event.target.value as DuplicateStrategy)}
              className={inputClass}
            >
              <option value="ERROR">Error</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="SKIP">Skip</option>
            </select>
          </label>
          <label
            className={cn(
              "flex min-h-32 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-secondary/20 px-4 text-center text-[13px] font-semibold",
              busy && "opacity-60",
            )}
          >
            <Upload className="h-4 w-4 text-primary" />
            {busy ? "Validating..." : "Upload CSV or XLSX"}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
                event.target.value = "";
              }}
            />
          </label>
          {preview?.canCommit && (
            <Btn variant="primary" className="w-full" onClick={onCommit} disabled={busy}>
              Commit {preview.validCount} rows
            </Btn>
          )}
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr>
                <TH>#</TH>
                <TH>Row key</TH>
                <TH>Status</TH>
                <TH>Errors</TH>
                <TH>Warnings</TH>
              </tr>
            </thead>
            <tbody>
              {preview?.rows.slice(0, 25).map((row) => (
                <tr key={`${row.rowNumber}-${row.rowKey}`}>
                  <TD className="num">{row.rowNumber}</TD>
                  <TD className="font-semibold">{row.rowKey}</TD>
                  <TD>
                    <Status>{row.status}</Status>
                  </TD>
                  <TD>{row.errors.map((item) => item.message).join("; ") || "-"}</TD>
                  <TD>{row.warnings.map((item) => item.message).join("; ") || "-"}</TD>
                </tr>
              ))}
              {!preview && (
                <tr>
                  <TD colSpan={5} className="py-12 text-center text-muted-foreground">
                    No authoritative preview loaded.
                  </TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function ProviderPanel({
  category,
  centre,
  providerId,
  setProviderId,
  providerBranchId,
  setProviderBranchId,
  environment,
  setEnvironment,
  configuration,
  setConfiguration,
  credentials,
  setCredentials,
  onSubmit,
  busy,
}: {
  category: string;
  centre: ReturnType<typeof useSetupCentre>;
  providerId: string;
  setProviderId: (value: string) => void;
  providerBranchId: string;
  setProviderBranchId: (value: string) => void;
  environment: string;
  setEnvironment: (value: string) => void;
  configuration: Record<string, string>;
  setConfiguration: (value: Record<string, string>) => void;
  credentials: Record<string, string>;
  setCredentials: (value: Record<string, string>) => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
}) {
  const providers = centre.providers.filter((item) => item.category === category && item.enabled);
  const provider = providers.find((item) => item.id === providerId);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel>
        <PanelHead
          title={`${category === "PAYMENT" ? "Payment" : "Delivery"} connections`}
          sub={`${centre.integrations.filter((item) => item.category === category).length} configured`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr>
                <TH>Provider</TH>
                <TH>Environment</TH>
                <TH>Status</TH>
                <TH>Health</TH>
                <TH className="text-right">Queue</TH>
              </tr>
            </thead>
            <tbody>
              {centre.integrations
                .filter((item) => item.category === category)
                .map((item) => (
                  <tr key={item.connectionId}>
                    <TD className="font-semibold">{item.displayName}</TD>
                    <TD>{item.environment}</TD>
                    <TD>
                      <Status>{item.status}</Status>
                    </TD>
                    <TD>
                      <Status>{item.health}</Status>
                    </TD>
                    <TD className="num text-right">{item.pendingQueue}</TD>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel>
        <PanelHead
          title="Configure connection"
          sub="Adapter-declared fields and capabilities"
          right={<Link2 className="h-4 w-4 text-primary" />}
        />
        <form onSubmit={onSubmit} className="space-y-3 p-4">
          <label className={labelClass}>
            Provider
            <select
              required
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select registered provider</option>
              {providers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Branch scope
            <select
              value={providerBranchId}
              onChange={(event) => setProviderBranchId(event.target.value)}
              className={inputClass}
            >
              <option value="">Tenant scope</option>
              {centre.structure.branches.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Environment
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              className={inputClass}
            >
              <option value="SANDBOX">Sandbox</option>
              <option value="PRODUCTION">Production</option>
            </select>
          </label>
          {provider &&
            Object.entries(provider.configurationSchema).map(([key, schema]) => (
              <label className={labelClass} key={key}>
                {humanize(key)}
                {schema.type === "boolean" ? (
                  <select
                    value={configuration[key] ?? "false"}
                    onChange={(event) =>
                      setConfiguration({ ...configuration, [key]: event.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="false">Disabled</option>
                    <option value="true">Enabled</option>
                  </select>
                ) : (
                  <input
                    value={configuration[key] ?? ""}
                    onChange={(event) =>
                      setConfiguration({ ...configuration, [key]: event.target.value })
                    }
                    className={inputClass}
                  />
                )}
              </label>
            ))}
          {provider?.credentialFields.map((key) => (
            <label className={labelClass} key={key}>
              {humanize(key)}
              <input
                type="password"
                autoComplete="new-password"
                value={credentials[key] ?? ""}
                onChange={(event) => setCredentials({ ...credentials, [key]: event.target.value })}
                className={inputClass}
              />
            </label>
          ))}
          {provider && (
            <div className="flex flex-wrap gap-1.5">
              {provider.capabilities.slice(0, 8).map((item) => (
                <Status key={item}>{item.replaceAll("_", " ")}</Status>
              ))}
            </div>
          )}
          <Btn type="submit" variant="primary" className="w-full" disabled={!provider || busy}>
            Save connection
          </Btn>
        </form>
      </Panel>
    </div>
  );
}

function MappingPanel({
  centre,
  mapping,
  setMapping,
  onSubmit,
  busy,
}: {
  centre: ReturnType<typeof useSetupCentre>;
  mapping: { connectionId: string; resourceType: string; internalId: string; externalId: string };
  setMapping: (value: {
    connectionId: string;
    resourceType: string;
    internalId: string;
    externalId: string;
  }) => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
}) {
  const internalOptions =
    mapping.resourceType === "STORE"
      ? centre.structure.branches.map((item) => ({ id: item.id, name: item.name }))
      : [];
  return (
    <Panel>
      <PanelHead
        title="Store and menu mapping"
        sub="Explicit reviewed mappings; ambiguous suggestions remain conflicts"
        right={<Link2 className="h-4 w-4 text-primary" />}
      />
      <form onSubmit={onSubmit} className="grid gap-3 p-4 md:grid-cols-2">
        <label className={labelClass}>
          Connection
          <select
            required
            value={mapping.connectionId}
            onChange={(event) => setMapping({ ...mapping, connectionId: event.target.value })}
            className={inputClass}
          >
            <option value="">Select connection</option>
            {centre.integrations.map((item) => (
              <option value={item.connectionId} key={item.connectionId}>
                {item.displayName} · {item.environment}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Resource type
          <select
            value={mapping.resourceType}
            onChange={(event) =>
              setMapping({ ...mapping, resourceType: event.target.value, internalId: "" })
            }
            className={inputClass}
          >
            <option value="STORE">Store</option>
            <option value="ITEM">Menu item</option>
            <option value="MODIFIER_GROUP">Modifier group</option>
            <option value="MODIFIER">Modifier</option>
            <option value="TAX">Tax</option>
          </select>
        </label>
        {internalOptions.length ? (
          <label className={labelClass}>
            Seramet resource
            <select
              required
              value={mapping.internalId}
              onChange={(event) => setMapping({ ...mapping, internalId: event.target.value })}
              className={inputClass}
            >
              <option value="">Select branch</option>
              {internalOptions.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Field
            label="Seramet resource ID"
            value={mapping.internalId}
            onChange={(value) => setMapping({ ...mapping, internalId: value })}
          />
        )}
        <Field
          label="External resource ID"
          value={mapping.externalId}
          onChange={(value) => setMapping({ ...mapping, externalId: value })}
        />
        <div className="md:col-span-2">
          <Btn type="submit" variant="primary" disabled={busy}>
            Commit reviewed mapping
          </Btn>
        </div>
      </form>
    </Panel>
  );
}

function DevicePanel({
  centre,
  device,
  setDevice,
  onSubmit,
  busy,
  onTest,
}: {
  centre: ReturnType<typeof useSetupCentre>;
  device: {
    branchId: string;
    deviceType: string;
    name: string;
    role: string;
    stationId: string;
    paperSize: string;
  };
  setDevice: (value: {
    branchId: string;
    deviceType: string;
    name: string;
    role: string;
    stationId: string;
    paperSize: string;
  }) => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  onTest: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel>
        <PanelHead
          title="Device health"
          sub="Reported state only; missing heartbeats remain UNKNOWN"
          right={<HardDrive className="h-4 w-4 text-primary" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr>
                <TH>Device</TH>
                <TH>Branch</TH>
                <TH>Type</TH>
                <TH>Trust</TH>
                <TH>Health</TH>
                <TH />
              </tr>
            </thead>
            <tbody>
              {centre.devices.map((item) => (
                <tr key={item.deviceId}>
                  <TD className="font-semibold">{item.name}</TD>
                  <TD>
                    {centre.structure.branches.find((branch) => branch.id === item.branchId)
                      ?.name ?? item.branchId}
                  </TD>
                  <TD>{item.deviceType}</TD>
                  <TD>
                    <Status>{item.trustStatus}</Status>
                  </TD>
                  <TD>
                    <Status>{item.health}</Status>
                  </TD>
                  <TD className="text-right">
                    <Btn onClick={() => onTest(item.deviceId)} title="Test print">
                      <Printer className="h-4 w-4" />
                    </Btn>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel>
        <PanelHead title="Register device" sub="Branch, station and role routing" />
        <form onSubmit={onSubmit} className="space-y-3 p-4">
          <label className={labelClass}>
            Branch
            <select
              required
              value={device.branchId}
              onChange={(event) => setDevice({ ...device, branchId: event.target.value })}
              className={inputClass}
            >
              <option value="">Select branch</option>
              {centre.structure.branches.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Device type
            <select
              value={device.deviceType}
              onChange={(event) => setDevice({ ...device, deviceType: event.target.value })}
              className={inputClass}
            >
              <option value="PRINTER">Printer</option>
              <option value="KDS">KDS</option>
              <option value="POS_TERMINAL">POS terminal</option>
              <option value="CASH_DRAWER">Cash drawer</option>
              <option value="DISPLAY">Display</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <Field
            label="Device name"
            value={device.name}
            onChange={(value) => setDevice({ ...device, name: value })}
          />
          <Field
            label="Role"
            value={device.role}
            onChange={(value) => setDevice({ ...device, role: value })}
          />
          <label className={labelClass}>
            Station
            <select
              value={device.stationId}
              onChange={(event) => setDevice({ ...device, stationId: event.target.value })}
              className={inputClass}
            >
              <option value="">No station</option>
              {centre.options.stations
                .filter((item) => String(item["branch_id"]) === device.branchId)
                .map((item) => (
                  <option value={String(item["id"])} key={String(item["id"])}>
                    {String(item["name"])}
                  </option>
                ))}
            </select>
          </label>
          <Field
            label="Paper size"
            value={device.paperSize}
            onChange={(value) => setDevice({ ...device, paperSize: value })}
          />
          <Btn type="submit" variant="primary" className="w-full" disabled={busy}>
            Register device
          </Btn>
        </form>
      </Panel>
    </div>
  );
}

function OpeningStockPanel({
  centre,
  value,
  setValue,
  onSubmit,
  busy,
  currency,
  selectedBranch,
  onApprove,
  onPost,
}: {
  centre: ReturnType<typeof useSetupCentre>;
  value: {
    branchId: string;
    warehouseId: string;
    inventoryItemId: string;
    unitId: string;
    businessDate: string;
    quantity: string;
    unitCost: string;
  };
  setValue: (value: {
    branchId: string;
    warehouseId: string;
    inventoryItemId: string;
    unitId: string;
    businessDate: string;
    quantity: string;
    unitCost: string;
  }) => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  currency: string;
  selectedBranch: string;
  onApprove: (id: string) => void;
  onPost: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Panel>
        <PanelHead
          title="Prepare opening stock"
          sub={`${selectedBranch || "Branch"} · append-only`}
        />
        <form onSubmit={onSubmit} className="space-y-3 p-4">
          <label className={labelClass}>
            Branch
            <select
              required
              value={value.branchId}
              onChange={(event) =>
                setValue({ ...value, branchId: event.target.value, warehouseId: "" })
              }
              className={inputClass}
            >
              <option value="">Select branch</option>
              {centre.structure.branches.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Warehouse
            <select
              required
              value={value.warehouseId}
              onChange={(event) => setValue({ ...value, warehouseId: event.target.value })}
              className={inputClass}
            >
              <option value="">Select warehouse</option>
              {centre.options.warehouses
                .filter((item) => String(item["branch_id"]) === value.branchId)
                .map((item) => (
                  <option value={String(item["id"])} key={String(item["id"])}>
                    {String(item["name"])}
                  </option>
                ))}
            </select>
          </label>
          <label className={labelClass}>
            Inventory item
            <select
              required
              value={value.inventoryItemId}
              onChange={(event) => {
                const item = centre.options.inventoryItems.find(
                  (candidate) => String(candidate["id"]) === event.target.value,
                );
                setValue({
                  ...value,
                  inventoryItemId: event.target.value,
                  unitId: String(item?.["base_unit_id"] ?? ""),
                });
              }}
              className={inputClass}
            >
              <option value="">Select item</option>
              {centre.options.inventoryItems.map((item) => (
                <option value={String(item["id"])} key={String(item["id"])}>
                  {String(item["name"])}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Unit
            <select
              required
              value={value.unitId}
              onChange={(event) => setValue({ ...value, unitId: event.target.value })}
              className={inputClass}
            >
              <option value="">Select unit</option>
              {centre.options.units.map((item) => (
                <option value={String(item["id"])} key={String(item["id"])}>
                  {String(item["code"])}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Business date"
            type="date"
            value={value.businessDate}
            onChange={(next) => setValue({ ...value, businessDate: next })}
          />
          <Field
            label="Quantity"
            value={value.quantity}
            onChange={(next) => setValue({ ...value, quantity: next })}
          />
          <Field
            label={`Unit cost (${currency || "currency not configured"})`}
            value={value.unitCost}
            onChange={(next) => setValue({ ...value, unitCost: next })}
          />
          <Btn type="submit" variant="primary" className="w-full" disabled={busy || !currency}>
            Prepare batch
          </Btn>
        </form>
      </Panel>
      <Panel>
        <PanelHead
          title="Opening-stock reconciliation"
          sub="Review, approval, posting and movement trace"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr>
                <TH>Business date</TH>
                <TH>Branch</TH>
                <TH>Status</TH>
                <TH className="text-right">Value</TH>
                <TH>Approved</TH>
                <TH />
              </tr>
            </thead>
            <tbody>
              {centre.openingStock.map((row) => (
                <tr key={String(row["id"])}>
                  <TD>{String(row["business_date"])}</TD>
                  <TD>
                    {centre.structure.branches.find((item) => item.id === String(row["branch_id"]))
                      ?.name ?? String(row["branch_id"])}
                  </TD>
                  <TD>
                    <Status>{String(row["status"])}</Status>
                  </TD>
                  <TD className="num text-right">
                    {currency
                      ? formatMinor(Number(row["total_value_minor"] ?? 0), currency)
                      : String(row["total_value_minor"])}
                  </TD>
                  <TD>{row["approved_at"] ? "Yes" : "No"}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      {row["status"] === "REVIEW" && (
                        <Btn onClick={() => onApprove(String(row["id"]))}>Approve</Btn>
                      )}
                      {row["status"] === "APPROVED" && (
                        <Btn variant="primary" onClick={() => onPost(String(row["id"]))}>
                          Post
                        </Btn>
                      )}
                    </div>
                  </TD>
                </tr>
              ))}
              {centre.openingStock.length === 0 && (
                <tr>
                  <TD colSpan={6} className="py-12 text-center text-muted-foreground">
                    No opening-stock batches.
                  </TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}
function parseMicroUnits(value: string) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error("Quantity must have at most six decimal places");
  const micro = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Quantity exceeds the safe range");
  return Number(micro);
}
function parseRateBps(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Rate must have at most two decimal places");
  const bps = Number(match[1]!) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (bps > 10000) throw new Error("Rate cannot exceed 100%");
  return bps;
}
