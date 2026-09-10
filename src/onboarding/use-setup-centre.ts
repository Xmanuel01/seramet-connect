import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
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
  OnboardingWizardState,
} from "@/onboarding/location-currency-types";

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

export function useSetupCentre() {
  const { activeTenantId, branchId, currentUser, isAllBranches, role } = useAppContext();
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
  const [setup, setSetup] = useState<SetupSummary | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationHealthRow[]>([]);
  const [devices, setDevices] = useState<DeviceHealthRow[]>([]);
  const [providers, setProviders] = useState<SetupProviderDefinition[]>([]);
  const [structure, setStructure] = useState<SetupStructure>({ brands: [], branches: [] });
  const [profile, setProfile] = useState<SetupBusinessProfile | null>(null);
  const [options, setOptions] = useState<SetupOptions>({
    accounts: [],
    roles: [],
    warehouses: [],
    stations: [],
    documentTemplates: [],
    inventoryItems: [],
    units: [],
  });
  const [mappings, setMappings] = useState<Array<Record<string, unknown>>>([]);
  const [openingStock, setOpeningStock] = useState<Array<Record<string, unknown>>>([]);
  const [menuCatalog, setMenuCatalog] = useState<SetupMenuCatalogItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<SetupDiagnostics | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingWizardState | null>(null);
  const [countries, setCountries] = useState<CountryReference[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyReference[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const get = useCallback(
    async <T>(path: string) => {
      const response = await fetch(path, { headers });
      const body = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.message ?? body.error ?? `Setup request failed (${response.status})`);
      return body;
    },
    [headers],
  );

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
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
      ] = await Promise.all([
        get<{ setup: SetupSummary }>(`/api/seramet/setup/centre${query}`),
        get<{ integrations: IntegrationHealthRow[] }>("/api/seramet/setup/integration-health"),
        get<{ devices: DeviceHealthRow[] }>("/api/seramet/setup/device-health"),
        get<{ providers: SetupProviderDefinition[] }>("/api/seramet/setup/providers"),
        get<SetupStructure>("/api/seramet/setup/organisation-structure"),
        get<{ profile: SetupBusinessProfile }>("/api/seramet/setup/business-profile"),
        get<{ options: SetupOptions }>(`/api/seramet/setup/options${query}`),
        get<{ mappings: Array<Record<string, unknown>> }>("/api/seramet/setup/provider-mappings"),
        get<{ batches: Array<Record<string, unknown>> }>(
          `/api/seramet/setup/opening-stock${query}`,
        ),
        get<{ items: SetupMenuCatalogItem[] }>(`/api/seramet/setup/menu-catalog${query}`),
        get<{ diagnostics: SetupDiagnostics }>("/api/seramet/setup/diagnostics").catch(() => ({
          diagnostics: null,
        })),
        get<{ onboarding: OnboardingWizardState }>("/api/seramet/setup/onboarding"),
        get<{ countries: CountryReference[]; currencies: CurrencyReference[] }>(
          "/api/seramet/setup/reference/location-currency",
        ),
      ]);
      setSetup(summary.setup);
      setIntegrations(providerHealth.integrations);
      setDevices(deviceHealth.devices);
      setProviders(providerDefinitions.providers);
      setStructure({ brands: organisation.brands, branches: organisation.branches });
      setProfile(business.profile);
      setOptions(setupOptions.options);
      setMappings(providerMappings.mappings);
      setOpeningStock(opening.batches);
      setMenuCatalog(catalog.items);
      setDiagnostics(diagnosticState.diagnostics);
      setOnboarding(onboardingState.onboarding);
      setCountries(referenceState.countries);
      setCurrencies(referenceState.currencies);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup Centre is unavailable");
      setStatus("error");
    }
  }, [branchId, get, isAllBranches]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = useCallback(
    async <T>(path: string, body: unknown) => {
      const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
      const payload = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.message ?? payload.error ?? `Setup command failed (${response.status})`,
        );
      await refresh();
      return payload;
    },
    [headers, refresh],
  );

  const previewImport = useCallback(
    async (file: File, kind: ImportKind, duplicateStrategy: DuplicateStrategy) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      const result = await command<{ preview: ImportPreview }>(
        "/api/seramet/setup/imports/preview",
        {
          ...(!isAllBranches ? { branchId } : {}),
          kind,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
          duplicateStrategy,
          idempotencyKey: `setup-import:${kind}:${activeTenantId}:${file.name}:${file.size}:${file.lastModified}`,
        },
      );
      return result.preview;
    },
    [activeTenantId, branchId, command, isAllBranches],
  );

  const commitImport = useCallback(
    (preview: ImportPreview) =>
      command<{ result: { rows: number; duplicate: boolean } }>(
        `/api/seramet/setup/imports/${encodeURIComponent(preview.id)}/commit`,
        { idempotencyKey: preview.commitKey },
      ),
    [command],
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
    diagnostics,
    onboarding,
    countries,
    currencies,
    status,
    error,
    refresh,
    command,
    previewImport,
    commitImport,
    runTest,
    transitionGoLive,
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
