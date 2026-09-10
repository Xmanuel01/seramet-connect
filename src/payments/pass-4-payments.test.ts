import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPaymentProvider,
  testPaymentProviderDefinition,
} from "@/integrations/payments/test-provider";
import { createDarajaAdapter } from "@/integrations/payments/daraja/adapter";
import { createPesapalAdapter } from "@/integrations/payments/pesapal/adapter";
import { createTendePayAdapter } from "@/integrations/payments/tendepay/adapter";
import type { PaymentAdapterRuntime } from "@/integrations/payments/adapter-runtime";
import { ProviderRegistry } from "@/integrations/provider-registry";
import { StaticCredentialResolver } from "@/integrations/runtime/credential-resolver";
import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import {
  createIntegrationRepository,
  resetIntegrationMemoryForTests,
} from "@/integrations/runtime/integration-repository";
import { ProviderTokenService } from "@/integrations/runtime/token-service";
import type { ProviderExecutionContext, ProviderWebhookRequest } from "@/integrations/types";
import type { ServerActor } from "@/lib/seramet-auth";
import type {
  IdempotencyRecord,
  ProviderWebhookEvent,
  TransactionRepository,
} from "@/lib/seramet-repository";
import {
  createEmptyTransactionState,
  normalizeTransactionState,
  type BillingRecord,
  type MarketplaceReceivable,
  type TransactionState,
} from "@/lib/transaction-engine";
import { assertBalancedJournal } from "@/payments/accounting-posting";
import { buildCustomerStatement } from "@/payments/customer-account-service";
import { parseMajorAmount } from "@/payments/money";
import { PaymentOrchestrator } from "@/payments/payment-orchestrator";
import { ReconciliationEngine, businessDateFor } from "@/payments/reconciliation-engine";
import {
  genericBankStatementAdapter,
  genericSettlementAdapter,
  type NormalizedSettlementImport,
} from "@/payments/statement-adapters";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import type { IntegrationConnection } from "@/platform/types";

const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;
const currency = "KES";
const actor = "Pass 4 tester";
const orchestrator = new PaymentOrchestrator();
const reconciliation = new ReconciliationEngine();

beforeEach(() => {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  resetIntegrationMemoryForTests();
});

