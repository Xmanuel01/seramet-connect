import { LOCAL_PILOT_TENANT_ID } from "@/platform/pilot-defaults";
import {
  type ConfigurationRepository,
  getConfigurationRepository,
  PlatformConfigurationError,
} from "@/platform/repositories/configuration-repository";
import { normalizePaymentOperations, emptyPaymentOperationsState } from "@/payments/payment-state";
import type { PaymentOperationsState } from "@/payments/types";
import type { CostControlSnapshot } from "@/cost-control/types";

export type OrderStatus =
  | "DRAFT"
  | "HELD"
  | "OPEN"
  | "SENT_TO_KITCHEN"
  | "IN_PROGRESS"
  | "READY"
  | "SERVED"
  | "BILL_REQUESTED"
  | "AWAITING_PAYMENT"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CANCELLED"
  | "REFUNDED";

export type InvoiceStatus =
  | "DRAFT_BILL"
  | "OPEN"
  | "PARTIAL"
  | "PAID"
  | "PROVIDER_RECEIVABLE"
  | "PENDING"
  | "VOID"
  | "MERGED"
  | "SPLIT";
export type PaymentIntentStatus =
  | "CREATED"
  | "PENDING"
  | "AWAITING_CUSTOMER"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";
export type PaymentMethod = string;
export type ReconciliationStatus =
  | "UNMATCHED"
  | "SUGGESTED"
  | "MATCHED"
  | "PARTIALLY_MATCHED"
  | "RECONCILED"
  | "DUPLICATE"
  | "IGNORED"
  | "ERROR";
export type ExternalDirection = "INBOUND" | "OUTBOUND";
export type JournalEntryStatus = "DRAFT" | "POSTED" | "REVERSED";
export type ProductionStatus = "NEW" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";

export type TransactionLine = {
  id: string;
  productId?: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  productionStation?: string;
  sourceOrderId?: string;
  itemNote?: string;
  productionStatus?: ProductionStatus;
  productionStartedAt?: string;
  productionReadyAt?: string;
  productionServedAt?: string;
  sentAt?: string;
  sentQuantity?: number;
};

export type TransactionOrder = {
  id: string;
  tenantId?: string;
  branchId?: string;
  branch: string;
  table?: string;
  customer: string;
  customerId?: string;
  customerCode?: string;
  channel: string;
  cashier: string;
  waiter?: string;
  kitchenNote?: string;
  status: OrderStatus;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "PROVIDER_RECEIVABLE" | "REFUNDED";
  createdAt: string;
  updatedAt: string;
  lines: TransactionLine[];
  subtotal: number;
  tax: number;
  total: number;
  externalSource?: ExternalOrderSource;
  inventoryPostedAt?: string;
  delivery?: {
    rider?: string;
    status: "UNASSIGNED" | "ASSIGNED" | "PICKED_UP" | "OUT_FOR_DELIVERY" | "DELIVERED";
    assignedAt?: string;
    pickedUpAt?: string;
    deliveredAt?: string;
  };
  guestContext?: {
    guestSessionId: string;
    tableSessionId?: string;
    quoteId: string;
    submissionId: string;
    serviceMode: "QR_TABLE" | "PICKUP" | "DIRECT_DELIVERY" | "WEB_ORDER" | "KIOSK";
    trackingReference: string;
    scheduledFor?: string;
    quotedSubtotalMinor?: number;
    discountMinor?: number;
    amountDueMinor?: number;
    currency?: string;
    acceptancePolicy?: "AUTO_ACCEPT" | "WAITER_REVIEW" | "CASHIER_REVIEW";
  };
  cancellation?: {
    reason: string;
    user: string;
    timestamp: string;
    affectedItems: string[];
  };
};

export type ExternalOrderSource = {
  connectionId: string;
  providerId: string;
  externalStoreId: string;
  externalOrderId: string;
  providerDisplayReference?: string;
  providerStatus?: string;
  externallyPaid: boolean;
  externallyCollectedAmount?: number;
  marketplaceReceivableId?: string;
  fulfilmentType: "PROVIDER_DELIVERY" | "OWN_DELIVERY" | "PICKUP";
  isScheduled: boolean;
  scheduledFor?: string;
  scheduledReleaseAt?: string;
  estimatedReadyAt?: string;
  receivedAt: string;
  acceptedAt?: string;
  preparationStartedAt?: string;
  readyAt?: string;
  pickedUpAt?: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
};

export type InventoryStock = {
  tenantId?: string;
  branchId?: string;
  sku: string;
  name: string;
  category: string;
  branch: string;
  stock: number;
  par: number;
  unit: string;
  averageCost: number;
  supplier: string;
  updatedAt: string;
};

export type RecipeIngredient = {
  sku: string;
  quantity: number;
};

export type RecipeRecord = {
  id: string;
  tenantId?: string;
  productId: string;
  dish: string;
  yieldLabel: string;
  ingredients: RecipeIngredient[];
  updatedAt: string;
};

export type StockMovement = {
  id: string;
  tenantId?: string;
  branchId?: string;
  branch: string;
  sku: string;
  quantity: number;
  unit: string;
  unitCost: number;
  type: "RECEIPT" | "SALE_CONSUMPTION" | "WASTAGE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";
  reference: string;
  reason?: string;
  actor: string;
  createdAt: string;
};

export type PurchaseOrderStatus =
  "PENDING_APPROVAL" | "APPROVED" | "PARTIAL" | "RECEIVED" | "CANCELLED";

export type PurchaseOrderLine = {
  sku: string;
  name: string;
  quantity: number;
  receivedQuantity: number;
  unit: string;
  unitCost: number;
};

export type PurchaseOrderRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  branch: string;
  supplier: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  expectedAt: string;
  createdBy: string;
  approvedBy?: string;
  lines: PurchaseOrderLine[];
  total: number;
};

export type WastageRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  branch: string;
  sku?: string;
  item: string;
  quantity: number;
  unit: string;
  reason: string;
  cost: number;
  requestedBy: string;
  approvedBy?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
};

export type BreakageRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  branch: string;
  item: string;
  quantity: number;
  unit: string;
  reason: string;
  value: number;
  requestedBy: string;
  approvedBy?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
};

export type EmployeeRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  name: string;
  role: string;
  department: string;
  branch: string;
  shift: string;
  netMonthlyPay: number;
  monthlyWorkDays: number;
  standardDailyHours: number;
  active: boolean;
};

export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "OFF" | "ON_LEAVE";

export type AttendanceRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  employeeId: string;
  employeeName: string;
  branch: string;
  date: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  clockIn?: string;
  clockOut?: string;
  status: AttendanceStatus;
  minutesLate: number;
  overtimeMinutes: number;
  source: "POS" | "MOBILE" | "MANUAL" | "SEED";
  updatedAt: string;
};

export type BillingRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  orderIds: string[];
  sourceBillIds?: string[];
  splitFromBillId?: string;
  splitMethod?: "ITEM" | "QUANTITY" | "GUEST" | "EQUAL" | "CUSTOM";
  branch: string;
  customer: string;
  customerId?: string;
  customerCode?: string;
  table?: string;
  status: InvoiceStatus;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "PROVIDER_RECEIVABLE";
  issuedAt: string;
  dueAt: string;
  lines: TransactionLine[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
};

export type MarketplaceReceivable = {
  id: string;
  tenantId: string;
  branchId: string;
  branch: string;
  orderId: string;
  invoiceId: string;
  connectionId: string;
  providerId: string;
  externalOrderId: string;
  providerDisplayReference?: string;
  currency: string;
  grossAmount: number;
  externallyCollectedAmount: number;
  settledAmount: number;
  outstandingAmount: number;
  status: "OPEN" | "PARTIALLY_SETTLED" | "SETTLED" | "DISPUTED" | "CANCELLED";
  receivableAccount: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
  metadata: Record<string, unknown>;
};

export type MarketplaceChargeType =
  "COMMISSION" | "DELIVERY_FEE" | "SERVICE_FEE" | "PROMOTION" | "ADJUSTMENT" | "TAX" | "OTHER";

export type MarketplaceCharge = {
  id: string;
  tenantId: string;
  branchId: string;
  orderId: string;
  connectionId: string;
  type: MarketplaceChargeType;
  description: string;
  amount: number;
  taxAmount?: number;
  currency: string;
  source: "PROVIDER_ORDER" | "PROVIDER_REPORT" | "MANUAL";
  externalReference?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ProductionAmendmentRecord = {
  id: string;
  tenantId: string;
  branchId: string;
  branch: string;
  orderId: string;
  type: "ADDITION" | "CANCEL_ITEM";
  lines: TransactionLine[];
  reason: string;
  requestedBy: string;
  approvedBy?: string;
  printStatus: "PENDING" | "PRINTED" | "FAILED";
  createdAt: string;
};

export type PaymentIntent = {
  id: string;
  tenantId?: string;
  branchId?: string;
  orderId: string;
  invoiceId: string;
  branch: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  provider: string;
  tillOrAccount?: string;
  customerPhone?: string;
  createdBy: string;
  createdAt: string;
  status: PaymentIntentStatus;
  expiresAt: string;
  externalReference?: string;
  idempotencyKey: string;
};

export type PaymentRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  invoiceId: string;
  orderId: string;
  branch: string;
  method: PaymentMethod;
  provider: string;
  amount: number;
  currency: string;
  tenderCurrency?: string;
  tenderAmount?: number;
  baseAmount?: number;
  fxRateReference?: string;
  fxRateNumerator?: number;
  fxRateDenominator?: number;
  reference: string;
  externalTransactionId?: string;
  cashier: string;
  terminal: string;
  timestamp: string;
  reconciliationStatus: ReconciliationStatus;
  settlementStatus: "PENDING" | "SETTLED" | "FAILED" | "NOT_REQUIRED";
  card?: {
    terminalReference: string;
    acquirer: string;
    authorizationCode: string;
    batch: string;
  };
  bank?: {
    bankAccount: string;
    transactionId: string;
    valueDate: string;
    sender: string;
    matchingStatus: ReconciliationStatus;
  };
  cash?: {
    received: number;
    change: number;
    drawerId: string;
  };
};

export type ReceiptRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  orderId: string;
  invoiceId: string;
  branch: string;
  cashier: string;
  customer: string;
  customerId?: string;
  customerCode?: string;
  issuedAt: string;
  total: number;
  paidAmount: number;
  change: number;
  paymentBreakdown: {
    method: PaymentMethod;
    amount: number;
    reference: string;
    tenderCurrency?: string;
    tenderAmount?: number;
    baseAmount?: number;
    fxRateReference?: string;
    fxRateNumerator?: number;
    fxRateDenominator?: number;
  }[];
  reprints: { requestedBy: string; reason: string; timestamp: string }[];
};

export type ExternalTransaction = {
  id: string;
  tenantId?: string;
  branchId?: string;
  provider: string;
  sourceAccount: string;
  destination: string;
  branch?: string;
  amount: number;
  direction: ExternalDirection;
  currency: string;
  reference: string;
  timestamp: string;
  description: string;
  providerMetadata: Record<string, string>;
  importedAt: string;
  reconciliationStatus: ReconciliationStatus;
};

export type ReconciliationMatch = {
  id: string;
  tenantId?: string;
  externalTransactionId: string;
  internalTransactionId: string;
  internalType:
    | "Payment"
    | "Invoice"
    | "Expense"
    | "Supplier Payment"
    | "Payroll Payment"
    | "Bank Transfer"
    | "Cash Deposit"
    | "Utility Bill"
    | "Customer Payment";
  matchType: "EXACT_REFERENCE" | "REFERENCE_AMOUNT" | "AMOUNT_TIME_BRANCH" | "MANUAL";
  amount: number;
  confidence: number;
  matchedBy: string;
  matchedAt: string;
  status: "SUGGESTED" | "APPROVED" | "REJECTED";
  notes?: string;
};

export type JournalEntry = {
  id: string;
  tenantId?: string;
  branchId?: string;
  sourceType:
    | "Invoice"
    | "Payment"
    | "Receipt"
    | "Refund"
    | "Expense"
    | "Reconciliation"
    | "Marketplace Sale"
    | "Marketplace Reversal";
  sourceId: string;
  branch: string;
  status: JournalEntryStatus;
  postedAt?: string;
  lines: { account: string; debit: number; credit: number; costCentre: string; taxCode?: string }[];
};

export type CashDrawer = {
  id: string;
  tenantId?: string;
  branchId?: string;
  branch: string;
  cashier: string;
  openedAt: string;
  closedAt?: string;
  openingCash: number;
  cashSales: number;
  cashIn: number;
  cashRefunds: number;
  cashOut: number;
  expectedDrawer: number;
  physicalCount?: number;
  variance?: number;
  status: "OPEN" | "SUBMITTED" | "APPROVED" | "VARIANCE_REVIEW";
  supervisor?: string;
};

