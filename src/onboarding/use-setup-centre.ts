import type { PersistedImportProgress } from "@/onboarding/menu-import-progress";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createScopedReadGuard } from "@/lib/scoped-read-guard";
import { getSerametAccessToken } from "@/lib/access-token";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useAppContext } from "@/lib/app-context";
import type {
  DuplicateStrategy,
  ImportKind,
  ImportPreview,
  IntegrationHealthRow,
  DeviceHealthRow,
  SetupSummary,
  TestRun,
} from "@/onboarding/types";
import type {
  CountryReference,
  CurrencyReference,
  OnboardingStepInput,
  OnboardingWizardState,
} from "@/onboarding/location-currency-types";
import type { HistoricalSalesPreview } from "@/onboarding/historical-sales-migration-service";
import type { ManualMenuItemCreateInput, MenuItemUpdateInput } from "@/onboarding/manual-menu-item";
import { menuImageUploadFile } from "@/lib/menu-image-mapping";
import { onboardingStep } from "@/onboarding/onboarding-steps";

export type RecentMenuImport = {
  id: string;
  originalName: string;
  status: ImportPreview["status"];
  rowCount: number;
  templateVersion: number;
  duplicateStrategy: DuplicateStrategy;
  targetBranchIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SetupProviderDefinition = {
  id: string;
  code: string;
  displayName: string;
  category: string;
  version: string;
  countries: string[];
  capabilities: string[];
  configurationSchema: Record<string, { type?: string }>;
  credentialFields: string[];
  enabled: boolean;
  documentationUrl?: string;
};

export type SetupStructure = {
  brands: Array<{ id: string; code: string; name: string; active: number }>;
  branches: Array<{
    id: string;
    brandId: string | null;
    code: string;
    name: string;
    timezone: string;
    businessDayCutoffMinutes: number;
    active: boolean;
    lifecycleState: "DRAFT" | "CONFIGURING" | "ACTIVE" | "SUSPENDED" | "CLOSED";
    isBootstrap: boolean;
    version: number;
    negativeStockPolicy: string;
    inventoryEnabled: boolean | null;
    recipesRequired: boolean | null;
    paymentsRequired: boolean | null;
    printingRequired: boolean | null;
    kdsRequired: boolean | null;
  }>;
};

export type SetupBusinessProfile = {
  legalName: string;
  tradingName: string;
  defaultCurrency: string;
  timezone: string;
  locale: string;
  countryCode: string;
  accountingMode: string;
  taxConfigurationReference: string | null;
  logoAssetReference: string | null;
  defaultDocumentFooter: string | null;
  fiscalSettings: Record<string, unknown>;
  contact: Record<string, string>;
  legalIdentifiers: Record<string, string>;
  documentBranding: Record<string, unknown>;
};

export type SetupOptions = {
  accounts: Array<Record<string, unknown>>;
  roles: Array<Record<string, unknown>>;
  warehouses: Array<Record<string, unknown>>;
  stations: Array<Record<string, unknown>>;
  documentTemplates: Array<Record<string, unknown>>;
  inventoryItems: Array<Record<string, unknown>>;
  units: Array<Record<string, unknown>>;
  taxRules: Array<Record<string, unknown>>;
};

export type SetupMenuCatalogItem = {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  category_code: string;
  description: string | null;
  selling_price_minor: number;
  currency: string;
  station_id: string | null;
  recipe_reference: string | null;
  sellable: number;
  active: number;
  branch_price_minor: number | null;
  available: number | null;
  branch_activated: number;
  tax_rule_id: string | null;
  service_charge_applicable: number;
  online_price_minor: number | null;
  image_url: string | null;
  unit_of_measure: string | null;
};

export type SetupDiagnostics = {
  appVersion: string;
  buildId: string;
  environment: string;
  schema: { current: number; required: number; pending: number };
  runtimeIssues: string[];
  database: string;
  workers: Record<string, number>;
  featureFlags: Array<{ key: string; enabled: boolean }>;
  backup: { status: string; completedAt?: string; verifiedAt?: string };
  redaction: Record<string, string>;
};

export type HistoricalSalesMigrationState = {
  completed: boolean;
  committed: Record<string, unknown> | null;
  latest: Record<string, unknown> | null;
};

export type FileImportCapability = { available: boolean; reason: string | null };

/**
 * The last data seen per scope (business, branch, user), kept for this tab only. Reopening
 * Setup Centre shows it at once while a refresh runs; nothing is stored on the device.
 */
type SetupSnapshot = {
  setup: SetupSummary | null;
  integrations: IntegrationHealthRow[];
  devices: DeviceHealthRow[];
  providers: SetupProviderDefinition[];
  structure: SetupStructure;
  profile: SetupBusinessProfile | null;
  options: SetupOptions;
  mappings: Array<Record<string, unknown>>;
  openingStock: Array<Record<string, unknown>>;
  menuCatalog: SetupMenuCatalogItem[];
  diagnostics: SetupDiagnostics | null;
  onboarding: OnboardingWizardState | null;
  countries: CountryReference[];
  currencies: CurrencyReference[];
  historicalSalesState: HistoricalSalesMigrationState | null;
  fileImportCapability: FileImportCapability;
};
const lastSnapshot = new Map<string, SetupSnapshot>();

export function useSetupCentre() {
  const { activeTenantId, branchId, currentUser, isAllBranches, role } = useAppContext();
  const scopeKey = `${activeTenantId}:${branchId}:${currentUser.id}:${role}:${isAllBranches}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const readGuard = useMemo(() => createScopedReadGuard(() => scopeRef.current), []);
  const catalogGuard = useMemo(() => createScopedReadGuard(() => scopeRef.current), []);
  const onboardingGuard = useMemo(() => createScopedReadGuard(() => scopeRef.current), []);
  // Separate from step saves, so a quick Continue cannot abort the refresh a step started.
  const profileRefreshGuard = useMemo(() => createScopedReadGuard(() => scopeRef.current), []);
  const structureRefreshGuard = useMemo(() => createScopedReadGuard(() => scopeRef.current), []);
  const headers = useMemo(() => {
    const token = getSerametAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-user-id": currentUser.id,
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      "x-seramet-user": currentUser.name,
      "x-seramet-role": role,
      ...(isAllBranches ? { "x-seramet-branch-scope": "ALL" } : {}),
    };
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, isAllBranches, role]);
  const cached = lastSnapshot.get(scopeKey);
  const [setup, setSetup] = useState<SetupSummary | null>(cached?.setup ?? null);
  const [integrations, setIntegrations] = useState<IntegrationHealthRow[]>(
    cached?.integrations ?? [],
  );
  const [devices, setDevices] = useState<DeviceHealthRow[]>(cached?.devices ?? []);
  const [providers, setProviders] = useState<SetupProviderDefinition[]>(cached?.providers ?? []);
  const [structure, setStructure] = useState<SetupStructure>(
    cached?.structure ?? { brands: [], branches: [] },
  );
  const [profile, setProfile] = useState<SetupBusinessProfile | null>(cached?.profile ?? null);
  const [options, setOptions] = useState<SetupOptions>(
    cached?.options ?? {
      accounts: [],
      roles: [],
      warehouses: [],
      stations: [],
      documentTemplates: [],
      inventoryItems: [],
      units: [],
      taxRules: [],
    },
  );
  const [mappings, setMappings] = useState<Array<Record<string, unknown>>>(cached?.mappings ?? []);
  const [openingStock, setOpeningStock] = useState<Array<Record<string, unknown>>>(
    cached?.openingStock ?? [],
  );
  const [menuCatalog, setMenuCatalog] = useState<SetupMenuCatalogItem[]>(cached?.menuCatalog ?? []);
  const [menuCatalogStatus, setMenuCatalogStatus] = useState<"loading" | "ready" | "error">(
    cached ? "ready" : "loading",
  );
  const [menuCatalogError, setMenuCatalogError] = useState("");
  const [diagnostics, setDiagnostics] = useState<SetupDiagnostics | null>(
    cached?.diagnostics ?? null,
  );
  const [onboarding, setOnboarding] = useState<OnboardingWizardState | null>(
    cached?.onboarding ?? null,
  );
  const [countries, setCountries] = useState<CountryReference[]>(cached?.countries ?? []);
  const [currencies, setCurrencies] = useState<CurrencyReference[]>(cached?.currencies ?? []);
  const [historicalSalesState, setHistoricalSalesState] =
    useState<HistoricalSalesMigrationState | null>(cached?.historicalSalesState ?? null);
  const [fileImportCapability, setFileImportCapability] = useState<FileImportCapability>(
    cached?.fileImportCapability ?? {
      available: false,
      reason: "Checking file-import security configuration",
    },
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(cached ? "ready" : "loading");
  const [error, setError] = useState("");
  const [unavailableResources, setUnavailableResources] = useState<string[]>([]);

  const get = useCallback(
    async <T>(path: string, signal?: AbortSignal) => {
      const response = await authenticatedFetch(path, { headers, signal });
      const body = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw Object.assign(
          new Error(body.message ?? body.error ?? `Setup request failed (${response.status})`),
          { status: response.status },
        );
      return body;
    },
    [headers],
  );

  const refresh = useCallback(async () => {
    if (scopeRef.current !== scopeKey) return;
    const read = readGuard.begin(scopeKey);
    const catalogRead = catalogGuard.begin(scopeKey);
    const readGet = <T>(path: string) => get<T>(path, read.signal);
    const warm = lastSnapshot.has(scopeKey);
    if (!warm) {
      setStatus("loading");
      setMenuCatalogStatus("loading");
    }
    setError("");
    setMenuCatalogError("");
    // The page can draw once the summary, structure and options are in; the rest fills in.
    let essentials = 0;
    const essential = () => {
      if (++essentials === 3 && read.isCurrent()) setStatus("ready");
    };
    const query = isAllBranches ? "" : `?branchId=${encodeURIComponent(branchId)}`;
    const [
      summary,
      providerHealth,
      deviceHealth,
      providerDefinitions,
      organisation,
      business,
      setupOptions,
      providerMappings,
      opening,
      catalog,
      diagnosticState,
      onboardingState,
      referenceState,
      historicalSales,
      importCapability,
    ] = await Promise.allSettled([
      readGet<{ setup: SetupSummary }>(`/api/seramet/setup/centre${query}`).then((value) => {
        if (read.isCurrent()) setSetup(value.setup);
        essential();
        return value;
      }),
      readGet<{ integrations: IntegrationHealthRow[] }>("/api/seramet/setup/integration-health"),
      readGet<{ devices: DeviceHealthRow[] }>("/api/seramet/setup/device-health"),
      readGet<{ providers: SetupProviderDefinition[] }>("/api/seramet/setup/providers"),
      readGet<SetupStructure>("/api/seramet/setup/organisation-structure").then((value) => {
        if (read.isCurrent()) setStructure({ brands: value.brands, branches: value.branches });
        essential();
        return value;
      }),
      readGet<{ profile: SetupBusinessProfile }>("/api/seramet/setup/business-profile").then(
        (value) => {
          if (read.isCurrent()) setProfile(value.profile);
          return value;
        },
      ),
      readGet<{ options: SetupOptions }>(`/api/seramet/setup/options${query}`).then((value) => {
        if (read.isCurrent()) setOptions(value.options);
        essential();
        return value;
      }),
      readGet<{ mappings: Array<Record<string, unknown>> }>("/api/seramet/setup/provider-mappings"),
      readGet<{ batches: Array<Record<string, unknown>> }>(
        `/api/seramet/setup/opening-stock${query}`,
      ),
      readGet<{ items: SetupMenuCatalogItem[] }>(`/api/seramet/setup/menu-catalog${query}`),
      readGet<{ diagnostics: SetupDiagnostics }>("/api/seramet/setup/diagnostics"),
      readGet<{ onboarding: OnboardingWizardState }>("/api/seramet/setup/onboarding"),
      readGet<{ countries: CountryReference[]; currencies: CurrencyReference[] }>(
        "/api/seramet/setup/reference/location-currency",
      ),
      readGet<{ state: HistoricalSalesMigrationState }>("/api/seramet/setup/historical-sales"),
      readGet<{ capability: FileImportCapability }>("/api/seramet/setup/imports/capability"),
    ] as const);
    if (!read.isCurrent()) return;
    if (summary.status === "fulfilled") setSetup(summary.value.setup);
    else setSetup(null);
    if (providerHealth.status === "fulfilled") setIntegrations(providerHealth.value.integrations);
    else setIntegrations([]);
    if (deviceHealth.status === "fulfilled") setDevices(deviceHealth.value.devices);
    else setDevices([]);
    if (providerDefinitions.status === "fulfilled")
      setProviders(providerDefinitions.value.providers);
    if (organisation.status === "fulfilled") {
      setStructure({ brands: organisation.value.brands, branches: organisation.value.branches });
    }
    if (business.status === "fulfilled") setProfile(business.value.profile);
    if (setupOptions.status === "fulfilled") setOptions(setupOptions.value.options);
    if (providerMappings.status === "fulfilled") setMappings(providerMappings.value.mappings);
    if (opening.status === "fulfilled") setOpeningStock(opening.value.batches);
    if (diagnosticState.status === "fulfilled") setDiagnostics(diagnosticState.value.diagnostics);
    if (onboardingState.status === "fulfilled") setOnboarding(onboardingState.value.onboarding);
    if (referenceState.status === "fulfilled") {
      setCountries(referenceState.value.countries);
      setCurrencies(referenceState.value.currencies);
    }
    if (historicalSales.status === "fulfilled")
      setHistoricalSalesState(historicalSales.value.state);
    if (importCapability.status === "fulfilled")
      setFileImportCapability(importCapability.value.capability);
    else
      setFileImportCapability({
        available: false,
        reason: "File-import security configuration could not be verified",
      });
    if (catalogRead.isCurrent() && catalog.status === "fulfilled") {
      setMenuCatalog(catalog.value.items);
      setMenuCatalogStatus("ready");
    } else if (catalogRead.isCurrent() && catalog.status === "rejected") {
      setMenuCatalogError(
        failureMessage(catalog.reason, "Authoritative menu catalogue is unavailable"),
      );
      setMenuCatalogStatus("error");
    }
    const resources = [
      ["setup summary", summary],
      ["provider health", providerHealth],
      ["device health", deviceHealth],
      ["provider definitions", providerDefinitions],
      ["organisation", organisation],
      ["business profile", business],
      ["setup options", setupOptions],
      ["provider mappings", providerMappings],
      ["opening stock", opening],
      ["menu catalogue", catalog],
      ["diagnostics", diagnosticState],
      ["onboarding", onboardingState],
      ["location and currency references", referenceState],
      ["historical sales migration", historicalSales],
      ["file import capability", importCapability],
    ] as const;
    // A business that hasn't started guided setup has no onboarding record yet: not a fault.
    const failed = resources.filter(
      ([name, result]) =>
        result.status === "rejected" &&
        !(name === "onboarding" && (result.reason as { status?: number })?.status === 404),
    );
    // Name what didn't load; the server's wording stays out of the page.
    const failures = failed.length ? [failed.map(([name]) => name).join(", ")] : [];
    setUnavailableResources(
      resources.flatMap(([name, result]) => (result.status === "rejected" ? [name] : [])),
    );
    setError(failures.join("; "));
    const criticalFailure = [summary, organisation, setupOptions].some(
      (result) => result.status === "rejected",
    );
    setStatus(criticalFailure ? "error" : "ready");
    const value = <T>(result: PromiseSettledResult<T>) =>
      result.status === "fulfilled" ? result.value : undefined;
    if (!criticalFailure)
      lastSnapshot.set(scopeKey, {
        setup: value(summary)?.setup ?? null,
        integrations: value(providerHealth)?.integrations ?? [],
        devices: value(deviceHealth)?.devices ?? [],
        providers: value(providerDefinitions)?.providers ?? [],
        structure: {
          brands: value(organisation)?.brands ?? [],
          branches: value(organisation)?.branches ?? [],
        },
        profile: value(business)?.profile ?? null,
        options: value(setupOptions)!.options,
        mappings: value(providerMappings)?.mappings ?? [],
        openingStock: value(opening)?.batches ?? [],
        menuCatalog: value(catalog)?.items ?? [],
        diagnostics: value(diagnosticState)?.diagnostics ?? null,
        onboarding: value(onboardingState)?.onboarding ?? null,
        countries: value(referenceState)?.countries ?? [],
        currencies: value(referenceState)?.currencies ?? [],
        historicalSalesState: value(historicalSales)?.state ?? null,
        fileImportCapability: value(importCapability)?.capability ?? {
          available: false,
          reason: "File-import security configuration could not be verified",
        },
      });
  }, [branchId, get, isAllBranches, readGuard, catalogGuard, scopeKey]);

  /** Refresh only the item catalogue after a verified import. */
  const refreshMenuCatalog = useCallback(async () => {
    if (scopeRef.current !== scopeKey) return;
    const read = catalogGuard.begin(scopeKey);
    const query = isAllBranches ? "" : `?branchId=${encodeURIComponent(branchId)}`;
    setMenuCatalogStatus("loading");
    try {
      const result = await get<{ items: SetupMenuCatalogItem[] }>(
        `/api/seramet/setup/menu-catalog${query}`,
        read.signal,
      );
      if (!read.isCurrent()) return;
      setMenuCatalog(result.items);
      setMenuCatalogError("");
      setMenuCatalogStatus("ready");
    } catch (error) {
      if (!read.isCurrent()) return;
      setMenuCatalogError(failureMessage(error, "Authoritative menu catalogue is unavailable"));
      setMenuCatalogStatus("error");
    }
  }, [branchId, get, isAllBranches, catalogGuard, scopeKey]);

  useEffect(() => {
    // On a scope change, show that scope's last data if this tab has seen it; else start empty.
    const known = lastSnapshot.get(scopeKey);
    setSetup(known?.setup ?? null);
    setMenuCatalog(known?.menuCatalog ?? []);
    setIntegrations(known?.integrations ?? []);
    setDevices(known?.devices ?? []);
    setMappings(known?.mappings ?? []);
    setOpeningStock(known?.openingStock ?? []);
    setDiagnostics(known?.diagnostics ?? null);
    setProviders(known?.providers ?? []);
    setStructure(known?.structure ?? { brands: [], branches: [] });
    setProfile(known?.profile ?? null);
    setOptions(
      known?.options ?? {
        accounts: [],
        roles: [],
        warehouses: [],
        stations: [],
        documentTemplates: [],
        inventoryItems: [],
        units: [],
        taxRules: [],
      },
    );
    setOnboarding(known?.onboarding ?? null);
    setCountries(known?.countries ?? []);
    setCurrencies(known?.currencies ?? []);
    setHistoricalSalesState(known?.historicalSalesState ?? null);
    setFileImportCapability(
      known?.fileImportCapability ?? {
        available: false,
        reason: "Checking file-import security configuration",
      },
    );
    setStatus(known ? "ready" : "loading");
    setMenuCatalogStatus(known ? "ready" : "loading");
    void refresh();
    return () => {
      readGuard.cancel();
      catalogGuard.cancel();
      onboardingGuard.cancel();
      profileRefreshGuard.cancel();
      structureRefreshGuard.cancel();
    };
  }, [
    refresh,
    scopeKey,
    readGuard,
    catalogGuard,
    onboardingGuard,
    profileRefreshGuard,
    structureRefreshGuard,
  ]);

  const send = useCallback(
    async <T>(path: string, body: unknown, method: "POST" | "PUT" | "PATCH" = "POST") => {
      const response = await authenticatedFetch(path, {
        method,
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.message ?? payload.error ?? `Setup command failed (${response.status})`,
        );
      return payload;
    },
    [headers],
  );

  const post = useCallback(<T>(path: string, body: unknown) => send<T>(path, body), [send]);

  // Light refresh for the guided onboarding: stations, roles and tax rules only.
  const refreshOptions = useCallback(async () => {
    if (scopeRef.current !== scopeKey) return;
    const query = isAllBranches ? "" : `?branchId=${encodeURIComponent(branchId)}`;
    const result = await get<{ options: SetupOptions }>(`/api/seramet/setup/options${query}`);
    if (scopeRef.current === scopeKey) setOptions(result.options);
  }, [branchId, get, isAllBranches, scopeKey]);

  const command = useCallback(
    async <T>(path: string, body: unknown) => {
      const payload = await post<T>(path, body);
      await refresh();
      return payload;
    },
    [post, refresh],
  );

  const saveOnboardingStep = useCallback(
    async (input: OnboardingStepInput) => {
      if (scopeRef.current !== scopeKey) throw new Error("Restaurant setup changed; try again");
      const read = onboardingGuard.begin(scopeKey);
      const payload = await post<{ onboarding: OnboardingWizardState }>(
        "/api/seramet/setup/onboarding/step",
        input,
      );
      if (!read.isCurrent()) return;
      if (!payload.onboarding || !Number.isInteger(payload.onboarding.currentStep)) {
        throw new Error("Saved onboarding progress could not be confirmed");
      }
      if (payload.onboarding.status === "COMPLETED") {
        await refresh();
        return;
      }
      // The save already returns authoritative progress; unrelated setup reads must not gate Continue.
      setOnboarding(payload.onboarding);
      const savedStep = onboardingStep(input.step)?.id;
      // Currency and business type write the business profile; the branch step writes structure.
      if (savedStep === "currency" || savedStep === "businessType") {
        const refreshRead = profileRefreshGuard.begin(scopeKey);
        void get<{ profile: SetupBusinessProfile }>(
          "/api/seramet/setup/business-profile",
          refreshRead.signal,
        )
          .then((result) => {
            if (refreshRead.isCurrent()) setProfile(result.profile);
          })
          .catch((reason) => {
            if (!refreshRead.isCurrent()) return;
            setUnavailableResources((current) => [...new Set([...current, "business profile"])]);
            setError(failureMessage(reason, "Business profile could not be refreshed"));
          });
      } else if (savedStep === "branch") {
        const refreshRead = structureRefreshGuard.begin(scopeKey);
        void get<SetupStructure>("/api/seramet/setup/organisation-structure", refreshRead.signal)
          .then((result) => {
            if (refreshRead.isCurrent()) setStructure(result);
          })
          .catch((reason) => {
            if (!refreshRead.isCurrent()) return;
            setUnavailableResources((current) => [...new Set([...current, "organisation"])]);
            setError(failureMessage(reason, "Organisation could not be refreshed"));
          });
      }
    },
    [get, onboardingGuard, post, profileRefreshGuard, refresh, scopeKey, structureRefreshGuard],
  );

  const resumeOnboarding = useCallback(async () => {
    if (scopeRef.current !== scopeKey) throw new Error("Restaurant setup changed; try again");
    const read = onboardingGuard.begin(scopeKey);
    const payload = await post<{ onboarding: OnboardingWizardState }>(
      "/api/seramet/setup/onboarding/resume",
      {},
    );
    if (!read.isCurrent()) return;
    if (payload.onboarding?.status !== "IN_PROGRESS") {
      throw new Error("Guided setup could not be reopened");
    }
    setOnboarding(payload.onboarding);
  }, [onboardingGuard, post, scopeKey]);

  const previewImport = useCallback(
    async (
      file: File,
      kind: ImportKind,
      duplicateStrategy: DuplicateStrategy,
      options?: {
        targetMode?: "TENANT_MASTER" | "SELECTED_BRANCHES" | "ROW_BRANCHES";
        targetBranchIds?: string[];
        columnMap?: Record<string, string>;
        referenceMap?: { stations?: Record<string, string> };
      },
    ) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      // Bind retry identity to the actual file bytes AND import settings. Reusing a file
      // with different branch targets or mappings must create a different request;
      // retrying the same request must resolve its existing durable job.
      const branchForRequest = !options?.targetMode && !isAllBranches ? branchId : undefined;
      const stableEntries = (values?: Record<string, string>) =>
        Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right));
      const requestIdentity = {
        tenantId: activeTenantId,
        branchId: branchForRequest ?? null,
        kind,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        duplicateStrategy,
        targetMode: options?.targetMode ?? null,
        targetBranchIds: [...(options?.targetBranchIds ?? [])].sort(),
        columnMap: stableEntries(options?.columnMap),
        stations: stableEntries(options?.referenceMap?.stations),
        fileDigest: Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
      };
      const identityDigest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(requestIdentity)),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const response = await authenticatedFetch("/api/seramet/setup/imports/uploads", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(!options?.targetMode && !isAllBranches ? { branchId } : {}),
          ...options,
          kind,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
          duplicateStrategy,
          idempotencyKey: `setup-import:${kind}:${identityDigest}`,
        }),
      });
      const submitted = (await response.json().catch(() => ({}))) as {
        job?: { jobId: string; status: string; result?: { importId?: string } };
        message?: string;
        error?: string;
      };
      if (!response.ok || !submitted.job) {
        throw new Error(
          submitted.message ?? submitted.error ?? `Import upload failed (${response.status})`,
        );
      }
      let importId = submitted.job.result?.importId;
      for (let attempt = 0; !importId && attempt < 120; attempt += 1) {
        await delay(1_000);
        const status = await get<{
          job: { status: string; result?: { importId?: string }; error?: string };
        }>(`/api/seramet/setup/imports/jobs/${encodeURIComponent(submitted.job.jobId)}`);
        if (["FAILED", "DEAD_LETTER"].includes(status.job.status)) {
          throw new Error(status.job.error ?? "File preparation failed before preview");
        }
        importId = status.job.result?.importId;
      }
      if (!importId)
        throw new Error("File preparation is still running; inspect the queued import later");
      return (
        await get<{ preview: ImportPreview }>(
          `/api/seramet/setup/imports/${encodeURIComponent(importId)}`,
        )
      ).preview;
    },
    [activeTenantId, branchId, get, headers, isAllBranches],
  );

  const recentMenuImports = useCallback(
    async () =>
      (await get<{ imports: RecentMenuImport[] }>("/api/seramet/setup/imports/recent")).imports,
    [get],
  );

  const inspectImport = useCallback(
    async (id: string) => {
      const response = await get<{ preview: ImportPreview }>(
        `/api/seramet/setup/imports/${encodeURIComponent(id)}`,
      );
      return response.preview;
    },
    [get],
  );

  const importStatus = useCallback(
    async (id: string) => {
      const response = await get<{
        result: {
          id: string;
          status: ImportPreview["status"];
          rowCount: number;
          updatedAt: string;
          verification?: ImportPreview["verification"];
          publishStatus?: ImportPreview["publishStatus"];
          publishedAt?: string | null;
          progress: PersistedImportProgress & {
            pending: number;
            processed: number;
            revision: number;
          };
          worker: { status: string; attempts: number; updatedAt: string } | null;
        };
      }>(`/api/seramet/setup/imports/${encodeURIComponent(id)}/status`);
      return response.result;
    },
    [get],
  );

  // A queued commit must return as soon as the server accepts it. Fetching every
  // setup dashboard endpoint before resolving keeps the spinner open unnecessarily.
  const commitImport = useCallback(
    async (preview: ImportPreview) => {
      const response = await authenticatedFetch(
        `/api/seramet/setup/imports/${encodeURIComponent(preview.id)}/commit`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ idempotencyKey: preview.commitKey, publishWhenVerified: true }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        result: {
          rows?: number;
          duplicate: boolean;
          queued: boolean;
          status: "QUEUED" | "COMMITTED";
          jobId?: string;
          verification?: ImportPreview["verification"];
        };
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Import commit failed (${response.status})`,
        );
      }
      if (payload.result?.status === "COMMITTED") void refreshMenuCatalog();
      return payload;
    },
    [headers, refreshMenuCatalog],
  );

  const publishImport = useCallback(
    async (preview: ImportPreview) => {
      if (!preview.publishKey) throw new Error("Approved import plan has no publish identity");
      const response = await authenticatedFetch(
        `/api/seramet/setup/imports/${encodeURIComponent(preview.id)}/publish`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ idempotencyKey: preview.publishKey }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        result?: {
          duplicate: boolean;
          queued: boolean;
          status: "PUBLISHING" | "PUBLISHED";
          jobId?: string;
          verification?: ImportPreview["verification"];
        };
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.result) {
        throw new Error(
          payload.message ?? payload.error ?? `Import publication failed (${response.status})`,
        );
      }
      if (payload.result.status === "PUBLISHED") void refreshMenuCatalog();
      return payload;
    },
    [headers, refreshMenuCatalog],
  );

  const createManualMenuItem = useCallback(
    async (input: ManualMenuItemCreateInput) => {
      const result = await command<{
        item: { id: string; code: string; branchId: string; status: "ACTIVE"; duplicate: boolean };
      }>("/api/seramet/setup/manual-menu-items", input);
      await refreshMenuCatalog();
      return result.item;
    },
    [command, refreshMenuCatalog],
  );

  const updateMenuItem = useCallback(
    async (itemId: string, input: MenuItemUpdateInput) => {
      const result = await send<{ item: { id: string; code: string } }>(
        `/api/seramet/setup/menu-items/${encodeURIComponent(itemId)}`,
        input,
        "PATCH",
      );
      await refreshMenuCatalog();
      return result.item;
    },
    [refreshMenuCatalog, send],
  );

  /** Resizes and uploads a menu photo; returns the stored object id to save on the item. */
  const uploadMenuImage = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.set("file", await menuImageUploadFile(file));
      form.set("objectClass", "PUBLIC_ASSET");
      // The browser sets the multipart Content-Type (with its boundary) itself.
      const { "Content-Type": _json, ...uploadHeaders } = headers;
      const response = await authenticatedFetch("/api/seramet/files", {
        method: "POST",
        headers: uploadHeaders,
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        object?: { id: string };
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.object) {
        throw new Error(payload.message ?? payload.error ?? "The photo couldn't be uploaded");
      }
      return payload.object.id;
    },
    [headers],
  );

  const runTest = useCallback(
    (input: { testType: TestRun["testType"]; targetType: string; targetId?: string }) =>
      command<{ test: TestRun }>("/api/seramet/setup/tests", {
        ...(!isAllBranches ? { branchId } : {}),
        ...input,
        idempotencyKey: `setup-test:${input.testType}:${input.targetId ?? input.targetType}:${Date.now()}`,
      }),
    [branchId, command, isAllBranches],
  );

  const transitionGoLive = useCallback(
    (toState: "READY_FOR_REVIEW" | "READY_FOR_GO_LIVE" | "LIVE" | "SUSPENDED") =>
      command("/api/seramet/setup/go-live", { toState }),
    [command],
  );

  const previewHistoricalSales = useCallback(
    async (file: File, sourceSystem: string) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await command<{ preview: HistoricalSalesPreview }>(
        "/api/seramet/setup/historical-sales/preview",
        {
          sourceSystem,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64: bytesToBase64(bytes),
        },
      );
      return result.preview;
    },
    [command],
  );

  const commitHistoricalSales = useCallback(
    (preview: HistoricalSalesPreview) =>
      command<{ result: { id: string; duplicate: boolean; status: "COMMITTED"; rows?: number } }>(
        `/api/seramet/setup/historical-sales/${encodeURIComponent(preview.id)}/commit`,
        { idempotencyKey: preview.commitKey },
      ),
    [command],
  );

  const skipHistoricalSales = useCallback(
    (reason: string) =>
      command<{ result: { id: string; status: "SKIPPED"; canImportLater: boolean } }>(
        "/api/seramet/setup/historical-sales/skip",
        { reason },
      ),
    [command],
  );

  return {
    setup,
    integrations,
    devices,
    providers,
    structure,
    profile,
    options,
    mappings,
    openingStock,
    menuCatalog,
    menuCatalogStatus,
    menuCatalogError,
    diagnostics,
    onboarding,
    countries,
    currencies,
    historicalSalesState,
    fileImportCapability,
    status,
    error,
    unavailableResources,
    refresh,
    command,
    send,
    refreshOptions,
    saveOnboardingStep,
    resumeOnboarding,
    previewImport,
    recentMenuImports,
    inspectImport,
    importStatus,
    refreshMenuCatalog,
    commitImport,
    publishImport,
    createManualMenuItem,
    updateMenuItem,
    uploadMenuImage,
    runTest,
    transitionGoLive,
    previewHistoricalSales,
    commitHistoricalSales,
    skipHistoricalSales,
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function failureMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