describe("Pass 4 payment domain acceptance", () => {
  it("AC 1-4 separates sale, intent, immutable transaction and many-to-many allocations", () => {
    let state = stateWithBills(2_000, 2_000);
    const created = orchestrator.createIntent(state, {
      tenantId,
      branchId,
      invoiceIds: ["INV-T-1", "INV-T-2"],
      paymentMethodId: "payment-demo-mpesa-till",
      amountRequestedMinor: kes(3_000),
      currency,
      createdBy: actor,
      idempotencyKey: "intent-many-to-many",
    });
    state = created.state;
    expect(state.bills.every((bill) => bill.paid === 0)).toBe(true);
    expect(created.intent.status).toBe("PENDING");
    state = orchestrator.confirmProviderCollection(state, {
      tenantId,
      branchId,
      intentId: created.intent.id,
      paymentMethodId: "payment-demo-mpesa-till",
      providerConnectionId: "connection-demo-daraja-wst",
      providerTransactionId: "MPESA-MULTI-001",
      merchantReference: "BATCH-001",
      amountMinor: kes(3_000),
      currency,
      allocations: [
        { invoiceId: "INV-T-1", amountMinor: kes(1_500) },
        { invoiceId: "INV-T-2", amountMinor: kes(1_500) },
      ],
      actor,
    });
    const transaction = state.paymentOperations!.transactions[0]!;
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(
      state.paymentOperations!.allocations.filter(
        (item) => item.paymentTransactionId === transaction.id,
      ),
    ).toHaveLength(2);
    expect(state.bills.map((bill) => bill.paymentStatus)).toEqual(["PARTIAL", "PARTIAL"]);
  });

  it("AC 5-6 supports split and partial payment without premature paid status", () => {
    let state = stateWithBills(4_000);
    state = orchestrator.openDrawer(state, {
      tenantId,
      branchId,
      employeeId: "cashier-1",
      openingFloatMinor: 0,
      currency,
      actor,
    });
    const drawerId = state.paymentOperations!.drawerSessions[0]!.id;
    state = orchestrator.recordCash(state, {
      tenantId,
      branchId,
      drawerSessionId: drawerId,
      paymentMethodId: "payment-demo-cash",
      invoiceId: "INV-T-1",
      amountMinor: kes(1_000),
      cashTenderedMinor: kes(1_000),
      currency,
      actor,
    });
    expect(state.bills[0]).toMatchObject({ paid: 1_000, paymentStatus: "PARTIAL" });
    state = orchestrator.confirmProviderCollection(state, {
      tenantId,
      branchId,
      paymentMethodId: "payment-demo-mpesa-till",
      providerConnectionId: "connection-demo-daraja-wst",
      providerTransactionId: "MPESA-SPLIT-001",
      merchantReference: "INV-T-1",
      amountMinor: kes(3_000),
      currency,
      allocations: [{ invoiceId: "INV-T-1", amountMinor: kes(3_000) }],
      actor,
    });
    expect(state.bills[0]).toMatchObject({ paid: 4_000, paymentStatus: "PAID" });
    expect(state.receipts.filter((receipt) => receipt.invoiceId === "INV-T-1")).toHaveLength(1);
    expect(state.paymentOperations!.allocations).toHaveLength(2);
  });

  it("retains overpayments as an explicit unallocated balance", () => {
    let state = stateWithBills(2_000);
    state = orchestrator.confirmProviderCollection(state, {
      tenantId,
      branchId,
      paymentMethodId: "payment-demo-mpesa-till",
      providerConnectionId: "connection-demo-daraja-wst",
      providerTransactionId: "MPESA-OVERPAY-001",
      merchantReference: "INV-T-1",
      amountMinor: kes(2_500),
      currency,
      allocations: [{ invoiceId: "INV-T-1", amountMinor: kes(2_000) }],
      actor,
    });
    expect(state.bills[0]).toMatchObject({ paid: 2_000, paymentStatus: "PAID" });
    expect(state.paymentOperations!.transactions[0]!.unallocatedAmountMinor).toBe(kes(500));
  });

  it("AC 7-8 records tender, change, explicit movements and drawer variance", () => {
    let state = stateWithBills(1_450);
    state = orchestrator.openDrawer(state, {
      tenantId,
      branchId,
      employeeId: "cashier-2",
      openingFloatMinor: kes(200),
      currency,
      actor,
    });
    const drawerId = state.paymentOperations!.drawerSessions[0]!.id;
    state = orchestrator.recordCash(state, {
      tenantId,
      branchId,
      drawerSessionId: drawerId,
      paymentMethodId: "payment-demo-cash",
      invoiceId: "INV-T-1",
      amountMinor: kes(1_450),
      cashTenderedMinor: kes(2_000),
      currency,
      actor,
    });
    expect(state.paymentOperations!.transactions[0]!.metadata).toMatchObject({
      cashTenderedMinor: kes(2_000),
      changeGivenMinor: kes(550),
    });
    expect(state.paymentOperations!.drawerSessions[0]!.expectedCashMinor).toBe(kes(1_650));
    expect(state.paymentOperations!.cashMovements.map((item) => item.type)).toEqual([
      "SALE",
      "OPENING_FLOAT",
    ]);
    state = orchestrator.closeDrawer(state, {
      tenantId,
      drawerSessionId: drawerId,
      countedCashMinor: kes(1_600),
      actor,
    });
    expect(state.paymentOperations!.drawerSessions[0]).toMatchObject({
      varianceMinor: -kes(50),
      status: "REVIEW_REQUIRED",
    });
    state = orchestrator.approveDrawerVariance(state, {
      tenantId,
      drawerSessionId: drawerId,
      approvedBy: "Manager",
      reason: "Count independently verified",
    });
    expect(state.paymentOperations!.drawerSessions[0]!.status).toBe("APPROVED");
  });

  it("tracks cash refunds, payouts, drops and petty cash against the open drawer", () => {
    let state = stateWithBills(2_000);
    state = orchestrator.openDrawer(state, {
      tenantId,
      branchId,
      employeeId: "cashier-cash-controls",
      openingFloatMinor: kes(500),
      currency,
      actor,
    });
    const drawerSessionId = state.paymentOperations!.drawerSessions[0]!.id;
    state = orchestrator.recordCash(state, {
      tenantId,
      branchId,
      drawerSessionId,
      paymentMethodId: "payment-demo-cash",
      invoiceId: "INV-T-1",
      amountMinor: kes(2_000),
      cashTenderedMinor: kes(2_000),
      currency,
      actor,
    });
    const originalTransactionId = state.paymentOperations!.transactions[0]!.id;
    state = orchestrator.requestRefund(state, {
      tenantId,
      transactionId: originalTransactionId,
      amountMinor: kes(400),
      currency,
      reason: "Cash item refund",
      requestedBy: actor,
    });
    const refundId = state.paymentOperations!.refunds[0]!.id;
    state = orchestrator.approveRefund(state, {
      tenantId,
      refundId,
      approvedBy: "Manager",
    });
    state = orchestrator.confirmRefund(state, {
      tenantId,
      refundId,
      providerReference: "CASH-REFUND-001",
      actor,
      drawerSessionId,
    });
    for (const movement of [
      { type: "PAID_OUT" as const, amountMinor: kes(100), reason: "Supplier float" },
      { type: "CASH_DROP" as const, amountMinor: kes(500), reason: "Safe drop" },
      { type: "PETTY_CASH" as const, amountMinor: kes(50), reason: "Cleaning supplies" },
    ]) {
      state = orchestrator.addCashMovement(state, {
        tenantId,
        branchId,
        drawerSessionId,
        currency,
        actor,
        approvedBy: "Manager",
        ...movement,
      });
    }
    expect(state.paymentOperations!.drawerSessions[0]!.expectedCashMinor).toBe(kes(1_450));
    expect(state.paymentOperations!.cashMovements.map((movement) => movement.type)).toEqual(
      expect.arrayContaining([
        "OPENING_FLOAT",
        "SALE",
        "REFUND",
        "PAID_OUT",
        "CASH_DROP",
        "PETTY_CASH",
      ]),
    );
  });

  it("AC 10, 22 and 31 reject reused references, preserve reversals and use safe minor units", () => {
    let state = stateWithBills(2_000, 2_000);
    state = confirmMpesa(state, "INV-T-1", 2_000, "UNIQUE-MPESA-001");
    expect(() => confirmMpesa(state, "INV-T-2", 2_000, "UNIQUE-MPESA-001")).toThrow(
      /already been used/,
    );
    const original = state.paymentOperations!.transactions[0]!;
    state = orchestrator.reverseTransaction(state, {
      tenantId,
      transactionId: original.id,
      actor: "Supervisor",
      reason: "Provider reversal confirmed",
    });
    expect(
      state.paymentOperations!.transactions.find((item) => item.id === original.id)?.status,
    ).toBe("CONFIRMED");
    expect(state.paymentOperations!.transactions[0]).toMatchObject({
      direction: "REVERSAL",
      originalTransactionId: original.id,
    });
    expect(() => parseMajorAmount("1.001", "KES")).toThrow(/decimal places/);
  });

  it("AC 19-20 retains possible matches for review and exposes unmatched exceptions", () => {
    let state = stateWithBills(2_500);
    state = orchestrator.submitManualReference(state, {
      tenantId,
      branchId,
      paymentMethodId: "payment-demo-mpesa-till",
      providerConnectionId: "connection-demo-daraja-wst",
      customerReference: "AMBIG-001",
      merchantReference: "INV-T-1",
      amountMinor: kes(2_500),
      currency,
      allocations: [{ invoiceId: "INV-T-1", amountMinor: kes(2_500) }],
      actor,
    });
    state = reconciliation.importBankTransactions(state, {
      tenantId,
      branchId,
      accountId: "account-demo-bank",
      adapterCode: "TEST",
      rows: [bankRow("BANK-A", 2_500, "AMBIG-001"), bankRow("BANK-B", 2_500, "AMBIG-001")],
    });
    state = reconciliation.automaticallyMatchPayments(state, {
      tenantId,
      branchId,
      businessDate: "2026-08-30",
    });
    expect(state.paymentOperations!.matches[0]?.confidence).toBe("POSSIBLE");
    expect(state.paymentOperations!.matches[0]?.status).toBe("SUGGESTED");
    expect(state.paymentOperations!.reconciliationSessions[0]!.status).toBe("REVIEW_REQUIRED");
  });

  it("AC 18 auto-approves one deterministic exact match", () => {
    let state = stateWithBills(2_500);
    state = confirmMpesa(state, "INV-T-1", 2_500, "EXACT-001");
    state = reconciliation.importBankTransactions(state, {
      tenantId,
      branchId,
      accountId: "account-demo-bank",
      adapterCode: "TEST",
      rows: [bankRow("EXACT-001", 2_500, "EXACT-001")],
    });
    state = reconciliation.automaticallyMatchPayments(state, {
      tenantId,
      branchId,
      businessDate: "2026-08-30",
    });
    expect(state.paymentOperations!.matches[0]).toMatchObject({
      confidence: "EXACT",
      status: "APPROVED",
      matchedBy: "SYSTEM",
    });
    expect(state.paymentOperations!.bankTransactions[0]!.status).toBe("MATCHED");
    expect(state.paymentOperations!.collections[0]!.collectionState).toBe("IN_BANK");
    expect(state.paymentOperations!.journals[0]).toMatchObject({
      sourceType: "PAYMENT_RECONCILIATION",
    });
    expect(state.paymentOperations!.journals[0]!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: "account-demo-bank", debitMinor: kes(2_500) }),
        expect.objectContaining({
          accountId: "account-demo-mpesa-clearing",
          creditMinor: kes(2_500),
        }),
      ]),
    );
  });

  it("AC 21 implements requested, approved, processing and confirmed refund lifecycle", () => {
    let state = stateWithBills(2_000);
    state = confirmMpesa(state, "INV-T-1", 2_000, "PAY-REFUND-001");
    const transactionId = state.paymentOperations!.transactions[0]!.id;
    state = orchestrator.requestRefund(state, {
      tenantId,
      transactionId,
      amountMinor: kes(500),
      currency,
      reason: "One item returned",
      requestedBy: "Cashier",
    });
    const refundId = state.paymentOperations!.refunds[0]!.id;
    state = orchestrator.approveRefund(state, { tenantId, refundId, approvedBy: "Manager" });
    state = orchestrator.markRefundProcessing(state, {
      tenantId,
      refundId,
      providerReference: "REFUND-REQUEST-001",
    });
    expect(state.paymentOperations!.refunds[0]!.status).toBe("PROCESSING");
    state = orchestrator.confirmRefund(state, {
      tenantId,
      refundId,
      providerReference: "REFUND-CONFIRMED-001",
      actor: "Provider callback",
    });
    expect(state.paymentOperations!.refunds[0]!.status).toBe("CONFIRMED");
    expect(state.paymentOperations!.transactions[0]!.direction).toBe("REFUND");
  });

  it("AC 23 treats gift-card issue as liability and redemption as liability release", () => {
    let state = stateWithBills(2_000);
    state = orchestrator.issueStoredValue(state, {
      tenantId,
      type: "GIFT_CARD",
      code: "GIFT-001",
      amountMinor: kes(4_000),
      currency,
      liabilityAccountId: "account-demo-gift-card-liability",
      collectionAccountId: "account-demo-cash",
      actor,
    });
    const issueJournal = state.paymentOperations!.journals[0]!;
    expect(issueJournal.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: "account-demo-cash", debitMinor: kes(4_000) }),
        expect.objectContaining({
          accountId: "account-demo-gift-card-liability",
          creditMinor: kes(4_000),
        }),
      ]),
    );
    state = orchestrator.redeemStoredValue(state, {
      tenantId,
      branchId,
      storedValueCode: "GIFT-001",
      paymentMethodId: "payment-demo-gift-card",
      invoiceId: "INV-T-1",
      amountMinor: kes(1_000),
      currency,
      actor,
    });
    expect(state.paymentOperations!.storedValueAccounts[0]!.balanceMinor).toBe(kes(3_000));
    expect(state.paymentOperations!.journals[0]!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: "account-demo-gift-card-liability",
          debitMinor: kes(1_000),
        }),
        expect.objectContaining({
          accountId: "account-demo-customer-receivable",
          creditMinor: kes(1_000),
        }),
      ]),
    );
  });

  it("AC 24 posts house-account receivable without creating a fake payment", () => {
    let state = stateWithBills(20_000);
    state = orchestrator.chargeHouseAccount(state, {
      tenantId,
      branchId,
      customerId: "customer-company-a",
      invoiceId: "INV-T-1",
      amountMinor: kes(20_000),
      currency,
      receivableAccountId: "account-demo-customer-receivable",
      revenueAccountId: "account-demo-revenue",
      actor,
    });
    expect(state.paymentOperations!.transactions).toHaveLength(0);
    expect(state.bills[0]!.status).toBe("PENDING");
    expect(state.paymentOperations!.customerAccounts[0]).toMatchObject({
      customerId: "customer-company-a",
      balanceMinor: kes(20_000),
    });
    expect(state.paymentOperations!.customerAccountEntries[0]).toMatchObject({
      type: "INVOICE",
      amountMinor: kes(20_000),
    });
    expect(state.paymentOperations!.journals[0]!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: "account-demo-customer-receivable",
          debitMinor: kes(20_000),
        }),
        expect.objectContaining({ accountId: "account-demo-revenue", creditMinor: kes(20_000) }),
      ]),
    );
  });

  it("enforces customer credit limits and produces a dated customer statement", () => {
    let state = stateWithBills(20_000);
    state = orchestrator.chargeHouseAccount(state, {
      tenantId,
      branchId,
      customerId: "customer-company-statement",
      invoiceId: "INV-T-1",
      amountMinor: kes(20_000),
      currency,
      receivableAccountId: "account-demo-customer-receivable",
      revenueAccountId: "account-demo-revenue",
      creditLimitMinor: kes(25_000),
      paymentTermsDays: 30,
      actor,
    });
    const customerAccountId = state.paymentOperations!.customerAccounts[0]!.id;
    state = orchestrator.confirmProviderCollection(state, {
      tenantId,
      branchId,
      paymentMethodId: "payment-demo-mpesa-till",
      providerConnectionId: "connection-demo-daraja-wst",
      providerTransactionId: "MPESA-ACCOUNT-001",
      merchantReference: customerAccountId,
      amountMinor: kes(5_000),
      currency,
      allocations: [],
      actor,
    });
    state = orchestrator.recordCustomerAccountPayment(state, {
      tenantId,
      branchId,
      customerAccountId,
      paymentTransactionId: state.paymentOperations!.transactions[0]!.id,
      amountMinor: kes(5_000),
      currency,
      actor,
    });
    const statement = buildCustomerStatement(state.paymentOperations!, {
      tenantId,
      customerAccountId,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2099-12-31T23:59:59.999Z",
    });
    expect(statement.entries.map((entry) => entry.type)).toEqual(["INVOICE", "PAYMENT"]);
    expect(statement.closingBalanceMinor).toBe(kes(15_000));
    expect(state.paymentOperations!.customerAccounts[0]!.balanceMinor).toBe(kes(15_000));
  });

  it("AC 25-26 balances every journal and uses configured account IDs", () => {
    let state = stateWithBills(1_000);
    state = orchestrator.openDrawer(state, {
      tenantId,
      branchId,
      employeeId: "cashier-3",
      openingFloatMinor: 0,
      currency,
      actor,
    });
    state = orchestrator.recordCash(state, {
      tenantId,
      branchId,
      drawerSessionId: state.paymentOperations!.drawerSessions[0]!.id,
      paymentMethodId: "payment-demo-cash",
      invoiceId: "INV-T-1",
      amountMinor: kes(1_000),
      cashTenderedMinor: kes(1_000),
      currency,
      actor,
    });
    state.paymentOperations!.journals.forEach((journal) => assertBalancedJournal(journal.lines));
    expect(state.paymentOperations!.journals[0]!.lines[0]!.accountId).toBe("account-demo-cash");
  });

  it("AC 27-28 blocks EOD critical exceptions unless permission and reason are supplied", () => {
    let state = stateWithBills(1_000);
    state = normalizeTransactionState(state);
    state.paymentOperations!.exceptions.push({
      id: "EX-CRITICAL",
      tenantId,
      branchId,
      sourceType: "BANK",
      sourceId: "BANK-MISSING",
      reason: "BANK_SHORTFALL",
      amountMinor: -kes(500),
      currency,
      severity: "CRITICAL",
      status: "OPEN",
      detail: "Bank receipt is short",
      createdAt: new Date().toISOString(),
    });
    state = reconciliation.prepareDayClose(state, {
      tenantId,
      branchId,
      businessDate: "2026-08-30",
      actor,
    });
    const dayCloseId = state.paymentOperations!.dayCloses[0]!.id;
    expect(() =>
      reconciliation.closeDay(state, {
        tenantId,
        dayCloseId,
        actor,
        hasOverridePermission: false,
      }),
    ).toThrow(/must be resolved/);
    expect(() =>
      reconciliation.closeDay(state, {
        tenantId,
        dayCloseId,
        actor,
        hasOverridePermission: true,
      }),
    ).toThrow(/reason is required/);
    state = reconciliation.closeDay(state, {
      tenantId,
      dayCloseId,
      actor,
      hasOverridePermission: true,
      overrideReason: "Owner approved timing difference",
    });
    expect(state.paymentOperations!.dayCloses[0]!.status).toBe("CLOSED");
  });

  it("AC 29 enforces tenant isolation for collect, match, refund and close operations", () => {
    const state = stateWithBills(1_000);
    expect(() =>
      orchestrator.createIntent(state, {
        tenantId: "tenant-b",
        branchId,
        invoiceIds: ["INV-T-1"],
        paymentMethodId: "payment-demo-cash",
        amountRequestedMinor: kes(1_000),
        currency,
        createdBy: actor,
        idempotencyKey: "cross-tenant",
      }),
    ).toThrow(/Tenant scope violation/);
    expect(() =>
      reconciliation.automaticallyMatchPayments(state, {
        tenantId: "tenant-b",
        businessDate: "2026-08-30",
      }),
    ).toThrow(/Tenant scope violation/);
  });

  it("AC 32 rejects raw card PAN, CVV and PIN metadata", () => {
    const state = stateWithBills(1_000);
    expect(() =>
      orchestrator.recordManualTerminalPayment(state, {
        tenantId,
        branchId,
        paymentMethodId: "payment-demo-card",
        merchantReference: "INV-T-1",
        amountMinor: kes(1_000),
        currency,
        allocations: [{ invoiceId: "INV-T-1", amountMinor: kes(1_000) }],
        actor,
        terminalReference: "TERM-01",
        metadata: { cvv: "123" },
      }),
    ).toThrow(/Sensitive card data/);
    expect(() =>
      orchestrator.recordManualTerminalPayment(state, {
        tenantId,
        branchId,
        paymentMethodId: "payment-demo-card",
        merchantReference: "INV-T-1",
        amountMinor: kes(1_000),
        currency,
        allocations: [{ invoiceId: "INV-T-1", amountMinor: kes(1_000) }],
        actor,
        terminalReference: "TERM-01",
        maskedPan: "4111111111111111",
      }),
    ).toThrow(/masked PAN/);
  });
});

