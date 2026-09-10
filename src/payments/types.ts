import type { MinorAmount } from "@/payments/money";

export type PaymentAccountType =
  | "CASH"
  | "BANK"
  | "MOBILE_MONEY"
  | "CARD_CLEARING"
  | "MARKETPLACE_RECEIVABLE"
  | "PAYMENT_GATEWAY_CLEARING"
  | "CUSTOMER_RECEIVABLE"
  | "VOUCHER_LIABILITY"
  | "LOYALTY_LIABILITY"
  | "REVENUE"
  | "EXPENSE"
  | "TAX_LIABILITY"
  | "OTHER";

export type PaymentAccount = {
  id: string;
  tenantId: string;
  branchId?: string;
  code: string;
  name: string;
  type: PaymentAccountType;
  currency: string;
  providerConnectionId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentIntentStatus =
  | "CREATED"
  | "PENDING"
  | "AWAITING_CUSTOMER"
  | "PROCESSING"
  | "AUTHORIZED"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "PARTIALLY_PAID"
  | "REFUND_PENDING"
  | "REFUNDED";

export type PaymentCurrencyEvidence = Readonly<{
  quoteId: string;
  invoiceId: string;
  baseCurrency: string;
  baseAmountMinor: MinorAmount;
  tenderCurrency: string;
  tenderAmountMinor: MinorAmount;
  cashTenderedMinor?: MinorAmount;
  changeGivenMinor?: MinorAmount;
  changeCurrency?: string;
  rateNumerator: number;
  rateDenominator: number;
  rateSourceId: string;
  rateTimestamp: string;
  convertedBaseAmountMinor: MinorAmount;
  roundingAdjustmentMinor: MinorAmount;
  refundRatePolicy: "ORIGINAL_RATE" | "CURRENT_RATE" | "MANAGER_REVIEW";
}>;

export type PaymentIntentRecord = {
  id: string;
  tenantId: string;
  branchId: string;
  orderId?: string;
  invoiceIds: string[];
  customerId?: string;
  paymentMethodId: string;
  providerConnectionId?: string;
  currency: string;
  amountRequestedMinor: MinorAmount;
  amountAuthorizedMinor: MinorAmount;
  amountCollectedMinor: MinorAmount;
  status: PaymentIntentStatus;
  expiresAt?: string;
  externalReference?: string;
  providerReference?: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type PaymentTransactionDirection = "COLLECTION" | "REFUND" | "REVERSAL" | "ADJUSTMENT";
export type PaymentTransactionStatus =
  | "PENDING"
  | "UNVERIFIED"
  | "VERIFYING"
  | "CONFIRMED"
  | "MANUALLY_CONFIRMED"
  | "NOT_FOUND"
  | "AMOUNT_MISMATCH"
  | "ALREADY_USED"
  | "FAILED"
  | "REVERSED";

export type PaymentTransaction = Readonly<{
  id: string;
  tenantId: string;
  branchId: string;
  intentId?: string;
  paymentMethodId: string;
  providerConnectionId?: string;
  direction: PaymentTransactionDirection;
  amountMinor: MinorAmount;
  unallocatedAmountMinor: MinorAmount;
  currency: string;
  status: PaymentTransactionStatus;
  providerTransactionId?: string;
  customerReference?: string;
  merchantReference: string;
  receiptNumber?: string;
  originalTransactionId?: string;
  occurredAt: string;
  confirmedAt?: string;
  createdAt: string;
  createdBy: string;
  deviceId?: string;
  currencyEvidence?: PaymentCurrencyEvidence;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type PaymentAllocation = Readonly<{
  id: string;
  tenantId: string;
  branchId: string;
  paymentTransactionId: string;
  invoiceId: string;
  amountMinor: MinorAmount;
  currency: string;
  createdAt: string;
  createdBy: string;
}>;

export type PaymentCollection = Readonly<{
  id: string;
  tenantId: string;
  branchId: string;
  paymentTransactionId: string;
  accountId: string;
  amountMinor: MinorAmount;
  currency: string;
  collectionState: "IN_HAND" | "IN_CLEARING" | "RECEIVABLE" | "IN_BANK" | "REVERSED";
  collectedAt: string;
  settledAt?: string;
  createdAt: string;
}>;

export type CashDrawerSession = {
  id: string;
  tenantId: string;
  branchId: string;
  deviceId?: string;
  employeeId: string;
  baseCurrency: string;
  openedAt: string;
  openingFloatMinor: MinorAmount;
  closedAt?: string;
  expectedCashMinor: MinorAmount;
  countedCashMinor?: MinorAmount;
  varianceMinor?: MinorAmount;
  status: "OPEN" | "CLOSED" | "REVIEW_REQUIRED" | "APPROVED";
  closedBy?: string;
  approvedBy?: string;
  approvalReason?: string;
  currencyBalances: Record<
    string,
    {
      openingFloatMinor: MinorAmount;
      expectedCashMinor: MinorAmount;
      countedCashMinor?: MinorAmount;
      varianceMinor?: MinorAmount;
    }
  >;
  createdAt: string;
  updatedAt: string;
};

export type CashMovementType =
  | "OPENING_FLOAT"
  | "SALE"
  | "REFUND"
  | "PAID_IN"
  | "PAID_OUT"
  | "CASH_DROP"
  | "PETTY_CASH"
  | "CORRECTION"
  | "CLOSING";

export type CashMovement = Readonly<{
  id: string;
  tenantId: string;
  branchId: string;
  drawerSessionId: string;
  paymentTransactionId?: string;
  type: CashMovementType;
  amountMinor: MinorAmount;
  currency: string;
  reason: string;
  actor: string;
  approvedBy?: string;
  timestamp: string;
}>;

export type BankTransaction = Readonly<{
  id: string;
  tenantId: string;
  branchId?: string;
  accountId: string;
  providerConnectionId?: string;
  externalTransactionId: string;
  date: string;
  valueDate?: string;
  amountMinor: MinorAmount;
  currency: string;
  description: string;
  payerOrPayee?: string;
  reference?: string;
  balanceMinor?: MinorAmount;
  rawReference?: string;
  status: "IMPORTED" | "MATCHED" | "PARTIAL" | "UNMATCHED" | "DUPLICATE" | "IGNORED";
  importedAt: string;
  sourceAdapter: string;
}>;

export type SettlementLineType =
  | "GROSS_SALE"
  | "COMMISSION"
  | "SERVICE_FEE"
  | "DELIVERY_ADJUSTMENT"
  | "PROMOTION"
  | "REFUND"
  | "TAX_ADJUSTMENT"
  | "OTHER_ADJUSTMENT";

export type SettlementLine = Readonly<{
  id: string;
  tenantId: string;
  settlementBatchId: string;
  type: SettlementLineType;
  externalOrderId?: string;
  orderId?: string;
  marketplaceReceivableId?: string;
  paymentTransactionId?: string;
  amountMinor: MinorAmount;
  taxAmountMinor: MinorAmount;
  currency: string;
  reference: string;
  description: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type SettlementBatch = {
  id: string;
  tenantId: string;
  connectionId: string;
  branchId?: string;
  externalSettlementId: string;
  periodStart: string;
  periodEnd: string;
  settledAt?: string;
  currency: string;
  grossSalesMinor: MinorAmount;
  commissionsMinor: MinorAmount;
  serviceFeesMinor: MinorAmount;
  deliveryAdjustmentsMinor: MinorAmount;
  promotionsMinor: MinorAmount;
  refundsMinor: MinorAmount;
  taxAdjustmentsMinor: MinorAmount;
  otherAdjustmentsMinor: MinorAmount;
  netExpectedMinor: MinorAmount;
  netSettledMinor: MinorAmount;
  bankTransactionId?: string;
  status: "IMPORTED" | "MATCHING" | "MATCHED" | "EXCEPTION" | "POSTED" | "REVERSED";
  importedBy: string;
  importedAt: string;
  postedBy?: string;
  postedAt?: string;
  reversalJournalId?: string;
  updatedAt: string;
};

export type SettlementExceptionReason =
  | "MISSING_ORDER"
  | "UNKNOWN_DEDUCTION"
  | "DUPLICATE_DEDUCTION"
  | "BANK_SHORTFALL"
  | "MISSING_SETTLEMENT"
  | "TIMING_DIFFERENCE"
  | "REFUND_MISMATCH"
  | "OTHER";

export type ReconciliationException = {
  id: string;
  tenantId: string;
  branchId?: string;
  sourceType: "PAYMENT" | "BANK" | "SETTLEMENT" | "CASH" | "REFUND";
  sourceId: string;
  reason: SettlementExceptionReason;
  amountMinor: MinorAmount;
  currency: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: "OPEN" | "INVESTIGATING" | "RESOLVED" | "IGNORED";
  detail: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
};

export type ReconciliationSession = {
  id: string;
  tenantId: string;
  branchId?: string;
  type: "PAYMENT" | "BANK" | "SETTLEMENT" | "CASH" | "EOD";
  businessDate: string;
  status: "OPEN" | "MATCHING" | "REVIEW_REQUIRED" | "COMPLETE" | "REVERSED";
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
};

export type PaymentMatch = Readonly<{
  id: string;
  tenantId: string;
  branchId?: string;
  reconciliationSessionId: string;
  leftType: "PAYMENT_TRANSACTION" | "SETTLEMENT" | "CASH_EXPECTED";
  leftId: string;
  rightType: "BANK_TRANSACTION" | "PROVIDER_TRANSACTION" | "CASH_COUNT";
  rightId: string;
  amountMinor: MinorAmount;
  currency: string;
  confidence: "EXACT" | "HIGH" | "POSSIBLE" | "UNMATCHED";
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "REVERSED";
  matchedBy: "SYSTEM" | "MANUAL";
  approvedBy?: string;
  reason: string;
  createdAt: string;
}>;

export type PaymentRefund = {
  id: string;
  tenantId: string;
  branchId: string;
  originalTransactionId: string;
  providerConnectionId?: string;
  amountMinor: MinorAmount;
  currency: string;
  reason: string;
  status: "REQUESTED" | "APPROVED" | "PROCESSING" | "CONFIRMED" | "FAILED" | "REJECTED";
  requestedBy: string;
  approvedBy?: string;
  providerReference?: string;
  refundTransactionId?: string;
  currencyEvidence?: PaymentCurrencyEvidence;
  createdAt: string;
  updatedAt: string;
};

export type PaymentDispute = {
  id: string;
  tenantId: string;
  branchId: string;
  transactionId: string;
  providerConnectionId?: string;
  amountMinor: MinorAmount;
  currency: string;
  reason: string;
  status: "OPEN" | "EVIDENCE_REQUIRED" | "UNDER_REVIEW" | "WON" | "LOST" | "CLOSED";
  openedAt: string;
  resolvedAt?: string;
};

export type JournalLine = Readonly<{
  accountId: string;
  debitMinor: MinorAmount;
  creditMinor: MinorAmount;
  currency: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type FinancialJournal = {
  id: string;
  tenantId: string;
  branchId?: string;
  sourceType:
    | "PAYMENT_COLLECTION"
    | "REFUND"
    | "REVERSAL"
    | "MARKETPLACE_SETTLEMENT"
    | "GIFT_CARD_ISSUE"
    | "GIFT_CARD_REDEMPTION"
    | "VOUCHER_REDEMPTION"
    | "LOYALTY_REDEMPTION"
    | "RESERVATION_DEPOSIT_APPLICATION"
    | "HOUSE_ACCOUNT"
    | "PAYMENT_RECONCILIATION"
    | "CASH_MOVEMENT";
  sourceId: string;
  businessDate: string;
  description: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  lines: readonly JournalLine[];
  postedBy?: string;
  postedAt?: string;
  reversalOfId?: string;
  createdAt: string;
};

export type DayClose = {
  id: string;
  tenantId: string;
  branchId: string;
  businessDate: string;
  status: "OPEN" | "REVIEW" | "CLOSED" | "REOPENED";
  unresolvedExceptionIds: string[];
  closedBy?: string;
  closedAt?: string;
  reopenedBy?: string;
  reason?: string;
  overrideReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredValueAccount = {
  id: string;
  tenantId: string;
  customerId?: string;
  type: "GIFT_CARD" | "VOUCHER" | "LOYALTY" | "HOUSE_ACCOUNT" | "CUSTOMER_CREDIT";
  code: string;
  currency: string;
  balanceMinor: MinorAmount;
  liabilityAccountId?: string;
  receivableAccountId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAccount = {
  id: string;
  tenantId: string;
  customerId: string;
  currency: string;
  creditLimitMinor?: MinorAmount;
  paymentTermsDays?: number;
  receivableAccountId: string;
  balanceMinor: MinorAmount;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAccountEntry = Readonly<{
  id: string;
  tenantId: string;
  branchId?: string;
  customerAccountId: string;
  type: "INVOICE" | "PAYMENT" | "CREDIT_NOTE" | "ADJUSTMENT";
  sourceId: string;
  amountMinor: MinorAmount;
  currency: string;
  occurredAt: string;
  actor: string;
}>;

export type PaymentAuditEvent = Readonly<{
  id: string;
  tenantId: string;
  branchId?: string;
  actor: string;
  deviceId?: string;
  action: string;
  recordType: string;
  recordId: string;
  detail: string;
  createdAt: string;
}>;

export type FraudFlag = {
  id: string;
  tenantId: string;
  branchId?: string;
  type:
    | "DUPLICATE_REFERENCE"
    | "MANUAL_DIGITAL_CONFIRMATION"
    | "REFUND_EXCEEDS_PAYMENT"
    | "CASH_CORRECTION"
    | "LARGE_VARIANCE"
    | "CANCELLED_INVOICE_PAYMENT"
    | "REALLOCATION"
    | "MANUAL_RECONCILIATION";
  sourceId: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: "OPEN" | "REVIEWED" | "RESOLVED";
  detail: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
};

export type PaymentOperationsState = {
  schemaVersion: 1;
  accounts: PaymentAccount[];
  intents: PaymentIntentRecord[];
  transactions: PaymentTransaction[];
  allocations: PaymentAllocation[];
  collections: PaymentCollection[];
  drawerSessions: CashDrawerSession[];
  cashMovements: CashMovement[];
  bankTransactions: BankTransaction[];
  settlementBatches: SettlementBatch[];
  settlementLines: SettlementLine[];
  reconciliationSessions: ReconciliationSession[];
  matches: PaymentMatch[];
  exceptions: ReconciliationException[];
  refunds: PaymentRefund[];
  disputes: PaymentDispute[];
  journals: FinancialJournal[];
  dayCloses: DayClose[];
  storedValueAccounts: StoredValueAccount[];
  customerAccounts: CustomerAccount[];
  customerAccountEntries: CustomerAccountEntry[];
  auditEvents: PaymentAuditEvent[];
  fraudFlags: FraudFlag[];
};