export type RefundRecord = {
  id: string;
  tenantId?: string;
  branchId?: string;
  orderId: string;
  invoiceId: string;
  receiptId?: string;
  branch: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
  requestedBy: string;
  approvedBy?: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "COMPLETED";
  createdAt: string;
  completedAt?: string;
};

export type AuditEvent = {
  id: string;
  tenantId?: string;
  branchId?: string;
  time: string;
  actor: string;
  role: string;
  branch: string;
  module: string;
  action: string;
  record: string;
  before: string;
  after: string;
};

export type TransactionState = {
  schemaVersion?: 2 | 3;
  tenantId?: string;
  paymentOperations?: PaymentOperationsState;
  orders: TransactionOrder[];
  bills: BillingRecord[];
  paymentIntents: PaymentIntent[];
  payments: PaymentRecord[];
  receipts: ReceiptRecord[];
  marketplaceReceivables: MarketplaceReceivable[];
  marketplaceCharges: MarketplaceCharge[];
  productionAmendments: ProductionAmendmentRecord[];
  externalTransactions: ExternalTransaction[];
  reconciliationMatches: ReconciliationMatch[];
  journalEntries: JournalEntry[];
  cashDrawers: CashDrawer[];
  refunds: RefundRecord[];
  auditEvents: AuditEvent[];
  inventory: InventoryStock[];
  recipes: RecipeRecord[];
  stockMovements: StockMovement[];
  purchaseOrders: PurchaseOrderRecord[];
  wastageRecords: WastageRecord[];
  breakageRecords: BreakageRecord[];
  employees: EmployeeRecord[];
  attendanceRecords: AttendanceRecord[];
  costControlSnapshots: CostControlSnapshot[];
};

export type OrderDraft = {
  tenantId?: string;
  branchId?: string;
  branch: string;
  table?: string;
  customer: string;
  customerId?: string;
  customerCode?: string;
  channel: TransactionOrder["channel"];
  cashier: string;
  waiter?: string;
  kitchenNote?: string;
  externalSource?: ExternalOrderSource;
  delivery?: TransactionOrder["delivery"];
  guestContext?: TransactionOrder["guestContext"];
  financialOverride?: {
    subtotal: number;
    tax: number;
    total: number;
  };
  lines: TransactionLine[];
};

const storageKey = "seramet.transaction-engine.v2";
const configurationRepository = new Proxy({} as ConfigurationRepository, {
  get(_target, property) {
    const repository = getConfigurationRepository();
    const value = repository[property as keyof ConfigurationRepository];
    return typeof value === "function" ? value.bind(repository) : value;
  },
});

function resolveScope(branchIdOrName: string, tenantId = LOCAL_PILOT_TENANT_ID) {
  const branch = configurationRepository.resolveBranch(tenantId, branchIdOrName);
  return { tenantId, branchId: branch.id, branch: branch.name };
}

function resolveConfiguredAccount(tenantId: string, branchId: string, method: PaymentMethod) {
  const paymentMethod = configurationRepository
    .listPaymentMethods(tenantId, false)
    .find((item) => item.id === method || item.code === method);
  if (!paymentMethod?.providerConnectionId) return paymentMethod?.settlementAccountId;
  const connection = configurationRepository
    .listConnections(tenantId, branchId)
    .find((item) => item.id === paymentMethod.providerConnectionId);
  const shortcode = connection?.configuration["shortcode"];
  return typeof shortcode === "string" ? shortcode : paymentMethod.settlementAccountId;
}

function configuredPaymentMethod(
  tenantId: string,
  category: "CASH" | "DIGITAL_WALLET" | "CARD" | "BANK_TRANSFER" | "CREDIT",
) {
  return configurationRepository
    .listPaymentMethods(tenantId)
    .find((method) => method.category === category);
}

function configuredPaymentProvider(tenantId: string, branchId: string, methodIdOrCode: string) {
  const method = configurationRepository
    .listPaymentMethods(tenantId, false)
    .find((item) => item.id === methodIdOrCode || item.code === methodIdOrCode);
  if (!method?.providerConnectionId) return method?.displayName ?? "Configured payment method";
  return (
    configurationRepository
      .listConnections(tenantId, branchId)
      .find((connection) => connection.id === method.providerConnectionId)?.displayName ??
    method.displayName
  );
}

function isAllBranchScopeInput(value: string) {
  return /^all(?:\s+branches)?$/i.test(value.trim());
}

function selectedBranchIds(tenantId: string, branchIdOrName: string) {
  if (isAllBranchScopeInput(branchIdOrName)) {
    return configurationRepository.listBranches(tenantId).map((branch) => branch.id);
  }
  return [configurationRepository.resolveBranch(tenantId, branchIdOrName).id];
}

function recordMatchesBranch(
  record: { tenantId?: string; branchId?: string; branch: string },
  tenantId: string,
  branchIdOrName: string,
) {
  if ((record.tenantId ?? tenantId) !== tenantId) return false;
  const branchIds = selectedBranchIds(tenantId, branchIdOrName);
  const recordBranchId =
    record.branchId ?? configurationRepository.resolveBranch(tenantId, record.branch).id;
  return branchIds.includes(recordBranchId);
}

function now() {
  return new Date().toISOString();
}

function addMinutes(iso: string, minutes: number) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function money(n: number) {
  return Math.round(n);
}

