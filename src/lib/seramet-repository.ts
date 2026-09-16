import {
  TransactionEngine,
  createEmptyTransactionState,
  normalizeTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import { paymentOrchestrator } from "@/payments/payment-orchestrator";
import { ReconciliationEngine } from "@/payments/reconciliation-engine";
import { SettlementService } from "@/payments/settlement-service";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export class TransactionConflictError extends Error {
  readonly code = "CONFLICT";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "TransactionConflictError";
  }
}

export type IdempotencyRecord = {
  tenantId: string;
  key: string;
  actorId: string;
  action: string;
  requestHash: string;
  responseJson: string;
  createdAt: string;
};

export type TransactionRepository = {
  loadState: (tenantId: string) => Promise<TransactionState>;
  saveState: (state: TransactionState, actor: ServerActor, reason: string) => Promise<void>;
  commitMutation: (input: TransactionMutationCommit) => Promise<TransactionMutationResult>;
  revision: (tenantId: string) => Promise<number>;
  getIdempotency: (tenantId: string, key: string) => Promise<IdempotencyRecord | null>;
  saveIdempotency: (record: IdempotencyRecord) => Promise<void>;
  appendProviderEvent: (event: ProviderWebhookEvent) => Promise<void>;
  migrate: () => Promise<void>;
  readonly authoritative: boolean;
};

export type TransactionMutationCommit = {
  actor: ServerActor;
  action: string;
  payload: unknown;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  expectedRevision?: number;
  deviceId?: string;
};

export type TransactionMutationResult = {
  state: TransactionState;
  revision: number;
  duplicate: boolean;
};

export type ProviderWebhookEvent = {
  id: string;
  tenantId: string;
  provider: string;
  eventType: string;
  externalReference: string;
  payloadJson: string;
  receivedAt: string;
  processed: boolean;
};

const memoryRevisions = new Map<string, number>();
const reconciliationEngine = new ReconciliationEngine();
const settlementService = new SettlementService();

const memory = {
  states: new Map<string, TransactionState>(),
  idempotency: new Map<string, IdempotencyRecord>(),
  events: [] as ProviderWebhookEvent[],
};

export function resetMemoryTransactionRepositoryForTests() {
  memory.states.clear();
  memory.idempotency.clear();
  memory.events.length = 0;
  memoryRevisions.clear();
}

export class MemoryTransactionRepository implements TransactionRepository {
  readonly authoritative = false;

  async migrate() {
    return undefined;
  }

  async loadState(tenantId: string) {
    const state = memory.states.get(tenantId) ?? createEmptyTransactionState(tenantId);
    return normalizeTransactionState(structuredCloneSafe(state));
  }

  async saveState(state: TransactionState, actor: ServerActor, _reason?: string) {
    if (state.tenantId !== actor.tenantId) throw new Error("Cross-tenant snapshot write denied");
    memory.states.set(actor.tenantId, structuredCloneSafe(state));
  }

  async commitMutation(input: TransactionMutationCommit): Promise<TransactionMutationResult> {
    const cached = await this.getIdempotency(input.actor.tenantId, input.idempotencyKey);
    if (cached) {
      if (cached.requestHash !== input.requestHash) {
        throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
      }
      const result = JSON.parse(cached.responseJson) as {
        state: TransactionState;
        revision: number;
      };
      return {
        state: normalizeTransactionState(result.state),
        revision: result.revision,
        duplicate: true,
      };
    }
    const currentRevision = memoryRevisions.get(input.actor.tenantId) ?? 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new TransactionConflictError(
        "Authoritative state changed concurrently; reload and retry the command",
      );
    }
    const current = await this.loadState(input.actor.tenantId);
    const next = applyServerMutation(current, input.action, input.payload, input.actor);
    await this.saveState(next, input.actor, `Mutation ${input.action}`);
    const revision = currentRevision + 1;
    memoryRevisions.set(input.actor.tenantId, revision);
    await this.saveIdempotency({
      tenantId: input.actor.tenantId,
      key: input.idempotencyKey,
      actorId: input.actor.id,
      action: input.action,
      requestHash: input.requestHash,
      responseJson: JSON.stringify({ state: next, revision }),
      createdAt: new Date().toISOString(),
    });
    return { state: next, revision, duplicate: false };
  }

  async revision(tenantId: string) {
    return memoryRevisions.get(tenantId) ?? 0;
  }

  async getIdempotency(tenantId: string, key: string) {
    return memory.idempotency.get(`${tenantId}:${key}`) ?? null;
  }

  async saveIdempotency(record: IdempotencyRecord) {
    memory.idempotency.set(`${record.tenantId}:${record.key}`, record);
  }

  async appendProviderEvent(event: ProviderWebhookEvent) {
    memory.events.unshift(event);
  }
}

