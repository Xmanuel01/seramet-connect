import type { PermissionCode } from "@/platform/types";

export type IntelligenceIntent =
  | "BRANCH_OVERVIEW"
  | "OWNER_OVERVIEW"
  | "ENTERPRISE_OVERVIEW"
  | "FINANCE"
  | "FOOD_COST"
  | "COMPARE_PERIODS"
  | "COMPARE_BRANCHES"
  | "CHANNEL_PROFITABILITY"
  | "INVENTORY"
  | "PROCUREMENT"
  | "SUPPLIER"
  | "KITCHEN"
  | "STAFF_OPERATIONS"
  | "PAYMENT_RECONCILIATION"
  | "SETTLEMENT"
  | "MANAGEMENT_ACTIONS"
  | "CLOSE_READINESS"
  | "INTEGRATION_HEALTH"
  | "SETUP_READINESS"
  | "CRM_OVERVIEW"
  | "CRM_RETENTION"
  | "CRM_LOYALTY"
  | "CRM_CAMPAIGNS"
  | "CRM_FEEDBACK"
  | "GENERAL_PRODUCT_HELP"
  | "UNSUPPORTED";

export type IntelligenceQuality =
  "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA" | "COMPLETE" | "PARTIAL";

export type EvidenceMetric = {
  code: string;
  label: string;
  value: number;
  unit: "MINOR" | "BPS" | "COUNT" | "MILLISECONDS" | "MICRO";
  currency?: string;
  quality: IntelligenceQuality;
  evidenceRef: string;
};

export type EvidenceFinding = {
  id: string;
  title: string;
  statement: string;
  classification: "CONFIRMED" | "CORRELATED" | "UNEXPLAINED";
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evidenceRefs: string[];
  route?: string;
};

export type EvidenceSource = {
  ref: string;
  toolKey: IntelligenceToolKey;
  sourceType: string;
  sourceId: string;
  branchId?: string;
  quality: IntelligenceQuality;
  calculatedAt: string;
  payloadHash: string;
};

export type EvidencePeriod = {
  label: string;
  start: string;
  end: string;
  comparisonStart?: string;
  comparisonEnd?: string;
  timezone: string;
  businessDayCutoffMinutes: number;
};

export type EvidencePackage = {
  id: string;
  intent: IntelligenceIntent;
  tenantId: string;
  authorizedBranchIds: string[];
  branchLabels: string[];
  period: EvidencePeriod;
  metrics: EvidenceMetric[];
  findings: EvidenceFinding[];
  sources: EvidenceSource[];
  quality: IntelligenceQuality;
  qualityReasons: string[];
  configurationGaps: string[];
  limitations: string[];
  evidenceWatermark: string;
  calculatedAt: string;
};

export type SuggestedIntelligenceAction = {
  key: string;
  label: string;
  route: string;
  risk: "READ_ONLY" | "LOW" | "MEDIUM" | "HIGH";
  requiresConfirmation: boolean;
  command?: "ACKNOWLEDGE_MANAGEMENT_ACTION";
  commandPayload?: Record<string, unknown>;
};

export type StructuredIntelligenceAnswer = {
  summary: string;
  keyFindings: Array<{
    statement: string;
    classification: "CONFIRMED" | "CORRELATED" | "UNEXPLAINED";
    evidenceRefs: string[];
  }>;
  evidenceRefs: string[];
  dataQuality: IntelligenceQuality;
  qualityReasons: string[];
  limitations: string[];
  suggestedActions: SuggestedIntelligenceAction[];
};

export type IntelligenceProviderCapability =
  "STRUCTURED_OUTPUT" | "STREAMING" | "TOOL_CALLING" | "VISION" | "LONG_CONTEXT";

export type IntelligenceProviderConfiguration = {
  id: string;
  tenantId: string;
  providerKey: string;
  displayName: string;
  modelIdentifier: string;
  enabled: boolean;
  status: "CONFIGURED" | "DISABLED" | "DEGRADED" | "UNAVAILABLE";
  capabilities: IntelligenceProviderCapability[];
  secretReference?: string;
  timeoutMs: number;
  maxInputUnits: number;
  maxOutputUnits: number;
  perMinuteLimit: number;
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  perUserDailyLimit: number;
  retentionMode: "EPHEMERAL" | "SHORT" | "STANDARD";
  allowedFeatures: string[];
  allowedRoleIds: string[];
  promptVersion: string;
};

export type IntelligenceProviderRequest = {
  requestId: string;
  correlationId: string;
  providerKey: string;
  modelIdentifier: string;
  promptVersion: string;
  question: string;
  intent: IntelligenceIntent;
  evidence: Omit<EvidencePackage, "tenantId">;
  maxOutputUnits: number;
};

export type IntelligenceProviderResult = {
  answer: StructuredIntelligenceAnswer;
  inputUnits: number;
  outputUnits: number;
  providerCostMinor?: number;
  costCurrency?: string;
  latencyMs: number;
  providerRequestId?: string;
};

export interface IntelligenceProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: readonly IntelligenceProviderCapability[];
  generateStructuredResponse(
    request: IntelligenceProviderRequest,
  ): Promise<IntelligenceProviderResult>;
  health?(): Promise<{
    status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
    latencyMs?: number;
    code?: string;
  }>;
}

export type IntelligenceToolKey =
  | "BRANCH_SUMMARY"
  | "OWNER_SUMMARY"
  | "ENTERPRISE_OVERVIEW"
  | "FLASH_PNL"
  | "FOOD_COST_BRIDGE"
  | "CHANNEL_PROFITABILITY"
  | "MENU_PROFITABILITY"
  | "INVENTORY_RISK"
  | "PURCHASE_RECOMMENDATIONS"
  | "SUPPLIER_PERFORMANCE"
  | "KITCHEN_PERFORMANCE"
  | "STAFF_OPERATIONS"
  | "PAYMENT_RECONCILIATION"
  | "SETTLEMENT_EXCEPTIONS"
  | "MANAGEMENT_ACTIONS"
  | "CLOSE_READINESS"
  | "BRANCH_HEALTH"
  | "SETUP_READINESS"
  | "INTEGRATION_HEALTH"
  | "CRM_SUMMARY"
  | "CRM_RETENTION"
  | "CRM_LOYALTY"
  | "CRM_CAMPAIGNS"
  | "CRM_FEEDBACK"
  | "PRODUCT_HELP";

export type IntelligenceToolDefinition = {
  key: IntelligenceToolKey;
  intelligencePermission: PermissionCode;
  sourcePermissions: PermissionCode[];
  description: string;
};

export type AskIntelligenceInput = {
  question: string;
  sessionId?: string;
  branchIds?: string[];
  screenContext?: string;
  forceRefresh?: boolean;
};

export type IntelligenceResponse = {
  requestId: string;
  correlationId: string;
  sessionId: string;
  messageId: string;
  intent: IntelligenceIntent;
  answer: StructuredIntelligenceAnswer;
  evidence: EvidencePackage;
  provider: {
    key: string;
    displayName: string;
    modelIdentifier: string;
    health: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
    demo: boolean;
  };
  cached: boolean;
  generatedAt: string;
};
