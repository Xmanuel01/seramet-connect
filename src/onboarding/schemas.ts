import { z } from "zod";
import { setupSections } from "@/onboarding/types";

const optionalRecord = z.record(z.unknown()).optional();
const optionalStringRecord = z.record(z.string()).optional();

export const businessProfileSchema = z
  .object({
    legalName: z.string().trim().min(2).max(180),
    tradingName: z.string().trim().min(2).max(180),
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/),
    defaultCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/),
    timezone: z.string().trim().min(3).max(80),
    locale: z.string().trim().min(2).max(20),
    accountingMode: z.enum(["PERPETUAL", "PERIODIC"]),
    taxConfigurationReference: z.string().trim().max(120).optional(),
    logoAssetReference: z.string().trim().max(500).optional(),
    defaultDocumentFooter: z.string().trim().max(500).optional(),
    contact: optionalStringRecord,
    legalIdentifiers: optionalStringRecord,
    fiscalSettings: optionalRecord,
    documentBranding: optionalRecord,
  })
  .strict();

export const onboardingStepSchema = z
  .object({
    step: z.number().int().min(5).max(20),
    action: z.enum(["SAVE", "BACK", "COMPLETE"]),
    response: z.record(z.unknown()),
  })
  .strict();

export const acceptedCurrencySchema = z
  .object({
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    paymentEligible: z.boolean().default(true),
    cashEligible: z.boolean().default(true),
    digitalPaymentEligible: z.boolean().default(false),
    exchangeRatePolicy: z.enum(["MANUAL", "PROVIDER", "HQ", "LEGAL_ENTITY"]).default("MANUAL"),
    rateFreshnessMinutes: z.number().int().positive().max(43_200).default(1_440),
    roundingPolicy: z.enum(["HALF_UP", "UP", "DOWN"]).default("HALF_UP"),
    changePolicy: z
      .enum(["TENDER_CURRENCY", "BASE_CURRENCY", "NO_CHANGE"])
      .default("TENDER_CURRENCY"),
    branchIds: z.array(z.string().trim().min(1)).max(500).default([]),
    paymentMethodIds: z.array(z.string().trim().min(1)).max(500).default([]),
  })
  .strict();