describe("Marketplace, bank and file reconciliation", () => {
  it("AC 14 imports bank CSV idempotently through a generic adapter", async () => {
    const preview = await genericBankStatementAdapter.parse(
      "externalTransactionId,date,amount,currency,description,reference\nBANK-001,2026-08-30,75000,KES,Marketplace settlement,SET-001",
      currency,
    );
    expect(preview.canPost).toBe(true);
    let state = stateWithBills(1_000);
    state = reconciliation.importBankTransactions(state, {
      tenantId,
      branchId,
      accountId: "account-demo-bank",
      adapterCode: preview.adapterCode,
      rows: preview.recognized,
    });
    state = reconciliation.importBankTransactions(state, {
      tenantId,
      branchId,
      accountId: "account-demo-bank",
      adapterCode: preview.adapterCode,
      rows: preview.recognized,
    });
    expect(state.paymentOperations!.bankTransactions).toHaveLength(1);
  });

  it("AC 15-17 reconciles gross marketplace receivable, deductions and bank settlement", () => {
    let state = stateWithBills(100_000);
    state.marketplaceReceivables.push(marketplaceReceivable());
    const imported = reconciliation.importSettlement(state, {
      tenantId,
      branchId,
      importedBy: actor,
      normalized: settlementImport(75_000),
    });
    state = imported.state;
    state = reconciliation.importBankTransactions(state, {
      tenantId,
      branchId,
      accountId: "account-demo-bank",
      adapterCode: "TEST",
      rows: [bankRow("BANK-SETTLEMENT-001", 75_000, "SETTLEMENT-001")],
    });
    state = reconciliation.matchSettlementToBank(state, {
      tenantId,
      settlementBatchId: imported.batch.id,
      bankTransactionId: state.paymentOperations!.bankTransactions[0]!.id,
      actor,
    });
    state = reconciliation.postSettlement(state, {
      tenantId,
      settlementBatchId: imported.batch.id,
      actor,
      accounts: settlementAccounts(),
    });
    const journal = state.paymentOperations!.journals[0]!;
    expect(state.marketplaceReceivables[0]).toMatchObject({
      settledAmount: 100_000,
      outstandingAmount: 0,
      status: "SETTLED",
    });
    expect(journal.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: "account-demo-bank", debitMinor: kes(75_000) }),
        expect.objectContaining({
          accountId: "account-demo-commission-expense",
          debitMinor: kes(20_000),
        }),
        expect.objectContaining({
          accountId: "account-demo-promotion-expense",
          debitMinor: kes(5_000),
        }),
        expect.objectContaining({
          accountId: "account-demo-marketplace-receivable",
          creditMinor: kes(100_000),
        }),
      ]),
    );
    assertBalancedJournal(journal.lines);
    expect(state.bills[0]!.total).toBe(100_000);
  });

  it("AC 16 creates an exception instead of force-matching a short settlement", () => {
    let state = stateWithBills(100_000);
    state.marketplaceReceivables.push(marketplaceReceivable());
    const imported = reconciliation.importSettlement(state, {
      tenantId,
      branchId,
      importedBy: actor,
      normalized: settlementImport(75_000),
    });
    state = reconciliation.importBankTransactions(imported.state, {
      tenantId,
      branchId,
      accountId: "account-demo-bank",
      adapterCode: "TEST",
      rows: [bankRow("BANK-SHORT", 71_500, "SETTLEMENT-001")],
    });
    state = reconciliation.matchSettlementToBank(state, {
      tenantId,
      settlementBatchId: imported.batch.id,
      bankTransactionId: state.paymentOperations!.bankTransactions[0]!.id,
      actor,
    });
    expect(state.paymentOperations!.settlementBatches[0]!.status).toBe("EXCEPTION");
    expect(state.paymentOperations!.exceptions[0]).toMatchObject({
      reason: "BANK_SHORTFALL",
      amountMinor: -kes(3_500),
      status: "OPEN",
    });
  });

  it("previews malformed settlement files without posting them", async () => {
    const preview = await genericSettlementAdapter.parse(
      "settlementId,type,reference,amount,periodStart,periodEnd\nSET-1,UNKNOWN,LINE-1,100,2026-08-01,2026-08-31",
      { connectionId: "connection-demo-uber-eats", currency },
    );
    expect(preview.canPost).toBe(false);
    expect(preview.unknown).toEqual([2]);
  });

  it("uses configurable business-day cutoffs across midnight", () => {
    expect(businessDateFor("2026-08-31T01:00:00.000Z", 2)).toBe("2026-08-30");
  });
});