export function applyServerMutation(
  state: TransactionState,
  action: string,
  payload: unknown,
  actor: ServerActor,
) {
  const input = payload as Record<string, unknown>;
  switch (action) {
    case "replaceState":
      return input["state"] as TransactionState;
    case "holdOrder":
      return TransactionEngine.holdOrder(
        state,
        input["draft"] as Parameters<typeof TransactionEngine.holdOrder>[1],
      );
    case "createOrder":
      return TransactionEngine.createOrder(
        state,
        input["draft"] as Parameters<typeof TransactionEngine.createOrder>[1],
        input["status"] as Parameters<typeof TransactionEngine.createOrder>[2],
      );
    case "updateOrderDraft":
      return TransactionEngine.updateOrderDraft(
        state,
        String(input["orderId"]),
        input["draft"] as Parameters<typeof TransactionEngine.updateOrderDraft>[2],
        actor.name,
      );
    case "upsertOrderDraft": {
      const orderId = typeof input["orderId"] === "string" ? input["orderId"] : undefined;
      const draft = input["draft"] as Parameters<typeof TransactionEngine.createOrder>[1];
      if (orderId && state.orders.some((order) => order.id === orderId)) {
        return TransactionEngine.updateOrderDraft(state, orderId, draft, actor.name);
      }
      return input["targetStatus"] === "HELD"
        ? TransactionEngine.holdOrder(state, draft)
        : TransactionEngine.createOrder(state, draft, "OPEN");
    }
    case "upsertAndSendKitchen": {
      const orderId = typeof input["orderId"] === "string" ? input["orderId"] : undefined;
      const draft = input["draft"] as Parameters<typeof TransactionEngine.createOrder>[1];
      let next = state;
      if (orderId && next.orders.some((order) => order.id === orderId)) {
        next = TransactionEngine.updateOrderDraft(next, orderId, draft, actor.name);
      } else {
        next = TransactionEngine.createOrder(next, draft, "OPEN");
      }
      const createdOrderId =
        orderId ??
        next.orders.find((order) => !state.orders.some((current) => current.id === order.id))?.id;
      if (!createdOrderId)
        throw new Error("Kitchen order did not receive an authoritative identity");
      return TransactionEngine.sendToKitchen(next, createdOrderId, actor.name);
    }
    case "createGuestOrder": {
      const draft = input["draft"] as Parameters<typeof TransactionEngine.createOrder>[1];
      const customerValueInput = input["customerValueInput"] as
        | Omit<
            Parameters<typeof paymentOrchestrator.recordAuthoritativeCustomerValue>[1],
            "invoiceId"
          >
        | undefined;
      const scheduledFor = draft.guestContext?.scheduledFor;
      const scheduled = Boolean(scheduledFor && Date.parse(scheduledFor) > Date.now());
      const requiresReview =
        draft.guestContext?.acceptancePolicy === "WAITER_REVIEW" ||
        draft.guestContext?.acceptancePolicy === "CASHIER_REVIEW";
      let next = TransactionEngine.createOrder(
        state,
        draft,
        scheduled || requiresReview ? "HELD" : "OPEN",
      );
      const orderId = next.orders.find(
        (order) => !state.orders.some((current) => current.id === order.id),
      )?.id;
      if (!orderId) throw new Error("Guest order did not receive an authoritative identity");
      if (!scheduled && !requiresReview) {
        next = TransactionEngine.sendToKitchen(next, orderId, actor.name);
      }
      next = TransactionEngine.createOpenBill(next, orderId);
      if (customerValueInput) {
        const invoice = next.bills.find((candidate) => candidate.orderIds.includes(orderId));
        if (!invoice) throw new Error("Guest order invoice was not created");
        next = paymentOrchestrator.recordAuthoritativeCustomerValue(next, {
          ...customerValueInput,
          invoiceId: invoice.id,
          metadata: {
            ...customerValueInput.metadata,
            orderId,
          },
        });
      }
      return next;
    }
    case "requestBillWithDraft": {
      const orderId = String(input["orderId"]);
      const next = TransactionEngine.updateOrderDraft(
        state,
        orderId,
        input["draft"] as Parameters<typeof TransactionEngine.updateOrderDraft>[2],
        actor.name,
      );
      return TransactionEngine.requestBill(next, orderId, actor.name);
    }
    case "prepareInvoiceForPayment": {
      const orderId = typeof input["orderId"] === "string" ? input["orderId"].trim() : "";
      if (!orderId) throw new Error("An explicit order ID is required to prepare payment");
      return TransactionEngine.prepareInvoiceForPayment(state, orderId, actor.name);
    }
    case "sendToKitchen":
      return TransactionEngine.sendToKitchen(state, String(input["orderId"]), actor.name);
    case "setProductionStationStatus":
      return TransactionEngine.setProductionStationStatus(
        state,
        String(input["orderId"]),
        String(input["station"]),
        String(input["status"]) as Parameters<
          typeof TransactionEngine.setProductionStationStatus
        >[3],
        actor.name,
      );
    case "markOrderServed":
      return TransactionEngine.markOrderServed(state, String(input["orderId"]), actor.name);
    case "generatePurchaseOrders":
      return TransactionEngine.generatePurchaseOrders(
        state,
        String(input["branch"] ?? actor.branch),
        actor.name,
      ).state;
    case "approvePurchaseOrder":
      return TransactionEngine.approvePurchaseOrder(
        state,
        String(input["purchaseOrderId"]),
        actor.name,
      );
    case "receivePurchaseOrder":
      return TransactionEngine.receivePurchaseOrder(
        state,
        String(input["purchaseOrderId"]),
        (input["quantities"] ?? {}) as Record<string, number>,
        actor.name,
      );
    case "recordWastage":
      return TransactionEngine.recordWastage(
        state,
        input["input"] as Parameters<typeof TransactionEngine.recordWastage>[1],
      );
    case "approveWastage":
      return TransactionEngine.approveWastage(state, String(input["wastageId"]), actor.name);
    case "replaceCostControlSnapshot": {
      const snapshot = input["snapshot"] as TransactionState["costControlSnapshots"][number];
      if (
        !snapshot ||
        snapshot.tenantId !== actor.tenantId ||
        !actor.assignedBranchIds.includes(snapshot.branchId)
      ) {
        throw new Error("Cost-control snapshot is outside the authenticated branch scope");
      }
      const nextSnapshot = {
        ...snapshot,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.name,
      };
      return {
        ...state,
        costControlSnapshots: [
          nextSnapshot,
          ...state.costControlSnapshots.filter((row) => row.id !== snapshot.id),
        ],
      };
    }
    case "recordBreakage":
      return TransactionEngine.recordBreakage(
        state,
        input["input"] as Parameters<typeof TransactionEngine.recordBreakage>[1],
      );
    case "approveBreakage":
      return TransactionEngine.approveBreakage(state, String(input["breakageId"]), actor.name);
    case "clockInEmployee":
      return TransactionEngine.clockInEmployee(
        state,
        String(input["employeeId"]),
        actor.name,
        (input["source"] ?? "POS") as Parameters<typeof TransactionEngine.clockInEmployee>[3],
      );
    case "clockOutEmployee":
      return TransactionEngine.clockOutEmployee(
        state,
        String(input["employeeId"]),
        actor.name,
        (input["source"] ?? "POS") as Parameters<typeof TransactionEngine.clockOutEmployee>[3],
      );
    case "setEmployeeNetPay":
      return TransactionEngine.setEmployeeNetPay(
        state,
        String(input["employeeId"]),
        Number(input["netMonthlyPay"]),
        actor.name,
      );
    case "addRider":
      return TransactionEngine.addRider(
        state,
        {
          name: String(input["name"] ?? ""),
          branch: String(input["branch"] ?? actor.branch),
          ...(input["shift"] ? { shift: String(input["shift"]) } : {}),
          ...(input["netMonthlyPay"] === undefined
            ? {}
            : { netMonthlyPay: Number(input["netMonthlyPay"]) }),
        },
        actor.name,
      );
    case "assignDeliveryRider":
      return TransactionEngine.assignDeliveryRider(
        state,
        String(input["orderId"]),
        String(input["rider"]),
        actor.name,
      );
    case "setDeliveryStatus":
      return TransactionEngine.setDeliveryStatus(
        state,
        String(input["orderId"]),
        String(input["status"]) as Parameters<typeof TransactionEngine.setDeliveryStatus>[2],
        actor.name,
      );
    case "releaseHeldOrder":
      return TransactionEngine.releaseHeldOrder(state, String(input["orderId"]), actor.name);
    case "createOpenBill":
      return TransactionEngine.createOpenBill(state, String(input["orderId"]));
    case "confirmPaymentIntent":
      return TransactionEngine.confirmPaymentIntent(
        state,
        String(input["intentId"]),
        String(input["externalReference"]),
        actor.name,
      );
    case "recordManualTillPayment":
      return TransactionEngine.recordManualTillPayment(
        state,
        String(input["invoiceId"]),
        input["input"] as Parameters<typeof TransactionEngine.recordManualTillPayment>[2],
      );
    case "recordCashPayment":
      return TransactionEngine.recordCashPayment(
        state,
        String(input["invoiceId"]),
        input["input"] as Parameters<typeof TransactionEngine.recordCashPayment>[2],
      );
    case "recordCardPayment":
      return TransactionEngine.recordCardPayment(
        state,
        String(input["invoiceId"]),
        input["input"] as Parameters<typeof TransactionEngine.recordCardPayment>[2],
      );
    case "recordBankPayment":
      return TransactionEngine.recordBankPayment(
        state,
        String(input["invoiceId"]),
        input["input"] as Parameters<typeof TransactionEngine.recordBankPayment>[2],
      );
    case "mergeBills":
      return TransactionEngine.mergeBills(
        state,
        input["billIds"] as string[],
        actor.name,
        String(input["reason"] ?? "Authorized merge"),
      );
    case "splitBill":
      return TransactionEngine.splitBill(
        state,
        String(input["billId"]),
        input["splits"] as Parameters<typeof TransactionEngine.splitBill>[2],
        actor.name,
      );
    case "cancelOrder": {
      const orderId = String(input["orderId"]);
      const order = state.orders.find((candidate) => candidate.id === orderId);
      if (!order) throw new Error(`Order ${orderId} was not found`);
      const cancellation = input["input"] as { reason?: unknown } | undefined;
      const reason = typeof cancellation?.reason === "string" ? cancellation.reason.trim() : "";
      if (!reason) throw new Error("Order cancellation requires a reason");
      return TransactionEngine.cancelOrder(state, orderId, {
        user: actor.name,
        reason,
        affectedItems: order.lines
          .filter((line) => line.productionStatus !== "CANCELLED")
          .map((line) => line.name),
      });
    }
    case "requestRefund":
      return TransactionEngine.requestRefund(
        state,
        input["input"] as Parameters<typeof TransactionEngine.requestRefund>[1],
      );
    case "approveRefund":
      return TransactionEngine.approveRefund(state, String(input["refundId"]), actor.name);
    case "importExternalTransaction":
      return TransactionEngine.importExternalTransaction(
        state,
        input["input"] as Parameters<typeof TransactionEngine.importExternalTransaction>[1],
      );
    case "suggestReconciliation":
      return TransactionEngine.suggestReconciliation(state, String(input["externalTransactionId"]));
    case "manuallyReconcile":
      return TransactionEngine.manuallyReconcile(
        state,
        String(input["externalTransactionId"]),
        String(input["paymentId"]),
        actor.name,
        String(input["notes"] ?? "Manual reconciliation"),
      );
    case "closeCashDrawer":
      return TransactionEngine.closeCashDrawer(
        state,
        String(input["drawerId"]),
        Number(input["physicalCount"]),
        actor.name,
      );
    case "markBillPending": {
      const billId = String(input["invoiceId"]);
      const timestamp = new Date().toISOString();
      return {
        ...state,
        bills: state.bills.map((bill) =>
          bill.id === billId ? { ...bill, status: "PENDING" as const } : bill,
        ),
        auditEvents: [
          {
            id: `AUD-PENDING-${crypto.randomUUID()}`,
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            time: timestamp,
            actor: actor.name,
            role: actor.role,
            branch: actor.branch,
            module: String(input["module"] ?? "Invoices"),
            action: "Marked invoice pending",
            record: billId,
            before: String(state.bills.find((bill) => bill.id === billId)?.status ?? "UNKNOWN"),
            after: "PENDING - settlement deferred",
          },
          ...state.auditEvents,
        ],
      };
    }
    case "settleInvoice":
      return settlementService.settle(
        state,
        input["input"] as Parameters<SettlementService["settle"]>[1],
      );
    case "applyConfiguredPayment": {
      const invoiceId = String(input["invoiceId"]);
      const paymentMethodId = String(input["paymentMethodId"]);
      const amountMinor = Number(input["amountMinor"]);
      const cashTenderedMinor = Number(
        input["tenderedAmountMinor"] ?? input["cashTenderedMinor"] ?? amountMinor,
      );
      const currencyEvidence =
        input["currencyEvidence"] && typeof input["currencyEvidence"] === "object"
          ? (input["currencyEvidence"] as NonNullable<
              Parameters<typeof paymentOrchestrator.recordCash>[1]["currencyEvidence"]
            >)
          : undefined;
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new Error("Payment amount must be a positive integer in minor units");
      }
      const configuration = getConfigurationRepository();
      const method = configuration
        .listPaymentMethods(actor.tenantId, false)
        .find((candidate) => candidate.id === paymentMethodId);
      if (!method || !method.enabled) throw new Error("Configured payment method is unavailable");
      const invoice = state.bills.find((candidate) => candidate.id === invoiceId);
      if (!invoice) throw new Error("Invoice was not found");
      const invoiceBranchId =
        invoice.branchId ?? configuration.resolveBranch(actor.tenantId, invoice.branch).id;
      if (invoiceBranchId !== actor.branchId) {
        throw new Error("Invoice belongs to another branch");
      }
      const currency = configuration.getTenant(actor.tenantId).defaultCurrency;
      const reference =
        typeof input["reference"] === "string" && input["reference"].trim()
          ? input["reference"].trim().toUpperCase()
          : undefined;
      const terminalId = String(input["terminalId"] ?? actor.deviceId ?? "SERVER-POS");
      if (
        method.metadata["providerOperation"] === "PAYMENT_PROMPT" ||
        method.metadata["providerOperation"] === "QR_PAYMENT"
      ) {
        throw new Error("Provider-initiated payments must use the integration runtime");
      }
      if (method.category === "CASH") {
        const drawer = state.paymentOperations?.drawerSessions.find(
          (candidate) =>
            candidate.tenantId === actor.tenantId &&
            candidate.branchId === actor.branchId &&
            candidate.status === "OPEN",
        );
        if (!drawer) throw new Error("Open a cash drawer before collecting cash");
        return paymentOrchestrator.recordCash(state, {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          drawerSessionId: drawer.id,
          paymentMethodId: method.id,
          invoiceId,
          amountMinor,
          cashTenderedMinor,
          currency,
          actor: actor.name,
          deviceId: terminalId,
          ...(currencyEvidence ? { currencyEvidence } : {}),
        });
      }
      if (method.category === "CARD") {
        return paymentOrchestrator.recordManualTerminalPayment(state, {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          paymentMethodId: method.id,
          ...(method.providerConnectionId
            ? { providerConnectionId: method.providerConnectionId }
            : {}),
          customerReference: reference ?? `${method.code}-${invoiceId}-${crypto.randomUUID()}`,
          merchantReference: invoiceId,
          amountMinor,
          currency,
          allocations: [{ invoiceId, amountMinor }],
          actor: actor.name,
          deviceId: terminalId,
          terminalReference: terminalId,
          ...(currencyEvidence ? { currencyEvidence } : {}),
          ...(reference ? { authorizationCode: reference } : {}),
        });
      }
      if (method.category === "BANK_TRANSFER") {
        return paymentOrchestrator.recordBankTransferPending(state, {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          paymentMethodId: method.id,
          ...(method.providerConnectionId
            ? { providerConnectionId: method.providerConnectionId }
            : {}),
          customerReference: reference ?? `${method.code}-${invoiceId}-${crypto.randomUUID()}`,
          merchantReference: invoiceId,
          amountMinor,
          currency,
          allocations: [{ invoiceId, amountMinor }],
          actor: actor.name,
          deviceId: terminalId,
          ...(currencyEvidence ? { currencyEvidence } : {}),
        });
      }
      if (method.category === "DIGITAL_WALLET") {
        if (!reference) throw new Error(`${method.displayName} requires a transaction reference`);
        return paymentOrchestrator.submitManualReference(state, {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          paymentMethodId: method.id,
          ...(method.providerConnectionId
            ? { providerConnectionId: method.providerConnectionId }
            : {}),
          customerReference: reference,
          merchantReference: invoiceId,
          amountMinor,
          currency,
          allocations: [{ invoiceId, amountMinor }],
          actor: actor.name,
          deviceId: terminalId,
          ...(currencyEvidence ? { currencyEvidence } : {}),
        });
      }
      if (method.category === "CREDIT") {
        if (!method.receivableAccountId || !method.metadata["revenueAccountId"]) {
          throw new Error("Credit payment method requires receivable and revenue account mappings");
        }
        if (!invoice.customerId) {
          throw new Error("A verified customer account is required for credit payment");
        }
        return paymentOrchestrator.chargeHouseAccount(state, {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          customerId: invoice.customerId,
          invoiceId,
          amountMinor,
          currency,
          receivableAccountId: method.receivableAccountId,
          revenueAccountId: String(method.metadata["revenueAccountId"]),
          actor: actor.name,
        });
      }
      throw new Error("Payment method has no configured collection workflow");
    }
    case "applyVoucherRedemption":
    case "applyGiftCardRedemption":
    case "applyLoyaltyReward":
      return paymentOrchestrator.recordAuthoritativeCustomerValue(
        state,
        input["input"] as Parameters<
          typeof paymentOrchestrator.recordAuthoritativeCustomerValue
        >[1],
      );
    case "applyReservationDeposit":
      return paymentOrchestrator.applyCustomerDeposit(
        state,
        input["input"] as Parameters<typeof paymentOrchestrator.applyCustomerDeposit>[1],
      );
    case "automaticPaymentMatching":
      return reconciliationEngine.automaticallyMatchPayments(
        state,
        input["input"] as Parameters<ReconciliationEngine["automaticallyMatchPayments"]>[1],
      );
    case "manualPaymentMatch":
      return reconciliationEngine.manuallyMatch(
        state,
        input["input"] as Parameters<ReconciliationEngine["manuallyMatch"]>[1],
      );
    case "resolveReconciliationException":
      return reconciliationEngine.resolveException(
        state,
        input["input"] as Parameters<ReconciliationEngine["resolveException"]>[1],
      );
    case "openPaymentDrawer":
      return paymentOrchestrator.openDrawer(
        state,
        input["input"] as Parameters<typeof paymentOrchestrator.openDrawer>[1],
      );
    case "closePaymentDrawer":
      return paymentOrchestrator.closeDrawer(
        state,
        input["input"] as Parameters<typeof paymentOrchestrator.closeDrawer>[1],
      );
    case "approveDrawerVariance":
      return paymentOrchestrator.approveDrawerVariance(
        state,
        input["input"] as Parameters<typeof paymentOrchestrator.approveDrawerVariance>[1],
      );
    case "importBankTransactions":
      return reconciliationEngine.importBankTransactions(
        state,
        input["input"] as Parameters<ReconciliationEngine["importBankTransactions"]>[1],
      );
    case "importSettlementBatches":
      return (
        input["inputs"] as Array<Parameters<ReconciliationEngine["importSettlement"]>[1]>
      ).reduce(
        (next, settlement) => reconciliationEngine.importSettlement(next, settlement).state,
        state,
      );
    case "matchSettlementToBank":
      return reconciliationEngine.matchSettlementToBank(
        state,
        input["input"] as Parameters<ReconciliationEngine["matchSettlementToBank"]>[1],
      );
    case "postSettlement":
      return reconciliationEngine.postSettlement(
        state,
        input["input"] as Parameters<ReconciliationEngine["postSettlement"]>[1],
      );
    case "prepareDayClose":
      return reconciliationEngine.prepareDayClose(
        state,
        input["input"] as Parameters<ReconciliationEngine["prepareDayClose"]>[1],
      );
    case "closeDay":
      return reconciliationEngine.closeDay(state, {
        ...(input["input"] as Parameters<ReconciliationEngine["closeDay"]>[1]),
        hasOverridePermission: actor.permissions.includes(permissions.reconciliationApprove),
      });
    case "reopenDay":
      return reconciliationEngine.reopenDay(state, {
        tenantId: actor.tenantId,
        dayCloseId: String(input["dayCloseId"]),
        actor: actor.name,
        reason: String(input["reason"] ?? ""),
      });
    case "recordPeriodClose": {
      const businessDate = String(input["businessDate"]);
      const prepared = reconciliationEngine.prepareDayClose(state, {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        businessDate,
        actor: actor.name,
      });
      const dayClose = prepared.paymentOperations?.dayCloses.find(
        (candidate) =>
          candidate.tenantId === actor.tenantId &&
          candidate.branchId === actor.branchId &&
          candidate.businessDate === businessDate,
      );
      if (!dayClose) throw new Error("Day close could not be prepared");
      const closed = reconciliationEngine.closeDay(prepared, {
        tenantId: actor.tenantId,
        dayCloseId: dayClose.id,
        actor: actor.name,
        hasOverridePermission: actor.permissions.includes(permissions.reconciliationApprove),
      });
      return {
        ...closed,
        auditEvents: [
          {
            id: `AUD-DAY-CLOSE-${crypto.randomUUID()}`,
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            time: new Date().toISOString(),
            actor: actor.name,
            role: actor.role,
            branch: actor.branch,
            module: "Period Close",
            action: "Closed trading day",
            record: businessDate,
            before: "Trading day open",
            after: "Day-end checks complete and manager sign-off recorded",
          },
          ...closed.auditEvents,
        ],
      };
    }
    case "recordReceiptReprint": {
      const receiptId = String(input["receiptId"]);
      const timestamp = new Date().toISOString();
      return {
        ...state,
        receipts: state.receipts.map((receipt) =>
          receipt.id === receiptId
            ? {
                ...receipt,
                reprints: [
                  {
                    requestedBy: actor.name,
                    approvedBy: actor.name,
                    reason: String(input["reason"] ?? "Authorized reprint"),
                    timestamp,
                  },
                  ...receipt.reprints,
                ],
              }
            : receipt,
        ),
      };
    }
    default:
      throw new Error(`Unsupported mutation ${action}`);
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