export const manualFxRateSchema = z
  .object({
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    tenderCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    rateNumerator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    rateDenominator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveUntil: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(8).max(500),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const fxQuoteSchema = z
  .object({
    branchId: z.string().trim().min(1).max(120),
    invoiceId: z.string().trim().min(1).max(120),
    paymentMethodId: z.string().trim().min(1).max(120),
    baseAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    tenderCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const organisationProvisionSchema = businessProfileSchema
  .extend({
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    brandCode: z.string().trim().min(1).max(40),
    brandName: z.string().trim().min(2).max(160),
    administratorEmail: z.string().email().max(200).optional(),
  })
  .strict();

export const brandSetupSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(2).max(160),
    active: z.boolean().optional(),
  })
  .strict();

export const branchSetupSchema = z
  .object({
    id: z.string().trim().min(2).max(100).optional(),
    brandId: z.string().trim().min(1).max(100),
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(2).max(160),
    timezone: z.string().trim().min(3).max(80),
    businessDayCutoffMinutes: z.number().int().min(0).max(1439),
    address: z.string().trim().max(300).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().email().max(200).optional(),
    accountingModeOverride: z.enum(["PERPETUAL", "PERIODIC"]).optional(),
    negativeStockPolicy: z.enum(["ALLOW_WITH_ALERT", "BLOCK", "MANAGER_OVERRIDE"]),
    operatingHours: optionalRecord,
    serviceModes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    requiredDeviceRoles: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    paymentsRequired: z.boolean().optional(),
    inventoryEnabled: z.boolean().optional(),
    recipesRequired: z.boolean().optional(),
    printingRequired: z.boolean().optional(),
    kdsRequired: z.boolean().optional(),
    createWarehouse: z
      .object({ code: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(160) })
      .strict()
      .optional(),
  })
  .strict();

export const importPreviewRequestSchema = z
  .object({
    branchId: z.string().trim().min(1).optional(),
    kind: z.enum(["MENU", "INVENTORY", "SUPPLIER", "STAFF", "OPENING_STOCK", "CONFIGURATION"]),
    originalName: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(160),
    base64: z.string().min(1),
    duplicateStrategy: z.enum(["CREATE", "UPDATE", "SKIP", "ERROR"]),
    idempotencyKey: z.string().trim().min(8).max(200),
    columnMap: z.record(z.string()).optional(),
  })
  .strict();

export const importCommitRequestSchema = z
  .object({ idempotencyKey: z.string().trim().min(8).max(200) })
  .strict();

export const reasonRequestSchema = z.object({ reason: z.string().trim().min(8).max(500) }).strict();

export const setupTestRequestSchema = z
  .object({
    branchId: z.string().trim().min(1).optional(),
    testType: z.enum(["PRINT", "ORDER", "INTEGRATION", "DEVICE"]),
    targetType: z.string().trim().min(1).max(80),
    targetId: z.string().trim().min(1).max(120).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export const openingStockSchema = z
  .object({
    branchId: z.string().trim().min(1),
    warehouseId: z.string().trim().min(1),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    idempotencyKey: z.string().trim().min(8).max(200),
    lines: z
      .array(
        z
          .object({
            inventoryItemId: z.string().trim().min(1),
            unitId: z.string().trim().min(1),
            quantityMicro: z.number().int().nonnegative(),
            unitCostMinor: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();

export const accountMappingSchema = z
  .object({
    branchId: z.string().trim().min(1).optional(),
    mappingKey: z.string().trim().min(2).max(100),
    requirement: z.enum(["REQUIRED", "OPTIONAL"]),
    accountId: z.string().trim().min(1).optional(),
    financeSignoff: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  })
  .strict();

export const taxServiceRuleSchema = z
  .object({
    branchId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    ruleType: z.enum(["TAX", "SERVICE_CHARGE"]),
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(2).max(120),
    rateBps: z.number().int().min(0).max(10000),
    calculationMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    accountId: z.string().trim().min(1).optional(),
    roundingMode: z.string().trim().min(2).max(60).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const providerSetupSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    branchId: z.string().trim().min(1).optional(),
    providerId: z.string().trim().min(1).max(120),
    environment: z.enum(["SANDBOX", "PRODUCTION"]),
    configuration: optionalRecord,
    credentials: z.record(z.string().min(1)).optional(),
    secretReference: z.string().trim().min(1).max(240).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const externalMappingSchema = z
  .object({
    connectionId: z.string().trim().min(1).max(120),
    branchId: z.string().trim().min(1).max(120).optional(),
    resourceType: z.enum(["STORE", "ITEM", "MODIFIER_GROUP", "MODIFIER", "TAX", "AVAILABILITY"]),
    internalId: z.string().trim().min(1).max(200),
    externalId: z.string().trim().min(1).max(200),
    status: z.enum(["UNMAPPED", "MAPPED", "CONFLICT", "DISABLED"]),
    reviewConfirmed: z.boolean(),
    confidenceBps: z.number().int().min(0).max(10000).optional(),
    metadata: optionalRecord,
  })
  .strict();

export const deviceSetupSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    branchId: z.string().trim().min(1),
    deviceType: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(160),
    stationId: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1).max(80).optional(),
    networkIdentifier: z.string().trim().max(240).optional(),
    paperSize: z.string().trim().max(40).optional(),
    capabilities: z.array(z.string().trim().min(1).max(100)).max(60).optional(),
    fallbackDeviceId: z.string().trim().min(1).optional(),
  })
  .strict();

export const documentTemplateSetupSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    branchId: z.string().trim().min(1).optional(),
    documentType: z.string().trim().min(2).max(80),
    layoutVersion: z.string().trim().min(1).max(40),
    active: z.boolean(),
    width: z.string().trim().max(20).optional(),
    copies: z.number().int().min(1).max(10).optional(),
    logoAssetReference: z.string().trim().max(500).optional(),
    footerMessage: z.string().trim().max(500).optional(),
    paymentInstructions: z.string().trim().max(500).optional(),
    showCustomer: z.boolean().optional(),
    showTable: z.boolean().optional(),
    showCashier: z.boolean().optional(),
    showKotPrices: z.boolean().optional(),
    showQrCode: z.boolean().optional(),
    configuration: optionalRecord,
  })
  .strict();

export const setupSectionSchema = z.enum(setupSections);

export const goLiveRequestSchema = z
  .object({
    toState: z.enum(["READY_FOR_REVIEW", "READY_FOR_GO_LIVE", "LIVE", "SUSPENDED"]),
    override: z.boolean().optional(),
    reason: z.string().trim().min(8).max(500).optional(),
  })
  .strict();

export const featureFlagSchema = z
  .object({
    key: z.string().trim().min(2).max(120),
    enabled: z.boolean(),
    configuration: optionalRecord,
  })
  .strict();

export const entitlementSchema = z
  .object({
    subscriptionId: z.string().trim().min(1),
    featureKey: z.string().trim().min(2).max(120),
    enabled: z.boolean(),
    limits: optionalRecord,
  })
  .strict();

export const exportRequestSchema = z
  .object({
    entityTypes: z.array(z.string().trim().min(1).max(80)).min(1).max(40),
    periodStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    periodEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    rowLimit: z.number().int().min(1).max(1_000_000).default(100_000),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export const diagnosticsExportSchema = z
  .object({
    scope: optionalRecord,
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export const subscriptionLifecycleSchema = z
  .object({
    subscriptionId: z.string().trim().min(1).max(120),
    status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]),
    effectiveAt: z.string().datetime(),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

export const demoResetSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export const setupWeightSchema = z
  .object({ section: z.enum(setupSections), weightBps: z.number().int().min(0).max(10000) })
  .strict();