describe("Official provider boundaries and integration runtime", () => {
  it("AC 9 confirms a digital collection only after a verified idempotent runtime callback", async () => {
    const fixture = paymentRuntimeFixture();
    const initiated = await fixture.runtime.initiatePayment({
      tenantId,
      branchId,
      invoiceId: "INV-T-1",
      paymentMethodId: "payment-test-runtime",
      amountMinor: kes(2_000),
      currency,
      actor,
      idempotencyKey: "runtime-intent-001",
      operation: "PAYMENT_PROMPT",
      customerPhone: "254700000001",
    });
    const providerReference = initiated.intent?.providerReference;
    expect(providerReference).toBeTruthy();
    expect(fixture.transactions.state.bills[0]!.paid).toBe(0);
    const payload = JSON.stringify({
      id: "TEST-CALLBACK-001",
      reference: providerReference,
      status: "CONFIRMED",
      amountMinor: kes(2_000),
      currency,
    });
    const envelope = {
      tenantId,
      providerCode: "TEST_PAYMENT",
      connectionId: "connection-test-payment",
      rawBody: new TextEncoder().encode(payload),
      headers: { "x-test-signature": "runtime-secret" },
    };
    const first = await fixture.runtime.handleWebhook(envelope);
    const duplicate = await fixture.runtime.handleWebhook(envelope);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(fixture.transactions.state.bills[0]).toMatchObject({
      paid: 2_000,
      paymentStatus: "PAID",
    });
    expect(fixture.transactions.state.paymentOperations!.transactions).toHaveLength(1);
    expect(fixture.transactions.state.receipts).toHaveLength(1);
  });

  it("AC 11 uses official Daraja OAuth, STK and callback shapes without claiming undocumented refund", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(httpResponse({ access_token: "sandbox-token", expires_in: "3599" }))
      .mockResolvedValueOnce(
        httpResponse({
          MerchantRequestID: "MERCHANT-001",
          CheckoutRequestID: "CHECKOUT-001",
          ResponseCode: "0",
          CustomerMessage: "Success",
        }),
      );
    const adapter = createDarajaAdapter({}, adapterRuntime(request));
    const context = paymentContext(darajaConnection(), {
      consumerKey: "key",
      consumerSecret: "secret",
      passkey: "passkey",
      webhookSecret: "callback-secret",
    });
    const result = await adapter.createPaymentPrompt!(
      {
        intent: {
          id: "PI4-001",
          tenantId,
          branchId,
          invoiceIds: ["INV-T-1"],
          paymentMethodId: "payment-demo-mpesa-prompt",
          currency,
          amountRequestedMinor: kes(2_000),
          amountAuthorizedMinor: 0,
          amountCollectedMinor: 0,
          status: "PENDING",
          idempotencyKey: "daraja-test",
          createdBy: actor,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
        customerPhone: "0712345678",
      },
      context.connection,
      context,
    );
    expect(result).toMatchObject({ ok: true, providerReference: "CHECKOUT-001" });
    expect(request.mock.calls[0]![0].path).toContain("/oauth/v1/generate");
    expect(request.mock.calls[1]![0]).toMatchObject({ path: "/mpesa/stkpush/v1/processrequest" });
    expect(adapter.requestPaymentRefund).toBeUndefined();
    const callback = await adapter.parseWebhook!(darajaWebhook(context.connection));
    expect(callback).toMatchObject({
      ok: true,
      value: { eventType: "PAYMENT_CONFIRMED", amountMinor: kes(2_000) },
    });
  });

  it("AC 12 uses Pesapal API 3.0 auth, order, IPN status query and processing refund", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        httpResponse({ token: "pesa-token", expiryDate: "2099-01-01T00:00:00Z" }),
      )
      .mockResolvedValueOnce(
        httpResponse({
          order_tracking_id: "TRACK-001",
          redirect_url: "https://sandbox.example/redirect",
        }),
      )
      .mockResolvedValueOnce(
        httpResponse({
          payment_status_description: "COMPLETED",
          amount: 2000,
          currency: "KES",
          confirmation_code: "PESA-001",
          merchant_reference: "INV-T-1",
        }),
      )
      .mockResolvedValueOnce(httpResponse({ message: "Refund request submitted" }));
    const adapter = createPesapalAdapter(adapterRuntime(request));
    const context = paymentContext(pesapalConnection(), {
      consumerKey: "consumer",
      consumerSecret: "secret",
    });
    const prompt = await adapter.createPaymentPrompt!(
      { intent: legacyIntent(), customer: { phoneNumber: "254700000001" } },
      context.connection,
      context,
    );
    expect(prompt).toMatchObject({ ok: true, providerReference: "TRACK-001" });
    expect(request.mock.calls[0]![0].path).toBe("/api/Auth/RequestToken");
    expect(request.mock.calls[1]![0].path).toBe("/api/Transactions/SubmitOrderRequest");
    const ipn = await adapter.parseWebhook!(pesapalWebhook(context.connection));
    expect(ipn).toMatchObject({ ok: true, value: { requiresPaymentFetch: true } });
    const status = await adapter.queryPayment!("TRACK-001", context);
    expect(status).toMatchObject({
      ok: true,
      value: { status: "CONFIRMED", amountMinor: kes(2_000) },
    });
    const refund = await adapter.requestPaymentRefund!(
      { confirmationCode: "PESA-001", amountMajor: 500, username: "manager" },
      context,
    );
    expect(refund).toMatchObject({ ok: true, value: { lifecycleStatus: "PROCESSING" } });
    expect(request.mock.calls[3]![0].path).toBe("/api/Transactions/RefundRequest");
  });

  it("AC 13 returns SPEC_REQUIRED for every undocumented TendePay live operation", async () => {
    const adapter = createTendePayAdapter();
    expect(adapter.definition.capabilities).toEqual([]);
    const context = paymentContext(tendeConnection(), { apiKey: "server-secret" });
    const operations = await Promise.all([
      adapter.createPaymentPrompt!({}, context.connection, context),
      adapter.createPaymentQr!({}, context.connection, context),
      adapter.queryPayment!("TX", context),
      adapter.requestPaymentRefund!({}, context),
      adapter.fetchSettlements!({}, context),
    ]);
    expect(operations.every((result) => !result.ok && result.code === "SPEC_REQUIRED")).toBe(true);
  });

  it("test provider simulates success, failure, delay, rate limit, timeout, refund and settlement", async () => {
    const adapter = createTestPaymentProvider();
    const connection = testConnection();
    const context = paymentContext(connection, { webhookSecret: "test" });
    const intent = { id: "PI-TEST", amountRequestedMinor: kes(1_000), currency };
    for (const scenario of ["SUCCESS", "FAILED", "DELAYED"] as const) {
      connection.configuration["scenario"] = scenario;
      const result = await adapter.createPaymentPrompt!({ intent }, connection, context);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect((await adapter.queryPayment!(result.providerReference!, context)).ok).toBe(true);
    }
    connection.configuration["scenario"] = "RATE_LIMIT";
    expect(await adapter.createPaymentPrompt!({ intent }, connection, context)).toMatchObject({
      ok: false,
      code: "RATE_LIMITED",
    });
    connection.configuration["scenario"] = "TIMEOUT";
    expect(await adapter.createPaymentPrompt!({ intent }, connection, context)).toMatchObject({
      ok: false,
      code: "TIMEOUT",
    });
    expect(await adapter.requestPaymentRefund!({}, context)).toMatchObject({
      ok: true,
      value: { status: "PROCESSING" },
    });
    expect(await adapter.fetchSettlements!({}, context)).toMatchObject({
      ok: true,
      value: { netAmountMinor: 75_000 },
    });
  });
});

