import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyTransactionState, TransactionEngine } from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import { LocationCurrencyService } from "@/onboarding/location-currency-service";
import { paymentOrchestrator } from "@/payments/payment-orchestrator";
import { allPermissionCodes } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import {
  RestaurantRegistrationService,
  type RestaurantRegistrationResult,
} from "@/server/registration-service";

describe.sequential("guided onboarding and multi-currency settlement", () => {
  let db: SqliteD1TestDatabase;

  beforeEach(() => {
    db = createMigratedTestDatabase();
  });

  afterEach(() => {
    setConfigurationRepositoryForTests(undefined);
    db.close();
  });

  it("persists page progress and derives country-specific currency suggestions", async () => {
    const kenya = await register("kenya-location", "Kenya Location Restaurant");
    const kenyaService = new LocationCurrencyService(db, actor(kenya));
    await kenyaService.saveOnboardingStep({
      step: 5,
      action: "SAVE",
      response: {
        countryCode: "KE",
        administrativeLevel1: "Nairobi",
        city: "Nairobi",
        addressLine: "Configured address",
      },
    });
    const draft = await kenyaService.getOnboardingState();
    expect(draft).toMatchObject({ currentStep: 6, location: { status: "DRAFT" } });
    await kenyaService.saveOnboardingStep({
      step: 6,
      action: "SAVE",
      response: { confirmed: true },
    });
    expect(await kenyaService.getOnboardingState()).toMatchObject({
      currentStep: 7,
      location: { countryCode: "KE", status: "CONFIRMED" },
      suggestedCurrency: { code: "KES" },
    });

    const unitedStates = await register("us-location", "US Location Restaurant");
    const usService = new LocationCurrencyService(db, actor(unitedStates));
    await usService.saveOnboardingStep({
      step: 5,
      action: "SAVE",
      response: {
        countryCode: "US",
        administrativeLevel1: "New York",
        city: "New York",
        addressLine: "Configured US address",
      },
    });
    await usService.saveOnboardingStep({
      step: 6,
      action: "SAVE",
      response: { confirmed: true },
    });
    const references = await usService.listReferences();
    expect(references.countries.find((country) => country.code === "US")).toMatchObject({
      administrativeLevel1Label: "State",
      defaultCurrencyCode: "USD",
    });
    expect((await usService.getOnboardingState()).suggestedCurrency?.code).toBe("USD");
  });

  it("settles a KES invoice in USD with immutable FX and currency drawer evidence", async () => {
    const provisioned = await register("fx-payment", "FX Payment Restaurant");
    const authenticated = actor(provisioned);
    const service = new LocationCurrencyService(db, authenticated);
    await configureKenyanCurrency(service);
    seedCashConfiguration(provisioned);
    await hydrateAuthoritativeConfiguration(db, { SERAMET_ENVIRONMENT: "test" }, true);

    await service.saveManualRate({
      baseCurrency: "KES",
      tenderCurrency: "USD",
      rateNumerator: 12_950,
      rateDenominator: 100,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveUntil: new Date(Date.now() + 3_600_000).toISOString(),
      reason: "Authorized operational cash rate",
      idempotencyKey: "manual-rate-fx-payment-0001",
    });

    let state = createEmptyTransactionState(provisioned.tenantId);
    state = TransactionEngine.createOrder(
      state,
      {
        tenantId: provisioned.tenantId,
        branchId: provisioned.branchId,
        branch: "Configured branch",
        customer: "Walk-in customer",
        channel: "DINE_IN",
        cashier: "Owner",
        waiter: "Owner",
        lines: [
          {
            id: "line-fx-1",
            name: "Configured item",
            category: "Configured category",
            quantity: 1,
            unitPrice: 12_950,
            productionStation: "NONE",
          },
        ],
      },
      "OPEN",
    );
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Owner");
    state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Owner");
    state = paymentOrchestrator.openDrawer(state, {
      tenantId: provisioned.tenantId,
      branchId: provisioned.branchId,
      employeeId: provisioned.userId,
      openingFloatMinor: 0,
      currency: "KES",
      actor: provisioned.userId,
    });
    const repository = new D1AuthoritativeTransactionRepository(db);
    await repository.saveState(state, authenticated, "FX test state");
    const invoice = state.bills[0]!;
    const quote = await service.createFxQuote({
      branchId: provisioned.branchId,
      invoiceId: invoice.id,
      paymentMethodId: "cash-configured",
      baseAmountMinor: 1_295_000,
      tenderCurrency: "USD",
      idempotencyKey: "fx-quote-payment-0001",
    });
    expect(quote).toMatchObject({
      baseCurrency: "KES",
      baseAmountMinor: 1_295_000,
      tenderCurrency: "USD",
      tenderAmountMinor: 10_000,
      convertedBaseAmountMinor: 1_295_000,
    });

    const result = await repository.commitMutation({
      actor: authenticated,
      action: "applyConfiguredPayment",
      payload: {
        invoiceId: invoice.id,
        paymentMethodId: "cash-configured",
        amountMinor: 1_295_000,
        fxQuoteId: quote.id,
        tenderCurrency: "USD",
        tenderedAmountMinor: 10_000,
      },
      idempotencyKey: "fx-payment-command-0001",
      requestHash: "fx-payment-command-hash-0001",
      correlationId: "fx-payment-correlation-0001",
    });
    const transaction = result.state.paymentOperations!.transactions[0]!;
    expect(result.state.bills[0]).toMatchObject({ paymentStatus: "PAID", paid: 12_950 });
    expect(transaction).toMatchObject({
      amountMinor: 1_295_000,
      currency: "KES",
      currencyEvidence: {
        tenderCurrency: "USD",
        tenderAmountMinor: 10_000,
        baseAmountMinor: 1_295_000,
        rateNumerator: 12_950,
        rateDenominator: 100,
      },
    });
    expect(result.state.paymentOperations!.drawerSessions[0]!.currencyBalances).toMatchObject({
      KES: { expectedCashMinor: 0 },
      USD: { expectedCashMinor: 10_000 },
    });
    expect(result.state.receipts[0]?.paymentBreakdown[0]).toMatchObject({
      tenderCurrency: "USD",
      tenderAmount: 100,
      baseAmount: 12_950,
      fxRateReference: quote.id,
    });
    expect(
      result.state.paymentOperations!.journals[0]!.lines.reduce(
        (sum, line) => sum + line.debitMinor - line.creditMinor,
        0,
      ),
    ).toBe(0);
    expect(
      await db
        .prepare("SELECT status FROM fx_payment_quotes WHERE tenant_id=? AND id=?")
        .bind(provisioned.tenantId, quote.id)
        .first("status"),
    ).toBe("CONSUMED");
    expect(
      await db
        .prepare(
          "SELECT tender_amount_minor FROM payment_currency_snapshots WHERE tenant_id=? AND quote_id=?",
        )
        .bind(provisioned.tenantId, quote.id)
        .first("tender_amount_minor"),
    ).toBe(10_000);

    await expect(
      repository.commitMutation({
        actor: authenticated,
        action: "applyConfiguredPayment",
        payload: {
          invoiceId: invoice.id,
          paymentMethodId: "cash-configured",
          amountMinor: 1,
          fxQuoteId: quote.id,
          tenderCurrency: "USD",
          tenderedAmountMinor: 10_000,
        },
        idempotencyKey: "fx-payment-command-0002",
        requestHash: "fx-payment-command-hash-0002",
        correlationId: "fx-payment-correlation-0002",
      }),
    ).rejects.toThrow(/expired|consumed/i);
  });

  it("locks base currency after authoritative financial activity", async () => {
    const provisioned = await register("currency-lock", "Currency Lock Restaurant");
    const service = new LocationCurrencyService(db, actor(provisioned));
    await configureKenyanCurrency(service);
    db.sqlite
      .prepare(
        `INSERT INTO authoritative_records
          (tenant_id,entity_type,entity_id,branch_id,status,payload_json,version,created_at,updated_at)
         VALUES (?,'state:bills','bill-lock',?,'OPEN','{}',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      )
      .run(provisioned.tenantId, provisioned.branchId);
    await expect(
      service.saveOnboardingStep({
        step: 7,
        action: "SAVE",
        response: { baseCurrency: "USD", secondaryCurrencies: [] },
      }),
    ).rejects.toThrow(/locked/i);
    expect((await service.getOnboardingState()).canChangeBaseCurrency).toBe(false);
  });

  it("rejects stale rates, tampered quote amounts and cross-tenant quote use", async () => {
    const provisioned = await register("fx-guards", "FX Guard Restaurant");
    const authenticated = actor(provisioned);
    const service = new LocationCurrencyService(db, authenticated);
    await configureKenyanCurrency(service);
    seedCashConfiguration(provisioned);
    await hydrateAuthoritativeConfiguration(db, { SERAMET_ENVIRONMENT: "test" }, true);
    const state = createReadyCashBill(provisioned, 5_000);
    const invoice = state.bills[0]!;
    const repository = new D1AuthoritativeTransactionRepository(db);
    await repository.saveState(state, authenticated, "FX guard state");

    await service.saveManualRate({
      baseCurrency: "KES",
      tenderCurrency: "USD",
      rateNumerator: 12_950,
      rateDenominator: 100,
      effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
      effectiveUntil: new Date(Date.now() - 60_000).toISOString(),
      reason: "Expired operational rate",
      idempotencyKey: "expired-rate-guard-0001",
    });
    await expect(
      service.createFxQuote({
        branchId: provisioned.branchId,
        invoiceId: invoice.id,
        paymentMethodId: "cash-configured",
        baseAmountMinor: 500_000,
        tenderCurrency: "USD",
        idempotencyKey: "expired-quote-guard-0001",
      }),
    ).rejects.toThrow(/no current authoritative FX rate/i);

    await saveCurrentUsdRate(service, "current-rate-guard-0001");
    const quote = await service.createFxQuote({
      branchId: provisioned.branchId,
      invoiceId: invoice.id,
      paymentMethodId: "cash-configured",
      baseAmountMinor: 500_000,
      tenderCurrency: "USD",
      idempotencyKey: "guard-quote-0001",
    });
    await expect(
      repository.commitMutation({
        actor: authenticated,
        action: "applyConfiguredPayment",
        payload: {
          invoiceId: invoice.id,
          paymentMethodId: "cash-configured",
          amountMinor: 499_999,
          fxQuoteId: quote.id,
          tenderCurrency: "USD",
          tenderedAmountMinor: quote.tenderAmountMinor,
        },
        idempotencyKey: "tampered-fx-command-0001",
        requestHash: "tampered-fx-hash-0001",
        correlationId: "tampered-fx-correlation-0001",
      }),
    ).rejects.toThrow(/amount does not match/i);
    expect(
      await db
        .prepare("SELECT status FROM fx_payment_quotes WHERE tenant_id=? AND id=?")
        .bind(provisioned.tenantId, quote.id)
        .first("status"),
    ).toBe("ACTIVE");

    const other = await register("fx-other", "Other Currency Restaurant");
    const otherActor = actor(other);
    const otherService = new LocationCurrencyService(db, otherActor);
    await configureKenyanCurrency(otherService);
    seedCashConfiguration(other);
    await hydrateAuthoritativeConfiguration(db, { SERAMET_ENVIRONMENT: "test" }, true);
    const otherState = createReadyCashBill(other, 5_000);
    const otherRepository = new D1AuthoritativeTransactionRepository(db);
    await otherRepository.saveState(otherState, otherActor, "Other tenant FX state");
    await expect(
      otherRepository.commitMutation({
        actor: otherActor,
        action: "applyConfiguredPayment",
        payload: {
          invoiceId: otherState.bills[0]!.id,
          paymentMethodId: "cash-configured",
          amountMinor: 500_000,
          fxQuoteId: quote.id,
          tenderCurrency: "USD",
          tenderedAmountMinor: quote.tenderAmountMinor,
        },
        idempotencyKey: "cross-tenant-fx-command-0001",
        requestHash: "cross-tenant-fx-hash-0001",
        correlationId: "cross-tenant-fx-correlation-0001",
      }),
    ).rejects.toThrow(/quote was not found/i);
  });

  it("keeps foreign cash change, refunds and drawer variances in the tender currency", async () => {
    const provisioned = await register("fx-cash-control", "FX Cash Control Restaurant");
    const authenticated = actor(provisioned);
    const service = new LocationCurrencyService(db, authenticated);
    await configureKenyanCurrency(service);
    seedCashConfiguration(provisioned);
    await hydrateAuthoritativeConfiguration(db, { SERAMET_ENVIRONMENT: "test" }, true);
    await saveCurrentUsdRate(service, "current-rate-cash-control-0001");
    const state = createReadyCashBill(provisioned, 5_000);
    const invoice = state.bills[0]!;
    const drawerId = state.paymentOperations!.drawerSessions[0]!.id;
    const repository = new D1AuthoritativeTransactionRepository(db);
    await repository.saveState(state, authenticated, "Foreign cash control state");
    const quote = await service.createFxQuote({
      branchId: provisioned.branchId,
      invoiceId: invoice.id,
      paymentMethodId: "cash-configured",
      baseAmountMinor: 500_000,
      tenderCurrency: "USD",
      idempotencyKey: "cash-control-quote-0001",
    });
    expect(quote.tenderAmountMinor).toBe(3_861);
    const paid = await repository.commitMutation({
      actor: authenticated,
      action: "applyConfiguredPayment",
      payload: {
        invoiceId: invoice.id,
        paymentMethodId: "cash-configured",
        amountMinor: 500_000,
        fxQuoteId: quote.id,
        tenderCurrency: "USD",
        tenderedAmountMinor: 4_000,
      },
      idempotencyKey: "cash-control-payment-0001",
      requestHash: "cash-control-payment-hash-0001",
      correlationId: "cash-control-payment-correlation-0001",
    });
    expect(paid.state.paymentOperations!.transactions[0]!.currencyEvidence).toMatchObject({
      tenderAmountMinor: 3_861,
      cashTenderedMinor: 4_000,
      changeGivenMinor: 139,
      changeCurrency: "USD",
    });
    expect(paid.state.paymentOperations!.drawerSessions[0]!.currencyBalances["USD"]).toMatchObject({
      expectedCashMinor: 3_861,
    });

    const original = paid.state.paymentOperations!.transactions[0]!;
    let refunded = paymentOrchestrator.requestRefund(paid.state, {
      tenantId: provisioned.tenantId,
      transactionId: original.id,
      amountMinor: 250_000,
      currency: "KES",
      reason: "Authorized partial refund",
      requestedBy: provisioned.userId,
    });
    const refundId = refunded.paymentOperations!.refunds[0]!.id;
    refunded = paymentOrchestrator.approveRefund(refunded, {
      tenantId: provisioned.tenantId,
      refundId,
      approvedBy: provisioned.userId,
    });
    refunded = paymentOrchestrator.confirmRefund(refunded, {
      tenantId: provisioned.tenantId,
      refundId,
      providerReference: "CASH-REFUND-0001",
      actor: provisioned.userId,
      drawerSessionId: drawerId,
    });
    expect(refunded.paymentOperations!.refunds[0]!.currencyEvidence).toMatchObject({
      baseAmountMinor: 250_000,
      tenderAmountMinor: 1_931,
      rateNumerator: 12_950,
      rateDenominator: 100,
      refundRatePolicy: "ORIGINAL_RATE",
    });
    expect(refunded.paymentOperations!.drawerSessions[0]!.currencyBalances["USD"]).toMatchObject({
      expectedCashMinor: 1_930,
    });
    await repository.saveState(refunded, authenticated, "Foreign cash refund state");
    const closed = await repository.commitMutation({
      actor: authenticated,
      action: "closePaymentDrawer",
      payload: {
        input: {
          tenantId: provisioned.tenantId,
          drawerSessionId: drawerId,
          countedCashMinor: 0,
          countedByCurrency: { KES: 0, USD: 1_900 },
          actor: provisioned.userId,
        },
      },
      idempotencyKey: "cash-control-close-0001",
      requestHash: "cash-control-close-hash-0001",
      correlationId: "cash-control-close-correlation-0001",
    });
    expect(closed.state.paymentOperations!.drawerSessions[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      currencyBalances: { USD: { countedCashMinor: 1_900, varianceMinor: -30 } },
    });
    expect(
      await db
        .prepare(
          `SELECT variance_minor FROM cash_drawer_currency_counts
           WHERE tenant_id=? AND drawer_session_id=? AND currency_code='USD'`,
        )
        .bind(provisioned.tenantId, drawerId)
        .first("variance_minor"),
    ).toBe(-30);
  });

  it("settles an exact split across base and foreign cash without changing the invoice currency", async () => {
    const provisioned = await register("fx-split", "FX Split Restaurant");
    const authenticated = actor(provisioned);
    const service = new LocationCurrencyService(db, authenticated);
    await configureKenyanCurrency(service);
    seedCashConfiguration(provisioned);
    await hydrateAuthoritativeConfiguration(db, { SERAMET_ENVIRONMENT: "test" }, true);
    await saveCurrentUsdRate(service, "current-rate-split-0001");
    const state = createReadyCashBill(provisioned, 12_950);
    const invoice = state.bills[0]!;
    const repository = new D1AuthoritativeTransactionRepository(db);
    await repository.saveState(state, authenticated, "Split payment state");
    await repository.commitMutation({
      actor: authenticated,
      action: "applyConfiguredPayment",
      payload: {
        invoiceId: invoice.id,
        paymentMethodId: "cash-configured",
        amountMinor: 647_500,
        cashTenderedMinor: 647_500,
      },
      idempotencyKey: "split-base-command-0001",
      requestHash: "split-base-hash-0001",
      correlationId: "split-base-correlation-0001",
    });
    const quote = await service.createFxQuote({
      branchId: provisioned.branchId,
      invoiceId: invoice.id,
      paymentMethodId: "cash-configured",
      baseAmountMinor: 647_500,
      tenderCurrency: "USD",
      idempotencyKey: "split-foreign-quote-0001",
    });
    const completed = await repository.commitMutation({
      actor: authenticated,
      action: "applyConfiguredPayment",
      payload: {
        invoiceId: invoice.id,
        paymentMethodId: "cash-configured",
        amountMinor: 647_500,
        fxQuoteId: quote.id,
        tenderCurrency: "USD",
        tenderedAmountMinor: quote.tenderAmountMinor,
      },
      idempotencyKey: "split-foreign-command-0001",
      requestHash: "split-foreign-hash-0001",
      correlationId: "split-foreign-correlation-0001",
    });
    expect(completed.state.bills[0]).toMatchObject({ paymentStatus: "PAID", paid: 12_950 });
    expect(completed.state.paymentOperations!.allocations).toHaveLength(2);
    expect(completed.state.paymentOperations!.drawerSessions[0]!.currencyBalances).toMatchObject({
      KES: { expectedCashMinor: 647_500 },
      USD: { expectedCashMinor: 5_000 },
    });
    expect(
      completed.state.paymentOperations!.journals.every(
        (journal) =>
          journal.lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0) === 0,
      ),
    ).toBe(true);
  });

  async function register(slug: string, tradingName: string) {
    return new RestaurantRegistrationService(db).register(
      {
        provider: "supabase",
        subject: `subject-${slug}`,
        sessionId: `session-${slug}`,
        email: `${slug}@example.test`,
        emailVerified: true,
        issuedAt: Math.floor(Date.now() / 1_000) - 60,
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      },
      {
        idempotencyKey: `registration-${slug}-idempotency`,
        administratorName: "Restaurant owner",
        slug,
        legalName: tradingName,
        tradingName,
      },
    );
  }

  function seedCashConfiguration(provisioned: RestaurantRegistrationResult) {
    for (const [id, code, name, type] of [
      ["cash-account", "CASH", "Configured cash account", "ASSET"],
      ["receivable-account", "AR", "Configured receivable account", "ASSET"],
    ] as const) {
      db.sqlite
        .prepare(
          `INSERT INTO accounts
            (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
           VALUES (?,?,?,?,?,?,'KES',1,'{}')`,
        )
        .run(provisioned.tenantId, id, provisioned.branchId, code, name, type);
    }
    db.sqlite
      .prepare(
        `INSERT INTO payment_methods
          (tenant_id,id,code,category,settlement_account_id,receivable_account_id,cash_account_id,
           active,payload_json)
         VALUES (?,'cash-configured','CASH','CASH','cash-account','receivable-account','cash-account',1,?)`,
      )
      .run(
        provisioned.tenantId,
        JSON.stringify({
          displayName: "Configured cash",
          sortOrder: 10,
          requiresReference: false,
          requiresCustomer: false,
          supportsRefund: true,
          supportsSplit: true,
          metadata: {},
        }),
      );
  }
});

function createReadyCashBill(provisioned: RestaurantRegistrationResult, totalMajor: number) {
  let state = createEmptyTransactionState(provisioned.tenantId);
  state = TransactionEngine.createOrder(
    state,
    {
      tenantId: provisioned.tenantId,
      branchId: provisioned.branchId,
      branch: "Configured branch",
      customer: "Walk-in customer",
      channel: "DINE_IN",
      cashier: "Restaurant owner",
      waiter: "Restaurant owner",
      lines: [
        {
          id: `line-${provisioned.tenantId}`,
          name: "Configured item",
          category: "Configured category",
          quantity: 1,
          unitPrice: totalMajor,
          productionStation: "NONE",
        },
      ],
    },
    "OPEN",
  );
  state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Restaurant owner");
  state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Restaurant owner");
  return paymentOrchestrator.openDrawer(state, {
    tenantId: provisioned.tenantId,
    branchId: provisioned.branchId,
    employeeId: provisioned.userId,
    openingFloatMinor: 0,
    currency: "KES",
    actor: provisioned.userId,
  });
}

function saveCurrentUsdRate(service: LocationCurrencyService, idempotencyKey: string) {
  return service.saveManualRate({
    baseCurrency: "KES",
    tenderCurrency: "USD",
    rateNumerator: 12_950,
    rateDenominator: 100,
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    effectiveUntil: new Date(Date.now() + 3_600_000).toISOString(),
    reason: "Authorized operational cash rate",
    idempotencyKey,
  });
}

async function configureKenyanCurrency(service: LocationCurrencyService) {
  await service.saveOnboardingStep({
    step: 5,
    action: "SAVE",
    response: {
      countryCode: "KE",
      administrativeLevel1: "Nairobi",
      city: "Nairobi",
      addressLine: "Configured address",
    },
  });
  await service.saveOnboardingStep({ step: 6, action: "SAVE", response: { confirmed: true } });
  await service.saveOnboardingStep({
    step: 7,
    action: "SAVE",
    response: {
      baseCurrency: "KES",
      secondaryCurrencies: ["USD"],
      currencyConfigurations: [
        {
          currencyCode: "USD",
          paymentEligible: true,
          cashEligible: true,
          digitalPaymentEligible: false,
          exchangeRatePolicy: "MANUAL",
          rateFreshnessMinutes: 1_440,
          roundingPolicy: "HALF_UP",
          changePolicy: "TENDER_CURRENCY",
          branchIds: [],
          paymentMethodIds: [],
        },
      ],
    },
  });
}

function actor(provisioned: RestaurantRegistrationResult): ServerActor {
  return {
    id: provisioned.userId,
    name: "Restaurant owner",
    tenantId: provisioned.tenantId,
    roleIds: ["tenant-administrator"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: [provisioned.branchId],
    assignedBranches: [{ id: provisioned.branchId, name: "Configured branch" }],
    branchScope: { type: "ALL" },
    branchId: provisioned.branchId,
    branch: "Configured branch",
    role: "Configured administrator",
  };
}
