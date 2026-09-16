import {
  TransactionEngine,
  normalizeTransactionState,
  type BillingRecord,
  type TransactionState,
} from "@/lib/transaction-engine";
import { createJournal, reverseJournal } from "@/payments/accounting-posting";
import {
  assertMinorAmount,
  assertSameCurrency,
  majorFromMinor,
  parseMajorAmount,
  sumMinor,
} from "@/payments/money";
import type {
  CashMovementType,
  PaymentAllocation,
  PaymentIntentRecord,
  PaymentCurrencyEvidence,
  PaymentOperationsState,
  PaymentTransaction,
  PaymentTransactionStatus,
} from "@/payments/types";
import {
  getConfigurationRepository,
  PlatformConfigurationError,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import type { PaymentMethodDefinition } from "@/platform/types";

type AllocationRequest = { invoiceId: string; amountMinor: number };

type CreateIntentInput = {
  tenantId: string;
  branchId: string;
  orderId?: string;
  invoiceIds: string[];
  customerId?: string;
  paymentMethodId: string;
  amountRequestedMinor: number;
  currency: string;
  createdBy: string;
  deviceId?: string;
  expiresAt?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

type ConfirmCollectionInput = {
  tenantId: string;
  branchId: string;
  intentId?: string;
  paymentMethodId: string;
  providerConnectionId?: string;
  providerTransactionId?: string;
  customerReference?: string;
  merchantReference: string;
  amountMinor: number;
  currency: string;
  allocations: AllocationRequest[];
  actor: string;
  deviceId?: string;
  occurredAt?: string;
  status?: Extract<PaymentTransactionStatus, "CONFIRMED" | "MANUALLY_CONFIRMED">;
  currencyEvidence?: PaymentCurrencyEvidence;
  metadata?: Record<string, unknown>;
};

export class PaymentOrchestrator {
  constructor(private readonly configuredRepository?: ConfigurationRepository) {}

  private get configuration() {
    return this.configuredRepository ?? getConfigurationRepository();
  }

  createIntent(state: TransactionState, input: CreateIntentInput) {
    assertMinorAmount(input.amountRequestedMinor);
    if (input.amountRequestedMinor <= 0) throw new Error("Payment amount must be positive");
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const existing = operations.intents.find(
      (intent) =>
        intent.tenantId === input.tenantId && intent.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { state: next, intent: existing, replayed: true };
    const method = this.method(input.tenantId, input.paymentMethodId);
    this.assertMethodBranch(method, input.branchId);
    const stamp = new Date().toISOString();
    const intent: PaymentIntentRecord = {
      id: nextId("PI4", operations.intents),
      tenantId: input.tenantId,
      branchId: input.branchId,
      ...(input.orderId ? { orderId: input.orderId } : {}),
      invoiceIds: [...input.invoiceIds],
      ...(input.customerId ? { customerId: input.customerId } : {}),
      paymentMethodId: method.id,
      ...(method.providerConnectionId ? { providerConnectionId: method.providerConnectionId } : {}),
      currency: input.currency.toUpperCase(),
      amountRequestedMinor: input.amountRequestedMinor,
      amountAuthorizedMinor: 0,
      amountCollectedMinor: 0,
      status: method.category === "CASH" ? "CREATED" : "PENDING",
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      createdAt: stamp,
      updatedAt: stamp,
      metadata: { ...input.metadata, ...(input.deviceId ? { deviceId: input.deviceId } : {}) },
    };
    operations.intents.unshift(intent);
    this.audit(
      operations,
      input.tenantId,
      input.branchId,
      input.createdBy,
      "INTENT_CREATED",
      "PaymentIntent",
      intent.id,
      `${intent.currency} ${intent.amountRequestedMinor}`,
      input.deviceId,
    );
    return { state: next, intent, replayed: false };
  }

  markIntentInitiated(
    state: TransactionState,
    input: {
      tenantId: string;
      intentId: string;
      providerReference: string;
      externalReference?: string;
      status?: "AWAITING_CUSTOMER" | "PROCESSING";
      actor: string;
    },
  ) {
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const intent = operations.intents.find(
      (candidate) => candidate.id === input.intentId && candidate.tenantId === input.tenantId,
    );
    if (!intent) throw new Error("Payment intent not found");
    if (["CONFIRMED", "FAILED", "CANCELLED", "EXPIRED"].includes(intent.status)) return next;
    intent.providerReference = input.providerReference;
    if (input.externalReference) intent.externalReference = input.externalReference;
    intent.status = input.status ?? "PROCESSING";
    intent.updatedAt = new Date().toISOString();
    this.audit(
      operations,
      input.tenantId,
      intent.branchId,
      input.actor,
      "PROVIDER_REQUEST_INITIATED",
      "PaymentIntent",
      intent.id,
      input.providerReference,
    );
    return next;
  }

  failIntent(
    state: TransactionState,
    input: { tenantId: string; intentId: string; actor: string; reason: string },
  ) {
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const intent = operations.intents.find(
      (candidate) => candidate.id === input.intentId && candidate.tenantId === input.tenantId,
    );
    if (!intent || intent.status === "CONFIRMED") return next;
    intent.status = "FAILED";
    intent.updatedAt = new Date().toISOString();
    this.audit(
      operations,
      input.tenantId,
      intent.branchId,
      input.actor,
      "PAYMENT_FAILED",
      "PaymentIntent",
      intent.id,
      input.reason,
    );
    return next;
  }

  confirmProviderCollection(state: TransactionState, input: ConfirmCollectionInput) {
    return this.recordConfirmedCollection(state, { ...input, status: "CONFIRMED" });
  }

  recordCash(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      drawerSessionId: string;
      paymentMethodId: string;
      invoiceId: string;
      amountMinor: number;
      cashTenderedMinor: number;
      currency: string;
      actor: string;
      deviceId?: string;
      currencyEvidence?: PaymentCurrencyEvidence;
    },
  ) {
    const tenderDueMinor = input.currencyEvidence?.tenderAmountMinor ?? input.amountMinor;
    assertMinorAmount(input.cashTenderedMinor, "cash tendered");
    if (input.cashTenderedMinor < tenderDueMinor) throw new Error("Cash tendered is insufficient");
    const changeGivenMinor = input.cashTenderedMinor - tenderDueMinor;
    const currencyEvidence = input.currencyEvidence
      ? Object.freeze({
          ...input.currencyEvidence,
          cashTenderedMinor: input.cashTenderedMinor,
          changeGivenMinor: input.currencyEvidence.changeGivenMinor ?? changeGivenMinor,
          changeCurrency:
            input.currencyEvidence.changeCurrency ?? input.currencyEvidence.tenderCurrency,
        })
      : undefined;
    const result = this.recordConfirmedCollection(state, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      paymentMethodId: input.paymentMethodId,
      merchantReference: input.invoiceId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      allocations: [{ invoiceId: input.invoiceId, amountMinor: input.amountMinor }],
      actor: input.actor,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      status: "CONFIRMED",
      ...(currencyEvidence ? { currencyEvidence } : {}),
      metadata: {
        cashTenderedMinor: input.currencyEvidence ? input.amountMinor : input.cashTenderedMinor,
        changeGivenMinor: input.currencyEvidence ? 0 : changeGivenMinor,
        drawerSessionId: input.drawerSessionId,
      },
    });
    const foreignChangeInBase = currencyEvidence
      ? currencyEvidence.changeCurrency === currencyEvidence.baseCurrency &&
        (currencyEvidence.changeGivenMinor ?? 0) > 0
      : false;
    const withTender = this.addCashMovement(result, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      drawerSessionId: input.drawerSessionId,
      paymentTransactionId: latestTransaction(result).id,
      type: "SALE",
      amountMinor: foreignChangeInBase ? input.cashTenderedMinor : tenderDueMinor,
      currency: input.currencyEvidence?.tenderCurrency ?? input.currency,
      reason: `Cash sale ${input.invoiceId}`,
      actor: input.actor,
    });
    if (!foreignChangeInBase || !currencyEvidence) return withTender;
    return this.addCashMovement(withTender, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      drawerSessionId: input.drawerSessionId,
      paymentTransactionId: latestTransaction(withTender).id,
      type: "PAID_OUT",
      amountMinor: currencyEvidence.changeGivenMinor ?? 0,
      currency: currencyEvidence.baseCurrency,
      reason: `Base-currency change for ${input.invoiceId}`,
      actor: input.actor,
    });
  }

  recordManualTerminalPayment(
    state: TransactionState,
    input: Omit<ConfirmCollectionInput, "status" | "providerTransactionId"> & {
      terminalReference: string;
      authorizationCode?: string;
      cardScheme?: string;
      maskedPan?: string;
    },
  ) {
    assertSafeCardMetadata(input);
    return this.recordConfirmedCollection(state, {
      ...input,
      customerReference: input.terminalReference,
      status: "MANUALLY_CONFIRMED",
      metadata: {
        ...input.metadata,
        terminalReference: input.terminalReference,
        ...(input.authorizationCode ? { authorizationCode: input.authorizationCode } : {}),
        ...(input.cardScheme ? { cardScheme: input.cardScheme } : {}),
        ...(input.maskedPan ? { maskedPan: input.maskedPan } : {}),
      },
    });
  }

  submitManualReference(
    state: TransactionState,
    input: Omit<ConfirmCollectionInput, "status" | "providerTransactionId">,
  ) {
    return this.recordUnverifiedCollection(state, input);
  }

  recordBankTransferPending(
    state: TransactionState,
    input: Omit<ConfirmCollectionInput, "status" | "providerTransactionId">,
  ) {
    return this.recordUnverifiedCollection(state, input);
  }

  verifyPendingCollection(
    state: TransactionState,
    input: {
      tenantId: string;
      transactionId: string;
      providerTransactionId: string;
      amountMinor: number;
      currency: string;
      actor: string;
      verified: boolean;
    },
  ) {
    const base = normalizeTransactionState(state);
    this.assertTenant(base, input.tenantId);
    const operations = requiredOperations(base);
    const pending = operations.transactions.find(
      (item) => item.id === input.transactionId && item.tenantId === input.tenantId,
    );
    if (!pending) throw new Error("Pending payment transaction not found");
    if (!input.verified) {
      replaceTransaction(operations, pending.id, { ...pending, status: "NOT_FOUND" });
      return base;
    }
    assertSameCurrency(pending.currency, input.currency);
    if (pending.amountMinor !== input.amountMinor) {
      replaceTransaction(operations, pending.id, { ...pending, status: "AMOUNT_MISMATCH" });
      this.flag(
        operations,
        pending,
        "DUPLICATE_REFERENCE",
        "CRITICAL",
        "Provider amount did not match submitted payment",
      );
      return base;
    }
    const allocations = operations.allocations
      .filter((item) => item.paymentTransactionId === pending.id)
      .map(({ invoiceId, amountMinor }) => ({ invoiceId, amountMinor }));
    operations.transactions = operations.transactions.filter((item) => item.id !== pending.id);
    operations.allocations = operations.allocations.filter(
      (item) => item.paymentTransactionId !== pending.id,
    );
    return this.recordConfirmedCollection(base, {
      tenantId: pending.tenantId,
      branchId: pending.branchId,
      paymentMethodId: pending.paymentMethodId,
      ...(pending.providerConnectionId
        ? { providerConnectionId: pending.providerConnectionId }
        : {}),
      providerTransactionId: input.providerTransactionId,
      ...(pending.customerReference ? { customerReference: pending.customerReference } : {}),
      merchantReference: pending.merchantReference,
      amountMinor: pending.amountMinor,
      currency: pending.currency,
      allocations,
      actor: input.actor,
      ...(pending.deviceId ? { deviceId: pending.deviceId } : {}),
      occurredAt: pending.occurredAt,
      status: "CONFIRMED",
      metadata: { ...pending.metadata, verifiedPendingTransactionId: pending.id },
    });
  }

  openDrawer(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      employeeId: string;
      openingFloatMinor: number;
      currency: string;
      deviceId?: string;
      actor: string;
    },
  ) {
    assertMinorAmount(input.openingFloatMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    if (
      operations.drawerSessions.some(
        (drawer) =>
          drawer.tenantId === input.tenantId &&
          drawer.branchId === input.branchId &&
          drawer.employeeId === input.employeeId &&
          drawer.status === "OPEN",
      )
    )
      throw new Error("Employee already has an open drawer session in this branch");
    const stamp = new Date().toISOString();
    const session = {
      id: nextId("DRAWER", operations.drawerSessions),
      tenantId: input.tenantId,
      branchId: input.branchId,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      employeeId: input.employeeId,
      baseCurrency: input.currency.toUpperCase(),
      openedAt: stamp,
      openingFloatMinor: input.openingFloatMinor,
      expectedCashMinor: 0,
      status: "OPEN" as const,
      currencyBalances: {
        [input.currency.toUpperCase()]: {
          openingFloatMinor: input.openingFloatMinor,
          expectedCashMinor: 0,
        },
      },
      createdAt: stamp,
      updatedAt: stamp,
    };
    operations.drawerSessions.unshift(session);
    return this.addCashMovement(next, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      drawerSessionId: session.id,
      type: "OPENING_FLOAT",
      amountMinor: input.openingFloatMinor,
      currency: input.currency,
      reason: "Opening float",
      actor: input.actor,
    });
  }

  addCashMovement(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      drawerSessionId: string;
      paymentTransactionId?: string;
      type: CashMovementType;
      amountMinor: number;
      currency: string;
      reason: string;
      actor: string;
      approvedBy?: string;
    },
  ) {
    assertMinorAmount(input.amountMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const drawer = operations.drawerSessions.find(
      (candidate) =>
        candidate.id === input.drawerSessionId && candidate.tenantId === input.tenantId,
    );
    if (!drawer || drawer.status !== "OPEN") throw new Error("Open cash drawer session not found");
    if (drawer.branchId !== input.branchId) throw new Error("Cash drawer branch mismatch");
    const signedAmount = cashMovementEffect(input.type, input.amountMinor);
    const movementCurrency = input.currency.toUpperCase();
    operations.cashMovements.unshift(
      Object.freeze({
        id: nextId("CASHMOV", operations.cashMovements),
        tenantId: input.tenantId,
        branchId: input.branchId,
        drawerSessionId: input.drawerSessionId,
        ...(input.paymentTransactionId ? { paymentTransactionId: input.paymentTransactionId } : {}),
        type: input.type,
        amountMinor: input.amountMinor,
        currency: movementCurrency,
        reason: input.reason,
        actor: input.actor,
        ...(input.approvedBy ? { approvedBy: input.approvedBy } : {}),
        timestamp: new Date().toISOString(),
      }),
    );
    const currencyBalance = drawer.currencyBalances[movementCurrency] ?? {
      openingFloatMinor: 0,
      expectedCashMinor: 0,
    };
    currencyBalance.expectedCashMinor += signedAmount;
    assertMinorAmount(currencyBalance.expectedCashMinor, "expected cash");
    drawer.currencyBalances[movementCurrency] = currencyBalance;
    if (movementCurrency === drawer.baseCurrency) {
      drawer.expectedCashMinor = currencyBalance.expectedCashMinor;
      assertMinorAmount(drawer.expectedCashMinor, "expected cash");
    }
    drawer.updatedAt = new Date().toISOString();
    if (input.type === "CORRECTION") {
      this.flag(
        operations,
        { id: input.drawerSessionId, tenantId: input.tenantId, branchId: input.branchId },
        "CASH_CORRECTION",
        "WARNING",
        input.reason,
      );
    }
    return next;
  }

  closeDrawer(
    state: TransactionState,
    input: {
      tenantId: string;
      drawerSessionId: string;
      countedCashMinor: number;
      countedByCurrency?: Record<string, number>;
      actor: string;
      largeVarianceThresholdMinor?: number;
    },
  ) {
    assertMinorAmount(input.countedCashMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const drawer = operations.drawerSessions.find(
      (candidate) =>
        candidate.id === input.drawerSessionId && candidate.tenantId === input.tenantId,
    );
    if (!drawer || drawer.status !== "OPEN") throw new Error("Open cash drawer session not found");
    drawer.countedCashMinor = input.countedCashMinor;
    drawer.varianceMinor = input.countedCashMinor - drawer.expectedCashMinor;
    drawer.status = drawer.varianceMinor === 0 ? "CLOSED" : "REVIEW_REQUIRED";
    drawer.closedBy = input.actor;
    drawer.closedAt = new Date().toISOString();
    drawer.updatedAt = drawer.closedAt;
    const counts = {
      ...input.countedByCurrency,
      [drawer.baseCurrency]: input.countedCashMinor,
    };
    for (const [currency, countedMinor] of Object.entries(counts)) {
      assertMinorAmount(countedMinor, `${currency} counted cash`);
      const balance = drawer.currencyBalances[currency] ?? {
        openingFloatMinor: 0,
        expectedCashMinor: 0,
      };
      balance.countedCashMinor = countedMinor;
      balance.varianceMinor = countedMinor - balance.expectedCashMinor;
      drawer.currencyBalances[currency] = balance;
    }
    if (Object.values(drawer.currencyBalances).some((value) => value.varianceMinor !== 0)) {
      drawer.status = "REVIEW_REQUIRED";
    }
    if (Math.abs(drawer.varianceMinor) >= (input.largeVarianceThresholdMinor ?? 50000)) {
      this.flag(
        operations,
        drawer,
        "LARGE_VARIANCE",
        "CRITICAL",
        `Cash variance ${drawer.varianceMinor}`,
      );
    }
    return next;
  }

  approveDrawerVariance(
    state: TransactionState,
    input: { tenantId: string; drawerSessionId: string; approvedBy: string; reason: string },
  ) {
    if (!input.reason.trim()) throw new Error("Variance approval reason is required");
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const drawer = requiredOperations(next).drawerSessions.find(
      (candidate) =>
        candidate.id === input.drawerSessionId && candidate.tenantId === input.tenantId,
    );
    if (!drawer || drawer.status !== "REVIEW_REQUIRED")
      throw new Error("Drawer variance is not awaiting review");
    drawer.status = "APPROVED";
    drawer.approvedBy = input.approvedBy;
    drawer.approvalReason = input.reason;
    drawer.updatedAt = new Date().toISOString();
    return next;
  }

  requestRefund(
    state: TransactionState,
    input: {
      tenantId: string;
      transactionId: string;
      amountMinor: number;
      currency: string;
      reason: string;
      requestedBy: string;
    },
  ) {
    assertMinorAmount(input.amountMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const original = operations.transactions.find(
      (item) => item.id === input.transactionId && item.tenantId === input.tenantId,
    );
    if (!original || !["CONFIRMED", "MANUALLY_CONFIRMED"].includes(original.status)) {
      throw new Error("Confirmed original payment was not found");
    }
    assertSameCurrency(original.currency, input.currency);
    const priorRefunds = operations.refunds
      .filter(
        (refund) =>
          refund.originalTransactionId === original.id &&
          !["FAILED", "REJECTED"].includes(refund.status),
      )
      .reduce((total, refund) => total + refund.amountMinor, 0);
    if (input.amountMinor <= 0 || priorRefunds + input.amountMinor > original.amountMinor) {
      this.flag(
        operations,
        original,
        "REFUND_EXCEEDS_PAYMENT",
        "CRITICAL",
        "Refund exceeds remaining confirmed collection",
      );
      throw new Error("Refund exceeds the refundable payment balance");
    }
    const stamp = new Date().toISOString();
    operations.refunds.unshift({
      id: nextId("REF4", operations.refunds),
      tenantId: input.tenantId,
      branchId: original.branchId,
      originalTransactionId: original.id,
      ...(original.providerConnectionId
        ? { providerConnectionId: original.providerConnectionId }
        : {}),
      amountMinor: input.amountMinor,
      currency: input.currency,
      reason: input.reason,
      status: "REQUESTED",
      requestedBy: input.requestedBy,
      ...(original.currencyEvidence
        ? {
            currencyEvidence: prorateCurrencyEvidence(
              original.currencyEvidence,
              input.amountMinor,
              original.amountMinor,
            ),
          }
        : {}),
      createdAt: stamp,
      updatedAt: stamp,
    });
    return next;
  }

  approveRefund(
    state: TransactionState,
    input: { tenantId: string; refundId: string; approvedBy: string },
  ) {
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const refund = requiredOperations(next).refunds.find(
      (candidate) => candidate.id === input.refundId && candidate.tenantId === input.tenantId,
    );
    if (!refund || refund.status !== "REQUESTED")
      throw new Error("Refund is not awaiting approval");
    refund.status = "APPROVED";
    refund.approvedBy = input.approvedBy;
    refund.updatedAt = new Date().toISOString();
    return next;
  }

  markRefundProcessing(
    state: TransactionState,
    input: { tenantId: string; refundId: string; providerReference?: string },
  ) {
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const refund = requiredOperations(next).refunds.find(
      (candidate) => candidate.id === input.refundId && candidate.tenantId === input.tenantId,
    );
    if (!refund || refund.status !== "APPROVED") throw new Error("Refund is not approved");
    refund.status = "PROCESSING";
    if (input.providerReference) refund.providerReference = input.providerReference;
    refund.updatedAt = new Date().toISOString();
    return next;
  }

  confirmRefund(
    state: TransactionState,
    input: {
      tenantId: string;
      refundId: string;
      providerReference: string;
      actor: string;
      drawerSessionId?: string;
    },
  ) {
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const refund = operations.refunds.find(
      (candidate) => candidate.id === input.refundId && candidate.tenantId === input.tenantId,
    );
    if (!refund || refund.status === "CONFIRMED") return next;
    if (refund.status !== "PROCESSING" && refund.status !== "APPROVED") {
      throw new Error("Refund cannot be confirmed from its current state");
    }
    const original = operations.transactions.find(
      (candidate) => candidate.id === refund.originalTransactionId,
    );
    if (!original) throw new Error("Original payment was not found");
    this.assertUniqueReference(operations, original.providerConnectionId, input.providerReference);
    const stamp = new Date().toISOString();
    const transaction: PaymentTransaction = Object.freeze({
      id: nextId("PTX", operations.transactions),
      tenantId: refund.tenantId,
      branchId: refund.branchId,
      paymentMethodId: original.paymentMethodId,
      ...(original.providerConnectionId
        ? { providerConnectionId: original.providerConnectionId }
        : {}),
      direction: "REFUND",
      amountMinor: refund.amountMinor,
      unallocatedAmountMinor: 0,
      currency: refund.currency,
      status: "CONFIRMED",
      providerTransactionId: input.providerReference,
      merchantReference: original.merchantReference,
      originalTransactionId: original.id,
      occurredAt: stamp,
      confirmedAt: stamp,
      createdAt: stamp,
      createdBy: input.actor,
      ...(refund.currencyEvidence ? { currencyEvidence: refund.currencyEvidence } : {}),
      metadata: Object.freeze({ refundId: refund.id }),
    });
    operations.transactions.unshift(transaction);
    refund.status = "CONFIRMED";
    refund.providerReference = input.providerReference;
    refund.refundTransactionId = transaction.id;
    refund.updatedAt = stamp;
    const method = this.method(refund.tenantId, original.paymentMethodId);
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: refund.tenantId,
        branchId: refund.branchId,
        sourceType: "REFUND",
        sourceId: transaction.id,
        businessDate: stamp.slice(0, 10),
        description: `Refund ${input.providerReference}`,
        postedBy: input.actor,
        lines: [
          journalLine(receivableAccount(method), refund.amountMinor, 0, refund.currency, {
            role: "refunds",
          }),
          journalLine(collectionAccount(method), 0, refund.amountMinor, refund.currency, {
            role: "payment-account",
          }),
        ],
      }),
    );
    if (method.category === "CASH") {
      if (!input.drawerSessionId) {
        throw new Error("Cash refund requires an open drawer session");
      }
      return this.addCashMovement(next, {
        tenantId: refund.tenantId,
        branchId: refund.branchId,
        drawerSessionId: input.drawerSessionId,
        paymentTransactionId: transaction.id,
        type: "REFUND",
        amountMinor: refund.currencyEvidence?.tenderAmountMinor ?? refund.amountMinor,
        currency: refund.currencyEvidence?.tenderCurrency ?? refund.currency,
        reason: `Confirmed refund ${input.providerReference}`,
        actor: input.actor,
      });
    }
    return next;
  }

  reverseTransaction(
    state: TransactionState,
    input: { tenantId: string; transactionId: string; actor: string; reason: string },
  ) {
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const original = operations.transactions.find(
      (candidate) => candidate.id === input.transactionId && candidate.tenantId === input.tenantId,
    );
    if (!original || !["CONFIRMED", "MANUALLY_CONFIRMED"].includes(original.status)) {
      throw new Error("Confirmed transaction was not found");
    }
    const existing = operations.transactions.find(
      (candidate) =>
        candidate.originalTransactionId === original.id && candidate.direction === "REVERSAL",
    );
    if (existing) return next;
    const stamp = new Date().toISOString();
    const {
      providerTransactionId: _providerTransactionId,
      customerReference: _customerReference,
      ...originalWithoutProviderReferences
    } = original;
    operations.transactions.unshift(
      Object.freeze({
        ...originalWithoutProviderReferences,
        id: nextId("PTX", operations.transactions),
        direction: "REVERSAL",
        status: "CONFIRMED",
        originalTransactionId: original.id,
        occurredAt: stamp,
        confirmedAt: stamp,
        createdAt: stamp,
        createdBy: input.actor,
        metadata: Object.freeze({ reason: input.reason }),
      }),
    );
    const journal = operations.journals.find(
      (candidate) => candidate.sourceId === original.id && candidate.status === "POSTED",
    );
    if (journal) {
      operations.journals.unshift(
        reverseJournal(journal, {
          id: nextId("JRN4", operations.journals),
          actor: input.actor,
          businessDate: stamp.slice(0, 10),
        }),
      );
      journal.status = "REVERSED";
    }
    return next;
  }

  issueStoredValue(
    state: TransactionState,
    input: {
      tenantId: string;
      type: "GIFT_CARD" | "VOUCHER" | "LOYALTY";
      code: string;
      amountMinor: number;
      currency: string;
      liabilityAccountId: string;
      collectionAccountId: string;
      actor: string;
      customerId?: string;
    },
  ) {
    assertMinorAmount(input.amountMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    if (operations.storedValueAccounts.some((account) => account.code === input.code)) {
      throw new Error("Stored-value account code already exists");
    }
    const stamp = new Date().toISOString();
    const account = {
      id: nextId("SVA", operations.storedValueAccounts),
      tenantId: input.tenantId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      type: input.type,
      code: input.code,
      currency: input.currency,
      balanceMinor: input.amountMinor,
      liabilityAccountId: input.liabilityAccountId,
      active: true,
      createdAt: stamp,
      updatedAt: stamp,
    };
    operations.storedValueAccounts.unshift(account);
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        sourceType: "GIFT_CARD_ISSUE",
        sourceId: account.id,
        businessDate: stamp.slice(0, 10),
        description: `${input.type} issue`,
        postedBy: input.actor,
        lines: [
          journalLine(input.collectionAccountId, input.amountMinor, 0, input.currency, {
            role: "collection",
          }),
          journalLine(input.liabilityAccountId, 0, input.amountMinor, input.currency, {
            role: "stored-value-liability",
          }),
        ],
      }),
    );
    return next;
  }

  redeemStoredValue(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      storedValueCode: string;
      paymentMethodId: string;
      invoiceId: string;
      amountMinor: number;
      currency: string;
      actor: string;
    },
  ) {
    assertMinorAmount(input.amountMinor);
    if (input.amountMinor <= 0) throw new Error("Redemption amount must be positive");
    let next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    let operations = requiredOperations(next);
    const account = operations.storedValueAccounts.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.code === input.storedValueCode &&
        candidate.active,
    );
    if (!account || !account.liabilityAccountId) {
      throw new Error("Active stored-value liability account was not found");
    }
    assertSameCurrency(account.currency, input.currency);
    if (account.balanceMinor < input.amountMinor)
      throw new Error("Stored-value balance is insufficient");
    const method = this.method(input.tenantId, input.paymentMethodId);
    if (!["VOUCHER", "LOYALTY"].includes(method.category)) {
      throw new Error("Payment method is not configured for stored-value redemption");
    }
    if (!method.receivableAccountId) {
      throw new PlatformConfigurationError(
        `${method.displayName} has no configured receivable account`,
      );
    }
    this.validateAllocations(
      next,
      input.tenantId,
      input.branchId,
      input.currency,
      input.amountMinor,
      [{ invoiceId: input.invoiceId, amountMinor: input.amountMinor }],
    );
    const stamp = new Date().toISOString();
    const transactionId = nextId("PTX", operations.transactions);
    const legacyPaymentIds = new Set(next.payments.map((payment) => payment.id));
    next = TransactionEngine.applyPayment(next, input.invoiceId, {
      amount: majorFromMinor(input.amountMinor, input.currency),
      method: method.code,
      provider: method.displayName,
      reference: input.storedValueCode,
      cashier: input.actor,
      terminal: "STORED_VALUE",
      reconciliationStatus: "RECONCILED",
      settlementStatus: "NOT_REQUIRED",
    });
    const legacyPayment = next.payments.find((payment) => !legacyPaymentIds.has(payment.id));
    if (legacyPayment) {
      next.journalEntries = next.journalEntries.filter(
        (journal) => journal.sourceId !== legacyPayment.id,
      );
    }
    operations = requiredOperations(next);
    const transaction: PaymentTransaction = Object.freeze({
      id: transactionId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      paymentMethodId: method.id,
      direction: "COLLECTION",
      amountMinor: input.amountMinor,
      unallocatedAmountMinor: 0,
      currency: input.currency,
      status: "CONFIRMED",
      customerReference: input.storedValueCode,
      merchantReference: input.invoiceId,
      occurredAt: stamp,
      confirmedAt: stamp,
      createdAt: stamp,
      createdBy: input.actor,
      metadata: Object.freeze({
        storedValueAccountId: account.id,
        ...(legacyPayment ? { legacyPaymentId: legacyPayment.id } : {}),
      }),
    });
    operations.transactions.unshift(transaction);
    operations.allocations.unshift(
      ...this.createAllocations(
        operations,
        transaction,
        [{ invoiceId: input.invoiceId, amountMinor: input.amountMinor }],
        input.actor,
      ),
    );
    const persistedAccount = operations.storedValueAccounts.find(
      (candidate) => candidate.id === account.id,
    );
    if (!persistedAccount) throw new Error("Stored-value account was lost during projection");
    persistedAccount.balanceMinor -= input.amountMinor;
    persistedAccount.updatedAt = stamp;
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        branchId: input.branchId,
        sourceType: "GIFT_CARD_REDEMPTION",
        sourceId: transaction.id,
        businessDate: stamp.slice(0, 10),
        description: `${account.type} redemption`,
        postedBy: input.actor,
        lines: [
          journalLine(account.liabilityAccountId, input.amountMinor, 0, input.currency, {
            storedValueAccountId: account.id,
          }),
          journalLine(method.receivableAccountId, 0, input.amountMinor, input.currency, {
            invoiceId: input.invoiceId,
          }),
        ],
      }),
    );
    this.audit(
      operations,
      input.tenantId,
      input.branchId,
      input.actor,
      "STORED_VALUE_REDEEMED",
      "PaymentTransaction",
      transaction.id,
      input.storedValueCode,
    );
    return next;
  }

  recordAuthoritativeCustomerValue(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      invoiceId: string;
      paymentMethodId: string;
      amountMinor: number;
      currency: string;
      valueType: "GIFT_CARD" | "VOUCHER" | "LOYALTY";
      valueId: string;
      publicReference: string;
      debitAccountId: string;
      businessDate: string;
      actor: string;
      authoritative: true;
      metadata?: Record<string, unknown>;
    },
  ) {
    if (input.authoritative !== true) {
      throw new Error("Customer-value redemption requires authoritative server validation");
    }
    assertMinorAmount(input.amountMinor);
    if (input.amountMinor <= 0) throw new Error("Redemption amount must be positive");
    let next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    let operations = requiredOperations(next);
    const method = this.method(input.tenantId, input.paymentMethodId);
    const expectedCategory = input.valueType === "LOYALTY" ? "LOYALTY" : "VOUCHER";
    if (method.category !== expectedCategory) {
      throw new Error("Payment method category does not match the customer-value instrument");
    }
    if (!method.receivableAccountId) {
      throw new PlatformConfigurationError(
        `${method.displayName} has no configured receivable account`,
      );
    }
    this.validateAllocations(
      next,
      input.tenantId,
      input.branchId,
      input.currency,
      input.amountMinor,
      [{ invoiceId: input.invoiceId, amountMinor: input.amountMinor }],
    );
    const stamp = new Date().toISOString();
    const transactionId = nextId("PTX", operations.transactions);
    const legacyPaymentIds = new Set(next.payments.map((payment) => payment.id));
    next = TransactionEngine.applyPayment(next, input.invoiceId, {
      amount: majorFromMinor(input.amountMinor, input.currency),
      method: method.code,
      provider: method.displayName,
      reference: input.publicReference,
      cashier: input.actor,
      terminal: "AUTHORITATIVE_VALUE",
      reconciliationStatus: "RECONCILED",
      settlementStatus: "NOT_REQUIRED",
    });
    const legacyPayment = next.payments.find((payment) => !legacyPaymentIds.has(payment.id));
    if (legacyPayment) {
      next.journalEntries = next.journalEntries.filter(
        (journal) => journal.sourceId !== legacyPayment.id,
      );
    }
    operations = requiredOperations(next);
    const transaction: PaymentTransaction = Object.freeze({
      id: transactionId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      paymentMethodId: method.id,
      direction: "COLLECTION",
      amountMinor: input.amountMinor,
      unallocatedAmountMinor: 0,
      currency: input.currency,
      status: "CONFIRMED",
      customerReference: input.publicReference,
      merchantReference: input.invoiceId,
      occurredAt: stamp,
      confirmedAt: stamp,
      createdAt: stamp,
      createdBy: input.actor,
      metadata: Object.freeze({
        ...input.metadata,
        customerValueType: input.valueType,
        customerValueId: input.valueId,
        debitAccountId: input.debitAccountId,
        receivableAccountId: method.receivableAccountId,
        businessDate: input.businessDate,
        ...(legacyPayment ? { legacyPaymentId: legacyPayment.id } : {}),
      }),
    });
    operations.transactions.unshift(transaction);
    operations.allocations.unshift(
      ...this.createAllocations(
        operations,
        transaction,
        [{ invoiceId: input.invoiceId, amountMinor: input.amountMinor }],
        input.actor,
      ),
    );
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        branchId: input.branchId,
        sourceType: `${input.valueType}_REDEMPTION`,
        sourceId: transaction.id,
        businessDate: input.businessDate,
        description: `${input.valueType.replace("_", " ")} redemption`,
        postedBy: input.actor,
        lines: [
          journalLine(input.debitAccountId, input.amountMinor, 0, input.currency, {
            customerValueId: input.valueId,
          }),
          journalLine(method.receivableAccountId, 0, input.amountMinor, input.currency, {
            invoiceId: input.invoiceId,
          }),
        ],
      }),
    );
    this.audit(
      operations,
      input.tenantId,
      input.branchId,
      input.actor,
      `${input.valueType}_REDEEMED`,
      "PaymentTransaction",
      transaction.id,
      input.publicReference,
    );
    return next;
  }

  applyCustomerDeposit(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      invoiceId: string;
      orderId: string;
      paymentMethodId: string;
      originalTransactionId: string;
      depositId: string;
      amountMinor: number;
      currency: string;
      liabilityAccountId: string;
      businessDate: string;
      actor: string;
      authoritative: true;
    },
  ) {
    if (input.authoritative !== true) {
      throw new Error("Customer deposit application requires authoritative server validation");
    }
    assertMinorAmount(input.amountMinor);
    if (input.amountMinor <= 0) throw new Error("Deposit application amount must be positive");
    let next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    let operations = requiredOperations(next);
    const method = this.method(input.tenantId, input.paymentMethodId);
    if (!method.receivableAccountId) {
      throw new PlatformConfigurationError(
        `${method.displayName} has no configured receivable account`,
      );
    }
    const original = operations.transactions.find(
      (transaction) =>
        transaction.id === input.originalTransactionId &&
        transaction.tenantId === input.tenantId &&
        transaction.branchId === input.branchId,
    );
    if (
      !original ||
      original.status !== "CONFIRMED" ||
      original.direction !== "COLLECTION" ||
      original.paymentMethodId !== method.id ||
      original.currency !== input.currency ||
      original.metadata["collectionPurpose"] !== "RESERVATION_DEPOSIT" ||
      original.metadata["collectionCreditAccountId"] !== input.liabilityAccountId
    ) {
      throw new Error("Confirmed reservation deposit transaction is unavailable");
    }
    const previouslyApplied = operations.transactions
      .filter(
        (transaction) =>
          transaction.direction === "ADJUSTMENT" &&
          transaction.originalTransactionId === original.id &&
          transaction.status === "CONFIRMED",
      )
      .reduce((sum, transaction) => sumMinor([sum, transaction.amountMinor]), 0);
    if (sumMinor([previouslyApplied, input.amountMinor]) > original.amountMinor) {
      throw new Error("Deposit application exceeds the confirmed collection");
    }
    this.validateAllocations(
      next,
      input.tenantId,
      input.branchId,
      input.currency,
      input.amountMinor,
      [{ invoiceId: input.invoiceId, amountMinor: input.amountMinor }],
    );
    const stamp = new Date().toISOString();
    const transactionId = nextId("PTX", operations.transactions);
    const beforePaymentIds = new Set(next.payments.map((payment) => payment.id));
    next = TransactionEngine.applyPayment(next, input.invoiceId, {
      amount: majorFromMinor(input.amountMinor, input.currency),
      method: method.id,
      provider: method.displayName,
      reference: `DEPOSIT ${input.depositId.slice(-8).toUpperCase()}`,
      cashier: input.actor,
      terminal: "AUTHORITATIVE_DEPOSIT",
      reconciliationStatus: "RECONCILED",
      settlementStatus: "NOT_REQUIRED",
    });
    const legacyPayment = next.payments.find((payment) => !beforePaymentIds.has(payment.id));
    if (legacyPayment) {
      next.journalEntries = next.journalEntries.filter(
        (journal) => journal.sourceId !== legacyPayment.id,
      );
    }
    operations = requiredOperations(next);
    const transaction: PaymentTransaction = Object.freeze({
      id: transactionId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      paymentMethodId: method.id,
      direction: "ADJUSTMENT",
      amountMinor: input.amountMinor,
      unallocatedAmountMinor: 0,
      currency: input.currency,
      status: "CONFIRMED",
      merchantReference: input.invoiceId,
      originalTransactionId: original.id,
      occurredAt: stamp,
      confirmedAt: stamp,
      createdAt: stamp,
      createdBy: input.actor,
      metadata: Object.freeze({
        reservationDepositId: input.depositId,
        orderId: input.orderId,
        liabilityAccountId: input.liabilityAccountId,
        receivableAccountId: method.receivableAccountId,
        businessDate: input.businessDate,
        ...(legacyPayment ? { legacyPaymentId: legacyPayment.id } : {}),
      }),
    });
    operations.transactions.unshift(transaction);
    operations.allocations.unshift(
      ...this.createAllocations(
        operations,
        transaction,
        [{ invoiceId: input.invoiceId, amountMinor: input.amountMinor }],
        input.actor,
      ),
    );
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        branchId: input.branchId,
        sourceType: "RESERVATION_DEPOSIT_APPLICATION",
        sourceId: transaction.id,
        businessDate: input.businessDate,
        description: "Reservation deposit applied to final bill",
        postedBy: input.actor,
        lines: [
          journalLine(input.liabilityAccountId, input.amountMinor, 0, input.currency, {
            reservationDepositId: input.depositId,
          }),
          journalLine(method.receivableAccountId, 0, input.amountMinor, input.currency, {
            invoiceId: input.invoiceId,
          }),
        ],
      }),
    );
    this.audit(
      operations,
      input.tenantId,
      input.branchId,
      input.actor,
      "RESERVATION_DEPOSIT_APPLIED",
      "PaymentTransaction",
      transaction.id,
      input.depositId,
    );
    return next;
  }

  chargeHouseAccount(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      customerId: string;
      invoiceId: string;
      amountMinor: number;
      currency: string;
      receivableAccountId: string;
      revenueAccountId: string;
      actor: string;
      creditLimitMinor?: number;
      paymentTermsDays?: number;
    },
  ) {
    assertMinorAmount(input.amountMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const stamp = new Date().toISOString();
    let account = operations.customerAccounts.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.customerId === input.customerId &&
        candidate.currency === input.currency,
    );
    if (!account) {
      account = {
        id: nextId("CUSTACC", operations.customerAccounts),
        tenantId: input.tenantId,
        customerId: input.customerId,
        currency: input.currency,
        ...(input.creditLimitMinor === undefined
          ? {}
          : { creditLimitMinor: input.creditLimitMinor }),
        ...(input.paymentTermsDays === undefined
          ? {}
          : { paymentTermsDays: input.paymentTermsDays }),
        balanceMinor: 0,
        receivableAccountId: input.receivableAccountId,
        active: true,
        createdAt: stamp,
        updatedAt: stamp,
      };
      operations.customerAccounts.unshift(account);
    }
    if (
      account.creditLimitMinor !== undefined &&
      account.balanceMinor + input.amountMinor > account.creditLimitMinor
    ) {
      throw new Error("Customer credit limit would be exceeded");
    }
    account.balanceMinor += input.amountMinor;
    account.updatedAt = stamp;
    const invoice = next.bills.find(
      (candidate) => candidate.id === input.invoiceId && candidate.tenantId === input.tenantId,
    );
    if (!invoice) throw new Error("House-account invoice was not found");
    invoice.status = "PENDING";
    if (account.paymentTermsDays !== undefined) {
      invoice.dueAt = new Date(
        Date.parse(invoice.issuedAt) + account.paymentTermsDays * 86_400_000,
      ).toISOString();
    }
    operations.customerAccountEntries.unshift(
      Object.freeze({
        id: nextId("CUSTENTRY", operations.customerAccountEntries),
        tenantId: input.tenantId,
        branchId: input.branchId,
        customerAccountId: account.id,
        type: "INVOICE",
        sourceId: input.invoiceId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        occurredAt: stamp,
        actor: input.actor,
      }),
    );
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        branchId: input.branchId,
        sourceType: "HOUSE_ACCOUNT",
        sourceId: input.invoiceId,
        businessDate: stamp.slice(0, 10),
        description: `House account charge ${input.invoiceId}`,
        postedBy: input.actor,
        lines: [
          journalLine(input.receivableAccountId, input.amountMinor, 0, input.currency, {
            customerId: input.customerId,
          }),
          journalLine(input.revenueAccountId, 0, input.amountMinor, input.currency, {
            invoiceId: input.invoiceId,
          }),
        ],
      }),
    );
    this.audit(
      operations,
      input.tenantId,
      input.branchId,
      input.actor,
      "INVOICE_PLACED_ON_ACCOUNT",
      "BillingRecord",
      input.invoiceId,
      input.customerId,
    );
    return next;
  }

  recordCustomerAccountPayment(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId?: string;
      customerAccountId: string;
      paymentTransactionId: string;
      amountMinor: number;
      currency: string;
      actor: string;
    },
  ) {
    assertMinorAmount(input.amountMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const account = operations.customerAccounts.find(
      (candidate) =>
        candidate.id === input.customerAccountId && candidate.tenantId === input.tenantId,
    );
    const transaction = operations.transactions.find(
      (candidate) =>
        candidate.id === input.paymentTransactionId &&
        candidate.tenantId === input.tenantId &&
        ["CONFIRMED", "MANUALLY_CONFIRMED"].includes(candidate.status),
    );
    if (!account || !transaction)
      throw new Error("Customer account or confirmed payment not found");
    assertSameCurrency(account.currency, input.currency);
    assertSameCurrency(transaction.currency, input.currency);
    if (input.amountMinor <= 0 || input.amountMinor > transaction.amountMinor) {
      throw new Error("Customer account payment amount is invalid");
    }
    account.balanceMinor = Math.max(0, account.balanceMinor - input.amountMinor);
    account.updatedAt = new Date().toISOString();
    operations.customerAccountEntries.unshift(
      Object.freeze({
        id: nextId("CUSTENTRY", operations.customerAccountEntries),
        tenantId: input.tenantId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        customerAccountId: account.id,
        type: "PAYMENT",
        sourceId: transaction.id,
        amountMinor: -input.amountMinor,
        currency: input.currency,
        occurredAt: new Date().toISOString(),
        actor: input.actor,
      }),
    );
    return next;
  }

  private recordUnverifiedCollection(
    state: TransactionState,
    input: Omit<ConfirmCollectionInput, "status" | "providerTransactionId">,
  ) {
    assertMinorAmount(input.amountMinor);
    const next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const method = this.method(input.tenantId, input.paymentMethodId);
    if (!input.customerReference?.trim()) throw new Error("Payment reference is required");
    this.assertUniqueReference(operations, method.providerConnectionId, input.customerReference);
    this.validateAllocations(
      next,
      input.tenantId,
      input.branchId,
      input.currency,
      input.amountMinor,
      input.allocations,
    );
    const stamp = input.occurredAt ?? new Date().toISOString();
    const transaction: PaymentTransaction = Object.freeze({
      id: nextId("PTX", operations.transactions),
      tenantId: input.tenantId,
      branchId: input.branchId,
      ...(input.intentId ? { intentId: input.intentId } : {}),
      paymentMethodId: method.id,
      ...(method.providerConnectionId ? { providerConnectionId: method.providerConnectionId } : {}),
      direction: "COLLECTION",
      amountMinor: input.amountMinor,
      unallocatedAmountMinor: Math.max(
        0,
        input.amountMinor - sumMinor(input.allocations.map((item) => item.amountMinor)),
      ),
      currency: input.currency,
      status: "UNVERIFIED",
      customerReference: input.customerReference,
      merchantReference: input.merchantReference,
      occurredAt: stamp,
      createdAt: stamp,
      createdBy: input.actor,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      metadata: Object.freeze({ ...input.metadata }),
    });
    operations.transactions.unshift(transaction);
    operations.allocations.unshift(
      ...this.createAllocations(operations, transaction, input.allocations, input.actor),
    );
    this.audit(
      operations,
      input.tenantId,
      input.branchId,
      input.actor,
      "REFERENCE_SUBMITTED",
      "PaymentTransaction",
      transaction.id,
      input.customerReference,
      input.deviceId,
    );
    return next;
  }

  private recordConfirmedCollection(state: TransactionState, input: ConfirmCollectionInput) {
    assertMinorAmount(input.amountMinor);
    if (input.amountMinor <= 0) throw new Error("Payment amount must be positive");
    let next = normalizeTransactionState(state);
    this.assertTenant(next, input.tenantId);
    let operations = requiredOperations(next);
    const method = this.method(input.tenantId, input.paymentMethodId);
    const providerConnectionId = input.providerConnectionId ?? method.providerConnectionId;
    if (input.status === "CONFIRMED" && providerConnectionId && !input.providerTransactionId) {
      throw new Error("Provider-confirmed payments require a provider transaction reference");
    }
    if (input.providerTransactionId) {
      this.assertUniqueReference(operations, providerConnectionId, input.providerTransactionId);
    }
    this.validateAllocations(
      next,
      input.tenantId,
      input.branchId,
      input.currency,
      input.amountMinor,
      input.allocations,
    );
    if (input.intentId) {
      const intent = operations.intents.find(
        (candidate) => candidate.id === input.intentId && candidate.tenantId === input.tenantId,
      );
      if (!intent) throw new Error("Payment intent not found");
      assertSameCurrency(intent.currency, input.currency);
      if (intent.amountRequestedMinor !== input.amountMinor) {
        intent.status = "FAILED";
        intent.updatedAt = new Date().toISOString();
        throw new Error("Provider payment amount does not match the payment intent");
      }
      if (intent.status === "CONFIRMED") return next;
    }

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const operationTransactionId = nextId("PTX", operations.transactions);
    const allocatedMinor = sumMinor(input.allocations.map((item) => item.amountMinor));
    const collectionCreditAccountId =
      typeof input.metadata?.["collectionCreditAccountId"] === "string" &&
      input.metadata["collectionCreditAccountId"].trim()
        ? input.metadata["collectionCreditAccountId"]
        : receivableAccount(method);
    let lastLegacyPaymentId: string | undefined;
    for (const allocation of input.allocations) {
      const beforeIds = new Set(next.payments.map((payment) => payment.id));
      next = TransactionEngine.applyPayment(next, allocation.invoiceId, {
        amount: majorFromMinor(allocation.amountMinor, input.currency),
        method: method.code,
        provider: providerConnectionId ?? method.displayName,
        reference:
          input.providerTransactionId ??
          input.customerReference ??
          `${operationTransactionId}-${allocation.invoiceId}`,
        cashier: input.actor,
        terminal: input.deviceId ?? "SYSTEM",
        reconciliationStatus: method.category === "CASH" ? "RECONCILED" : "MATCHED",
        settlementStatus: method.category === "CASH" ? "NOT_REQUIRED" : "PENDING",
        ...(input.currencyEvidence
          ? {
              tenderCurrency: input.currencyEvidence.tenderCurrency,
              tenderAmount: majorFromMinor(
                input.currencyEvidence.tenderAmountMinor,
                input.currencyEvidence.tenderCurrency,
              ),
              baseAmount: majorFromMinor(
                input.currencyEvidence.baseAmountMinor,
                input.currencyEvidence.baseCurrency,
              ),
              fxRateReference: input.currencyEvidence.quoteId,
              fxRateNumerator: input.currencyEvidence.rateNumerator,
              fxRateDenominator: input.currencyEvidence.rateDenominator,
            }
          : {}),
        ...(input.providerTransactionId
          ? { externalTransactionId: input.providerTransactionId }
          : {}),
        ...(method.category === "CASH"
          ? {
              cash: {
                received: majorFromMinor(
                  Number(input.metadata?.["cashTenderedMinor"] ?? allocation.amountMinor),
                  input.currency,
                ),
                change: majorFromMinor(
                  Number(input.metadata?.["changeGivenMinor"] ?? 0),
                  input.currency,
                ),
                drawerId: String(input.metadata?.["drawerSessionId"] ?? "unassigned"),
              },
            }
          : {}),
      });
      lastLegacyPaymentId = next.payments.find((payment) => !beforeIds.has(payment.id))?.id;
    }
    operations = requiredOperations(next);
    const transaction: PaymentTransaction = Object.freeze({
      id: operationTransactionId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      ...(input.intentId ? { intentId: input.intentId } : {}),
      paymentMethodId: method.id,
      ...(providerConnectionId ? { providerConnectionId } : {}),
      direction: "COLLECTION",
      amountMinor: input.amountMinor,
      unallocatedAmountMinor: input.amountMinor - allocatedMinor,
      currency: input.currency.toUpperCase(),
      status: input.status ?? "CONFIRMED",
      ...(input.providerTransactionId
        ? { providerTransactionId: input.providerTransactionId }
        : {}),
      ...(input.customerReference ? { customerReference: input.customerReference } : {}),
      merchantReference: input.merchantReference,
      occurredAt,
      confirmedAt: occurredAt,
      createdAt: new Date().toISOString(),
      createdBy: input.actor,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      ...(input.currencyEvidence ? { currencyEvidence: input.currencyEvidence } : {}),
      metadata: Object.freeze({
        ...input.metadata,
        ...(lastLegacyPaymentId ? { legacyPaymentId: lastLegacyPaymentId } : {}),
      }),
    });
    operations.transactions.unshift(transaction);
    operations.allocations.unshift(
      ...this.createAllocations(operations, transaction, input.allocations, input.actor),
    );
    operations.collections.unshift(
      Object.freeze({
        id: nextId("PCOL", operations.collections),
        tenantId: input.tenantId,
        branchId: input.branchId,
        paymentTransactionId: transaction.id,
        accountId: collectionAccount(method),
        amountMinor: input.amountMinor,
        currency: input.currency,
        collectionState: method.category === "CASH" ? "IN_HAND" : "IN_CLEARING",
        collectedAt: occurredAt,
        createdAt: new Date().toISOString(),
      }),
    );
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        branchId: input.branchId,
        sourceType: "PAYMENT_COLLECTION",
        sourceId: transaction.id,
        businessDate: occurredAt.slice(0, 10),
        description: `Collection ${transaction.merchantReference}`,
        postedBy: input.actor,
        lines: [
          journalLine(collectionAccount(method), input.amountMinor, 0, input.currency, {
            paymentMethodId: method.id,
          }),
          journalLine(collectionCreditAccountId, 0, input.amountMinor, input.currency, {
            allocations: input.allocations.length,
            ...(collectionCreditAccountId !== receivableAccount(method)
              ? { collectionPurpose: String(input.metadata?.["collectionPurpose"] ?? "OTHER") }
              : {}),
          }),
        ],
      }),
    );
    if (input.intentId) {
      const intent = operations.intents.find((candidate) => candidate.id === input.intentId);
      if (intent) {
        intent.amountAuthorizedMinor = input.amountMinor;
        intent.amountCollectedMinor = input.amountMinor;
        intent.status = "CONFIRMED";
        if (input.providerTransactionId) intent.providerReference = input.providerTransactionId;
        intent.updatedAt = new Date().toISOString();
      }
    }
    this.audit(
      operations,
      input.tenantId,
      input.branchId,
      input.actor,
      "PAYMENT_CONFIRMED",
      "PaymentTransaction",
      transaction.id,
      `${input.currency} ${input.amountMinor}`,
      input.deviceId,
    );
    if (input.status === "MANUALLY_CONFIRMED" && method.category !== "CASH") {
      this.flag(
        operations,
        transaction,
        "MANUAL_DIGITAL_CONFIRMATION",
        "WARNING",
        "External terminal payment manually confirmed",
      );
    }
    return next;
  }

  private validateAllocations(
    state: TransactionState,
    tenantId: string,
    branchId: string,
    currency: string,
    paymentAmountMinor: number,
    allocations: AllocationRequest[],
  ) {
    if (!allocations.length) return;
    const allocated = sumMinor(allocations.map((item) => item.amountMinor));
    if (allocated > paymentAmountMinor) throw new Error("Allocations exceed payment amount");
    const tenantCurrency = this.configuration.getTenant(tenantId).defaultCurrency;
    assertSameCurrency(tenantCurrency, currency);
    for (const allocation of allocations) {
      assertMinorAmount(allocation.amountMinor);
      if (allocation.amountMinor <= 0) throw new Error("Allocation must be positive");
      const invoice = state.bills.find(
        (candidate) => candidate.id === allocation.invoiceId && candidate.tenantId === tenantId,
      );
      if (!invoice) throw new Error(`Invoice ${allocation.invoiceId} not found for tenant`);
      const invoiceBranchId =
        invoice.branchId ?? this.configuration.resolveBranch(tenantId, invoice.branch).id;
      if (invoiceBranchId !== branchId) {
        throw new Error(`Invoice ${allocation.invoiceId} belongs to another branch`);
      }
      if (!["OPEN", "PARTIAL", "PENDING"].includes(invoice.status)) {
        throw new Error(
          `Invoice ${allocation.invoiceId} cannot accept payment from ${invoice.status}`,
        );
      }
      const dueMinor = parseMajorAmount(invoice.total - invoice.paid, tenantCurrency);
      if (allocation.amountMinor > dueMinor)
        throw new Error(`Allocation exceeds balance for ${invoice.id}`);
    }
  }

  private createAllocations(
    operations: PaymentOperationsState,
    transaction: PaymentTransaction,
    allocations: AllocationRequest[],
    actor: string,
  ): PaymentAllocation[] {
    return allocations.map((allocation, index) =>
      Object.freeze({
        id: `${transaction.id}-ALLOC-${index + 1}`,
        tenantId: transaction.tenantId,
        branchId: transaction.branchId,
        paymentTransactionId: transaction.id,
        invoiceId: allocation.invoiceId,
        amountMinor: allocation.amountMinor,
        currency: transaction.currency,
        createdAt: transaction.createdAt,
        createdBy: actor,
      }),
    );
  }

  private method(tenantId: string, paymentMethodId: string): PaymentMethodDefinition {
    const method = this.configuration
      .listPaymentMethods(tenantId, false)
      .find((candidate) => candidate.id === paymentMethodId || candidate.code === paymentMethodId);
    if (!method?.enabled) throw new PlatformConfigurationError("Payment method is not enabled");
    return method;
  }

  private assertMethodBranch(method: PaymentMethodDefinition, branchId: string) {
    if (!method.providerConnectionId) return;
    const connection = this.configuration
      .listConnections(method.tenantId, branchId)
      .find((candidate) => candidate.id === method.providerConnectionId);
    if (!connection || (connection.branchId && connection.branchId !== branchId)) {
      throw new Error("Payment method provider is not available for this branch");
    }
  }

  private assertTenant(state: TransactionState, tenantId: string) {
    if ((state.tenantId ?? tenantId) !== tenantId) throw new Error("Tenant scope violation");
  }

  private assertUniqueReference(
    operations: PaymentOperationsState,
    providerConnectionId: string | undefined,
    reference: string,
  ) {
    if (!providerConnectionId) return;
    const duplicate = operations.transactions.find(
      (transaction) =>
        transaction.providerConnectionId === providerConnectionId &&
        (transaction.providerTransactionId === reference ||
          transaction.customerReference === reference),
    );
    if (duplicate) throw new Error("Provider transaction reference has already been used");
  }

  private audit(
    operations: PaymentOperationsState,
    tenantId: string,
    branchId: string | undefined,
    actor: string,
    action: string,
    recordType: string,
    recordId: string,
    detail: string,
    deviceId?: string,
  ) {
    operations.auditEvents.unshift(
      Object.freeze({
        id: nextId("PAUD", operations.auditEvents),
        tenantId,
        ...(branchId ? { branchId } : {}),
        actor,
        ...(deviceId ? { deviceId } : {}),
        action,
        recordType,
        recordId,
        detail,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  private flag(
    operations: PaymentOperationsState,
    source: { id: string; tenantId: string; branchId?: string },
    type: PaymentOperationsState["fraudFlags"][number]["type"],
    severity: PaymentOperationsState["fraudFlags"][number]["severity"],
    detail: string,
  ) {
    operations.fraudFlags.unshift({
      id: nextId("FRAUD", operations.fraudFlags),
      tenantId: source.tenantId,
      ...(source.branchId ? { branchId: source.branchId } : {}),
      type,
      sourceId: source.id,
      severity,
      status: "OPEN",
      detail,
      createdAt: new Date().toISOString(),
    });
  }
}

function requiredOperations(state: TransactionState) {
  if (!state.paymentOperations) throw new Error("Payment operations state was not initialized");
  return state.paymentOperations;
}

function collectionAccount(method: PaymentMethodDefinition) {
  const accountId =
    method.category === "CASH"
      ? (method.cashAccountId ?? method.settlementAccountId)
      : (method.clearingAccountId ?? method.settlementAccountId);
  if (!accountId) {
    throw new PlatformConfigurationError(
      `${method.displayName} has no configured collection account`,
    );
  }
  return accountId;
}

function receivableAccount(method: PaymentMethodDefinition) {
  if (!method.receivableAccountId) {
    throw new PlatformConfigurationError(
      `${method.displayName} has no configured receivable account`,
    );
  }
  return method.receivableAccountId;
}

function journalLine(
  accountId: string,
  debitMinor: number,
  creditMinor: number,
  currency: string,
  metadata: Record<string, unknown>,
) {
  return Object.freeze({
    accountId,
    debitMinor,
    creditMinor,
    currency,
    metadata: Object.freeze(metadata),
  });
}

function nextId(prefix: string, rows: readonly { id: string }[]) {
  const maximum = rows.reduce((max, row) => {
    const parsed = Number(row.id.match(/(\d+)$/)?.[1] ?? 0);
    return Math.max(max, Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(6, "0")}`;
}

function replaceTransaction(
  operations: PaymentOperationsState,
  id: string,
  replacement: PaymentTransaction,
) {
  operations.transactions = operations.transactions.map((item) =>
    item.id === id ? Object.freeze(replacement) : item,
  );
}

function cashMovementEffect(type: CashMovementType, amountMinor: number) {
  return ["REFUND", "PAID_OUT", "CASH_DROP", "PETTY_CASH"].includes(type)
    ? -Math.abs(amountMinor)
    : type === "CLOSING"
      ? 0
      : amountMinor;
}

function latestTransaction(state: TransactionState) {
  const transaction = requiredOperations(state).transactions[0];
  if (!transaction) throw new Error("Payment transaction was not recorded");
  return transaction;
}

function prorateCurrencyEvidence(
  original: PaymentCurrencyEvidence,
  refundBaseAmountMinor: number,
  originalBaseAmountMinor: number,
): PaymentCurrencyEvidence {
  const tenderAmountMinor = Number(
    (BigInt(original.tenderAmountMinor) * BigInt(refundBaseAmountMinor) +
      BigInt(originalBaseAmountMinor) / 2n) /
      BigInt(originalBaseAmountMinor),
  );
  assertMinorAmount(tenderAmountMinor, "refund tender amount");
  return Object.freeze({
    ...original,
    baseAmountMinor: refundBaseAmountMinor,
    tenderAmountMinor,
    convertedBaseAmountMinor: refundBaseAmountMinor,
    roundingAdjustmentMinor: 0,
    refundRatePolicy: "ORIGINAL_RATE",
  });
}

function assertSafeCardMetadata(input: {
  maskedPan?: string;
  authorizationCode?: string;
  metadata?: Record<string, unknown>;
}) {
  if (input.maskedPan && !/^(?:\*{4,}|X{4,})\d{4}$/i.test(input.maskedPan)) {
    throw new Error("Only a masked PAN ending in four digits may be stored");
  }
  const keys = Object.keys(input.metadata ?? {}).map((key) => key.toLowerCase());
  if (keys.some((key) => ["pan", "cvv", "pin", "track", "cardnumber"].includes(key))) {
    throw new Error("Sensitive card data cannot be stored");
  }
}

export function invoiceBalanceMinor(invoice: BillingRecord, currency: string) {
  return parseMajorAmount(invoice.total - invoice.paid, currency);
}

export const paymentOrchestrator = new PaymentOrchestrator();