function stateWithBills(...amounts: number[]) {
  const state = createEmptyTransactionState(tenantId);
  state.bills = amounts.map((amount, index) => bill(`INV-T-${index + 1}`, amount));
  return normalizeTransactionState(state);
}

function bill(id: string, total: number): BillingRecord {
  const timestamp = "2026-08-30T10:00:00.000Z";
  return {
    id,
    tenantId,
    branchId,
    orderIds: [`ORD-${id}`],
    branch: "Westlands",
    customer: "Walk-in Customer",
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt: timestamp,
    dueAt: "2026-08-30T12:00:00.000Z",
    lines: [
      { id: `${id}-LINE`, name: "Test meal", category: "Main", quantity: 1, unitPrice: total },
    ],
    subtotal: total,
    tax: 0,
    total,
    paid: 0,
  };
}

function kes(amount: number) {
  return parseMajorAmount(amount, currency);
}

function confirmMpesa(
  state: TransactionState,
  invoiceId: string,
  amount: number,
  reference: string,
) {
  return orchestrator.confirmProviderCollection(state, {
    tenantId,
    branchId,
    paymentMethodId: "payment-demo-mpesa-till",
    providerConnectionId: "connection-demo-daraja-wst",
    providerTransactionId: reference,
    merchantReference: invoiceId,
    amountMinor: kes(amount),
    currency,
    allocations: [{ invoiceId, amountMinor: kes(amount) }],
    actor,
  });
}

