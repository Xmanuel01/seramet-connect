import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { OnboardingService } from "@/onboarding/onboarding-service";
import { LocationCurrencyService } from "@/onboarding/location-currency-service";
import {
  fxQuoteSchema,
  manualFxRateSchema,
  onboardingStepSchema,
  accountMappingSchema,
  branchSetupSchema,
  brandSetupSchema,
  businessProfileSchema,
  demoResetSchema,
  deviceSetupSchema,
  diagnosticsExportSchema,
  documentTemplateSetupSchema,
  entitlementSchema,
  externalMappingSchema,
  exportRequestSchema,
  featureFlagSchema,
  goLiveRequestSchema,
  importCommitRequestSchema,
  importPreviewRequestSchema,
  openingStockSchema,
  organisationProvisionSchema,
  providerSetupSchema,
  reasonRequestSchema,
  setupTestRequestSchema,
  setupWeightSchema,
  subscriptionLifecycleSchema,
  taxServiceRuleSchema,
} from "@/onboarding/schemas";
import type { ManualFxRateInput, OnboardingStepInput } from "@/onboarding/location-currency-types";
import type {
  AccountingMappingInput,
  BranchSetupInput,
  BrandSetupInput,
  BusinessProfileInput,
  DeviceSetupInput,
  DocumentTemplateSetupInput,
  ExternalMappingInput,
  GoLiveState,
  OpeningStockInput,
  OrganisationProvisionInput,
  ProviderSetupInput,
  TaxServiceRuleInput,
} from "@/onboarding/types";
import { ServerOperationError } from "@/server/errors";
import type { ZodTypeAny } from "zod";

