import {
  normalizeTransactionState,
  type BillingRecord,
  type TransactionState,
} from "@/lib/transaction-engine";
import { parseMajorAmount } from "@/payments/money";
import { paymentOrchestrator } from "@/payments/payment-orchestrator";
import {
  getConfigurationRepository,
  PlatformConfigurationError,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import type { PaymentMethodDefinition } from "@/platform/types";

export type SettlementInput = {
  tenantId: string;
  invoiceId: string;
  paymentMethodId: string;
  amount: number;
  reference?: string;
  cashier: string;
  deviceId?: string;
};

export type SettlementDisposition =
  "CONFIRMED" | "AWAITING_VERIFICATION" | "ON_ACCOUNT" | "PROVIDER_INITIATION_REQUIRED";

const compactCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export class SettlementService {
  constructor(private repository: ConfigurationRepository = getConfigurationRepository()) {}

  listMethods(tenantId: string) {
    return this.repository.listPaymentMethods(tenantId, true);
  }

  recommendMethod(tenantId: string, invoice: BillingRecord, state: TransactionState) {
    const methods = this.listMethods(tenantId);
    const order = state.orders.find((candidate) => invoice.orderIds.includes(candidate.id));
    const channel = order
      ? this.repository
          .listOrderChannels(tenantId, true)
          .find(
            (candidate) =>
              candidate.id === order.channel ||
              candidate.code === order.channel ||
              candidate.displayName === order.channel,
          )
      : undefined;
    if (channel?.isExternallyPaid) {
      return (
        methods.find(
          (method) => method.providerConnectionId === channel.deliveryProviderConnectionId,
        ) ?? methods.find((method) => method.category === "CREDIT")
      );
    }
    return (
      methods.find((method) => method.category === "DIGITAL_WALLET") ??
      methods.find((method) => method.category === "CASH") ??
      methods[0]
    );
  }

  disposition(method: PaymentMethodDefinition): SettlementDisposition {
    if (method.metadata["providerOperation"]) return "PROVIDER_INITIATION_REQUIRED";
    if (method.category === "CASH" || method.category === "CARD") return "CONFIRMED";
    if (method.category === "CREDIT") return "ON_ACCOUNT";
    return "AWAITING_VERIFICATION";
  }

  settle(state: TransactionState, input: SettlementInput) {
    const next = normalizeTransactionState(state);
    const invoice = next.bills.find(
      (candidate) => candidate.id === input.invoiceId && candidate.tenantId === input.tenantId,
    );
    if (!invoice) throw new PlatformConfigurationError("Invoice was not found");
    const method = this.listMethods(input.tenantId).find(
      (candidate) =>
        candidate.id === input.paymentMethodId || candidate.code === input.paymentMethodId,
    );
    if (!method) throw new PlatformConfigurationError("No active payment methods");
    if (input.amount <= 0) {
      throw new PlatformConfigurationError("Settlement amount must be positive");
    }
    if (method.requiresReference && !input.reference?.trim()) {
      throw new PlatformConfigurationError(`${method.displayName} requires a reference`);
    }
    if (method.metadata["providerOperation"]) {
      throw new PlatformConfigurationError(
        `${method.displayName} must be initiated through the secured provider payment endpoint`,
      );
    }

    const branch = invoice.branchId
      ? this.repository.getBranch(input.tenantId, invoice.branchId)
      : this.repository.resolveBranch(input.tenantId, invoice.branch);
    const tenant = this.repository.getTenant(input.tenantId);
    const currency = tenant.defaultCurrency;
    const outstanding = Math.max(0, invoice.total - invoice.paid);
    const allocatedMajor = Math.min(input.amount, outstanding);
    const amountMinor = parseMajorAmount(allocatedMajor, currency);
    const tenderedMinor = parseMajorAmount(input.amount, currency);
    const reference =
      input.reference?.trim().toUpperCase() ||
      `${compactCode(method.code)}-${invoice.id}-${Date.now()}`;
    const deviceId = input.deviceId ?? `${compactCode(branch.code)}-POS`;
    const allocation = [{ invoiceId: invoice.id, amountMinor }];

    if (method.category === "CASH") {
      const drawer = next.paymentOperations?.drawerSessions.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.branchId === branch.id &&
          candidate.status === "OPEN",
      );
      if (!drawer) {
        throw new PlatformConfigurationError("Open a cash drawer before collecting cash");
      }
      return paymentOrchestrator.recordCash(next, {
        tenantId: input.tenantId,
        branchId: branch.id,
        drawerSessionId: drawer.id,
        paymentMethodId: method.id,
        invoiceId: invoice.id,
        amountMinor,
        cashTenderedMinor: tenderedMinor,
        currency,
        actor: input.cashier,
        deviceId,
      });
    }

    if (method.category === "CARD") {
      return paymentOrchestrator.recordManualTerminalPayment(next, {
        tenantId: input.tenantId,
        branchId: branch.id,
        paymentMethodId: method.id,
        ...(method.providerConnectionId
          ? { providerConnectionId: method.providerConnectionId }
          : {}),
        customerReference: reference,
        merchantReference: invoice.id,
        amountMinor,
        currency,
        allocations: allocation,
        actor: input.cashier,
        deviceId,
        terminalReference: deviceId,
        authorizationCode: reference,
      });
    }

    if (method.category === "BANK_TRANSFER") {
      return paymentOrchestrator.recordBankTransferPending(next, {
        tenantId: input.tenantId,
        branchId: branch.id,
        paymentMethodId: method.id,
        ...(method.providerConnectionId
          ? { providerConnectionId: method.providerConnectionId }
          : {}),
        customerReference: reference,
        merchantReference: invoice.id,
        amountMinor,
        currency,
        allocations: allocation,
        actor: input.cashier,
        deviceId,
      });
    }

    if (method.category === "DIGITAL_WALLET") {
      return paymentOrchestrator.submitManualReference(next, {
        tenantId: input.tenantId,
        branchId: branch.id,
        paymentMethodId: method.id,
        ...(method.providerConnectionId
          ? { providerConnectionId: method.providerConnectionId }
          : {}),
        customerReference: reference,
        merchantReference: invoice.id,
        amountMinor,
        currency,
        allocations: allocation,
        actor: input.cashier,
        deviceId,
      });
    }

    if (method.category === "CREDIT") {
      const revenueAccountId = method.metadata["revenueAccountId"];
      if (!method.receivableAccountId || typeof revenueAccountId !== "string") {
        throw new PlatformConfigurationError(
          `${method.displayName} needs receivable and revenue account mappings`,
        );
      }
      return paymentOrchestrator.chargeHouseAccount(next, {
        tenantId: input.tenantId,
        branchId: branch.id,
        customerId: invoice.customer,
        invoiceId: invoice.id,
        amountMinor,
        currency,
        receivableAccountId: method.receivableAccountId,
        revenueAccountId,
        actor: input.cashier,
      });
    }

    throw new PlatformConfigurationError(
      `${method.displayName} needs a configured stored-value or provider handler`,
    );
  }
}

export const settlementReferenceLabel = (method: PaymentMethodDefinition) =>
  `${method.displayName} reference`;