function bankRow(id: string, amount: number, reference: string) {
  return {
    externalTransactionId: id,
    date: "2026-08-30T12:00:00.000Z",
    amountMinor: kes(amount),
    currency,
    description: reference,
    reference,
  };
}

function marketplaceReceivable(): MarketplaceReceivable {
  return {
    id: "MREC-001",
    tenantId,
    branchId,
    branch: "Westlands",
    orderId: "ORD-MARKET-001",
    invoiceId: "INV-T-1",
    connectionId: "connection-demo-uber-eats",
    providerId: "provider-delivery-uber-eats",
    externalOrderId: "UBER-ORDER-001",
    currency,
    grossAmount: 100_000,
    externallyCollectedAmount: 100_000,
    settledAmount: 0,
    outstandingAmount: 100_000,
    status: "OPEN",
    receivableAccount: "account-demo-marketplace-receivable",
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
    metadata: {},
  };
}

function settlementImport(net: number): NormalizedSettlementImport {
  return {
    providerSettlementId: "SETTLEMENT-001",
    connectionId: "connection-demo-uber-eats",
    currency,
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-30T23:59:59.000Z",
    settledAt: "2026-08-30T12:00:00.000Z",
    grossAmountMinor: kes(100_000),
    netAmountMinor: kes(net),
    lines: [
      settlementLine("GROSS_SALE", 100_000, "UBER-ORDER-001"),
      settlementLine("COMMISSION", 20_000, "COMMISSION-001"),
      settlementLine("PROMOTION", 5_000, "PROMOTION-001"),
    ],
  };
}

