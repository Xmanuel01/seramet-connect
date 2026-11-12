// Payment methods as onboarding creates them (no accounts of their own; tenant-wide mappings)
// must settle by card, M-Pesa code and bank reference end to end, including the database
// allocation guard. Before migration 0032 every non-cash payment was refused when saved.
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyTransactionState, TransactionEngine } from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import { LocationCurrencyService } from "@/onboarding/location-currency-service";
import { allPermissionCodes } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { hydrateSeededTenantsForTests } from "@/testing/configuration-fixture";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { RestaurantRegistrationService } from "@/server/registration-service";

let db: SqliteD1TestDatabase;
beforeEach(() => {
  db = createMigratedTestDatabase();
});
afterEach(() => {
  setConfigurationRepositoryForTests(undefined);
  db.close();
});

it("settles by M-Pesa code, card and bank reference through the database", async () => {
  const p = await new RestaurantRegistrationService(db).register(
    {
      provider: "supabase",
      subject: "subject-repro",
      sessionId: "session-repro",
      email: "repro@example.test",
      emailVerified: true,
      issuedAt: Math.floor(Date.now() / 1_000) - 60,
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    },
    {
      idempotencyKey: "registration-repro-idempotency",
      administratorName: "Owner",
      slug: "repro",
      legalName: "Repro",
      tradingName: "Repro",
    },
  );
  const actor: ServerActor = {
    id: p.userId,
    name: "Owner",
    tenantId: p.tenantId,
    roleIds: ["tenant-administrator"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: [p.branchId],
    assignedBranches: [{ id: p.branchId, name: "Branch" }],
    branchScope: { type: "ALL" },
    branchId: p.branchId,
    branch: "Branch",
    role: "Admin",
  };
  const loc = new LocationCurrencyService(db, actor);
  await loc.saveOnboardingStep({
    step: 1,
    action: "SAVE",
    response: {
      countryCode: "KE",
      administrativeLevel1: "Nairobi",
      city: "Nairobi",
      addressLine: "Configured address",
      confirmed: true,
    },
  });
  await loc.saveOnboardingStep({
    step: 2,
    action: "SAVE",
    response: { baseCurrency: "KES", secondaryCurrencies: [], currencyConfigurations: [] },
  });
  const stamp = new Date().toISOString();
  for (const [id, code, type] of [
    ["account-standard-1000", "1000", "ASSET"],
    ["account-standard-1010", "1010", "ASSET"],
    ["account-standard-1100", "1100", "ASSET"],
  ] as const)
    db.sqlite
      .prepare(
        "INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json) VALUES (?,?,NULL,?,?,?,'KES',1,'{}')",
      )
      .run(p.tenantId, id, code, code, type);
  for (const [key, acc] of [
    ["CASH", "account-standard-1000"],
    ["PAYMENT_CLEARING", "account-standard-1010"],
    ["CUSTOMER_RECEIVABLE", "account-standard-1100"],
  ])
    db.sqlite
      .prepare(
        "INSERT INTO setup_account_mappings (tenant_id,id,branch_id,scope_key,mapping_key,requirement,account_id,status,updated_by,updated_at) VALUES (?,?,NULL,'TENANT',?,'REQUIRED',?,'CONFIGURED','x',?)",
      )
      .run(p.tenantId, `map-${key}`, key, acc, stamp);
  for (const [id, code, category, name, ref] of [
    ["m-cash", "CASH", "CASH", "Cash", false],
    ["m-mpesa", "MPESA", "DIGITAL_WALLET", "M-Pesa", true],
    ["m-card", "CARD", "CARD", "Card", true],
    ["m-bank", "BANK_TRANSFER", "BANK_TRANSFER", "Bank transfer", true],
  ] as const)
    db.sqlite
      .prepare(
        "INSERT INTO payment_methods (tenant_id,id,code,category,active,payload_json) VALUES (?,?,?,?,1,?)",
      )
      .run(
        p.tenantId,
        id,
        code,
        category,
        JSON.stringify({
          id,
          tenantId: p.tenantId,
          code,
          displayName: name,
          category,
          enabled: true,
          sortOrder: 10,
          requiresReference: ref,
          requiresCustomer: false,
          supportsRefund: true,
          supportsSplit: true,
          metadata: {},
        }),
      );
  await hydrateSeededTenantsForTests(db, { SERAMET_ENVIRONMENT: "test" });

  const repository = new D1AuthoritativeTransactionRepository(db);
  const results: Record<string, string> = {};
  for (const [method, ref] of [
    ["m-mpesa", "SKL4QWERTY"],
    ["m-card", ""],
    ["m-bank", "FT123"],
  ] as const) {
    let state = createEmptyTransactionState(p.tenantId);
    const existing = await repository.loadState(p.tenantId);
    state = existing;
    state = TransactionEngine.createOrder(
      state,
      {
        tenantId: p.tenantId,
        branchId: p.branchId,
        branch: "Branch",
        customer: `Walk-in ${method}`,
        channel: "DINE_IN",
        cashier: "Owner",
        waiter: "Owner",
        lines: [
          {
            id: `line-${method}`,
            name: "Item",
            category: "Cat",
            quantity: 1,
            unitPrice: 100,
            productionStation: "NONE",
          },
        ],
      },
      "OPEN",
    );
    const order = state.orders[0]!;
    state = TransactionEngine.sendToKitchen(state, order.id, "Owner");
    state = TransactionEngine.requestBill(state, order.id, "Owner");
    await repository.saveState(state, actor, "repro");
    const loaded = await repository.loadState(p.tenantId);
    const bill = loaded.bills.find((b) => b.orderIds.includes(order.id))!;
    try {
      const r = await repository.commitMutation({
        actor,
        action: "settleInvoice",
        payload: {
          input: {
            tenantId: p.tenantId,
            invoiceId: bill.id,
            paymentMethodId: method,
            amount: bill.total,
            reference: ref,
            cashier: "Owner",
          },
        },
        idempotencyKey: `settle-${method}-0001`,
        requestHash: `settle-${method}-hash-0001`,
        correlationId: `settle-${method}-corr-0001`,
      });
      results[method] = r.state.bills.find((b) => b.id === bill.id)!.status;
    } catch (error) {
      const e = error as Error & { code?: string; cause?: unknown };
      results[method] =
        "ERROR " +
        e.message +
        " | code=" +
        String(e.code) +
        " | cause=" +
        String((e.cause as Error)?.message ?? e.cause) +
        " | " +
        String(e.stack).split(String.fromCharCode(10)).slice(1, 8).join(" <- ");
    }
  }
  expect(results).toEqual({ "m-mpesa": "PAID", "m-card": "PAID", "m-bank": "PAID" });
});
