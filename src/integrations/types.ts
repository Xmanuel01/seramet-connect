import type {
  IntegrationConnection,
  ProviderCapability,
  ProviderDefinition,
} from "@/platform/types";
import type {
  MarketplaceRejectionReason,
  MarketplaceStoreStatus,
  NormalizedMarketplaceMenu,
} from "@/integrations/marketplace/types";
import type { MarketplaceChargeType } from "@/lib/transaction-engine";

export type IntegrationEnvironment = "SANDBOX" | "PRODUCTION";
export type IntegrationDirection = "INBOUND" | "OUTBOUND";
export type IntegrationEventStatus =
  | "RECEIVED"
  | "QUEUED"
  | "PROCESSING"
  | "PROCESSED"
  | "IGNORED"
  | "MAPPING_REQUIRED"
  | "RETRY_PENDING"
  | "FAILED"
  | "DEAD_LETTER";

export type NormalizedProviderEventType =
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "ORDER_CANCELLED"
  | "ORDER_RELEASED"
  | "ORDER_READY_REQUESTED"
  | "STORE_CONNECTED"
  | "STORE_DISCONNECTED"
  | "STORE_STATUS_CHANGED"
  | "MENU_SYNC_REQUESTED"
  | "MENU_SYNC_COMPLETED"
  | "MENU_SYNC_FAILED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "REFUND_CONFIRMED"
  | "UNKNOWN";