export async function handleOnboardingApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/setup")) return null;
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative setup database unavailable",
    );
  }
  const service = new OnboardingService(env.SERAMET_DB, actor, env);
  const locationCurrency = new LocationCurrencyService(env.SERAMET_DB, actor);

  if (
    url.pathname === "/api/seramet/setup/reference/location-currency" &&
    request.method === "GET"
  ) {
    return json({ ok: true, ...(await locationCurrency.listReferences()) });
  }
  if (url.pathname === "/api/seramet/setup/onboarding" && request.method === "GET") {
    return json({ ok: true, onboarding: await locationCurrency.getOnboardingState() });
  }
  if (url.pathname === "/api/seramet/setup/payment-currencies" && request.method === "GET") {
    return json({ ok: true, currencies: await locationCurrency.listPaymentCurrencies() });
  }
  if (url.pathname === "/api/seramet/setup/onboarding/step" && request.method === "POST") {
    return json({
      ok: true,
      onboarding: await locationCurrency.saveOnboardingStep(
        await parse<OnboardingStepInput>(request, onboardingStepSchema),
      ),
    });
  }
  if (url.pathname === "/api/seramet/setup/fx-rates/manual" && request.method === "POST") {
    return json(
      {
        ok: true,
        rate: await locationCurrency.saveManualRate(
          await parse<ManualFxRateInput>(request, manualFxRateSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/fx-quotes" && request.method === "POST") {
    return json(
      {
        ok: true,
        quote: await locationCurrency.createFxQuote(
          await parse<{
            branchId: string;
            invoiceId: string;
            paymentMethodId: string;
            baseAmountMinor: number;
            tenderCurrency: string;
            idempotencyKey: string;
          }>(request, fxQuoteSchema),
        ),
      },
      201,
    );
  }

  if (url.pathname === "/api/seramet/setup/centre" && request.method === "GET") {
    return json({ ok: true, setup: await service.getSetupCentre(optional(url, "branchId")) });
  }
  if (url.pathname === "/api/seramet/setup/organisations" && request.method === "POST") {
    return json(
      {
        ok: true,
        organisation: await service.provisionOrganisation(
          await parse<OrganisationProvisionInput>(request, organisationProvisionSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/organisation-structure" && request.method === "GET") {
    return json({ ok: true, ...(await service.listBrandsAndBranches()) });
  }
  if (url.pathname === "/api/seramet/setup/business-profile" && request.method === "GET") {
    return json({ ok: true, profile: await service.getBusinessProfile() });
  }
  if (url.pathname === "/api/seramet/setup/options" && request.method === "GET") {
    return json({ ok: true, options: await service.setupOptions(optional(url, "branchId")) });
  }
  if (url.pathname === "/api/seramet/setup/brands" && request.method === "POST") {
    return json(
      {
        ok: true,
        brand: await service.createBrand(await parse<BrandSetupInput>(request, brandSetupSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/business-profile" && request.method === "POST") {
    return json(
      {
        ok: true,
        setup: await service.updateBusinessProfile(
          await parse<BusinessProfileInput>(request, businessProfileSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/branches" && request.method === "POST") {
    return json(
      {
        ok: true,
        branch: await service.createBranch(
          await parse<BranchSetupInput>(request, branchSetupSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/imports/preview" && request.method === "POST") {
    const body = await parse<{
      branchId?: string;
      kind: "MENU" | "INVENTORY" | "SUPPLIER" | "STAFF" | "OPENING_STOCK" | "CONFIGURATION";
      originalName: string;
      mimeType: string;
      base64: string;
      duplicateStrategy: "CREATE" | "UPDATE" | "SKIP" | "ERROR";
      idempotencyKey: string;
      columnMap?: Record<string, string>;
    }>(request, importPreviewRequestSchema, 30 * 1024 * 1024);
    const bytes = decodeBase64(body.base64);
    return json(
      {
        ok: true,
        preview: await service.previewImport({
          ...(body.branchId ? { branchId: body.branchId } : {}),
          kind: body.kind,
          originalName: body.originalName,
          mimeType: body.mimeType,
          bytes,
          duplicateStrategy: body.duplicateStrategy,
          idempotencyKey: body.idempotencyKey,
          ...(body.columnMap ? { columnMap: body.columnMap } : {}),
        }),
      },
      201,
    );
  }
  const commitImport = /^\/api\/seramet\/setup\/imports\/([^/]+)\/commit$/.exec(url.pathname);
  if (commitImport && request.method === "POST") {
    const body = await parse<{ idempotencyKey: string }>(request, importCommitRequestSchema);
    return json({
      ok: true,
      result: await service.commitImport(decodeURIComponent(commitImport[1]!), body.idempotencyKey),
    });
  }
  if (url.pathname === "/api/seramet/setup/opening-stock" && request.method === "POST") {
    return json(
      {
        ok: true,
        batch: await service.createOpeningStock(
          await parse<OpeningStockInput>(request, openingStockSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/opening-stock" && request.method === "GET") {
    return json({ ok: true, batches: await service.listOpeningStock(optional(url, "branchId")) });
  }
  const openingApprove = /^\/api\/seramet\/setup\/opening-stock\/([^/]+)\/approve$/.exec(
    url.pathname,
  );
  if (openingApprove && request.method === "POST") {
    const body = await parse<{ reason: string }>(request, reasonRequestSchema);
    return json({
      ok: true,
      batch: await service.approveOpeningStock(decodeURIComponent(openingApprove[1]!), body.reason),
    });
  }
  const openingPost = /^\/api\/seramet\/setup\/opening-stock\/([^/]+)\/post$/.exec(url.pathname);
  if (openingPost && request.method === "POST") {
    return json({
      ok: true,
      batch: await service.postOpeningStock(decodeURIComponent(openingPost[1]!)),
    });
  }
  if (url.pathname === "/api/seramet/setup/recipes/validate" && request.method === "GET") {
    return json({ ok: true, validation: await service.validateRecipes() });
  }
  if (url.pathname === "/api/seramet/setup/account-mappings" && request.method === "POST") {
    return json(
      {
        ok: true,
        mapping: await service.configureAccountMapping(
          await parse<AccountingMappingInput>(request, accountMappingSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/tax-service-rules" && request.method === "POST") {
    return json(
      {
        ok: true,
        rule: await service.configureTaxServiceRule(
          await parse<TaxServiceRuleInput>(request, taxServiceRuleSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/provider-connections" && request.method === "POST") {
    return json(
      {
        ok: true,
        connection: await service.configureProviderConnection(
          await parse<ProviderSetupInput>(request, providerSetupSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/providers" && request.method === "GET") {
    return json({ ok: true, providers: service.providerDefinitions() });
  }
  if (url.pathname === "/api/seramet/setup/provider-mappings" && request.method === "GET") {
    return json({
      ok: true,
      mappings: await service.listExternalMappings(optional(url, "connectionId")),
    });
  }
  if (url.pathname === "/api/seramet/setup/provider-mappings" && request.method === "POST") {
    return json(
      {
        ok: true,
        mapping: await service.configureExternalMapping(
          await parse<ExternalMappingInput>(request, externalMappingSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/devices" && request.method === "POST") {
    return json(
      {
        ok: true,
        device: await service.configureDevice(
          await parse<DeviceSetupInput>(request, deviceSetupSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/document-templates" && request.method === "POST") {
    return json(
      {
        ok: true,
        template: await service.configureDocumentTemplate(
          await parse<DocumentTemplateSetupInput>(request, documentTemplateSetupSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/tests" && request.method === "POST") {
    const body = await parse<{
      branchId?: string;
      testType: "PRINT" | "ORDER" | "INTEGRATION" | "DEVICE";
      targetType: string;
      targetId?: string;
      idempotencyKey: string;
    }>(request, setupTestRequestSchema);
    return json({ ok: true, test: await service.runTest(body) }, 201);
  }
  if (url.pathname === "/api/seramet/setup/integration-health" && request.method === "GET") {
    return json({ ok: true, integrations: await service.integrationHealth() });
  }
  if (url.pathname === "/api/seramet/setup/device-health" && request.method === "GET") {
    return json({ ok: true, devices: await service.deviceHealth() });
  }
  if (url.pathname === "/api/seramet/setup/diagnostics" && request.method === "GET") {
    return json({ ok: true, diagnostics: await service.diagnostics() });
  }
  if (url.pathname === "/api/seramet/setup/diagnostics/exports" && request.method === "POST") {
    return json(
      {
        ok: true,
        export: await service.requestDiagnosticsExport(
          await parse(request, diagnosticsExportSchema),
        ),
      },
      202,
    );
  }
  const diagnosticExport = /^\/api\/seramet\/setup\/diagnostics\/exports\/([^/]+)$/.exec(
    url.pathname,
  );
  if (diagnosticExport && request.method === "GET") {
    return json({
      ok: true,
      export: await service.getDiagnosticsExport(decodeURIComponent(diagnosticExport[1]!)),
    });
  }
  if (url.pathname === "/api/seramet/setup/feature-flags" && request.method === "POST") {
    return json({
      ok: true,
      featureFlag: await service.setFeatureFlag(await parse(request, featureFlagSchema)),
    });
  }
  if (url.pathname === "/api/seramet/setup/entitlements" && request.method === "POST") {
    return json({
      ok: true,
      entitlement: await service.setEntitlement(await parse(request, entitlementSchema)),
    });
  }
  if (url.pathname === "/api/seramet/setup/subscriptions/lifecycle" && request.method === "POST") {
    return json(
      {
        ok: true,
        lifecycle: await service.setSubscriptionLifecycle(
          await parse(request, subscriptionLifecycleSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/setup/section-weights" && request.method === "POST") {
    const body = await parse<{
      section: import("@/onboarding/types").SetupSection;
      weightBps: number;
    }>(request, setupWeightSchema);
    return json({ ok: true, weight: await service.setSectionWeight(body.section, body.weightBps) });
  }
  if (url.pathname === "/api/seramet/setup/demo/reset" && request.method === "POST") {
    return json(
      { ok: true, reset: await service.resetDemoTenant(await parse(request, demoResetSchema)) },
      202,
    );
  }
  if (url.pathname === "/api/seramet/setup/menu-catalog" && request.method === "GET") {
    return json({ ok: true, items: await service.listMenuCatalog(optional(url, "branchId")) });
  }
  if (url.pathname === "/api/seramet/setup/exports" && request.method === "POST") {
    return json(
      {
        ok: true,
        export: await service.requestDataExport(await parse(request, exportRequestSchema)),
      },
      202,
    );
  }
  const dataExport = /^\/api\/seramet\/setup\/exports\/([^/]+)(\/download)?$/.exec(url.pathname);
  if (dataExport && request.method === "GET") {
    const includePayload = Boolean(dataExport[2]);
    return json({
      ok: true,
      export: await service.getDataExport(decodeURIComponent(dataExport[1]!), includePayload),
    });
  }
  if (url.pathname === "/api/seramet/setup/go-live" && request.method === "POST") {
    const body = await parse<{ toState: GoLiveState; override?: boolean; reason?: string }>(
      request,
      goLiveRequestSchema,
    );
    return json({ ok: true, decision: await service.transitionGoLive(body) });
  }
  return null;
}

async function parse<T>(request: Request, schema: ZodTypeAny, maxBytes = 1_048_576): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new SerametHttpError(413, "Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new SerametHttpError(413, "Request body is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SerametHttpError(
      400,
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
        .join("; "),
    );
  }
  return result.data as T;
}

function decodeBase64(value: string) {
  try {
    const normalized = value.replace(/^data:[^;]+;base64,/, "");
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new SerametHttpError(400, "Import payload is not valid base64");
  }
}

function optional(url: URL, key: string) {
  return url.searchParams.get(key)?.trim() || undefined;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
