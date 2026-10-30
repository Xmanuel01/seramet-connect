import { directPaymentByReceipt, openBalanceMinor } from "@/payments/mpesa-matching";
import {
  TransactionEngine,
  createEmptyTransactionState,
  normalizeTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import { paymentOrchestrator } from "@/payments/payment-orchestrator";
import { custodyLedger } from "@/payments/custody-ledger";
import { ReconciliationEngine } from "@/payments/reconciliation-engine";
import { SettlementService } from "@/payments/settlement-service";
import {
  closeBusinessDay,
  closeCashierShift,
  closeCompatibleDrawer,
  configureClosing,
  type DrawerCount,
  type ClosingMode,
} from "@/payments/daily-closing";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { formatMinor, parseMajorAmount } from "@/payments/money";

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
    case "configureDailyClosing":
      return configureClosing(
        state,
        actor,
        input as {
          branchId: string;
          mode: ClosingMode;
          materialVarianceMinor: number;
          recipientUserIds: string[];
        },
      );
    case "closeCashierShift":
      return closeCashierShift(state, actor, input as DrawerCount);
    case "closeBusinessDay":
      return closeBusinessDay(
        state,
        actor,
        input as { businessDate: string; drawerCounts: DrawerCount[]; confirmed: boolean },
      );
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
    case "claimKitchenPrintObligations":
      return TransactionEngine.claimKitchenPrintObligations(
        state,
        Array.isArray(input["obligationIds"]) ? input["obligationIds"].map(String) : [],
        actor.branchId ?? "",
        actor.id,
        String(input["claimToken"] ?? ""),
      );
    case "claimKitchenPrintObligation":
      return TransactionEngine.claimKitchenPrintObligation(
        state,
        String(input["obligationId"]),
        actor.branchId ?? "",
        actor.id,
        String(input["claimToken"] ?? ""),
      );
    case "settleKitchenPrintObligation":
      return TransactionEngine.settleKitchenPrintObligation(
        state,
        String(input["obligationId"]),
        actor.branchId ?? "",
        actor.id,
        String(input["claimToken"] ?? ""),
        String(input["outcome"]) as "BRIDGE_ACCEPTED" | "UNCERTAIN",
        typeof input["failureReason"] === "string" ? input["failureReason"] : undefined,
      );
    case "requestKitchenReprint":
      return TransactionEngine.requestKitchenReprint(
        state,
        String(input["obligationId"]),
        actor.branchId ?? "",
        actor.id,
        String(input["reason"] ?? ""),
      );
    case "reviewKitchenPrintObligation":
      return TransactionEngine.reviewKitchenPrintObligation(
        state,
        String(input["obligationId"]),
        actor.branchId ?? "",
        actor.id,
        String(input["decision"]) as "CONFIRM_DELIVERED" | "RETRY",
        String(input["reason"] ?? ""),
      );
    case "amendKitchenOrder": {
      const orderId = String(input["orderId"]);
      const draft = input["draft"] as Parameters<typeof TransactionEngine.amendKitchenOrder>[2];
      return TransactionEngine.amendKitchenOrder(state, orderId, draft, actor.name);
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
    case "recallProductionStation":
      return TransactionEngine.recallProductionStation(
        state,
        String(input["orderId"]),
        String(input["station"]),
        String(input["reason"] ?? ""),
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
    case "assignDeliveryRider": {
      const orderId = String(input["orderId"]);
      const riderName = String(input["rider"]).trim();
      const assigned = TransactionEngine.assignDeliveryRider(state, orderId, riderName, actor.name);
      const rider = assigned.employees.find(
        (candidate) =>
          candidate.tenantId === actor.tenantId &&
          candidate.role === "Rider" &&
          candidate.name === riderName,
      );
      return custodyLedger.assignRider(assigned, {
        tenantId: actor.tenantId,
        orderId,
        ...(rider?.id ? { riderId: rider.id } : {}),
        riderName,
      });
    }
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
      const cancelled = TransactionEngine.cancelOrder(state, orderId, {
        user: actor.name,
        reason,
        affectedItems: order.lines
          .filter((line) => line.productionStatus !== "CANCELLED")
          .map((line) => line.name),
      });
      return custodyLedger.cancelObligation(cancelled, {
        tenantId: actor.tenantId,
        orderId,
        actor: actor.name,
        reason,
      });
    }
    case "requestRefund": {
      const requested = input["input"] as Parameters<typeof TransactionEngine.requestRefund>[1];
      return TransactionEngine.requestRefund(state, {
        ...requested,
        requestedBy: actor.name,
        requestedById: actor.id,
      });
    }
    case "approveRefund":
      return TransactionEngine.approveRefund(state, String(input["refundId"]), actor.name);
    case "rejectRefund":
      return TransactionEngine.rejectRefund(
        state,
        String(input["refundId"]),
        actor.name,
        String(input["reason"] ?? ""),
      );
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
    case "closeCashDrawer": {
      const normalized = normalizeTransactionState(state);
      const legacy = normalized.cashDrawers.find(
        (d) =>
          d.id === input["drawerId"] &&
          d.branchId === actor.branchId &&
          d.tenantId === actor.tenantId,
      );
      if (!legacy) throw new Error("Cash drawer was not found in the active branch");
      const currency = getConfigurationRepository().getTenant(actor.tenantId).defaultCurrency;
      return closeCompatibleDrawer(
        normalized,
        actor,
        {
          drawerSessionId: `MIGRATED-${legacy.id}`,
          countedByCurrency: {
            [currency]: parseMajorAmount(input["physicalCount"] as string | number, currency),
          },
          varianceReason: String(input["varianceReason"] ?? ""),
        },
        input["confirmed"] === true,
      );
    }
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
        // The customer may already have paid the till: its receipt is proof, so apply it now.
        const received = method.providerConnectionId
          ? directPaymentByReceipt(state, actor.tenantId, reference, method.providerConnectionId)
          : undefined;
        if (received) {
          if (received.unallocatedAmountMinor === 0)
            throw new Error(`M-Pesa receipt ${reference} has already been used`);
          if (received.unallocatedAmountMinor < amountMinor)
            throw new Error(
              `M-Pesa receipt ${reference} has ${formatMinor(received.unallocatedAmountMinor, received.currency)} left; record the rest separately`,
            );
          return paymentOrchestrator.applyUnallocatedCollection(state, {
            tenantId: actor.tenantId,
            transactionId: received.id,
            allocations: [{ invoiceId, amountMinor }],
            actor: actor.name,
            matchedBy: "RECEIPT_CODE",
            deviceId: terminalId,
          });
        }
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
    case "upsertReconciliationRule":
      return reconciliationEngine.upsertRule(
        state,
        input["input"] as Parameters<ReconciliationEngine["upsertRule"]>[1],
      );
    case "setReconciliationRuleActive":
      return reconciliationEngine.setRuleActive(
        state,
        input["input"] as Parameters<ReconciliationEngine["setRuleActive"]>[1],
      );
    case "recordRiderCollection": {
      const requested = input["input"] as Record<string, unknown>;
      const obligationId = String(requested["obligationId"] ?? "");
      const amountMinor = Number(requested["amountMinor"]);
      const tender = String(requested["tender"] ?? "CASH").toUpperCase();
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new Error("Rider collection amount must be a positive integer in minor units");
      }
      if (!["CASH", "MOBILE_MONEY", "BANK", "OTHER"].includes(tender)) {
        throw new Error("Unsupported rider collection tender");
      }
      const operations = state.paymentOperations;
      const obligation = operations?.custodyObligations.find(
        (candidate) => candidate.id === obligationId && candidate.tenantId === actor.tenantId,
      );
      if (!obligation) throw new Error("Rider custody obligation was not found");
      if (!obligation.custodyAccountId) {
        throw new Error("Configure the rider custody account before recording collection");
      }
      const reference =
        typeof requested["reference"] === "string" ? requested["reference"].trim() : "";
      if (tender !== "CASH" && !reference) {
        throw new Error("A transaction reference is required for non-cash rider collection");
      }

      const configuration = getConfigurationRepository();
      const requestedMethod = String(requested["paymentMethodId"] ?? "");
      const method = configuration
        .listPaymentMethods(actor.tenantId, false)
        .find((candidate) =>
          requestedMethod
            ? candidate.id === requestedMethod || candidate.code === requestedMethod
            : tender === "CASH"
              ? candidate.enabled && candidate.category === "CASH"
              : candidate.enabled &&
                ["DIGITAL_WALLET", "BANK_TRANSFER"].includes(candidate.category),
        );
      if (!method?.enabled) {
        throw new Error("No enabled payment method is configured for this rider collection");
      }

      let remaining = amountMinor;
      const merchantRemaining = Math.max(
        0,
        obligation.merchantAmountDueMinor - obligation.merchantCollectedMinor,
      );
      const merchantAppliedMinor = Math.min(remaining, merchantRemaining);
      remaining -= merchantAppliedMinor;
      const feeRemaining = Math.max(
        0,
        obligation.marketplaceFeeDueMinor - obligation.marketplaceFeeCollectedMinor,
      );
      const marketplaceFeeAppliedMinor = Math.min(remaining, feeRemaining);
      remaining -= marketplaceFeeAppliedMinor;
      const suspenseRemaining = Math.max(
        0,
        obligation.unclassifiedDueMinor - obligation.unclassifiedCollectedMinor,
      );
      const unclassifiedAppliedMinor = Math.min(remaining, suspenseRemaining);
      remaining -= unclassifiedAppliedMinor;
      if (remaining !== 0) {
        throw new Error("Collection exceeds the remaining classified cash-due obligation");
      }

      let next = state;
      let paymentTransactionId: string | undefined;
      if (merchantAppliedMinor > 0) {
        const receivable = state.marketplaceReceivables.find(
          (candidate) =>
            candidate.orderId === obligation.orderId &&
            candidate.tenantId === actor.tenantId &&
            candidate.status !== "CANCELLED",
        );
        if (!receivable) {
          throw new Error("Marketplace receivable was not found for the cash-due order");
        }
        const before = new Set(
          next.paymentOperations?.transactions.map((transaction) => transaction.id) ?? [],
        );
        next = paymentOrchestrator.recordCustodyCollection(next, {
          tenantId: actor.tenantId,
          branchId: obligation.branchId,
          paymentMethodId: method.id,
          merchantReference: obligation.externalOrderId ?? obligation.orderId,
          amountMinor: merchantAppliedMinor,
          currency: obligation.currency,
          custodyAccountId: obligation.custodyAccountId,
          collectionCreditAccountId: receivable.receivableAccount,
          actor: actor.name,
          ...(reference ? { reference } : {}),
          ...(requested["occurredAt"] ? { occurredAt: String(requested["occurredAt"]) } : {}),
        });
        paymentTransactionId = next.paymentOperations?.transactions.find(
          (transaction) => !before.has(transaction.id),
        )?.id;
      }

      return custodyLedger.recordCustomerCollection(next, {
        tenantId: actor.tenantId,
        obligationId,
        amountMinor,
        merchantAppliedMinor,
        marketplaceFeeAppliedMinor,
        unclassifiedAppliedMinor,
        tender: tender as "CASH" | "MOBILE_MONEY" | "BANK" | "OTHER",
        actor: actor.name,
        ...(obligation.riderId ? { riderId: obligation.riderId } : {}),
        ...(obligation.riderName ? { riderName: obligation.riderName } : {}),
        ...(paymentTransactionId ? { paymentTransactionId } : {}),
        ...(reference ? { reference } : {}),
        ...(requested["occurredAt"] ? { occurredAt: String(requested["occurredAt"]) } : {}),
      });
    }
    case "recordDirectCompanyCollection": {
      const requested = input["input"] as Record<string, unknown>;
      const obligationId = String(requested["obligationId"] ?? "");
      const amountMinor = Number(requested["amountMinor"]);
      const paymentMethodId = String(requested["paymentMethodId"] ?? "");
      const reference =
        typeof requested["reference"] === "string"
          ? requested["reference"].trim().toUpperCase()
          : "";
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new Error("Direct collection amount must be a positive integer in minor units");
      }
      if (!reference) throw new Error("Company collection requires a transaction reference");

      const operations = state.paymentOperations;
      const obligation = operations?.custodyObligations.find(
        (candidate) => candidate.id === obligationId && candidate.tenantId === actor.tenantId,
      );
      if (!obligation) throw new Error("Cash-due obligation was not found");

      const configuration = getConfigurationRepository();
      const method = configuration
        .listPaymentMethods(actor.tenantId, false)
        .find(
          (candidate) => candidate.id === paymentMethodId || candidate.code === paymentMethodId,
        );
      if (!method?.enabled || !["DIGITAL_WALLET", "BANK_TRANSFER"].includes(method.category)) {
        throw new Error("Choose an enabled company Till or bank payment method");
      }
      const destinationAccountId = method.clearingAccountId ?? method.settlementAccountId;
      if (!destinationAccountId) {
        throw new Error(
          "Company collection payment method requires a clearing or settlement account",
        );
      }

      let remaining = amountMinor;
      const merchantRemaining = Math.max(
        0,
        obligation.merchantAmountDueMinor - obligation.merchantCollectedMinor,
      );
      const merchantAppliedMinor = Math.min(remaining, merchantRemaining);
      remaining -= merchantAppliedMinor;
      const feeRemaining = Math.max(
        0,
        obligation.marketplaceFeeDueMinor - obligation.marketplaceFeeCollectedMinor,
      );
      const marketplaceFeeAppliedMinor = Math.min(remaining, feeRemaining);
      remaining -= marketplaceFeeAppliedMinor;
      const suspenseRemaining = Math.max(
        0,
        obligation.unclassifiedDueMinor - obligation.unclassifiedCollectedMinor,
      );
      const unclassifiedAppliedMinor = Math.min(remaining, suspenseRemaining);
      remaining -= unclassifiedAppliedMinor;
      if (remaining !== 0) {
        throw new Error("Collection exceeds the remaining classified cash-due obligation");
      }

      let next = state;
      let paymentTransactionId: string | undefined;
      if (merchantAppliedMinor > 0) {
        const receivable = state.marketplaceReceivables.find(
          (candidate) =>
            candidate.orderId === obligation.orderId &&
            candidate.tenantId === actor.tenantId &&
            candidate.status !== "CANCELLED",
        );
        if (!receivable) {
          throw new Error("Marketplace receivable was not found for the cash-due order");
        }
        const before = new Set(
          next.paymentOperations?.transactions.map((transaction) => transaction.id) ?? [],
        );
        next = paymentOrchestrator.recordCustodyCollection(next, {
          tenantId: actor.tenantId,
          branchId: obligation.branchId,
          paymentMethodId: method.id,
          merchantReference: obligation.externalOrderId ?? obligation.orderId,
          amountMinor: merchantAppliedMinor,
          currency: obligation.currency,
          custodyAccountId: destinationAccountId,
          collectionCreditAccountId: receivable.receivableAccount,
          collectionPurpose: "DIRECT_COMPANY_COLLECTION",
          actor: actor.name,
          reference,
          ...(requested["occurredAt"] ? { occurredAt: String(requested["occurredAt"]) } : {}),
        });
        paymentTransactionId = next.paymentOperations?.transactions.find(
          (transaction) => !before.has(transaction.id),
        )?.id;
      }

      return custodyLedger.recordDirectCompanyCollection(next, {
        tenantId: actor.tenantId,
        obligationId,
        amountMinor,
        merchantAppliedMinor,
        marketplaceFeeAppliedMinor,
        unclassifiedAppliedMinor,
        tender: method.category === "BANK_TRANSFER" ? "BANK" : "MOBILE_MONEY",
        toHolder: method.category === "BANK_TRANSFER" ? "BANK" : "MOBILE_MONEY_TILL",
        destinationAccountId,
        actor: actor.name,
        ...(paymentTransactionId ? { paymentTransactionId } : {}),
        reference,
        ...(requested["occurredAt"] ? { occurredAt: String(requested["occurredAt"]) } : {}),
      });
    }
    case "recordRiderBatchRemittance": {
      const requested = input["input"] as Record<string, unknown>;
      const riderName = String(requested["riderName"] ?? "").trim();
      const amountMinor = Number(requested["amountMinor"]);
      const toHolder = String(requested["toHolder"] ?? "").toUpperCase();
      const tender = String(requested["tender"] ?? "CASH").toUpperCase();
      const destinationAccountId = String(requested["destinationAccountId"] ?? "").trim();
      const reference =
        typeof requested["reference"] === "string"
          ? requested["reference"].trim().toUpperCase()
          : "";
      if (!riderName) throw new Error("Rider name is required");
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new Error("Remittance amount must be a positive integer in minor units");
      }
      if (!["CASH_DRAWER", "MOBILE_MONEY_TILL", "BANK"].includes(toHolder)) {
        throw new Error("Unsupported rider remittance destination");
      }
      if (!["CASH", "MOBILE_MONEY", "BANK"].includes(tender)) {
        throw new Error("Unsupported rider remittance tender");
      }
      if (!destinationAccountId) throw new Error("Destination account is required");
      if (tender !== "CASH" && !reference) {
        throw new Error("A transaction reference is required for non-cash remittance");
      }

      const operations = state.paymentOperations;
      if (!operations) throw new Error("Payment operations state was not initialized");
      const destination = operations.accounts.find(
        (account) =>
          account.id === destinationAccountId &&
          account.tenantId === actor.tenantId &&
          account.active &&
          (!account.branchId || account.branchId === actor.branchId),
      );
      if (!destination)
        throw new Error("Destination payment account is unavailable for this branch");
      const expectedAccountType =
        toHolder === "CASH_DRAWER"
          ? "CASH"
          : toHolder === "MOBILE_MONEY_TILL"
            ? "MOBILE_MONEY"
            : "BANK";
      if (destination.type !== expectedAccountType) {
        throw new Error(`Remittance destination must use a ${expectedAccountType} account`);
      }

      const obligations = operations.custodyObligations
        .filter(
          (obligation) =>
            obligation.tenantId === actor.tenantId &&
            obligation.branchId === actor.branchId &&
            obligation.riderName === riderName &&
            !["CANCELLED", "DISPUTED", "REMITTED"].includes(obligation.status) &&
            obligation.collectedMinor > obligation.remittedMinor,
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        );
      const totalOutstanding = obligations.reduce(
        (sum, obligation) => sum + (obligation.collectedMinor - obligation.remittedMinor),
        0,
      );
      if (amountMinor > totalOutstanding) {
        throw new Error("Remittance exceeds rider-held funds");
      }

      let next = state;
      let remaining = amountMinor;
      for (const obligation of obligations) {
        if (remaining <= 0) break;
        const current = next.paymentOperations?.custodyObligations.find(
          (candidate) => candidate.id === obligation.id,
        );
        if (!current) continue;
        const outstanding = Math.max(0, current.collectedMinor - current.remittedMinor);
        const allocated = Math.min(remaining, outstanding);
        if (allocated <= 0) continue;
        next = custodyLedger.recordRemittance(next, {
          tenantId: actor.tenantId,
          obligationId: current.id,
          amountMinor: allocated,
          tender: tender as "CASH" | "MOBILE_MONEY" | "BANK",
          toHolder: toHolder as "CASH_DRAWER" | "MOBILE_MONEY_TILL" | "BANK",
          destinationAccountId,
          actor: actor.name,
          ...(reference ? { reference } : {}),
          ...(requested["occurredAt"] ? { occurredAt: String(requested["occurredAt"]) } : {}),
        });
        remaining -= allocated;
      }
      if (remaining !== 0) throw new Error("Rider remittance could not be fully allocated");
      return next;
    }
    case "recordRiderRemittance": {
      const requested = input["input"] as Record<string, unknown>;
      const toHolder = String(requested["toHolder"] ?? "").toUpperCase();
      if (!["CASH_DRAWER", "MOBILE_MONEY_TILL", "BANK", "OTHER"].includes(toHolder)) {
        throw new Error("Unsupported custody remittance destination");
      }
      return custodyLedger.recordRemittance(state, {
        tenantId: actor.tenantId,
        obligationId: String(requested["obligationId"] ?? ""),
        amountMinor: Number(requested["amountMinor"]),
        tender: String(requested["tender"] ?? "CASH").toUpperCase() as
          "CASH" | "MOBILE_MONEY" | "BANK" | "OTHER",
        toHolder: toHolder as "CASH_DRAWER" | "MOBILE_MONEY_TILL" | "BANK" | "OTHER",
        destinationAccountId: String(requested["destinationAccountId"] ?? ""),
        actor: actor.name,
        ...(requested["reference"] ? { reference: String(requested["reference"]) } : {}),
        ...(requested["occurredAt"] ? { occurredAt: String(requested["occurredAt"]) } : {}),
      });
    }
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
    case "applyUnallocatedPayment": {
      // A person confirms which bill a payment that arrived without a prompt belongs to.
      const transactionId = String(input["transactionId"] ?? "");
      const invoiceId = String(input["invoiceId"] ?? "");
      const normalized = normalizeTransactionState(state);
      const payment = normalized.paymentOperations?.transactions.find(
        (item) => item.id === transactionId && item.tenantId === actor.tenantId,
      );
      if (!payment) throw new Error("Payment was not found");
      if (payment.branchId !== actor.branchId)
        throw new Error("Switch to the payment's branch to apply it");
      const bill = normalized.bills.find(
        (item) => item.id === invoiceId && (item.tenantId ?? actor.tenantId) === actor.tenantId,
      );
      if (!bill) throw new Error("Bill was not found");
      const requested = Number(input["amountMinor"] ?? 0);
      const amountMinor =
        requested > 0
          ? requested
          : Math.min(payment.unallocatedAmountMinor, openBalanceMinor(bill, payment.currency));
      return paymentOrchestrator.applyUnallocatedCollection(normalized, {
        tenantId: actor.tenantId,
        transactionId,
        allocations: [{ invoiceId, amountMinor }],
        actor: actor.name,
        matchedBy: "CASHIER_CONFIRMED",
      });
    }
    case "resolveReconciliationException":
      return reconciliationEngine.resolveException(
        state,
        input["input"] as Parameters<ReconciliationEngine["resolveException"]>[1],
      );
    case "openPaymentDrawer": {
      const requested = input["input"] as Parameters<typeof paymentOrchestrator.openDrawer>[1];
      if (requested.tenantId !== actor.tenantId || requested.branchId !== actor.branchId)
        throw new Error("Cash drawer must belong to the active tenant and branch");
      if (
        requested.employeeId !== actor.id &&
        !actor.permissions.includes(permissions.reconciliationApprove)
      )
        throw new Error("Cannot open another cashier's drawer");
      return paymentOrchestrator.openDrawer(state, { ...requested, actor: actor.id });
    }
    case "closePaymentDrawer": {
      const requested = input["input"] as Parameters<typeof paymentOrchestrator.closeDrawer>[1] & {
        confirmed?: boolean;
        varianceReason?: string;
      };
      const drawer = state.paymentOperations?.drawerSessions.find(
        (d) =>
          d.id === requested.drawerSessionId &&
          d.branchId === actor.branchId &&
          d.tenantId === actor.tenantId,
      );
      if (!drawer || requested.tenantId !== actor.tenantId)
        throw new Error("Cash drawer was not found in the active branch");
      return closeCompatibleDrawer(
        state,
        actor,
        {
          drawerSessionId: drawer.id,
          countedByCurrency: {
            ...requested.countedByCurrency,
            [drawer.baseCurrency]: requested.countedCashMinor,
          },
          varianceReason: requested.varianceReason,
        },
        requested.confirmed === true,
      );
    }
    case "approveDrawerVariance": {
      const requested = input["input"] as Parameters<
        typeof paymentOrchestrator.approveDrawerVariance
      >[1];
      if (
        requested.tenantId !== actor.tenantId ||
        !actor.permissions.includes(permissions.cashAdjust) ||
        !actor.permissions.includes(permissions.reconciliationApprove) ||
        !state.paymentOperations?.drawerSessions.some(
          (d) =>
            d.id === requested.drawerSessionId &&
            d.branchId === actor.branchId &&
            d.tenantId === actor.tenantId,
        )
      )
        throw new Error("Supervisor variance approval is required in the active branch");
      return paymentOrchestrator.approveDrawerVariance(state, {
        ...requested,
        approvedBy: actor.id,
      });
    }
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
    case "closeDay": {
      const requested = input["input"] as {
        dayCloseId: string;
        confirmed?: boolean;
        drawerCounts?: DrawerCount[];
      };
      const day = state.paymentOperations?.dayCloses.find(
        (d) =>
          d.id === requested.dayCloseId &&
          d.branchId === actor.branchId &&
          d.tenantId === actor.tenantId,
      );
      if (!day) throw new Error("Day close was not found in the active branch");
      return closeBusinessDay(state, actor, {
        businessDate: day.businessDate,
        drawerCounts: requested.drawerCounts ?? [],
        confirmed: requested.confirmed === true,
      });
    }
    case "reopenDay":
      return reconciliationEngine.reopenDay(state, {
        tenantId: actor.tenantId,
        dayCloseId: String(input["dayCloseId"]),
        actor: actor.name,
        reason: String(input["reason"] ?? ""),
      });
    case "recordPeriodClose": {
      return closeBusinessDay(state, actor, {
        businessDate: String(input["businessDate"]),
        drawerCounts: (input["drawerCounts"] as DrawerCount[] | undefined) ?? [],
        confirmed: input["confirmed"] === true,
      });
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