export type ProviderHealth = {
  status: "HEALTHY" | "DEGRADED" | "OFFLINE" | "AUTH_ERROR" | "CONFIG_REQUIRED";
  checkedAt: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type ProviderCredentials = Record<string, string>;

export type ProviderWebhookRequest = {
  rawBody: Uint8Array;
  headers: Record<string, string>;
  connection: IntegrationConnection;
  credentials: ProviderCredentials;
  payload?: unknown;
  providedSecret?: string;
};

export type ParsedProviderEvent = {
  providerEventId?: string | undefined;
  eventType: NormalizedProviderEventType;
  externalResourceId?: string | undefined;
  externalStoreId?: string | undefined;
  occurredAt?: string | undefined;
  payload: unknown;
  requiresOrderFetch?: boolean;
  requiresPaymentFetch?: boolean;
  amountMinor?: number;
  currency?: string;
  providerTransactionId?: string;
  merchantReference?: string;
};

export type NormalizedPaymentProviderStatus = {
  providerTransactionId: string;
  merchantReference: string;
  status: "PENDING" | "CONFIRMED" | "FAILED" | "REVERSED" | "INVALID";
  amountMinor: number;
  currency: string;
  paymentMethodDescription?: string;
  confirmationCode?: string;
  occurredAt?: string;
  raw: unknown;
};

export type NormalizedExternalOrder = {
  providerOrderId: string;
  connectionId: string;
  externalStoreId: string;
  branchId?: string;
  channelId?: string;
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN" | "OTHER";
  createdAt: string;
  scheduledFor?: string;
  currency: string;
  customer: {
    externalCustomerId?: string;
    name?: string;
    phone?: string;
    notes?: string;
  };
  delivery: {
    type: "PROVIDER" | "RESTAURANT" | "PICKUP" | "NONE";
    address?: string;
    instructions?: string;
    coordinates?: { latitude: number; longitude: number };
    providerManaged: boolean;
    rider?: { externalId?: string; name?: string; phone?: string };
  };
  items: Array<{
    externalItemId: string;
    internalItemId?: string;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    modifiers: Array<{
      externalModifierId: string;
      internalModifierId?: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }>;
    notes?: string;
  }>;
  pricing: {
    subtotal: number;
    discounts: number;
    taxes: number;
    deliveryFee?: number;
    serviceFee?: number;
    tip?: number;
    total: number;
  };
  payment: {
    externallyPaid: boolean;
    providerPaymentReference?: string;
    amountPaid?: number;
  };
  charges?: Array<{
    type: MarketplaceChargeType;
    description: string;
    amount: number;
    taxAmount?: number;
    currency: string;
    source: "PROVIDER_ORDER";
    externalReference?: string;
    metadata: Record<string, unknown>;
  }>;
  providerStatus?: string;
  fulfilmentMetadata?: Record<string, unknown>;
  specialInstructions?: string;
  rawExternalReference?: string;
};

export type ProviderOperationResult<T = unknown> =
  | { ok: true; value: T; providerReference?: string; responseMetadata?: Record<string, unknown> }
  | {
      ok: false;
      code:
        | "NOT_CONFIGURED"
        | "UNSUPPORTED"
        | "SPEC_REQUIRED"
        | "AUTHENTICATION"
        | "AUTHORIZATION"
        | "VALIDATION"
        | "MAPPING"
        | "RATE_LIMITED"
        | "TIMEOUT"
        | "PROVIDER_UNAVAILABLE"
        | "PROVIDER_ERROR";
      message: string;
      retryable?: boolean;
      retryAfterMs?: number;
    };

export type ProviderExecutionContext = {
  connection: IntegrationConnection;
  credentials: ProviderCredentials;
  correlationId: string;
  signal?: AbortSignal;
};

export type RecoverableExternalOrder = {
  externalOrderId: string;
  providerEventId?: string;
  placedAt?: string;
  payload?: unknown;
};

export type ProviderAdapter = {
  definition: ProviderDefinition;
  healthCheck: (
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderHealth>;
  verifyWebhook?: (request: ProviderWebhookRequest) => Promise<boolean> | boolean;
  parseWebhook?: (
    request: ProviderWebhookRequest,
  ) => Promise<ProviderOperationResult<ParsedProviderEvent>>;
  normalizeIncomingOrder?: (
    payload: unknown,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult<NormalizedExternalOrder>>;
  getOrder?: (
    externalOrderId: string,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult<unknown>>;
  recoverActiveOrders?: (
    externalStoreId: string,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult<RecoverableExternalOrder[]>>;
  acceptOrder?: (
    externalOrderId: string,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
    input?: {
      estimatedReadyAt?: string;
      estimatedPrepMinutes?: number;
      acceptedBy?: string;
      items?: Array<{ externalItemId: string; quantity: number }>;
    },
  ) => Promise<ProviderOperationResult>;
  rejectOrder?: (
    externalOrderId: string,
    reason: MarketplaceRejectionReason,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  cancelOrder?: (
    externalOrderId: string,
    reason: string,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  markOrderReady?: (
    externalOrderId: string,
    context: ProviderExecutionContext,
    input?: { items?: Array<{ externalItemId: string; quantity: number }> },
  ) => Promise<ProviderOperationResult>;
  updateReadyTime?: (
    externalOrderId: string,
    readyAt: string,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  updateStatus?: (
    externalOrderId: string,
    status: string,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  getStores?: (context: ProviderExecutionContext) => Promise<ProviderOperationResult<unknown[]>>;
  getStoreStatus?: (
    externalStoreId: string,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  setStoreStatus?: (
    externalStoreId: string,
    status: MarketplaceStoreStatus,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  getMenu?: (context: ProviderExecutionContext) => Promise<ProviderOperationResult>;
  syncMenu?: (
    menu: NormalizedMarketplaceMenu,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  syncAvailability?: (
    availability: {
      externalItemId: string;
      internalItemId: string;
      available: boolean;
      quantityAvailable?: number;
    },
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  updateItemPrice?: (
    item: {
      externalItemId: string;
      internalItemId: string;
      price: number;
      currency: string;
    },
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  processWebhook?: (
    payload: unknown,
    connection: IntegrationConnection,
  ) => Promise<ProviderOperationResult>;
  createPaymentPrompt?: (
    input: unknown,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  createPaymentQr?: (
    input: unknown,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  registerPaymentNotification?: (
    input: unknown,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  queryPayment?: (
    providerReference: string,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult<NormalizedPaymentProviderStatus>>;
  requestPaymentRefund?: (
    input: unknown,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  requestPaymentReversal?: (
    input: unknown,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  fetchSettlements?: (
    input: unknown,
    context: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
  importSettlement?: (
    input: unknown,
    connection: IntegrationConnection,
    context?: ProviderExecutionContext,
  ) => Promise<ProviderOperationResult>;
};

export function adapterSupports(adapter: ProviderAdapter, capability: ProviderCapability) {
  return adapter.definition.capabilities.includes(capability);
}
