import type { TransactionState } from "@/lib/transaction-engine";
import { parseMajorAmount } from "@/payments/money";
import type { PaymentOperationsState, PaymentTransaction } from "@/payments/types";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export function emptyPaymentOperationsState(): PaymentOperationsState {
  return {
    schemaVersion: 1,
    accounts: [],
    intents: [],
    transactions: [],
    allocations: [],
    collections: [],
    drawerSessions: [],
    cashMovements: [],
    bankTransactions: [],
    settlementBatches: [],
    settlementLines: [],
    reconciliationSessions: [],
    matches: [],
    exceptions: [],
    refunds: [],
    disputes: [],
    journals: [],
    dayCloses: [],
    storedValueAccounts: [],
    customerAccounts: [],
    customerAccountEntries: [],
    auditEvents: [],
    fraudFlags: [],
  };
}

export function normalizePaymentOperations(
  state: TransactionState,
  tenantId: string,
): PaymentOperationsState {
  const source = state.paymentOperations;
  const normalized = source
    ? {
        ...emptyPaymentOperationsState(),
        ...structuredClone(source),
        schemaVersion: 1 as const,
      }
    : emptyPaymentOperationsState();
  const currency = configuredCurrency(tenantId);
  for (const drawer of normalized.drawerSessions) {
    drawer.baseCurrency ??= currency ?? "XXX";
    drawer.currencyBalances ??= {
      [drawer.baseCurrency]: {
        openingFloatMinor: drawer.openingFloatMinor,
        expectedCashMinor: drawer.expectedCashMinor,
        ...(drawer.countedCashMinor === undefined
          ? {}
          : { countedCashMinor: drawer.countedCashMinor }),
        ...(drawer.varianceMinor === undefined ? {} : { varianceMinor: drawer.varianceMinor }),
      },
    };
  }
  const migratedDrawerIds = new Set(normalized.drawerSessions.map((drawer) => drawer.id));
  for (const legacy of state.cashDrawers ?? []) {
    if (!currency) continue;
    const id = `MIGRATED-${legacy.id}`;
    if (migratedDrawerIds.has(id)) continue;
    const expectedCashMinor = parseMajorAmount(legacy.expectedDrawer, currency);
    normalized.drawerSessions.push({
      id,
      tenantId: legacy.tenantId ?? tenantId,
      branchId: legacy.branchId ?? "legacy-branch",
      employeeId: legacy.cashier,
      baseCurrency: currency,
      openedAt: legacy.openedAt,
      openingFloatMinor: parseMajorAmount(legacy.openingCash, currency),
      ...(legacy.closedAt ? { closedAt: legacy.closedAt } : {}),
      expectedCashMinor,
      ...(legacy.physicalCount === undefined
        ? {}
        : { countedCashMinor: parseMajorAmount(legacy.physicalCount, currency) }),
      ...(legacy.variance === undefined
        ? {}
        : { varianceMinor: parseMajorAmount(legacy.variance, currency) }),
      status:
        legacy.status === "OPEN"
          ? "OPEN"
          : legacy.status === "APPROVED"
            ? "APPROVED"
            : legacy.status === "VARIANCE_REVIEW"
              ? "REVIEW_REQUIRED"
              : "CLOSED",
      ...(legacy.supervisor ? { approvedBy: legacy.supervisor } : {}),
      currencyBalances: {
        [currency]: {
          openingFloatMinor: parseMajorAmount(legacy.openingCash, currency),
          expectedCashMinor,
          ...(legacy.physicalCount === undefined
            ? {}
            : { countedCashMinor: parseMajorAmount(legacy.physicalCount, currency) }),
          ...(legacy.variance === undefined
            ? {}
            : { varianceMinor: parseMajorAmount(legacy.variance, currency) }),
        },
      },
      createdAt: legacy.openedAt,
      updatedAt: legacy.closedAt ?? legacy.openedAt,
    });
  }

  const migratedIds = new Set(normalized.transactions.map((item) => item.id));
  const projectedLegacyIds = new Set(
    normalized.transactions
      .map((item) => item.metadata["legacyPaymentId"])
      .filter((value): value is string => typeof value === "string"),
  );
  for (const legacy of state.payments ?? []) {
    const migratedId = `MIGRATED-${legacy.id}`;
    if (migratedIds.has(migratedId) || projectedLegacyIds.has(legacy.id)) continue;
    const transaction: PaymentTransaction = Object.freeze({
      id: migratedId,
      tenantId: legacy.tenantId ?? tenantId,
      branchId: legacy.branchId ?? "legacy-branch",
      paymentMethodId: legacy.method,
      direction: "COLLECTION",
      amountMinor: parseMajorAmount(legacy.amount, legacy.currency),
      unallocatedAmountMinor: 0,
      currency: legacy.currency,
      status: "CONFIRMED",
      ...(legacy.externalTransactionId
        ? { providerTransactionId: legacy.externalTransactionId }
        : {}),
      customerReference: legacy.reference,
      merchantReference: legacy.invoiceId,
      occurredAt: legacy.timestamp,
      confirmedAt: legacy.timestamp,
      createdAt: legacy.timestamp,
      createdBy: legacy.cashier,
      deviceId: legacy.terminal,
      metadata: Object.freeze({ migratedFrom: legacy.id }),
    });
    normalized.transactions.push(transaction);
    normalized.allocations.push(
      Object.freeze({
        id: `MIGRATED-ALLOC-${legacy.id}`,
        tenantId: transaction.tenantId,
        branchId: transaction.branchId,
        paymentTransactionId: transaction.id,
        invoiceId: legacy.invoiceId,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        createdAt: transaction.createdAt,
        createdBy: transaction.createdBy,
      }),
    );
  }
  return normalized;
}

function configuredCurrency(tenantId: string) {
  try {
    return getConfigurationRepository().getTenant(tenantId).defaultCurrency;
  } catch {
    return undefined;
  }
}
