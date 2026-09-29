export type TenantId = string;
export type BrandId = string;
export type BranchId = string;
export type WarehouseId = string;
export type StationId = string;
export type RoleId = string;
export type UserId = string;
export type ProviderId = string;
export type ProviderConnectionId = string;
export type PaymentMethodId = string;
export type OrderChannelId = string;
export type DeviceId = string;
export type PermissionCode = string;

export type BranchScope = { type: "ALL" } | { type: "BRANCH"; branchId: BranchId };

export type Tenant = {
  id: TenantId;
  slug: string;
  legalName: string;
  tradingName: string;
  active: boolean;
  defaultCurrency: string;
  timezone: string;
  locale: string;
  countryCode: string;
  createdAt: string;
  updatedAt: string;
};

export type Brand = {
  id: BrandId;
  tenantId: TenantId;
  name: string;
  code: string;
  logoUrl?: string;
  active: boolean;
};

export type Branch = {
  id: BranchId;
  tenantId: TenantId;
  brandId?: BrandId;
  code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  timezone?: string;
  currency?: string;
  active: boolean;
  metadata: Record<string, unknown>;
};

export type Warehouse = {
  id: WarehouseId;
  tenantId: TenantId;
  branchId: BranchId;
  code: string;
  name: string;
  type: "MAIN" | "KITCHEN" | "BAR" | "COLD" | "TRANSIT" | "OTHER";
  active: boolean;
};

export type Department = {
  id: string;
  tenantId: TenantId;
  branchId?: BranchId;
  code: string;
  name: string;
  active: boolean;
};

export type Station = {
  id: StationId;
  tenantId: TenantId;
  branchId: BranchId;
  code: string;
  name: string;
  stationType:
    "KITCHEN" | "GRILL" | "FRYER" | "BAR" | "COFFEE" | "DESSERT" | "PASS" | "DISPATCH" | "OTHER";
  active: boolean;
};

export type ServiceArea = {
  id: string;
  tenantId: TenantId;
  branchId: BranchId;
  name: string;
  active: boolean;
};

export type RestaurantTable = {
  id: string;
  tenantId: TenantId;
  branchId: BranchId;
  serviceAreaId?: string;
  code: string;
  seats: number;
  active: boolean;
};

export type PaymentMethodCategory =
  | "CASH"
  | "DIGITAL_WALLET"
  | "CARD"
  | "BANK_TRANSFER"
  | "CREDIT"
  | "VOUCHER"
  | "LOYALTY"
  | "EXTERNAL"
  | "CUSTOM";

export type PaymentMethodDefinition = {
  id: PaymentMethodId;
  tenantId: TenantId;
  code: string;
  displayName: string;
  category: PaymentMethodCategory;
  enabled: boolean;
  sortOrder: number;
  requiresReference: boolean;
  requiresCustomer: boolean;
  supportsRefund: boolean;
  supportsSplit: boolean;
  providerConnectionId?: ProviderConnectionId;
  settlementAccountId?: string;
  clearingAccountId?: string;
  receivableAccountId?: string;
  cashAccountId?: string;
  liabilityAccountId?: string;
  metadata: Record<string, unknown>;
};

export type OrderChannelType =
  | "DINE_IN"
  | "TAKEAWAY"
  | "OWN_DELIVERY"
  | "MARKETPLACE"
  | "WEB"
  | "QR"
  | "PHONE"
  | "WHATSAPP"
  | "KIOSK"
  | "OTHER";