function settlementLine(
  type: "GROSS_SALE" | "COMMISSION" | "PROMOTION",
  amount: number,
  reference: string,
) {
  return {
    type,
    ...(type === "GROSS_SALE" ? { externalOrderId: "UBER-ORDER-001" } : {}),
    amountMinor: kes(amount),
    taxAmountMinor: 0,
    reference,
    description: type.replaceAll("_", " "),
    metadata: {},
  };
}

function settlementAccounts() {
  return {
    bankAccountId: "account-demo-bank",
    marketplaceReceivableAccountId: "account-demo-marketplace-receivable",
    commissionExpenseAccountId: "account-demo-commission-expense",
    serviceFeeExpenseAccountId: "account-demo-adjustment-expense",
    deliveryAdjustmentAccountId: "account-demo-adjustment-expense",
    promotionExpenseAccountId: "account-demo-promotion-expense",
    refundExpenseAccountId: "account-demo-adjustment-expense",
    taxAdjustmentAccountId: "account-demo-adjustment-expense",
    otherAdjustmentAccountId: "account-demo-adjustment-expense",
  };
}

class TestTransactionRepository implements TransactionRepository {
  readonly authoritative = false;
  state = stateWithBills(2_000);
  idempotency = new Map<string, IdempotencyRecord>();
  providerEvents: ProviderWebhookEvent[] = [];
  async migrate() {}
  async revision() {
    return 0;
  }
  async commitMutation(): Promise<never> {
    throw new Error("Typed transaction commands are not used by this payment fixture");
  }
  async loadState(requestedTenantId: string) {
    return requestedTenantId === this.state.tenantId
      ? structuredClone(this.state)
      : createEmptyTransactionState(requestedTenantId);
  }
  async saveState(state: TransactionState, serverActor: ServerActor) {
    if (state.tenantId !== serverActor.tenantId) throw new Error("Cross tenant");
    this.state = structuredClone(state);
  }
  async getIdempotency(requestedTenantId: string, key: string) {
    return this.idempotency.get(`${requestedTenantId}:${key}`) ?? null;
  }
  async saveIdempotency(record: IdempotencyRecord) {
    this.idempotency.set(`${record.tenantId}:${record.key}`, record);
  }
  async appendProviderEvent(event: ProviderWebhookEvent) {
    this.providerEvents.push(event);
  }
}

