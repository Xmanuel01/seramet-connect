import type {
  IntegrationDirection,
  IntegrationEventStatus,
  NormalizedProviderEventType,
} from "@/integrations/types";

export type IntegrationEvent = {
  id: string;
  tenantId: string;
  branchId?: string;
  connectionId: string;
  providerId: string;
  direction: IntegrationDirection;
  eventType: NormalizedProviderEventType | string;
  providerEventId?: string;
  externalResourceId?: string;
  correlationId: string;
  idempotencyKey?: string;
  payload: unknown;
  payloadHash?: string;
  receivedAt: string;
  processedAt?: string | undefined;
  status: IntegrationEventStatus;
  attemptCount: number;
  lastError?: string | undefined;
  responseMetadata?: Record<string, unknown> | undefined;
  createdAt: string;
};

export type IntegrationIdempotencyRecord = {
  id: string;
  tenantId: string;
  connectionId: string;
  key: string;
  eventId: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  result?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ExternalResourceType =
  | "STORE"
  | "ORDER"
  | "MENU"
  | "CATEGORY"
  | "ITEM"
  | "MODIFIER_GROUP"
  | "MODIFIER"
  | "TAX"
  | "AVAILABILITY"
  | "CUSTOMER"
  | "PAYMENT"
  | "RIDER"
  | "REFUND";

export type ExternalMappingStatus =
  "UNMAPPED" | "MAPPED" | "AUTO_MATCHED" | "CONFLICT" | "DISABLED";

export type ExternalResourceMapping = {
  id: string;
  tenantId: string;
  branchId?: string;
  connectionId: string;
  providerId: string;
  resourceType: ExternalResourceType;
  internalId: string;
  externalId: string;
  externalParentId?: string;
  status: ExternalMappingStatus;
  syncStatus?:
    "NOT_SYNCED" | "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT" | "SPEC_REQUIRED";
  lastSyncedAt?: string;
  lastExternalHash?: string;
  lastInternalHash?: string;
  lastSyncedHash?: string;
  lastError?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationOutbox = {
  id: string;
  tenantId: string;
  branchId?: string;
  connectionId: string;
  providerId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  payload: unknown;
  idempotencyKey: string;
  coalescingKey?: string;
  correlationId: string;
  status: "PENDING" | "PROCESSING" | "RETRY_PENDING" | "PROCESSED" | "DEAD_LETTER";
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt?: string | undefined;
  createdAt: string;
  processedAt?: string | undefined;
  lastError?: string | undefined;
};

export type IntegrationDeadLetter = {
  id: string;
  tenantId: string;
  branchId?: string;
  connectionId: string;
  providerId: string;
  sourceType: "EVENT" | "OUTBOX";
  sourceId: string;
  originalPayload: unknown;
  error: string;
  attemptCount: number;
  correlationId: string;
  status: "OPEN" | "RESOLVED" | "IGNORED";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionReason?: string;
};

export type IntegrationHealthRecord = {
  id: string;
  tenantId: string;
  branchId?: string;
  connectionId: string;
  providerId: string;
  status: "HEALTHY" | "DEGRADED" | "OFFLINE" | "AUTH_ERROR" | "CONFIG_REQUIRED";
  message: string;
  credentialValid: boolean;
  mappingIssueCount: number;
  pendingEventCount: number;
  failedEventCount: number;
  consecutiveFailures: number;
  circuitState: "HEALTHY" | "DEGRADED" | "OPEN";
  circuitOpenUntil?: string;
  rateLimitedUntil?: string;
  lastSuccessfulRequestAt?: string;
  lastFailedRequestAt?: string;
  lastWebhookAt?: string;
  checkedAt: string;
  metadata: Record<string, unknown>;
};

export type IntegrationReplay = {
  id: string;
  tenantId: string;
  originalEventId: string;
  replayEventId: string;
  actorId: string;
  createdAt: string;
  resultStatus: IntegrationEventStatus;
};

export type ProviderToken = {
  connectionId: string;
  accessToken: string;
  expiresAt: string;
  tokenType?: string;
  scopes?: string[];
  refreshMetadata?: Record<string, unknown>;
};

export type UnmappedItemPolicy = "AUTO_REJECT" | "MANAGER_REVIEW" | "USE_EXTERNAL_DESCRIPTION";
export type OrderAcceptancePolicy = "MANUAL" | "AUTO_ACCEPT_VALID" | "AUTO_ACCEPT_ALL_MAPPED";