export function nextTransactionRecordId(prefix: string, records: ReadonlyArray<{ id: string }>) {
  const highestSequence = records.reduce((highest, record) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(record.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${prefix}-${String(highestSequence + 1).padStart(5, "0")}`;
}

function id(prefix: string, state: TransactionState, collection: keyof TransactionState) {
  return nextTransactionRecordId(
    prefix,
    state[collection] as unknown as ReadonlyArray<{ id: string }>,
  );
}

function totals(lines: TransactionLine[]) {
  const subtotal = money(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  return { subtotal, tax: 0, total: subtotal };
}

function audit(state: TransactionState, event: Omit<AuditEvent, "id" | "time">) {
  const scope = resolveScope(
    event.branchId ?? event.branch,
    event.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID,
  );
  state.auditEvents = [
    {
      id: id("AUD", state, "auditEvents"),
      time: now(),
      ...event,
      ...scope,
    },
    ...state.auditEvents,
  ];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function roundStock(value: number) {
  return Math.round(value * 1000) / 1000;
}

function shiftHours(shift: string) {
  const [start, end] = shift.split("-");
  if (!start || !end || shift === "OFF") return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  let minutes = eh! * 60 + em! - (sh! * 60 + sm!);
  if (minutes < 0) minutes += 24 * 60;
  return Math.max(0, minutes / 60);
}

function scopeTimeZone(tenantId: string, branchIdOrName: string) {
  const branch = configurationRepository.resolveBranch(tenantId, branchIdOrName);
  return branch.timezone || configurationRepository.getTenant(tenantId).timezone || "UTC";
}

function dateInTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date());
}

function timeInTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date());
}

function clockToMinutes(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour! * 60 + minute!;
}

function legacyBranchId(name: string) {
  return `branch-${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function normalizeScopedRecord<T extends { tenantId?: string; branchId?: string; branch: string }>(
  record: T,
  fallbackTenantId: string,
): T {
  const tenantId = record.tenantId ?? fallbackTenantId;
  try {
    const scope = resolveScope(record.branchId ?? record.branch, tenantId);
    return { ...record, ...scope };
  } catch {
    const name = record.branch.trim();
    if (!name || /^all(?:\s+branches)?$/i.test(name)) return { ...record, tenantId };
    const branchId = record.branchId ?? legacyBranchId(name);
    configurationRepository.upsertBranch(tenantId, {
      id: branchId,
      tenantId,
      code: name
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 6)
        .toUpperCase(),
      name,
      address: "",
      phone: "",
      email: "",
      active: true,
      metadata: { migratedFromTransactionState: true },
    });
    return { ...record, tenantId, branchId, branch: name };
  }
}

export function normalizeTransactionState(state: TransactionState): TransactionState {
  const tenantId = state.tenantId ?? LOCAL_PILOT_TENANT_ID;
  const employees = Array.isArray(state.employees) ? clone(state.employees) : [];
  const attendanceRecords = Array.isArray(state.attendanceRecords)
    ? clone(state.attendanceRecords)
    : [];

  const scoped = <T extends { tenantId?: string; branchId?: string; branch: string }>(rows: T[]) =>
    rows.map((record) => normalizeScopedRecord(record, tenantId));

  return {
    ...state,
    schemaVersion: 3,
    tenantId,
    paymentOperations: normalizePaymentOperations(state, tenantId),
    orders: scoped(Array.isArray(state.orders) ? state.orders : []),
    bills: scoped(Array.isArray(state.bills) ? state.bills : []),
    paymentIntents: scoped(Array.isArray(state.paymentIntents) ? state.paymentIntents : []),
    payments: scoped(Array.isArray(state.payments) ? state.payments : []),
    receipts: scoped(Array.isArray(state.receipts) ? state.receipts : []),
    marketplaceReceivables: scoped(
      Array.isArray(state.marketplaceReceivables) ? state.marketplaceReceivables : [],
    ),
    marketplaceCharges: (Array.isArray(state.marketplaceCharges)
      ? state.marketplaceCharges
      : []
    ).map((record) => ({ ...record, tenantId: record.tenantId ?? tenantId })),
    productionAmendments: scoped(
      Array.isArray(state.productionAmendments) ? state.productionAmendments : [],
    ),
    externalTransactions: (Array.isArray(state.externalTransactions)
      ? state.externalTransactions
      : []
    ).map((record) =>
      record.branch
        ? normalizeScopedRecord(record as ExternalTransaction & { branch: string }, tenantId)
        : { ...record, tenantId },
    ),
    reconciliationMatches: (Array.isArray(state.reconciliationMatches)
      ? state.reconciliationMatches
      : []
    ).map((record) => ({ ...record, tenantId: record.tenantId ?? tenantId })),
    journalEntries: scoped(Array.isArray(state.journalEntries) ? state.journalEntries : []),
    cashDrawers: scoped(Array.isArray(state.cashDrawers) ? state.cashDrawers : []),
    refunds: scoped(Array.isArray(state.refunds) ? state.refunds : []),
    auditEvents: scoped(Array.isArray(state.auditEvents) ? state.auditEvents : []),
    inventory: scoped(Array.isArray(state.inventory) ? state.inventory : []),
    recipes: (Array.isArray(state.recipes) ? state.recipes : []).map((record) => ({
      ...record,
      tenantId: record.tenantId ?? tenantId,
    })),
    stockMovements: scoped(Array.isArray(state.stockMovements) ? state.stockMovements : []),
    purchaseOrders: scoped(Array.isArray(state.purchaseOrders) ? state.purchaseOrders : []),
    wastageRecords: scoped(Array.isArray(state.wastageRecords) ? state.wastageRecords : []),
    breakageRecords: scoped(Array.isArray(state.breakageRecords) ? state.breakageRecords : []),
    employees: scoped(employees),
    attendanceRecords: scoped(attendanceRecords),
    costControlSnapshots: Array.isArray(state.costControlSnapshots)
      ? state.costControlSnapshots.map((snapshot) => ({ ...snapshot, tenantId }))
      : [],
  };
}

function findInventoryItem(state: TransactionState, branch: string, sku: string) {
  return state.inventory.find((item) => item.branch === branch && item.sku === sku);
}

function stockStatus(item: Pick<InventoryStock, "stock" | "par">) {
  if (item.stock <= item.par * 0.35) return "Critical";
  if (item.stock <= item.par) return "Low";
  return "Healthy";
}

function recipeCostForBranch(state: TransactionState, recipe: RecipeRecord, branch: string) {
  return money(
    recipe.ingredients.reduce((sum, ingredient) => {
      const item = findInventoryItem(state, branch, ingredient.sku);
      return sum + (item?.averageCost ?? 0) * ingredient.quantity;
    }, 0),
  );
}

function availableRecipePortions(state: TransactionState, branch: string, productId: string) {
  const recipe = state.recipes.find((item) => item.productId === productId);
  if (!recipe || recipe.ingredients.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(
    0,
    Math.floor(
      Math.min(
        ...recipe.ingredients.map((ingredient) => {
          const stock = findInventoryItem(state, branch, ingredient.sku)?.stock ?? 0;
          return ingredient.quantity > 0 ? stock / ingredient.quantity : Number.POSITIVE_INFINITY;
        }),
      ),
    ),
  );
}

function postOrderInventoryConsumption(
  state: TransactionState,
  order: TransactionOrder,
  actor: string,
) {
  if (order.inventoryPostedAt) return;
  const stamp = now();
  order.lines.forEach((line) => {
    if (!line.productId || line.quantity <= 0) return;
    const recipe = state.recipes.find((item) => item.productId === line.productId);
    if (!recipe) return;
    recipe.ingredients.forEach((ingredient) => {
      const item = findInventoryItem(state, order.branch, ingredient.sku);
      if (!item) return;
      const quantity = roundStock(ingredient.quantity * line.quantity);
      item.stock = roundStock(Math.max(0, item.stock - quantity));
      item.updatedAt = stamp;
      state.stockMovements.unshift({
        id: id("MOV", state, "stockMovements"),
        branch: order.branch,
        sku: item.sku,
        quantity: -quantity,
        unit: item.unit,
        unitCost: item.averageCost,
        type: "SALE_CONSUMPTION",
        reference: order.id,
        reason: `${line.name} x${line.quantity}`,
        actor,
        createdAt: stamp,
      });
    });
  });
  order.inventoryPostedAt = stamp;
}

export function createEmptyTransactionState(tenantId: string): TransactionState {
  return {
    schemaVersion: 3,
    tenantId,
    paymentOperations: emptyPaymentOperationsState(),
    orders: [],
    bills: [],
    paymentIntents: [],
    payments: [],
    receipts: [],
    marketplaceReceivables: [],
    marketplaceCharges: [],
    productionAmendments: [],
    externalTransactions: [],
    reconciliationMatches: [],
    journalEntries: [],
    cashDrawers: [],
    refunds: [],
    auditEvents: [],
    inventory: [],
    recipes: [],
    stockMovements: [],
    purchaseOrders: [],
    wastageRecords: [],
    breakageRecords: [],
    employees: [],
    attendanceRecords: [],
    costControlSnapshots: [],
  };
}

export const TransactionEngine = {
  storageKey,

  load(): TransactionState {
    if (typeof window === "undefined") return createEmptyTransactionState(LOCAL_PILOT_TENANT_ID);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      const initial = createEmptyTransactionState(LOCAL_PILOT_TENANT_ID);
      this.save(initial);
      return initial;
    }
    try {
      const normalized = normalizeTransactionState(JSON.parse(raw) as TransactionState);
      this.save(normalized);
      return normalized;
    } catch {
      const initial = createEmptyTransactionState(LOCAL_PILOT_TENANT_ID);
      this.save(initial);
      return initial;
    }
  },

  save(state: TransactionState) {
    if (typeof window !== "undefined")
      window.localStorage.setItem(storageKey, JSON.stringify(state));
  },

  reset() {
    const state = createEmptyTransactionState(LOCAL_PILOT_TENANT_ID);
    this.save(state);
    return state;
  },

  getInventoryRows(state: TransactionState, branch: string) {
    const tenantId = state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const rows = state.inventory.filter((item) => recordMatchesBranch(item, tenantId, branch));
    if (!isAllBranchScopeInput(branch)) {
      return rows.map((item) => ({ ...item, status: stockStatus(item) }));
    }
    const grouped = new Map<string, InventoryStock>();
    rows.forEach((item) => {
      const current = grouped.get(item.sku);
      if (!current) {
        grouped.set(item.sku, { ...item, branch: "Aggregated" });
        return;
      }
      current.stock = roundStock(current.stock + item.stock);
      current.par = roundStock(current.par + item.par);
      current.updatedAt = current.updatedAt > item.updatedAt ? current.updatedAt : item.updatedAt;
    });
    return [...grouped.values()].map((item) => ({ ...item, status: stockStatus(item) }));
  },

  getRecipeLibrary(state: TransactionState, branch: string) {
    const tenantId = state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const targetBranch = configurationRepository.getBranch(
      tenantId,
      selectedBranchIds(tenantId, branch)[0]!,
    ).name;
    return state.recipes.map((recipe) => ({
      ...recipe,
      cost: recipeCostForBranch(state, recipe, targetBranch),
      availablePortions: availableRecipePortions(state, targetBranch, recipe.productId),
    }));
  },

  getProductAvailability(state: TransactionState, branch: string, productId: string) {
    const portions = availableRecipePortions(state, branch, productId);
    return {
      available: portions > 0,
      portions: Number.isFinite(portions) ? portions : undefined,
    };
  },

  generatePurchaseOrders(state: TransactionState, branch: string, user: string) {
    const next = clone(normalizeTransactionState(state));
    const tenantId = next.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const targetBranches = selectedBranchIds(tenantId, branch).map((branchId) =>
      configurationRepository.getBranch(tenantId, branchId),
    );
    const created: string[] = [];
    targetBranches.forEach((targetBranchRecord) => {
      const targetBranch = targetBranchRecord.name;
      const candidates = next.inventory.filter(
        (item) => item.branchId === targetBranchRecord.id && item.stock < item.par,
      );
      const bySupplier = new Map<string, InventoryStock[]>();
      candidates.forEach((item) => {
        const list = bySupplier.get(item.supplier) ?? [];
        list.push(item);
        bySupplier.set(item.supplier, list);
      });
      bySupplier.forEach((items, supplier) => {
        const duplicate = next.purchaseOrders.some(
          (po) =>
            po.branch === targetBranch &&
            po.supplier === supplier &&
            ["PENDING_APPROVAL", "APPROVED", "PARTIAL"].includes(po.status),
        );
        if (duplicate) return;
        const lines: PurchaseOrderLine[] = items.map((item) => ({
          sku: item.sku,
          name: item.name,
          quantity: Math.max(0, Math.ceil(item.par - item.stock)),
          receivedQuantity: 0,
          unit: item.unit,
          unitCost: item.averageCost,
        }));
        if (lines.every((line) => line.quantity <= 0)) return;
        const purchaseOrder: PurchaseOrderRecord = {
          id: `PO-${new Date().getFullYear()}-${String(next.purchaseOrders.length + 1).padStart(4, "0")}`,
          tenantId,
          branchId: targetBranchRecord.id,
          branch: targetBranch,
          supplier,
          status: "PENDING_APPROVAL",
          createdAt: now(),
          expectedAt: addMinutes(now(), 24 * 60),
          createdBy: user,
          lines,
          total: money(lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0)),
        };
        next.purchaseOrders.unshift(purchaseOrder);
        created.push(purchaseOrder.id);
        audit(next, {
          actor: user,
          role: "Branch Manager",
          branch: targetBranch,
          module: "Procurement",
          action: "Generated PAR purchase order",
          record: purchaseOrder.id,
          before: "No purchase order",
          after: `${supplier} ${purchaseOrder.total}`,
        });
      });
    });
    return { state: next, created };
  },

  approvePurchaseOrder(state: TransactionState, purchaseOrderId: string, user: string) {
    const next = clone(normalizeTransactionState(state));
    const po = next.purchaseOrders.find((item) => item.id === purchaseOrderId);
    if (!po || po.status !== "PENDING_APPROVAL") return next;
    po.status = "APPROVED";
    po.approvedBy = user;
    audit(next, {
      actor: user,
      role: "Branch Manager",
      branch: po.branch,
      module: "Procurement",
      action: "Approved purchase order",
      record: po.id,
      before: "PENDING APPROVAL",
      after: "APPROVED",
    });
    return next;
  },

  receivePurchaseOrder(
    state: TransactionState,
    purchaseOrderId: string,
    quantities: Record<string, number>,
    user: string,
  ) {
    const next = clone(normalizeTransactionState(state));
    const po = next.purchaseOrders.find((item) => item.id === purchaseOrderId);
    if (!po || !["APPROVED", "PARTIAL"].includes(po.status)) return next;
    const stamp = now();
    po.lines.forEach((line) => {
      const requested = Math.max(0, quantities[line.sku] ?? 0);
      const remaining = Math.max(0, line.quantity - line.receivedQuantity);
      const received = Math.min(requested, remaining);
      if (received <= 0) return;
      line.receivedQuantity = roundStock(line.receivedQuantity + received);
      const item = findInventoryItem(next, po.branch, line.sku);
      if (item) {
        const previousValue = item.stock * item.averageCost;
        const incomingValue = received * line.unitCost;
        item.stock = roundStock(item.stock + received);
        item.averageCost =
          item.stock > 0 ? Math.round((previousValue + incomingValue) / item.stock) : line.unitCost;
        item.updatedAt = stamp;
        next.stockMovements.unshift({
          id: id("MOV", next, "stockMovements"),
          branch: po.branch,
          sku: line.sku,
          quantity: received,
          unit: line.unit,
          unitCost: line.unitCost,
          type: "RECEIPT",
          reference: po.id,
          actor: user,
          createdAt: stamp,
        });
      }
    });
    po.status = po.lines.every((line) => line.receivedQuantity >= line.quantity)
      ? "RECEIVED"
      : po.lines.some((line) => line.receivedQuantity > 0)
        ? "PARTIAL"
        : po.status;
    audit(next, {
      actor: user,
      role: "Storekeeper",
      branch: po.branch,
      module: "Receiving",
      action: "Posted goods receipt",
      record: po.id,
      before: "Open purchase order",
      after: po.status,
    });
    return next;
  },

  recordWastage(
    state: TransactionState,
    input: {
      branch: string;
      sku?: string;
      item: string;
      quantity: number;
      unit: string;
      reason: string;
      requestedBy: string;
      approve?: boolean;
    },
  ) {
    const next = clone(normalizeTransactionState(state));
    const scope = resolveScope(input.branch, next.tenantId ?? LOCAL_PILOT_TENANT_ID);
    const stock = input.sku ? findInventoryItem(next, scope.branch, input.sku) : undefined;
    const quantity = Math.max(0, input.quantity);
    const cost = money(quantity * (stock?.averageCost ?? 0));
    const record: WastageRecord = {
      id: id("WST", next, "wastageRecords"),
      ...scope,
      ...(input.sku ? { sku: input.sku } : {}),
      item: input.item,
      quantity,
      unit: input.unit,
      reason: input.reason,
      cost,
      requestedBy: input.requestedBy,
      ...(input.approve ? { approvedBy: input.requestedBy } : {}),
      status: input.approve ? "APPROVED" : "PENDING",
      createdAt: now(),
    };
    next.wastageRecords.unshift(record);
    if (record.status === "APPROVED" && stock && quantity > 0) {
      stock.stock = roundStock(Math.max(0, stock.stock - quantity));
      stock.updatedAt = record.createdAt;
      next.stockMovements.unshift({
        id: id("MOV", next, "stockMovements"),
        ...scope,
        sku: stock.sku,
        quantity: -quantity,
        unit: stock.unit,
        unitCost: stock.averageCost,
        type: "WASTAGE",
        reference: record.id,
        reason: input.reason,
        actor: input.requestedBy,
        createdAt: record.createdAt,
      });
    }
    audit(next, {
      actor: input.requestedBy,
      role: "Operations",
      branch: scope.branch,
      module: "Wastage",
      action: "Recorded wastage",
      record: record.id,
      before: "No wastage entry",
      after: `${record.status} ${record.quantity} ${record.unit}`,
    });
    return next;
  },

  approveWastage(state: TransactionState, wastageId: string, user: string) {
    const next = clone(normalizeTransactionState(state));
    const record = next.wastageRecords.find((item) => item.id === wastageId);
    if (!record || record.status !== "PENDING") return next;
    record.status = "APPROVED";
    record.approvedBy = user;
    const scope = resolveScope(
      record.branchId ?? record.branch,
      next.tenantId ?? LOCAL_PILOT_TENANT_ID,
    );
    const stock = record.sku ? findInventoryItem(next, scope.branch, record.sku) : undefined;
    if (stock && record.quantity > 0) {
      stock.stock = roundStock(Math.max(0, stock.stock - record.quantity));
      stock.updatedAt = now();
      next.stockMovements.unshift({
        id: id("MOV", next, "stockMovements"),
        ...scope,
        sku: stock.sku,
        quantity: -record.quantity,
        unit: stock.unit,
        unitCost: stock.averageCost,
        type: "WASTAGE",
        reference: record.id,
        reason: record.reason,
        actor: user,
        createdAt: now(),
      });
    }
    audit(next, {
      actor: user,
      role: "Branch Manager",
      branch: record.branch,
      module: "Wastage",
      action: "Approved wastage",
      record: record.id,
      before: "PENDING",
      after: "APPROVED",
    });
    return next;
  },

  recordBreakage(
    state: TransactionState,
    input: {
      branch: string;
      item: string;
      quantity: number;
      unit: string;
      reason: string;
      value: number;
      requestedBy: string;
    },
  ) {
    const next = clone(normalizeTransactionState(state));
    const record: BreakageRecord = {
      id: id("BRK", next, "breakageRecords"),
      branch: input.branch,
      item: input.item,
      quantity: Math.max(0, input.quantity),
      unit: input.unit,
      reason: input.reason,
      value: money(input.value),
      requestedBy: input.requestedBy,
      status: "PENDING",
      createdAt: now(),
    };
    next.breakageRecords.unshift(record);
    audit(next, {
      actor: input.requestedBy,
      role: "Operations",
      branch: input.branch,
      module: "Breakages",
      action: "Recorded breakage",
      record: record.id,
      before: "No breakage entry",
      after: `PENDING ${record.value}`,
    });
    return next;
  },

  approveBreakage(state: TransactionState, breakageId: string, user: string) {
    const next = clone(normalizeTransactionState(state));
    const record = next.breakageRecords.find((item) => item.id === breakageId);
    if (!record || record.status !== "PENDING") return next;
    record.status = "APPROVED";
    record.approvedBy = user;
    audit(next, {
      actor: user,
      role: "Branch Manager",
      branch: record.branch,
      module: "Breakages",
      action: "Approved breakage",
      record: record.id,
      before: "PENDING",
      after: "APPROVED",
    });
    return next;
  },

  getAttendanceRows(state: TransactionState, branch: string, date?: string) {
    const tenantId = state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const attendanceDate = date ?? dateInTimeZone(scopeTimeZone(tenantId, branch));
    return state.employees
      .filter((employee) => employee.active && recordMatchesBranch(employee, tenantId, branch))
      .map((employee) => {
        const attendance = state.attendanceRecords.find(
          (record) => record.employeeId === employee.id && record.date === attendanceDate,
        );
        return { employee, attendance };
      });
  },

  clockInEmployee(
    state: TransactionState,
    employeeId: string,
    actor: string,
    source: AttendanceRecord["source"] = "POS",
  ) {
    const next = clone(normalizeTransactionState(state));
    const employee = next.employees.find((item) => item.id === employeeId);
    if (!employee || !employee.active) return next;
    const scope = resolveScope(
      employee.branchId ?? employee.branch,
      next.tenantId ?? LOCAL_PILOT_TENANT_ID,
    );
    const timeZone = scopeTimeZone(scope.tenantId, scope.branchId);
    const date = dateInTimeZone(timeZone);
    const current = timeInTimeZone(timeZone);
    const [scheduledStart, scheduledEnd] =
      employee.shift === "OFF" ? [] : employee.shift.split("-");
    const currentMinutes = clockToMinutes(current);
    const scheduledMinutes = scheduledStart ? clockToMinutes(scheduledStart) : undefined;
    const minutesLate =
      scheduledMinutes === undefined ? 0 : Math.max(0, currentMinutes - scheduledMinutes);
    let attendance = next.attendanceRecords.find(
      (record) => record.employeeId === employeeId && record.date === date,
    );
    if (!attendance) {
      attendance = {
        id: `ATT-${date}-${employee.id}`,
        ...scope,
        employeeId: employee.id,
        employeeName: employee.name,
        date,
        ...(scheduledStart ? { scheduledStart } : {}),
        ...(scheduledEnd ? { scheduledEnd } : {}),
        status: minutesLate > 0 ? "LATE" : "PRESENT",
        minutesLate,
        overtimeMinutes: 0,
        source,
        updatedAt: now(),
      };
      next.attendanceRecords.unshift(attendance);
    }
    if (!attendance) return next;
    attendance.clockIn = current;
    delete attendance.clockOut;
    attendance.status = minutesLate > 0 ? "LATE" : "PRESENT";
    attendance.minutesLate = minutesLate;
    attendance.source = source;
    attendance.updatedAt = now();
    audit(next, {
      actor,
      role: "Employee",
      branch: employee.branch,
      module: "Attendance",
      action: "Clocked in employee",
      record: attendance.id,
      before: "Not clocked in",
      after: `${current}; ${minutesLate} min late`,
    });
    return next;
  },

  clockOutEmployee(
    state: TransactionState,
    employeeId: string,
    actor: string,
    source: AttendanceRecord["source"] = "POS",
  ) {
    const next = clone(normalizeTransactionState(state));
    const employee = next.employees.find((item) => item.id === employeeId);
    if (!employee) return next;
    const scope = resolveScope(
      employee.branchId ?? employee.branch,
      next.tenantId ?? LOCAL_PILOT_TENANT_ID,
    );
    const timeZone = scopeTimeZone(scope.tenantId, scope.branchId);
    const date = dateInTimeZone(timeZone);
    const attendance = next.attendanceRecords.find(
      (record) => record.employeeId === employeeId && record.date === date,
    );
    if (!attendance?.clockIn) return next;
    const current = timeInTimeZone(timeZone);
    attendance.clockOut = current;
    attendance.source = source;
    const scheduledEnd = attendance.scheduledEnd
      ? clockToMinutes(attendance.scheduledEnd)
      : undefined;
    const currentMinutes = clockToMinutes(current);
    attendance.overtimeMinutes =
      scheduledEnd === undefined ? 0 : Math.max(0, currentMinutes - scheduledEnd);
    attendance.updatedAt = now();
    audit(next, {
      actor,
      role: "Employee",
      branch: employee.branch,
      module: "Attendance",
      action: "Clocked out employee",
      record: attendance.id,
      before: attendance.clockIn,
      after: `${current}; ${attendance.overtimeMinutes} overtime min`,
    });
    return next;
  },

  setEmployeeNetPay(
    state: TransactionState,
    employeeId: string,
    netMonthlyPay: number,
    user: string,
  ) {
    const next = clone(normalizeTransactionState(state));
    const employee = next.employees.find((item) => item.id === employeeId);
    if (!employee || !Number.isFinite(netMonthlyPay) || netMonthlyPay < 0) return next;
    const before = employee.netMonthlyPay;
    employee.netMonthlyPay = money(netMonthlyPay);
    audit(next, {
      actor: user,
      role: "Branch Manager",
      branch: employee.branch,
      module: "Payroll",
      action: "Updated employee base net pay",
      record: employee.id,
      before: `${before}`,
      after: `${employee.netMonthlyPay}`,
    });
    return next;
  },

  addRider(
    state: TransactionState,
    input: { name: string; branch: string; shift?: string; netMonthlyPay?: number },
    user: string,
  ) {
    const next = clone(normalizeTransactionState(state));
    const name = input.name.trim();
    if (!name || !input.branch.trim()) return next;
    if (
      next.employees.some(
        (employee) =>
          employee.active &&
          employee.name.toLowerCase() === name.toLowerCase() &&
          employee.branch === input.branch,
      )
    ) {
      return next;
    }
    const shift = input.shift?.trim() || "10:00-21:30";
    const employee: EmployeeRecord = {
      id: id("EMP", next, "employees"),
      name,
      role: "Rider",
      department: "Delivery",
      branch: input.branch.trim(),
      shift,
      netMonthlyPay: money(input.netMonthlyPay ?? 0),
      monthlyWorkDays: 26,
      standardDailyHours: Math.max(8, shiftHours(shift) || 8),
      active: true,
    };
    next.employees.push(employee);
    audit(next, {
      actor: user,
      role: "Branch Manager",
      branch: employee.branch,
      module: "Delivery",
      action: "Added rider to roster",
      record: employee.id,
      before: "Not on roster",
      after: `${employee.name}; ${employee.shift}`,
    });
    return next;
  },

  assignDeliveryRider(state: TransactionState, orderId: string, rider: string, user: string) {
    const next = clone(normalizeTransactionState(state));
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || !order.delivery || !rider.trim()) return next;
    const before = order.delivery?.rider ?? "Unassigned";
    order.delivery = {
      ...(order.delivery ?? { status: "UNASSIGNED" as const }),
      rider: rider.trim(),
      status: order.delivery?.status === "DELIVERED" ? "DELIVERED" : "ASSIGNED",
      assignedAt: now(),
    };
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Dispatch",
      branch: order.branch,
      module: "Delivery",
      action: "Assigned rider",
      record: order.id,
      before,
      after: rider.trim(),
    });
    return next;
  },

  setDeliveryStatus(
    state: TransactionState,
    orderId: string,
    status: NonNullable<TransactionOrder["delivery"]>["status"],
    user: string,
  ) {
    const next = clone(normalizeTransactionState(state));
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || !order.delivery) return next;
    const before = order.delivery?.status ?? "UNASSIGNED";
    const stamp = now();
    const pickedUpAt =
      status === "PICKED_UP" || status === "OUT_FOR_DELIVERY" || status === "DELIVERED"
        ? (order.delivery?.pickedUpAt ?? stamp)
        : order.delivery?.pickedUpAt;
    const deliveredAt = status === "DELIVERED" ? stamp : order.delivery?.deliveredAt;
    order.delivery = {
      ...(order.delivery ?? { status: "UNASSIGNED" as const }),
      status,
      ...(pickedUpAt ? { pickedUpAt } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
    };
    if (status === "DELIVERED" && order.paymentStatus === "PAID") order.status = "PAID";
    order.updatedAt = stamp;
    audit(next, {
      actor: user,
      role: "Dispatch",
      branch: order.branch,
      module: "Delivery",
      action: "Updated delivery status",
      record: order.id,
      before,
      after: status,
    });
    return next;
  },

  getPayrollPreview(state: TransactionState, branch: string, month?: string) {
    const tenantId = state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const targetMonth = month ?? dateInTimeZone(scopeTimeZone(tenantId, branch)).slice(0, 7);
    return state.employees
      .filter((employee) => employee.active && recordMatchesBranch(employee, tenantId, branch))
      .map((employee) => {
        const attendance = state.attendanceRecords.filter(
          (record) => record.employeeId === employee.id && record.date.startsWith(targetMonth),
        );
        const lateMinutes = attendance.reduce((sum, record) => sum + record.minutesLate, 0);
        const overtimeMinutes = attendance.reduce((sum, record) => sum + record.overtimeMinutes, 0);
        const workingMinutes = Math.max(
          1,
          employee.monthlyWorkDays * employee.standardDailyHours * 60,
        );
        const minuteRate = employee.netMonthlyPay / workingMinutes;
        const latenessDeduction = Math.round(lateMinutes * minuteRate * 100) / 100;
        return {
          employee,
          lateMinutes,
          overtimeMinutes,
          minuteRate,
          hourlyRate: minuteRate * 60,
          latenessDeduction,
          adjustedNetPay: Math.max(0, employee.netMonthlyPay - latenessDeduction),
        };
      });
  },

  createOrder(state: TransactionState, draft: OrderDraft, status: OrderStatus = "OPEN") {
    const next = clone(state);
    const scope = resolveScope(
      draft.branchId ?? draft.branch,
      draft.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID,
    );
    const normalizedLines = draft.lines.map((line) => {
      const productionStatus =
        line.productionStation && line.productionStation !== "NONE"
          ? (line.productionStatus ?? "NEW")
          : line.productionStatus;
      return productionStatus ? { ...line, productionStatus } : { ...line };
    });
    const total = draft.financialOverride ?? totals(normalizedLines);
    const {
      delivery,
      externalSource,
      guestContext,
      financialOverride: _financialOverride,
      ...baseDraft
    } = draft;
    const order: TransactionOrder = {
      id: id("ORD", next, "orders"),
      ...baseDraft,
      ...scope,
      lines: normalizedLines,
      status,
      paymentStatus: "UNPAID",
      createdAt: now(),
      updatedAt: now(),
      ...total,
      ...(delivery ? { delivery } : {}),
      ...(externalSource ? { externalSource } : {}),
      ...(guestContext ? { guestContext } : {}),
    };
    next.orders.unshift(order);
    audit(next, {
      actor: draft.cashier,
      role: "Cashier",
      branch: scope.branch,
      module: "Orders",
      action: `Created ${status.toLowerCase()} order`,
      record: order.id,
      before: "No order",
      after: `${order.status} ${order.total}`,
    });
    return next;
  },

  holdOrder(state: TransactionState, draft: OrderDraft) {
    return this.createOrder(state, draft, "HELD");
  },

  releaseHeldOrder(state: TransactionState, orderId: string, user: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status !== "HELD") return next;
    order.status = "OPEN";
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Released held order",
      record: order.id,
      before: "HELD",
      after: "OPEN",
    });
    return next;
  },

  sendToKitchen(state: TransactionState, orderId: string, user: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) throw new Error(`Order ${orderId} was not found`);
    if (["CANCELLED", "PAID", "REFUNDED"].includes(order.status)) {
      throw new Error(`Order ${orderId} cannot be sent from ${order.status}`);
    }
    const before = order.status;
    const stamp = now();
    const unsentLines = order.lines.filter((line) => !line.sentAt);
    if (unsentLines.length === 0 && before !== "OPEN" && before !== "HELD") return next;
    unsentLines.forEach((line) => {
      line.sentAt = stamp;
      line.sentQuantity = line.quantity;
    });
    if (["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(before)) {
      next.productionAmendments.unshift({
        id: id("AMD", next, "productionAmendments"),
        tenantId: order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
        branchId:
          order.branchId ??
          configurationRepository.resolveBranch(
            order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
            order.branch,
          ).id,
        branch: order.branch,
        orderId,
        type: "ADDITION",
        lines: unsentLines.map((line) => ({ ...line })),
        reason: "Items added after the original production ticket",
        requestedBy: user,
        printStatus: "PENDING",
        createdAt: stamp,
      });
    }
    order.status = "SENT_TO_KITCHEN";
    if (order.externalSource && !order.externalSource.preparationStartedAt) {
      order.externalSource.preparationStartedAt = now();
    }
    order.updatedAt = stamp;
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Sent order to kitchen",
      record: order.id,
      before,
      after: "SENT_TO_KITCHEN with KOT routing",
    });
    return next;
  },

  setProductionStationStatus(
    state: TransactionState,
    orderId: string,
    station: string,
    status: ProductionStatus,
    user: string,
  ) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status === "CANCELLED" || order.status === "PAID") return next;

    const matchingLines = order.lines.filter((line) => line.productionStation === station);
    if (matchingLines.length === 0) return next;

    const before = order.status;
    const stamp = now();
    matchingLines.forEach((line) => {
      line.productionStatus = status;
      if (status === "PREPARING" && !line.productionStartedAt) line.productionStartedAt = stamp;
      if (status === "READY") line.productionReadyAt = stamp;
      if (status === "SERVED") line.productionServedAt = stamp;
    });

    const productionLines = order.lines.filter(
      (line) => line.productionStation && line.productionStation !== "NONE",
    );
    const active = productionLines.filter((line) => line.productionStatus !== "CANCELLED");
    if (active.length > 0 && active.every((line) => line.productionStatus === "SERVED")) {
      order.status = "SERVED";
    } else if (
      active.length > 0 &&
      active.every(
        (line) => line.productionStatus === "READY" || line.productionStatus === "SERVED",
      )
    ) {
      order.status = "READY";
    } else if (active.some((line) => line.productionStatus === "PREPARING")) {
      order.status = "IN_PROGRESS";
    } else {
      order.status = "SENT_TO_KITCHEN";
    }
    order.updatedAt = stamp;
    if (order.externalSource) {
      if (status === "PREPARING" && !order.externalSource.preparationStartedAt) {
        order.externalSource.preparationStartedAt = stamp;
      }
      if (order.status === "READY" && !order.externalSource.readyAt) {
        order.externalSource.readyAt = stamp;
      }
      if (order.status === "SERVED" && !order.externalSource.completedAt) {
        order.externalSource.completedAt = stamp;
      }
    }

    audit(next, {
      actor: user,
      role: "Kitchen",
      branch: order.branch,
      module: "Kitchen",
      action: `Updated ${station} station`,
      record: order.id,
      before,
      after: `${station}: ${status}; order: ${order.status}`,
    });
    return next;
  },

  markOrderServed(state: TransactionState, orderId: string, user: string) {
    const next = clone(normalizeTransactionState(state));
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status === "CANCELLED" || order.status === "PAID") return next;
    const before = order.status;
    const stamp = now();
    order.lines.forEach((line) => {
      if (
        line.productionStation &&
        line.productionStation !== "NONE" &&
        line.productionStatus !== "CANCELLED"
      ) {
        line.productionStatus = "SERVED";
        line.productionServedAt = stamp;
      }
    });
    order.status = "SERVED";
    order.updatedAt = stamp;
    postOrderInventoryConsumption(next, order, user);
    audit(next, {
      actor: user,
      role: "Service",
      branch: order.branch,
      module: "Orders",
      action: "Marked order served",
      record: order.id,
      before,
      after: "SERVED",
    });
    return next;
  },

  createOpenBill(state: TransactionState, orderId: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) throw new Error(`Order ${orderId} was not found`);
    const existing = next.bills.filter((bill) => bill.orderIds.includes(orderId));
    if (existing.some((bill) => ["OPEN", "PARTIAL", "PENDING", "PAID"].includes(bill.status))) {
      return next;
    }
    if (existing.some((bill) => bill.status === "SPLIT" || bill.status === "MERGED")) {
      throw new Error("The source invoice is no longer payable after split or merge");
    }
    const scope = resolveScope(
      order.branchId ?? order.branch,
      order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
    );
    const bill: BillingRecord = {
      id: id("BILL", next, "bills"),
      ...scope,
      orderIds: [order.id],
      customer: order.customer,
      ...(order.customerId ? { customerId: order.customerId } : {}),
      ...(order.customerCode ? { customerCode: order.customerCode } : {}),
      ...(order.table ? { table: order.table } : {}),
      status: "OPEN",
      paymentStatus: "UNPAID",
      issuedAt: now(),
      dueAt: addMinutes(now(), 120),
      lines: order.lines.map((line) => ({ ...line, sourceOrderId: order.id })),
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      paid: 0,
    };
    next.bills.unshift(bill);
    audit(next, {
      actor: order.cashier,
      role: "Cashier",
      branch: order.branch,
      module: "Invoices",
      action: "Created open bill",
      record: bill.id,
      before: "No bill",
      after: `OPEN ${bill.total}`,
    });
    return next;
  },

  prepareInvoiceForPayment(state: TransactionState, orderId: string, user: string) {
    let next = clone(normalizeTransactionState(state));
    const order = next.orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error(`Order ${orderId} was not found`);
    const orderInvoices = next.bills.filter((invoice) => invoice.orderIds.includes(orderId));
    const payable = orderInvoices.find((invoice) =>
      ["OPEN", "PARTIAL", "PENDING"].includes(invoice.status),
    );
    if (payable) return next;
    if (orderInvoices.some((invoice) => invoice.status === "PAID")) {
      throw new Error("The invoice has already been paid");
    }
    if (
      orderInvoices.some((invoice) => invoice.status === "SPLIT" || invoice.status === "MERGED")
    ) {
      throw new Error("The source invoice is no longer payable after split or merge");
    }
    if (["CANCELLED", "PAID", "REFUNDED"].includes(order.status)) {
      throw new Error(`Order ${orderId} cannot enter payment from ${order.status}`);
    }
    if (order.status === "HELD") next = this.releaseHeldOrder(next, orderId, user);
    const current = next.orders.find((candidate) => candidate.id === orderId)!;
    if (current.status === "OPEN") next = this.sendToKitchen(next, orderId, user);
    const sent = next.orders.find((candidate) => candidate.id === orderId)!;
    if (["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(sent.status)) {
      next = this.requestBill(next, orderId, user);
    } else if (sent.status === "BILL_REQUESTED") {
      next = this.createOpenBill(next, orderId);
    }
    const invoice = next.bills.find(
      (candidate) =>
        candidate.orderIds.includes(orderId) &&
        ["OPEN", "PARTIAL", "PENDING"].includes(candidate.status),
    );
    if (!invoice) throw new Error(`A payable invoice could not be prepared for order ${orderId}`);
    return next;
  },

  recordMarketplaceReceivable(
    state: TransactionState,
    orderId: string,
    input: {
      connectionId: string;
      providerId: string;
      externalOrderId: string;
      providerDisplayReference?: string;
      currency: string;
      externallyCollectedAmount: number;
      receivableAccount: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    let next = clone(normalizeTransactionState(state));
    const initialOrder = next.orders.find((item) => item.id === orderId);
    if (!initialOrder) return next;
    const existing = next.marketplaceReceivables.find(
      (receivable) =>
        receivable.orderId === orderId ||
        (receivable.connectionId === input.connectionId &&
          receivable.externalOrderId === input.externalOrderId),
    );
    if (existing) return next;

    next = this.createOpenBill(next, orderId);
    const order = next.orders.find((item) => item.id === orderId);
    const bill = next.bills.find(
      (candidate) => candidate.orderIds.includes(orderId) && candidate.status !== "VOID",
    );
    if (!order || !bill) return next;
    const tenantId = order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      order.branchId ?? configurationRepository.resolveBranch(tenantId, order.branch).id;
    const stamp = now();
    const receivable: MarketplaceReceivable = {
      id: id("MPR", next, "marketplaceReceivables"),
      tenantId,
      branchId,
      branch: order.branch,
      orderId,
      invoiceId: bill.id,
      connectionId: input.connectionId,
      providerId: input.providerId,
      externalOrderId: input.externalOrderId,
      ...(input.providerDisplayReference
        ? { providerDisplayReference: input.providerDisplayReference }
        : {}),
      currency: input.currency,
      grossAmount: order.total,
      externallyCollectedAmount: money(input.externallyCollectedAmount),
      settledAmount: 0,
      outstandingAmount: order.total,
      status: "OPEN",
      receivableAccount: input.receivableAccount,
      createdAt: stamp,
      updatedAt: stamp,
      metadata: { ...(input.metadata ?? {}) },
    };
    next.marketplaceReceivables.unshift(receivable);
    bill.status = "PROVIDER_RECEIVABLE";
    bill.paymentStatus = "PROVIDER_RECEIVABLE";
    bill.paid = 0;
    order.paymentStatus = "PROVIDER_RECEIVABLE";
    order.externalSource = {
      ...(order.externalSource ?? {
        connectionId: input.connectionId,
        providerId: input.providerId,
        externalStoreId: "",
        externalOrderId: input.externalOrderId,
        externallyPaid: true,
        fulfilmentType: "PROVIDER_DELIVERY",
        isScheduled: false,
        receivedAt: order.createdAt,
        metadata: {},
      }),
      marketplaceReceivableId: receivable.id,
      externallyPaid: true,
      externallyCollectedAmount: receivable.externallyCollectedAmount,
    };
    next.journalEntries.unshift(createMarketplaceSaleJournal(next, order, receivable));
    audit(next, {
      actor: "Integration Runtime",
      role: "System",
      branch: order.branch,
      module: "Marketplace",
      action: "Recorded marketplace receivable",
      record: receivable.id,
      before: "No provider receivable",
      after: `${input.currency} ${receivable.outstandingAmount} due from provider`,
    });
    return next;
  },

  recordMarketplaceCharges(
    state: TransactionState,
    orderId: string,
    charges: Array<
      Omit<MarketplaceCharge, "id" | "tenantId" | "branchId" | "orderId" | "createdAt">
    >,
  ) {
    const next = clone(normalizeTransactionState(state));
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) return next;
    const tenantId = order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      order.branchId ?? configurationRepository.resolveBranch(tenantId, order.branch).id;
    for (const charge of charges) {
      const duplicate = next.marketplaceCharges.some(
        (candidate) =>
          candidate.orderId === orderId &&
          candidate.connectionId === charge.connectionId &&
          candidate.type === charge.type &&
          candidate.externalReference === charge.externalReference &&
          candidate.amount === money(charge.amount),
      );
      if (duplicate) continue;
      next.marketplaceCharges.unshift({
        ...charge,
        id: id("MPC", next, "marketplaceCharges"),
        tenantId,
        branchId,
        orderId,
        amount: money(charge.amount),
        ...(charge.taxAmount === undefined ? {} : { taxAmount: money(charge.taxAmount) }),
        metadata: { ...charge.metadata },
        createdAt: now(),
      });
    }
    return next;
  },

  applyMarketplaceOrderModification(
    state: TransactionState,
    orderId: string,
    input: {
      lines: TransactionLine[];
      reason: string;
      requestedBy: string;
      providerStatus?: string;
      financialOverride?: { subtotal: number; tax: number; total: number };
    },
  ) {
    const next = clone(normalizeTransactionState(state));
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status === "CANCELLED" || order.status === "PAID") return next;
    const beforeLines = order.lines.map((line) => ({ ...line }));
    const previousTotals = { subtotal: order.subtotal, tax: order.tax, total: order.total };
    const productionStarted = [
      "SENT_TO_KITCHEN",
      "IN_PROGRESS",
      "READY",
      "SERVED",
      "BILL_REQUESTED",
    ].includes(order.status);
    const normalizedLines = input.lines.map((line) => ({
      ...line,
      ...(line.productionStation && line.productionStation !== "NONE"
        ? { productionStatus: line.productionStatus ?? "NEW" }
        : {}),
    }));
    const additions = normalizedLines.filter((line) => {
      const previous = beforeLines.find((candidate) => candidate.id === line.id);
      return !previous || line.quantity > previous.quantity;
    });
    const removals = beforeLines.filter((line) => {
      const current = normalizedLines.find((candidate) => candidate.id === line.id);
      return !current || current.quantity < line.quantity;
    });
    if (productionStarted) {
      if (additions.length) {
        next.productionAmendments.unshift({
          id: id("AMD", next, "productionAmendments"),
          tenantId: order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
          branchId:
            order.branchId ??
            configurationRepository.resolveBranch(
              order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
              order.branch,
            ).id,
          branch: order.branch,
          orderId,
          type: "ADDITION",
          lines: additions,
          reason: input.reason,
          requestedBy: input.requestedBy,
          printStatus: "PENDING",
          createdAt: now(),
        });
      }
      if (removals.length) {
        next.productionAmendments.unshift({
          id: id("AMD", next, "productionAmendments"),
          tenantId: order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
          branchId:
            order.branchId ??
            configurationRepository.resolveBranch(
              order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
              order.branch,
            ).id,
          branch: order.branch,
          orderId,
          type: "CANCEL_ITEM",
          lines: removals.map((line) => ({ ...line, productionStatus: "CANCELLED" })),
          reason: input.reason,
          requestedBy: input.requestedBy,
          printStatus: "PENDING",
          createdAt: now(),
        });
      }
    }
    const nextTotals = input.financialOverride ?? totals(normalizedLines);
    order.lines = normalizedLines;
    order.subtotal = nextTotals.subtotal;
    order.tax = nextTotals.tax;
    order.total = nextTotals.total;
    order.updatedAt = now();
    if (order.externalSource && input.providerStatus) {
      order.externalSource.providerStatus = input.providerStatus;
    }
    const receivable = next.marketplaceReceivables.find(
      (candidate) => candidate.orderId === orderId && candidate.status !== "CANCELLED",
    );
    if (receivable && nextTotals.total !== previousTotals.total) {
      const delta = {
        subtotal: money(nextTotals.subtotal - previousTotals.subtotal),
        tax: money(nextTotals.tax - previousTotals.tax),
        total: money(nextTotals.total - previousTotals.total),
      };
      receivable.grossAmount = nextTotals.total;
      receivable.outstandingAmount = money(nextTotals.total - receivable.settledAmount);
      receivable.updatedAt = now();
      const bill = next.bills.find((candidate) => candidate.id === receivable.invoiceId);
      if (bill) {
        bill.lines = normalizedLines.map((line) => ({ ...line, sourceOrderId: order.id }));
        bill.subtotal = nextTotals.subtotal;
        bill.tax = nextTotals.tax;
        bill.total = nextTotals.total;
      }
      next.journalEntries.unshift(
        createMarketplaceAdjustmentJournal(next, order, receivable, delta),
      );
    }
    audit(next, {
      actor: input.requestedBy,
      role: "Integration",
      branch: order.branch,
      module: "Marketplace",
      action: "Applied external order modification",
      record: order.id,
      before: `${beforeLines.length} lines, ${previousTotals.total}`,
      after: `${normalizedLines.length} lines, ${nextTotals.total}`,
    });
    return next;
  },

  updateOrderDraft(state: TransactionState, orderId: string, draft: OrderDraft, user: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) throw new Error(`Order ${orderId} was not found`);
    if (
      [
        "BILL_REQUESTED",
        "AWAITING_PAYMENT",
        "PARTIALLY_PAID",
        "PAID",
        "CANCELLED",
        "REFUNDED",
      ].includes(order.status)
    ) {
      throw new Error(`Order ${orderId} cannot be edited from ${order.status}`);
    }
    const before = `${order.lines.length} lines, ${order.total}`;
    const scope = resolveScope(
      draft.branchId ?? draft.branch,
      draft.tenantId ?? order.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID,
    );
    const currentTenantId = order.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const currentBranchId =
      order.branchId ?? configurationRepository.resolveBranch(currentTenantId, order.branch).id;
    if (scope.tenantId !== currentTenantId || scope.branchId !== currentBranchId) {
      throw new Error("An existing order cannot be moved to another tenant or branch");
    }
    const incomingById = new Map(draft.lines.map((line) => [line.id, line]));
    for (const sentLine of order.lines.filter((line) => line.sentAt)) {
      const incoming = incomingById.get(sentLine.id);
      if (!incoming) {
        throw new Error(
          "Sent kitchen lines cannot be removed; use the authorized cancellation workflow",
        );
      }
      if (
        incoming.quantity !== sentLine.quantity ||
        incoming.productId !== sentLine.productId ||
        incoming.name !== sentLine.name ||
        incoming.unitPrice !== sentLine.unitPrice ||
        incoming.productionStation !== sentLine.productionStation ||
        incoming.itemNote !== sentLine.itemNote
      ) {
        throw new Error("Sent kitchen lines are immutable; add a new line or request cancellation");
      }
    }
    const normalizedLines = draft.lines.map((line) => {
      const existing = order.lines.find((candidate) => candidate.id === line.id);
      if (existing?.sentAt) return { ...existing };
      const productionStatus =
        line.productionStation && line.productionStation !== "NONE"
          ? (line.productionStatus ?? "NEW")
          : line.productionStatus;
      return productionStatus ? { ...line, productionStatus } : { ...line };
    });
    const total = draft.financialOverride ?? totals(normalizedLines);
    order.tenantId = scope.tenantId;
    order.branchId = scope.branchId;
    order.branch = scope.branch;
    if (draft.table) order.table = draft.table;
    else delete order.table;
    order.customer = draft.customer;
    if (draft.customerId) order.customerId = draft.customerId;
    else delete order.customerId;
    if (draft.customerCode) order.customerCode = draft.customerCode;
    else delete order.customerCode;
    order.channel = draft.channel;
    order.cashier = draft.cashier;
    if (draft.waiter) order.waiter = draft.waiter;
    else delete order.waiter;
    if (draft.kitchenNote) order.kitchenNote = draft.kitchenNote;
    else delete order.kitchenNote;
    if (draft.guestContext) order.guestContext = { ...draft.guestContext };
    order.lines = normalizedLines;
    order.subtotal = total.subtotal;
    order.tax = total.tax;
    order.total = total.total;
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Updated active order",
      record: order.id,
      before,
      after: `${order.lines.length} lines, ${order.total}`,
    });
    return next;
  },

  requestBill(state: TransactionState, orderId: string, user: string) {
    let next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) throw new Error(`Order ${orderId} was not found`);
    if (order.status === "BILL_REQUESTED") return this.createOpenBill(next, orderId);
    if (!["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(order.status)) {
      throw new Error(`Order ${orderId} cannot request a bill from ${order.status}`);
    }
    const before = order.status;
    order.status = "BILL_REQUESTED";
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Requested customer bill",
      record: order.id,
      before,
      after: "BILL_REQUESTED - moved to invoices",
    });
    next = this.createOpenBill(next, orderId);
    return next;
  },

  createPaymentIntent(
    state: TransactionState,
    invoiceId: string,
    input: {
      amount: number;
      method: PaymentMethod;
      provider?: string;
      createdBy: string;
      customerPhone?: string;
    },
  ) {
    const next = clone(state);
    const invoice = next.bills.find((bill) => bill.id === invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} was not found`);
    if (!["OPEN", "PARTIAL", "PENDING"].includes(invoice.status)) {
      throw new Error(`Invoice ${invoiceId} cannot accept a payment intent from ${invoice.status}`);
    }
    const outstanding = money(invoice.total - invoice.paid);
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > outstanding) {
      throw new Error("Payment intent amount must be within the outstanding invoice balance");
    }
    const tenantId = invoice.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      invoice.branchId ?? configurationRepository.resolveBranch(tenantId, invoice.branch).id;
    const tenant = configurationRepository.getTenant(tenantId);
    const methodDefinition = configurationRepository
      .listPaymentMethods(tenantId, false)
      .find((method) => method.id === input.method || method.code === input.method);
    if (!methodDefinition?.enabled) {
      throw new Error(`Payment method ${input.method} is not configured for this business`);
    }
    const methodStatus: PaymentIntentStatus =
      methodDefinition?.category === "CASH"
        ? "CREATED"
        : methodDefinition?.category === "CARD"
          ? "PROCESSING"
          : methodDefinition?.metadata["prompt"] === true ||
              methodDefinition?.metadata["providerOperation"] === "PAYMENT_PROMPT"
            ? "AWAITING_CUSTOMER"
            : "PENDING";
    const configuredConnection = methodDefinition?.providerConnectionId
      ? configurationRepository
          .listConnections(tenantId, branchId)
          .find((connection) => connection.id === methodDefinition.providerConnectionId)
      : undefined;
    const tillOrAccount = resolveConfiguredAccount(tenantId, branchId, input.method);
    const intent: PaymentIntent = {
      id: id("PI", next, "paymentIntents"),
      tenantId,
      branchId,
      orderId: invoice.orderIds[0]!,
      invoiceId,
      branch: invoice.branch,
      amount: money(input.amount),
      currency: tenant.defaultCurrency,
      method: input.method,
      provider: configuredConnection?.displayName ?? methodDefinition.displayName,
      ...(tillOrAccount ? { tillOrAccount } : {}),
      ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
      createdBy: input.createdBy,
      createdAt: now(),
      status: methodStatus,
      expiresAt: addMinutes(now(), 15),
      idempotencyKey: `${invoiceId}:${input.method}:${money(input.amount)}:${input.customerPhone ?? "none"}`,
    };
    next.paymentIntents.unshift(intent);
    audit(next, {
      actor: input.createdBy,
      role: "Cashier",
      branch: invoice.branch,
      module: "Payments",
      action: "Created payment intent",
      record: intent.id,
      before: "No intent",
      after: `${intent.method} ${intent.status}`,
    });
    return { state: next, intent };
  },

  confirmPaymentIntent(
    state: TransactionState,
    intentId: string,
    externalReference: string,
    cashier = "Provider Callback",
  ) {
    const next = clone(state);
    const intent = next.paymentIntents.find((item) => item.id === intentId);
    if (!intent || intent.status === "SUCCEEDED") return next;
    intent.status = "SUCCEEDED";
    intent.externalReference = externalReference;
    return this.applyPayment(next, intent.invoiceId, {
      amount: intent.amount,
      method: intent.method,
      provider: intent.provider,
      reference: externalReference,
      cashier,
      terminal: "PROVIDER",
      reconciliationStatus: "MATCHED",
      settlementStatus:
        configurationRepository
          .listPaymentMethods(intent.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID, false)
          .find((method) => method.code === intent.method || method.id === intent.method)
          ?.category === "CASH"
          ? "NOT_REQUIRED"
          : "PENDING",
      externalTransactionId: `EXT-${externalReference}`,
    });
  },

  recordManualTillPayment(
    state: TransactionState,
    invoiceId: string,
    input: { amount: number; reference: string; cashier: string; terminal: string },
  ) {
    const bill = state.bills.find((item) => item.id === invoiceId);
    if (!bill) return state;
    const tenantId = bill.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      bill.branchId ?? configurationRepository.resolveBranch(tenantId, bill.branch).id;
    const method = configuredPaymentMethod(tenantId, "DIGITAL_WALLET");
    if (!method) return state;
    return this.applyPayment(state, invoiceId, {
      amount: input.amount,
      method: method.code,
      provider: configuredPaymentProvider(tenantId, branchId, method.code),
      reference: input.reference,
      cashier: input.cashier,
      terminal: input.terminal,
      reconciliationStatus: "SUGGESTED",
      settlementStatus: "PENDING",
    });
  },

  recordCashPayment(
    state: TransactionState,
    invoiceId: string,
    input: { received: number; cashier: string; terminal: string },
  ) {
    const bill = state.bills.find((item) => item.id === invoiceId);
    if (!bill) return state;
    const tenantId = bill.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      bill.branchId ?? configurationRepository.resolveBranch(tenantId, bill.branch).id;
    const method = configuredPaymentMethod(tenantId, "CASH");
    if (!method) return state;
    const due = Math.max(0, (bill?.total ?? 0) - (bill?.paid ?? 0));
    const amount = Math.min(input.received, due);
    return this.applyPayment(state, invoiceId, {
      amount,
      method: method.code,
      provider: method.displayName,
      reference: `CASH-${invoiceId}-${state.payments.length + 1}`,
      cashier: input.cashier,
      terminal: input.terminal,
      reconciliationStatus: "RECONCILED",
      settlementStatus: "NOT_REQUIRED",
      cash: {
        received: input.received,
        change: Math.max(0, input.received - amount),
        drawerId:
          state.cashDrawers.find(
            (drawer) => drawer.branchId === branchId && drawer.status === "OPEN",
          )?.id ?? `drawer-${branchId}`,
      },
    });
  },

  recordCardPayment(
    state: TransactionState,
    invoiceId: string,
    input: {
      amount: number;
      reference: string;
      cashier: string;
      terminal: string;
      acquirer: string;
      batch: string;
    },
  ) {
    const bill = state.bills.find((item) => item.id === invoiceId);
    if (!bill) return state;
    const tenantId = bill.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      bill.branchId ?? configurationRepository.resolveBranch(tenantId, bill.branch).id;
    const method = configuredPaymentMethod(tenantId, "CARD");
    if (!method) return state;
    return this.applyPayment(state, invoiceId, {
      amount: input.amount,
      method: method.code,
      provider: configuredPaymentProvider(tenantId, branchId, method.code),
      reference: input.reference,
      cashier: input.cashier,
      terminal: input.terminal,
      reconciliationStatus: "SUGGESTED",
      settlementStatus: "PENDING",
      card: {
        terminalReference: input.terminal,
        acquirer: input.acquirer,
        authorizationCode: input.reference,
        batch: input.batch,
      },
    });
  },

  recordBankPayment(
    state: TransactionState,
    invoiceId: string,
    input: {
      amount: number;
      reference: string;
      cashier: string;
      bankAccount: string;
      sender: string;
    },
  ) {
    const bill = state.bills.find((item) => item.id === invoiceId);
    if (!bill) return state;
    const tenantId = bill.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      bill.branchId ?? configurationRepository.resolveBranch(tenantId, bill.branch).id;
    const method = configuredPaymentMethod(tenantId, "BANK_TRANSFER");
    if (!method) return state;
    return this.applyPayment(state, invoiceId, {
      amount: input.amount,
      method: method.code,
      provider: configuredPaymentProvider(tenantId, branchId, method.code),
      reference: input.reference,
      cashier: input.cashier,
      terminal: "BANK",
      reconciliationStatus: "SUGGESTED",
      settlementStatus: "PENDING",
      bank: {
        bankAccount: input.bankAccount,
        transactionId: input.reference,
        valueDate: now().slice(0, 10),
        sender: input.sender,
        matchingStatus: "SUGGESTED",
      },
    });
  },

  applyPayment(
    state: TransactionState,
    invoiceId: string,
    input: Omit<
      PaymentRecord,
      "id" | "tenantId" | "branchId" | "invoiceId" | "orderId" | "branch" | "currency" | "timestamp"
    >,
  ) {
    const next = clone(normalizeTransactionState(state));
    const bill = next.bills.find((item) => item.id === invoiceId);
    if (!bill) throw new Error(`Invoice ${invoiceId} was not found`);
    if (!["OPEN", "PARTIAL", "PENDING"].includes(bill.status)) {
      throw new Error(`Invoice ${invoiceId} cannot accept payment from ${bill.status}`);
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Payment amount must be positive");
    }
    if (
      next.payments.some(
        (payment) => payment.reference === input.reference && payment.invoiceId === invoiceId,
      )
    )
      return next;
    const order = next.orders.find((item) => item.id === bill.orderIds[0]);
    const tenantId = bill.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID;
    const branchId =
      bill.branchId ?? configurationRepository.resolveBranch(tenantId, bill.branch).id;
    const payment: PaymentRecord = {
      id: id("PAY", next, "payments"),
      tenantId,
      branchId,
      invoiceId,
      orderId: bill.orderIds[0]!,
      branch: bill.branch,
      currency: configurationRepository.getTenant(tenantId).defaultCurrency,
      timestamp: now(),
      ...input,
    };
    next.payments.unshift(payment);
    bill.paid = money(bill.paid + input.amount);
    bill.paymentStatus = bill.paid >= bill.total ? "PAID" : "PARTIAL";
    bill.status = bill.paid >= bill.total ? "PAID" : "PARTIAL";
    if (order) {
      order.paymentStatus = bill.paymentStatus;
      order.status = bill.paid >= bill.total ? "PAID" : "PARTIALLY_PAID";
      order.updatedAt = now();
      if (bill.paid >= bill.total) postOrderInventoryConsumption(next, order, input.cashier);
    }
    next.journalEntries.unshift(createPaymentJournal(next, bill, payment));
    if (
      bill.paid >= bill.total &&
      !next.receipts.some((receipt) => receipt.invoiceId === bill.id)
    ) {
      next.receipts.unshift(
        createReceipt(
          next,
          bill,
          next.payments.filter((item) => item.invoiceId === bill.id),
        ),
      );
    }
    audit(next, {
      actor: input.cashier,
      role: "Cashier",
      branch: bill.branch,
      module: "Payments",
      action: "Recorded payment",
      record: payment.id,
      before: `${bill.total - bill.paid + input.amount} due`,
      after: `${bill.total - bill.paid} due`,
    });
    return next;
  },

  mergeBills(state: TransactionState, billIds: string[], user: string, reason: string) {
    const next = clone(state);
    if (new Set(billIds).size !== billIds.length)
      throw new Error("Invoice merge contains duplicates");
    const bills = next.bills.filter((bill) => billIds.includes(bill.id));
    if (bills.length !== billIds.length || bills.length < 2) {
      throw new Error("Every invoice selected for merge must exist");
    }
    if (bills.some((bill) => bill.paymentStatus !== "UNPAID" || bill.status !== "OPEN")) {
      throw new Error("Only open unpaid invoices can be merged");
    }
    const tenantIds = new Set(bills.map((bill) => bill.tenantId ?? next.tenantId));
    const branchIds = new Set(bills.map((bill) => bill.branchId ?? bill.branch));
    if (tenantIds.size !== 1 || branchIds.size !== 1) {
      throw new Error("Invoices from different tenants or branches cannot be merged");
    }
    const allLines = bills.flatMap((bill) => bill.lines);
    const total = totals(allLines);
    const firstBill = bills[0]!;
    const customerIds = [...new Set(bills.map((bill) => bill.customerId).filter(Boolean))];
    const customerCodes = [...new Set(bills.map((bill) => bill.customerCode).filter(Boolean))];
    const scope = resolveScope(
      firstBill.branchId ?? firstBill.branch,
      firstBill.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
    );
    const merged: BillingRecord = {
      id: id("BILL", next, "bills"),
      ...scope,
      sourceBillIds: billIds,
      orderIds: bills.flatMap((bill) => bill.orderIds),
      customer: "Merged bill",
      ...(customerIds.length === 1 ? { customerId: customerIds[0] } : {}),
      ...(customerCodes.length === 1 ? { customerCode: customerCodes[0] } : {}),
      ...(firstBill.table ? { table: firstBill.table } : {}),
      status: "OPEN",
      paymentStatus: "UNPAID",
      issuedAt: now(),
      dueAt: addMinutes(now(), 120),
      lines: allLines,
      paid: 0,
      ...total,
    };
    bills.forEach((bill) => {
      bill.status = "MERGED";
    });
    next.bills.unshift(merged);
    audit(next, {
      actor: user,
      role: "Branch Manager",
      branch: merged.branch,
      module: "Invoices",
      action: "Merged open bills",
      record: merged.id,
      before: billIds.join(", "),
      after: `${merged.id} ${reason}`,
    });
    return next;
  },

  splitBill(
    state: TransactionState,
    billId: string,
    splits: { label: string; amount: number }[],
    user: string,
  ) {
    const next = clone(state);
    const bill = next.bills.find((item) => item.id === billId);
    if (!bill) throw new Error(`Invoice ${billId} was not found`);
    if (bill.paymentStatus !== "UNPAID" || bill.status !== "OPEN") {
      throw new Error("Only an open unpaid invoice can be split");
    }
    if (splits.length < 2 || splits.some((split) => !split.label.trim() || split.amount <= 0)) {
      throw new Error("A split requires at least two positive, labelled allocations");
    }
    const splitTotal = money(splits.reduce((sum, split) => sum + split.amount, 0));
    if (splitTotal !== bill.total)
      throw new Error("Split allocations must equal the invoice total");
    bill.status = "SPLIT";
    let allocatedSubtotal = 0;
    let allocatedTax = 0;
    splits.forEach((split, index) => {
      const last = index === splits.length - 1;
      const ratio = split.amount / bill.total;
      const subtotal = last
        ? money(bill.subtotal - allocatedSubtotal)
        : money(bill.subtotal * ratio);
      const tax = last ? money(bill.tax - allocatedTax) : money(bill.tax * ratio);
      allocatedSubtotal = money(allocatedSubtotal + subtotal);
      allocatedTax = money(allocatedTax + tax);
      next.bills.unshift({
        ...bill,
        id: id("BILL", next, "bills"),
        splitFromBillId: bill.id,
        splitMethod: "CUSTOM",
        customer: split.label,
        status: "OPEN",
        subtotal,
        tax,
        total: split.amount,
        paid: 0,
        paymentStatus: "UNPAID",
      });
    });
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: bill.branch,
      module: "Invoices",
      action: "Split bill",
      record: bill.id,
      before: `${bill.total}`,
      after: splits.map((split) => `${split.label}:${split.amount}`).join(", "),
    });
    return next;
  },

  cancelOrder(
    state: TransactionState,
    orderId: string,
    input: { user: string; reason: string; affectedItems: string[] },
  ) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) throw new Error(`Order ${orderId} was not found`);
    if (!input.reason.trim()) throw new Error("Order cancellation requires a reason");
    if (["PAID", "REFUNDED"].includes(order.status)) {
      throw new Error(`Order ${orderId} cannot be cancelled from ${order.status}; use refunds`);
    }
    if (order.status === "CANCELLED") {
      throw new Error(`Order ${orderId} is already cancelled`);
    }
    const before = order.status;
    const stamp = now();
    const kitchenStarted = ["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(
      order.status,
    );
    if (kitchenStarted) {
      const activeLines = order.lines.filter((line) => line.productionStatus !== "CANCELLED");
      activeLines.forEach((line) => {
        line.productionStatus = "CANCELLED";
      });
      if (activeLines.length) {
        next.productionAmendments.unshift({
          id: id("AMD", next, "productionAmendments"),
          tenantId: order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
          branchId:
            order.branchId ??
            configurationRepository.resolveBranch(
              order.tenantId ?? next.tenantId ?? LOCAL_PILOT_TENANT_ID,
              order.branch,
            ).id,
          branch: order.branch,
          orderId,
          type: "CANCEL_ITEM",
          lines: activeLines.map((line) => ({ ...line })),
          reason: input.reason,
          requestedBy: input.user,
          printStatus: "PENDING",
          createdAt: stamp,
        });
      }
    }
    order.status = "CANCELLED";
    order.cancellation = { ...input, timestamp: stamp };
    order.updatedAt = stamp;
    if (order.externalSource) {
      order.externalSource.providerStatus = "CANCELLED";
      order.externalSource.completedAt = stamp;
    }
    const receivable = next.marketplaceReceivables.find(
      (candidate) => candidate.orderId === orderId && candidate.status !== "CANCELLED",
    );
    if (receivable && receivable.settledAmount === 0) {
      receivable.status = "CANCELLED";
      receivable.outstandingAmount = 0;
      receivable.updatedAt = stamp;
      next.journalEntries.unshift(createMarketplaceReversalJournal(next, order, receivable));
      const bill = next.bills.find((candidate) => candidate.id === receivable.invoiceId);
      if (bill) bill.status = "VOID";
    } else if (receivable) {
      receivable.status = "DISPUTED";
      receivable.updatedAt = stamp;
    }
    audit(next, {
      actor: input.user,
      role: "Branch Manager",
      branch: order.branch,
      module: "Orders",
      action: "Cancelled order",
      record: order.id,
      before,
      after: input.reason,
    });
    return next;
  },

  requestRefund(state: TransactionState, input: Omit<RefundRecord, "id" | "status" | "createdAt">) {
    const next = clone(state);
    const refund: RefundRecord = {
      id: id("RF", next, "refunds"),
      status: "REQUESTED",
      createdAt: now(),
      ...input,
    };
    next.refunds.unshift(refund);
    audit(next, {
      actor: input.requestedBy,
      role: "Cashier",
      branch: input.branch,
      module: "Refunds",
      action: "Requested refund",
      record: refund.id,
      before: "No refund",
      after: input.reason,
    });
    return next;
  },

  approveRefund(state: TransactionState, refundId: string, approvedBy: string) {
    const next = clone(state);
    const refund = next.refunds.find((item) => item.id === refundId);
    if (!refund || refund.status !== "REQUESTED") return next;
    refund.status = "APPROVED";
    refund.approvedBy = approvedBy;
    audit(next, {
      actor: approvedBy,
      role: "Branch Manager",
      branch: refund.branch,
      module: "Refunds",
      action: "Approved refund",
      record: refund.id,
      before: "REQUESTED",
      after: "APPROVED",
    });
    return next;
  },

  importExternalTransaction(
    state: TransactionState,
    input: Omit<ExternalTransaction, "id" | "importedAt" | "reconciliationStatus">,
  ) {
    const next = clone(state);
    if (
      next.externalTransactions.some(
        (transaction) =>
          transaction.provider === input.provider && transaction.reference === input.reference,
      )
    ) {
      next.externalTransactions.unshift({
        ...input,
        id: id("EXT", next, "externalTransactions"),
        importedAt: now(),
        reconciliationStatus: "DUPLICATE",
      });
      return next;
    }
    const external: ExternalTransaction = {
      ...input,
      id: id("EXT", next, "externalTransactions"),
      importedAt: now(),
      reconciliationStatus: "UNMATCHED",
    };
    next.externalTransactions.unshift(external);
    return this.suggestReconciliation(next, external.id);
  },

  suggestReconciliation(state: TransactionState, externalTransactionId: string) {
    const next = clone(state);
    const external = next.externalTransactions.find(
      (transaction) => transaction.id === externalTransactionId,
    );
    if (!external) return next;
    const candidates = next.payments
      .map((payment) => {
        let confidence = 0;
        if (payment.reference === external.reference) confidence += 70;
        if (payment.amount === external.amount) confidence += 15;
        if (payment.branch === external.branch) confidence += 10;
        if (
          payment.provider.toLowerCase().includes(external.provider.toLowerCase()) ||
          external.provider.toLowerCase().includes(payment.provider.toLowerCase())
        )
          confidence += 5;
        return { payment, confidence };
      })
      .filter((candidate) => candidate.confidence >= 75)
      .sort((a, b) => b.confidence - a.confidence);
    const candidate = candidates[0];
    if (!candidate) return next;
    external.reconciliationStatus = candidate.confidence >= 95 ? "MATCHED" : "SUGGESTED";
    next.reconciliationMatches.unshift({
      id: id("REC", next, "reconciliationMatches"),
      externalTransactionId: external.id,
      internalTransactionId: candidate.payment.id,
      internalType: "Payment",
      matchType:
        candidate.payment.reference === external.reference
          ? "EXACT_REFERENCE"
          : "AMOUNT_TIME_BRANCH",
      amount: Math.min(candidate.payment.amount, external.amount),
      confidence: candidate.confidence,
      matchedBy: "System",
      matchedAt: now(),
      status: candidate.confidence >= 95 ? "APPROVED" : "SUGGESTED",
      notes: "Matched using reference, amount, branch and provider signals.",
    });
    if (candidate.confidence >= 95) {
      candidate.payment.reconciliationStatus = "RECONCILED";
      external.reconciliationStatus = "RECONCILED";
    }
    return next;
  },

  manuallyReconcile(
    state: TransactionState,
    externalTransactionId: string,
    paymentId: string,
    user: string,
    notes: string,
  ) {
    const next = clone(state);
    const external = next.externalTransactions.find(
      (transaction) => transaction.id === externalTransactionId,
    );
    const payment = next.payments.find((item) => item.id === paymentId);
    if (!external || !payment) return next;
    external.reconciliationStatus = "RECONCILED";
    payment.reconciliationStatus = "RECONCILED";
    next.reconciliationMatches.unshift({
      id: id("REC", next, "reconciliationMatches"),
      externalTransactionId,
      internalTransactionId: paymentId,
      internalType: "Payment",
      matchType: "MANUAL",
      amount: Math.min(payment.amount, external.amount),
      confidence: 100,
      matchedBy: user,
      matchedAt: now(),
      status: "APPROVED",
      notes,
    });
    audit(next, {
      actor: user,
      role: "Accountant",
      branch: payment.branch,
      module: "Reconciliation",
      action: "Manually reconciled payment",
      record: paymentId,
      before: externalTransactionId,
      after: notes,
    });
    return next;
  },

  closeCashDrawer(
    state: TransactionState,
    drawerId: string,
    physicalCount: number,
    supervisor: string,
  ) {
    const next = clone(state);
    const drawer = next.cashDrawers.find((item) => item.id === drawerId);
    if (!drawer) return next;
    drawer.physicalCount = physicalCount;
    drawer.variance = money(physicalCount - drawer.expectedDrawer);
    drawer.closedAt = now();
    drawer.supervisor = supervisor;
    drawer.status = drawer.variance === 0 ? "APPROVED" : "VARIANCE_REVIEW";
    audit(next, {
      actor: supervisor,
      role: "Branch Manager",
      branch: drawer.branch,
      module: "Reconciliation",
      action: "Closed cash drawer",
      record: drawer.id,
      before: `Expected ${drawer.expectedDrawer}`,
      after: `Counted ${physicalCount}, variance ${drawer.variance}`,
    });
    return next;
  },
};

function createReceipt(
  state: TransactionState,
  bill: BillingRecord,
  payments: PaymentRecord[],
): ReceiptRecord {
  const paidAmount = money(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const cashChange = payments.reduce((sum, payment) => sum + (payment.cash?.change ?? 0), 0);
  const scope = resolveScope(
    bill.branchId ?? bill.branch,
    bill.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID,
  );
  return {
    id: id("RC", state, "receipts"),
    ...scope,
    orderId: bill.orderIds[0]!,
    invoiceId: bill.id,
    cashier: payments[0]?.cashier ?? "System",
    customer: bill.customer,
    ...(bill.customerId ? { customerId: bill.customerId } : {}),
    ...(bill.customerCode ? { customerCode: bill.customerCode } : {}),
    issuedAt: now(),
    total: bill.total,
    paidAmount,
    change: cashChange,
    paymentBreakdown: payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
      ...(payment.tenderCurrency ? { tenderCurrency: payment.tenderCurrency } : {}),
      ...(payment.tenderAmount === undefined ? {} : { tenderAmount: payment.tenderAmount }),
      ...(payment.baseAmount === undefined ? {} : { baseAmount: payment.baseAmount }),
      ...(payment.fxRateReference ? { fxRateReference: payment.fxRateReference } : {}),
      ...(payment.fxRateNumerator === undefined
        ? {}
        : { fxRateNumerator: payment.fxRateNumerator }),
      ...(payment.fxRateDenominator === undefined
        ? {}
        : { fxRateDenominator: payment.fxRateDenominator }),
    })),
    reprints: [],
  };
}

function createPaymentJournal(
  state: TransactionState,
  bill: BillingRecord,
  payment: PaymentRecord,
): JournalEntry {
  const scope = resolveScope(
    bill.branchId ?? bill.branch,
    bill.tenantId ?? state.tenantId ?? LOCAL_PILOT_TENANT_ID,
  );
  const method = getConfigurationRepository()
    .listPaymentMethods(scope.tenantId, false)
    .find((item) => item.id === payment.method || item.code === payment.method);
  if (!method?.settlementAccountId || !method.receivableAccountId) {
    throw new PlatformConfigurationError(
      "Payment method requires configured settlement and receivable accounts",
    );
  }
  return {
    id: id("JE", state, "journalEntries"),
    ...scope,
    sourceType: "Payment",
    sourceId: payment.id,
    status: "POSTED",
    postedAt: now(),
    lines: [
      {
        account: method.settlementAccountId,
        debit: payment.amount,
        credit: 0,
        costCentre: bill.branch,
      },
      {
        account: method.receivableAccountId,
        debit: 0,
        credit: payment.amount,
        costCentre: bill.branch,
      },
    ],
  };
}

function createMarketplaceSaleJournal(
  state: TransactionState,
  order: TransactionOrder,
  receivable: MarketplaceReceivable,
): JournalEntry {
  return {
    id: id("JE", state, "journalEntries"),
    tenantId: receivable.tenantId,
    branchId: receivable.branchId,
    branch: receivable.branch,
    sourceType: "Marketplace Sale",
    sourceId: receivable.id,
    status: "POSTED",
    postedAt: now(),
    lines: [
      {
        account: receivable.receivableAccount,
        debit: order.total,
        credit: 0,
        costCentre: order.branch,
      },
      {
        account: "Restaurant Revenue",
        debit: 0,
        credit: order.subtotal,
        costCentre: order.branch,
      },
      ...(order.tax
        ? [
            {
              account: "Output VAT",
              debit: 0,
              credit: order.tax,
              costCentre: order.branch,
            },
          ]
        : []),
    ],
  };
}

function createMarketplaceAdjustmentJournal(
  state: TransactionState,
  order: TransactionOrder,
  receivable: MarketplaceReceivable,
  delta: { subtotal: number; tax: number; total: number },
): JournalEntry {
  const increase = delta.total >= 0;
  const absoluteSubtotal = Math.abs(delta.subtotal);
  const absoluteTax = Math.abs(delta.tax);
  const absoluteTotal = Math.abs(delta.total);
  return {
    id: id("JE", state, "journalEntries"),
    tenantId: receivable.tenantId,
    branchId: receivable.branchId,
    branch: receivable.branch,
    sourceType: "Marketplace Sale",
    sourceId: `${receivable.id}:adjustment:${order.updatedAt}`,
    status: "POSTED",
    postedAt: now(),
    lines: increase
      ? [
          {
            account: receivable.receivableAccount,
            debit: absoluteTotal,
            credit: 0,
            costCentre: order.branch,
          },
          {
            account: "Restaurant Revenue",
            debit: 0,
            credit: absoluteSubtotal,
            costCentre: order.branch,
          },
          ...(absoluteTax
            ? [
                {
                  account: "Output VAT",
                  debit: 0,
                  credit: absoluteTax,
                  costCentre: order.branch,
                },
              ]
            : []),
        ]
      : [
          {
            account: "Restaurant Revenue",
            debit: absoluteSubtotal,
            credit: 0,
            costCentre: order.branch,
          },
          ...(absoluteTax
            ? [
                {
                  account: "Output VAT",
                  debit: absoluteTax,
                  credit: 0,
                  costCentre: order.branch,
                },
              ]
            : []),
          {
            account: receivable.receivableAccount,
            debit: 0,
            credit: absoluteTotal,
            costCentre: order.branch,
          },
        ],
  };
}

function createMarketplaceReversalJournal(
  state: TransactionState,
  order: TransactionOrder,
  receivable: MarketplaceReceivable,
): JournalEntry {
  return {
    id: id("JE", state, "journalEntries"),
    tenantId: receivable.tenantId,
    branchId: receivable.branchId,
    branch: receivable.branch,
    sourceType: "Marketplace Reversal",
    sourceId: receivable.id,
    status: "POSTED",
    postedAt: now(),
    lines: [
      {
        account: "Restaurant Revenue",
        debit: order.subtotal,
        credit: 0,
        costCentre: order.branch,
      },
      ...(order.tax
        ? [
            {
              account: "Output VAT",
              debit: order.tax,
              credit: 0,
              costCentre: order.branch,
            },
          ]
        : []),
      {
        account: receivable.receivableAccount,
        debit: 0,
        credit: order.total,
        costCentre: order.branch,
      },
    ],
  };
}

export function transactionMetrics(state: TransactionState) {
  const sales = state.bills
    .filter((bill) => bill.status === "PAID" || bill.status === "PROVIDER_RECEIVABLE")
    .reduce((sum, bill) => sum + bill.total, 0);
  const outstanding = state.bills
    .filter(
      (bill) =>
        bill.paymentStatus !== "PAID" && bill.status !== "MERGED" && bill.status !== "SPLIT",
    )
    .reduce((sum, bill) => sum + bill.total - bill.paid, 0);
  const unreconciled = state.externalTransactions.filter(
    (transaction) =>
      !["RECONCILED", "IGNORED", "DUPLICATE"].includes(transaction.reconciliationStatus),
  ).length;
  const cashVariance = state.cashDrawers.reduce((sum, drawer) => sum + (drawer.variance ?? 0), 0);
  const marketplaceReceivable = state.marketplaceReceivables
    .filter((receivable) => !["SETTLED", "CANCELLED"].includes(receivable.status))
    .reduce((sum, receivable) => sum + receivable.outstandingAmount, 0);
  return { sales, outstanding, marketplaceReceivable, unreconciled, cashVariance };
}
