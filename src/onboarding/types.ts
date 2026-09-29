export const setupSections = [
  "BUSINESS_PROFILE",
  "BRANCHES",
  "USERS_ROLES",
  "MENU",
  "INVENTORY",
  "RECIPES_UOM",
  "SUPPLIERS",
  "ACCOUNTING",
  "TAX_SERVICE",
  "PAYMENTS",
  "DELIVERY_INTEGRATIONS",
  "KITCHEN_STATIONS",
  "PRINTERS_DEVICES",
  "DOCUMENTS",
  "OPENING_STOCK",
  "TESTING",
  "READINESS",
  "GO_LIVE",
] as const;

export type SetupSection = (typeof setupSections)[number];
export type SetupStageStatus = "NOT_STARTED" | "IN_PROGRESS" | "READY" | "BLOCKED" | "COMPLETE";
export type ReadinessStatus = "READY" | "WARNING" | "BLOCKED" | "NOT_APPLICABLE";
export type ReadinessSeverity = "INFO" | "WARNING" | "CRITICAL" | "SECURITY" | "SCHEMA";
export type DataQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
export type GoLiveState = "SETUP" | "READY_FOR_REVIEW" | "READY_FOR_GO_LIVE" | "LIVE" | "SUSPENDED";
export type ImportKind =
  "MENU" | "INVENTORY" | "SUPPLIER" | "STAFF" | "OPENING_STOCK" | "CONFIGURATION";
export type DuplicateStrategy = "CREATE" | "UPDATE" | "SKIP" | "ERROR";
export type ImportTargetMode = "TENANT_MASTER" | "SELECTED_BRANCHES" | "ROW_BRANCHES";

export type SetupStage = {
  section: SetupSection;
  label: string;
  status: SetupStageStatus;
  readinessStatus: ReadinessStatus;
  progressBps: number;
  weightBps: number;
  blockers: number;
  warnings: number;
  evidence: Record<string, unknown>;
};

export type ReadinessResult = {
  id: string;
  code: string;
  section: SetupSection;
  scope: "TENANT" | "BRANCH";
  branchId?: string;
  status: ReadinessStatus;
  severity: ReadinessSeverity;
  message: string;
  evidence: Record<string, unknown>;
  recommendedAction: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  overrideAllowed: boolean;
};

export type SetupSummary = {
  tenantId: string;
  branchId?: string;
  organisationName: string;
  goLiveState: GoLiveState;
  demoMode: boolean;
  overallScoreBps: number;
  status: ReadinessStatus;
  stages: SetupStage[];
  results: ReadinessResult[];
  counts: {
    branches: number;
    users: number;
    menuItems: number;
    inventoryItems: number;
    suppliers: number;
    recipes: number;
    providerConnections: number;
    devices: number;
    openImports: number;
    deadLetters: number;
  };
  calculatedAt: string;
};

export type BusinessProfileInput = {
  legalName: string;
  tradingName: string;
  countryCode: string;
  defaultCurrency: string;
  timezone: string;
  locale: string;
  accountingMode: "PERPETUAL" | "PERIODIC";
  taxConfigurationReference?: string;
  logoAssetReference?: string;
  defaultDocumentFooter?: string;
  contact?: Record<string, string>;
  legalIdentifiers?: Record<string, string>;
  fiscalSettings?: Record<string, unknown>;
  documentBranding?: Record<string, unknown>;
};

export type OrganisationProvisionInput = BusinessProfileInput & {
  slug: string;
  brandCode: string;
  brandName: string;
  administratorEmail?: string;
};

export type BrandSetupInput = {
  id?: string;
  code: string;
  name: string;
  active?: boolean;
};

export type BranchSetupInput = {
  idempotencyKey: string;
  confirmPossibleDuplicate?: boolean;
  id?: string;
  brandId: string;
  code: string;
  name: string;
  timezone: string;
  businessDayCutoffMinutes: number;
  address?: string;
  phone?: string;
  email?: string;
  accountingModeOverride?: "PERPETUAL" | "PERIODIC";
  negativeStockPolicy: "ALLOW_WITH_ALERT" | "BLOCK" | "MANAGER_OVERRIDE";
  operatingHours?: Record<string, unknown>;
  serviceModes?: string[];
  requiredDeviceRoles?: string[];
  paymentsRequired?: boolean;
  inventoryEnabled?: boolean;
  recipesRequired?: boolean;
  printingRequired?: boolean;
  kdsRequired?: boolean;
  createWarehouse?: { code: string; name: string };
};

export type ImportPreviewInput = {
  branchId?: string;
  targetMode?: ImportTargetMode;
  targetBranchIds?: string[];
  kind: ImportKind;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
  duplicateStrategy: DuplicateStrategy;
  idempotencyKey: string;
  columnMap?: Record<string, string>;
  referenceMap?: { stations?: Record<string, string> };
};