export type OrderChannelDefinition = {
  id: OrderChannelId;
  tenantId: TenantId;
  code: string;
  displayName: string;
  channelType: OrderChannelType;
  enabled: boolean;
  deliveryProviderConnectionId?: ProviderConnectionId;
  requiresCustomer: boolean;
  requiresTable: boolean;
  requiresAddress: boolean;
  isExternallyPaid: boolean;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type ProviderCategory =
  "PAYMENT" | "DELIVERY" | "ACCOUNTING" | "MESSAGING" | "IDENTITY" | "OTHER";

export type ProviderCapability =
  | "RECEIVE_ORDERS"
  | "GET_ORDER"
  | "ACCEPT_ORDER"
  | "REJECT_ORDER"
  | "CANCEL_ORDER"
  | "MARK_ORDER_READY"
  | "UPDATE_READY_TIME"
  | "UPDATE_ORDER_STATUS"
  | "ORDER_MODIFICATIONS"
  | "RECOVER_ACTIVE_ORDERS"
  | "READ_STORE_STATUS"
  | "UPDATE_STORE_STATUS"
  | "SYNC_MENU"
  | "FETCH_MENU"
  | "SYNC_ITEMS"
  | "SYNC_CATEGORIES"
  | "SYNC_PRICES"
  | "SYNC_AVAILABILITY"
  | "SYNC_MODIFIERS"
  | "SYNC_STORE_HOURS"
  | "PAUSE_STORE"
  | "SYNC_CANCELLATIONS"
  | "RIDER_STATUS"
  | "ORDER_READY_NOTIFICATION"
  | "MANUAL_PAYMENT"
  | "CREATE_PAYMENT_INTENT"
  | "PAYMENT_PROMPT"
  | "STK_PUSH"
  | "QR_PAYMENT"
  | "CARD_PRESENT"
  | "CARD_NOT_PRESENT"
  | "PAYMENT_LINK"
  | "WEBHOOK_CONFIRMATION"
  | "QUERY_TRANSACTION"
  | "REFUND"
  | "PARTIAL_REFUND"
  | "REVERSAL"
  | "TRANSACTION_SYNC"
  | "SETTLEMENT_SYNC"
  | "FETCH_SETTLEMENTS"
  | "IMPORT_SETTLEMENT"
  | "PAYOUT"
  | "BULK_PAYOUT"
  | "BALANCE_QUERY";

export type IntegrationConnectionStatus =
  | "UNCONFIGURED"
  | "CREDENTIALS_REQUIRED"
  | "CONFIGURED"
  | "AUTHENTICATING"
  | "SANDBOX"
  | "TESTING"
  | "ACTIVE"
  | "DEGRADED"
  | "RATE_LIMITED"
  | "AUTH_ERROR"
  | "ERROR"
  | "DISABLED";

export type ProviderDefinition = {
  id: ProviderId;
  code: string;
  displayName: string;
  category: ProviderCategory;
  version: string;
  icon?: string;
  supportedCountries?: string[];
  capabilities: ProviderCapability[];
  configurationSchema: Record<string, unknown>;
  secretFields: string[];
  adapterMetadata?: {
    baseUrls?: Partial<Record<"SANDBOX" | "PRODUCTION", string>>;
    webhookBodyLimitBytes?: number;
    documentationUrl?: string;
  };
  enabled: boolean;
};

export type IntegrationConnection = {
  id: ProviderConnectionId;
  tenantId: TenantId;
  branchId?: BranchId;
  providerId: ProviderId;
  environment: "SANDBOX" | "PRODUCTION";
  status: IntegrationConnectionStatus;
  statusMessage?: string;
  displayName: string;
  configuration: Record<string, unknown>;
  secretReference?: string;
  externalAccountId?: string;
  metadata: Record<string, unknown>;
  lastSuccessfulRequestAt?: string;
  lastFailedRequestAt?: string;
  lastHealthCheckAt?: string;
  lastWebhookAt?: string;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
};

export type DeviceType =
  | "POS_TERMINAL"
  | "TABLET"
  | "KDS"
  | "PRINTER_BRIDGE"
  | "MANAGER_DEVICE"
  | "SELF_SERVICE"
  | "PRINTER"
  | "SCANNER"
  | "CASH_DRAWER"
  | "OTHER";
export type PrinterOutputRole =
  "CUSTOMER_DOCUMENT" | "KITCHEN" | "BAR" | "OFFICE" | "REPORT" | "LABEL" | "DISPATCH";

export type HardwareDevice = {
  id: DeviceId;
  tenantId: TenantId;
  branchId: BranchId;
  name: string;
  deviceType: DeviceType;
  connectionType: "OS_PRINTER" | "NETWORK" | "USB" | "BLUETOOTH" | "BROWSER" | "OTHER";
  driver: string;
  address: string;
  enabled: boolean;
  healthStatus: "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN";
  outputRoles: PrinterOutputRole[];
  metadata: Record<string, unknown>;
};

export type PrintRoute = {
  id: string;
  tenantId: TenantId;
  branchId: BranchId;
  documentType: string;
  stationId?: StationId;
  primaryDeviceId: DeviceId;
  fallbackDeviceId?: DeviceId;
  copies: number;
  enabled: boolean;
};

export type BusinessDocumentIdentity = {
  id: string;
  tenantId: TenantId;
  branchId?: BranchId;
  businessName: string;
  legalName?: string;
  logoUrl?: string;
  address: string;
  phone: string;
  email: string;
  taxNumber: string;
  website?: string;
  currency: string;
  paymentInstructions: string[];
  footerMessage: string;
  metadata: Record<string, unknown>;
};

export type DocumentTemplateConfiguration = {
  id: string;
  tenantId: TenantId;
  branchId?: BranchId;
  documentType: string;
  width: "58mm" | "80mm" | "A4";
  copies: number;
  showLogo: boolean;
  showBranch: boolean;
  showCashier: boolean;
  showCustomer: boolean;
  showTax: boolean;
  showPayment: boolean;
  showQrCode: boolean;
  footerMessage: string;
  layoutVersion: string;
  active: boolean;
};

export type RoleDefinition = {
  id: RoleId;
  tenantId: TenantId;
  code: string;
  name: string;
  active: boolean;
  permissions: PermissionCode[];
};

export type UserDefinition = {
  id: UserId;
  tenantId: TenantId;
  name: string;
  email?: string;
  active: boolean;
  roleIds: RoleId[];
  assignedBranchIds: BranchId[];
  primaryBranchId?: BranchId;
};

export type PlatformState = {
  schemaVersion: 2;
  tenants: Tenant[];
  brands: Brand[];
  branches: Branch[];
  warehouses: Warehouse[];
  departments: Department[];
  stations: Station[];
  serviceAreas: ServiceArea[];
  tables: RestaurantTable[];
  paymentMethods: PaymentMethodDefinition[];
  orderChannels: OrderChannelDefinition[];
  providers: ProviderDefinition[];
  connections: IntegrationConnection[];
  devices: HardwareDevice[];
  printRoutes: PrintRoute[];
  documentIdentities: BusinessDocumentIdentity[];
  documentTemplates: DocumentTemplateConfiguration[];
  roles: RoleDefinition[];
  users: UserDefinition[];
  updatedAt: string;
};

export type CurrentUserSession = UserDefinition & {
  roleNames: string[];
  permissions: PermissionCode[];
};