function paymentRuntimeFixture() {
  const platform = createDefaultDemoPlatformState();
  platform.providers.push(testPaymentProviderDefinition);
  platform.connections.push(testConnection());
  platform.paymentMethods.push({
    id: "payment-test-runtime",
    tenantId,
    code: "TEST_RUNTIME",
    displayName: "Test runtime payment",
    category: "DIGITAL_WALLET",
    enabled: true,
    sortOrder: 999,
    requiresReference: false,
    requiresCustomer: true,
    supportsRefund: true,
    supportsSplit: true,
    providerConnectionId: "connection-test-payment",
    settlementAccountId: "account-demo-mpesa-clearing",
    clearingAccountId: "account-demo-mpesa-clearing",
    receivableAccountId: "account-demo-customer-receivable",
    metadata: { providerOperation: "PAYMENT_PROMPT" },
  });
  const configuration = new ConfigurationRepository(platform);
  setConfigurationRepositoryForTests(configuration);
  const transactions = new TestTransactionRepository();
  const runtime = createIntegrationRuntime(
    {},
    {
      configuration,
      registry: new ProviderRegistry().register(createTestPaymentProvider()),
      repository: createIntegrationRepository(),
      transactions,
      credentials: new StaticCredentialResolver({
        "secret://test/payment": { webhookSecret: "runtime-secret" },
      }),
    },
  );
  return { runtime, transactions };
}

function testConnection(): IntegrationConnection {
  return {
    id: "connection-test-payment",
    tenantId,
    branchId,
    providerId: testPaymentProviderDefinition.id,
    environment: "SANDBOX",
    status: "CONFIGURED",
    displayName: "Test payment sandbox",
    configuration: { scenario: "SUCCESS" },
    secretReference: "secret://test/payment",
    metadata: {},
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function adapterRuntime(request: ReturnType<typeof vi.fn>): PaymentAdapterRuntime {
  return {
    http: { request } as unknown as PaymentAdapterRuntime["http"],
    tokens: new ProviderTokenService(),
  };
}

function httpResponse<T>(data: T) {
  return { status: 200, data, headers: {}, durationMs: 1 };
}

function paymentContext(
  connection: IntegrationConnection,
  credentials: Record<string, string>,
): ProviderExecutionContext {
  return { connection, credentials, correlationId: "correlation-test" };
}

function darajaConnection(): IntegrationConnection {
  return {
    ...testConnection(),
    id: "connection-daraja-test",
    providerId: "provider-daraja",
    displayName: "Daraja sandbox",
    configuration: { shortcode: "174379", callbackUrl: "https://example.test/daraja" },
    secretReference: "secret://test/daraja",
  };
}

function pesapalConnection(): IntegrationConnection {
  return {
    ...testConnection(),
    id: "connection-pesapal-test",
    providerId: "provider-pesapal",
    displayName: "Pesapal sandbox",
    configuration: {
      callbackUrl: "https://example.test/pesapal/return",
      ipnUrl: "https://example.test/pesapal/ipn",
      notificationId: "IPN-001",
    },
    secretReference: "secret://test/pesapal",
  };
}

function tendeConnection(): IntegrationConnection {
  return {
    ...testConnection(),
    id: "connection-tende-test",
    providerId: "provider-tendepay",
    displayName: "TendePay boundary",
    secretReference: "secret://test/tende",
  };
}

function darajaWebhook(connection: IntegrationConnection): ProviderWebhookRequest {
  const payload = {
    Body: {
      stkCallback: {
        MerchantRequestID: "MERCHANT-001",
        CheckoutRequestID: "CHECKOUT-001",
        ResultCode: 0,
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 2000 },
            { Name: "MpesaReceiptNumber", Value: "MPESA-RECEIPT-001" },
          ],
        },
      },
    },
  };
  return {
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    headers: { "x-seramet-webhook-secret": "callback-secret" },
    connection,
    credentials: { webhookSecret: "callback-secret" },
    payload,
  };
}

function pesapalWebhook(connection: IntegrationConnection): ProviderWebhookRequest {
  const payload = {
    OrderTrackingId: "TRACK-001",
    OrderMerchantReference: "INV-T-1",
    OrderNotificationType: "IPNCHANGE",
  };
  return {
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    headers: {},
    connection,
    credentials: {},
    payload,
  };
}

function legacyIntent() {
  return {
    id: "LEGACY-INTENT",
    tenantId,
    branchId,
    orderId: "ORD-T-1",
    invoiceId: "INV-T-1",
    branch: "Westlands",
    amount: 2_000,
    currency,
    method: "PESAPAL_GATEWAY",
    provider: "Pesapal",
    createdBy: actor,
    status: "PENDING" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