export type ImportIssue = { field: string; code: string; message: string };
export type ImportPreviewRow = {
  rowNumber: number;
  rowKey: string;
  status: "VALID" | "WARNING" | "ERROR" | "COMMITTED" | "SKIPPED";
  action?: "CREATE" | "UPDATE" | "SKIP" | "ERROR" | "NO_CHANGE";
  normalized: Record<string, unknown>;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

export type ImportPreview = {
  id: string;
  commitKey: string;
  kind: ImportKind;
  status: "PREVIEW" | "VALIDATED" | "COMMITTING" | "COMMITTED" | "REJECTED" | "FAILED";
  templateVersion?: number;
  importerVersion?: string;
  fingerprint?: string;
  targetMode?: ImportTargetMode;
  targetBranchIds?: string[];
  expiresAt?: string;
  verification?: {
    status: "PENDING" | "VERIFIED" | "FAILED";
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    branchSettings: number;
    catalogueVerified: boolean;
    warnings: string[];
  };
  originalName: string;
  duplicateStrategy: DuplicateStrategy;
  rowCount: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  canCommit: boolean;
  rows: ImportPreviewRow[];
  createdAt: string;
};

export type OpeningStockInput = {
  branchId: string;
  warehouseId: string;
  businessDate: string;
  currency: string;
  idempotencyKey: string;
  lines: Array<{
    inventoryItemId: string;
    unitId: string;
    quantityMicro: number;
    unitCostMinor: number;
  }>;
};

export type RecipeValidationIssue = {
  code: string;
  severity: "WARNING" | "CRITICAL";
  menuItemId?: string;
  recipeId?: string;
  message: string;
  evidence: Record<string, unknown>;
};

export type AccountingMappingInput = {
  branchId?: string;
  mappingKey: string;
  requirement: "REQUIRED" | "OPTIONAL";
  accountId?: string;
  financeSignoff?: "PENDING" | "APPROVED" | "REJECTED";
};

export type TaxServiceRuleInput = {
  branchId?: string;
  id?: string;
  ruleType: "TAX" | "SERVICE_CHARGE";
  code: string;
  name: string;
  rateBps: number;
  calculationMode: "INCLUSIVE" | "EXCLUSIVE";
  effectiveFrom: string;
  effectiveTo?: string;
  accountId?: string;
  roundingMode?: string;
  active?: boolean;
};

export type ProviderSetupInput = {
  id?: string;
  branchId?: string;
  providerId: string;
  environment: "SANDBOX" | "PRODUCTION";
  configuration?: Record<string, unknown>;
  credentials?: Record<string, string>;
  secretReference?: string;
  enabled?: boolean;
};

export type ExternalMappingInput = {
  connectionId: string;
  branchId?: string;
  resourceType: "STORE" | "ITEM" | "MODIFIER_GROUP" | "MODIFIER" | "TAX" | "AVAILABILITY";
  internalId: string;
  externalId: string;
  status: "UNMAPPED" | "MAPPED" | "CONFLICT" | "DISABLED";
  reviewConfirmed: boolean;
  confidenceBps?: number;
  metadata?: Record<string, unknown>;
};

export type DeviceSetupInput = {
  id?: string;
  branchId: string;
  deviceType: string;
  name: string;
  stationId?: string;
  role?: string;
  networkIdentifier?: string;
  paperSize?: string;
  capabilities?: string[];
  fallbackDeviceId?: string;
};

export type DocumentTemplateSetupInput = {
  id?: string;
  branchId?: string;
  documentType: string;
  layoutVersion: string;
  active: boolean;
  width?: string;
  copies?: number;
  logoAssetReference?: string;
  footerMessage?: string;
  paymentInstructions?: string;
  showCustomer?: boolean;
  showTable?: boolean;
  showCashier?: boolean;
  showKotPrices?: boolean;
  showQrCode?: boolean;
  configuration?: Record<string, unknown>;
};

export type TestRun = {
  id: string;
  testType: "PRINT" | "ORDER" | "INTEGRATION" | "DEVICE";
  targetType: string;
  targetId?: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "TIMEOUT" | "DEVICE_OFFLINE" | "UNKNOWN";
  marker: string;
  result: Record<string, unknown>;
  createdAt: string;
};

export type IntegrationHealthRow = {
  connectionId: string;
  providerId: string;
  displayName: string;
  category: string;
  branchId?: string;
  environment: string;
  status: string;
  health: "HEALTHY" | "DEGRADED" | "OFFLINE" | "AUTH_ERROR" | "CONFIG_REQUIRED" | "UNKNOWN";
  capabilities: string[];
  lastSuccess?: string;
  lastFailure?: string;
  lastWebhook?: string;
  lastSync?: string;
  pendingQueue: number;
  deadLetters: number;
  credentialsAgeDays?: number;
};

export type DeviceHealthRow = {
  deviceId: string;
  name: string;
  branchId: string;
  deviceType: string;
  trustStatus: string;
  health: "ONLINE" | "OFFLINE" | "DEGRADED" | "UNKNOWN";
  lastSeen?: string;
  lastSuccessfulOperation?: string;
  warning?: string;
  version?: string;
};

export type GoLiveDecision = {
  fromState: GoLiveState;
  toState: GoLiveState;
  scoreBps: number;
  blockers: string[];
  overrideUsed: boolean;
};
