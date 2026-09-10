import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CampaignProviderRegistry, TestCampaignProvider } from "@/crm/campaign-provider-registry";
import { CampaignService, renderTemplate, validateTemplate } from "@/crm/campaign-service";
import { calculateRfm, CrmAnalyticsService, evaluateSegment } from "@/crm/crm-analytics";
import { CrmService } from "@/crm/crm-service";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import { IntelligenceEvidenceService } from "@/intelligence/evidence-tools";
import { classifyIntent, planIntelligenceQuery } from "@/intelligence/query-planner";
import type { ServerActor } from "@/lib/seramet-auth";
import { SerametPrintService, type OrderForPrint } from "@/lib/seramet-print-service";
import { createEmptyTransactionState, TransactionEngine } from "@/lib/transaction-engine";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { createDefaultDemoPlatformState } from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { paymentOrchestrator } from "@/payments/payment-orchestrator";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";

describe("Pass 10 CRM, loyalty and customer intelligence", () => {
  let db: SqliteD1TestDatabase;
  let actor: ServerActor;
  let crm: CrmService;
  let value: LoyaltyValueService;

  beforeEach(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    db = createMigratedTestDatabase();
    for (const file of [
      "demo.sql",
      "pass7-demo.sql",
      "pass8-demo.sql",
      "pass9-demo.sql",
      "pass10-demo.sql",
    ]) {
      db.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations", "seed", file), "utf8"));
    }
    actor = testActor();
    crm = new CrmService(db, actor, {
      defaultCallingCode: "254",
      nationalPrefix: "0",
      minNationalDigits: 10,
      maxNationalDigits: 15,
    });
    value = new LoyaltyValueService(db, actor);
  });

  it("applies the current schema with authoritative CRM tables and permissions", () => {
    expect(
      db.sqlite.prepare("SELECT MAX(version) AS version FROM schema_migrations").get(),
    ).toMatchObject({
      version: 17,
    });
    const tables = db.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN
         ('customers','customer_identifiers','loyalty_ledger','voucher_redemptions',
          'gift_card_ledger','campaign_deliveries','customer_feedback')`,
      )
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(7);
    expect(allPermissionCodes).toContain(permissions.crmCustomerMerge);
    expect(allPermissionCodes).toContain(permissions.campaignSend);
  });

  it("creates a minimal customer and resolves exact normalized phone and email", async () => {
    const customer = await crm.createCustomer({
      displayName: "Exact Identity",
      phone: "0712 345 678",
      email: " Identity@Example.Test ",
      createdSource: "POS",
      preferredBranchId: branchId,
    });
    await expect(
      crm.resolveIdentity({ type: "PHONE", value: "+254712345678" }),
    ).resolves.toMatchObject({
      customerId: customer.id,
      exact: true,
    });
    await expect(
      crm.resolveIdentity({ type: "EMAIL", value: "identity@example.test" }),
    ).resolves.toMatchObject({
      customerId: customer.id,
    });
  });

  it("does not auto-merge similar names", async () => {
    const first = await crm.createCustomer({ displayName: "Alex Sample", createdSource: "POS" });
    const second = await crm.createCustomer({ displayName: "Alex Samples", createdSource: "POS" });
    expect(first.id).not.toBe(second.id);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM customer_aliases").get()).toMatchObject(
      { count: 0 },
    );
  });

  it("rejects exact identifier reuse within a tenant while allowing the same identifier in another tenant", async () => {
    await crm.createCustomer({ displayName: "First", phone: "0712 300 300", createdSource: "POS" });
    await expect(
      crm.createCustomer({
        displayName: "Duplicate",
        phone: "+254712300300",
        createdSource: "POS",
      }),
    ).rejects.toThrow(/already exists/);
    seedOtherTenant(db);
    const otherCrm = new CrmService(db, testActor("tenant-other", "branch-other"), {
      defaultCallingCode: "254",
      nationalPrefix: "0",
    });
    await expect(
      otherCrm.createCustomer({
        displayName: "Other tenant",
        phone: "+254712300300",
        createdSource: "POS",
      }),
    ).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("merges through immutable aliases, preserves history and treats retries idempotently", async () => {
    const canonical = await crm.createCustomer({ displayName: "Canonical", createdSource: "POS" });
    const duplicate = await crm.createCustomer({
      displayName: "Duplicate",
      phone: "0712 600 601",
      createdSource: "POS",
    });
    const input = {
      canonicalCustomerId: canonical.id,
      duplicateCustomerId: duplicate.id,
      reason: "Verified same person",
      idempotencyKey: "merge-001",
    };
    await expect(crm.mergeCustomers(input)).resolves.toMatchObject({ duplicate: false });
    await expect(crm.mergeCustomers(input)).resolves.toMatchObject({ duplicate: true });
    await expect(
      crm.resolveIdentity({ type: "PHONE", value: "+254712600601" }),
    ).resolves.toMatchObject({
      customerId: canonical.id,
      matchedCustomerId: duplicate.id,
    });
    expect(() => db.sqlite.prepare("UPDATE customer_aliases SET reason='changed'").run()).toThrow(
      /immutable/,
    );
  });

  it("enforces merge permission", async () => {
    const limited = new CrmService(
      db,
      testActor(tenantId, branchId, [permissions.crmCustomerManage]),
    );
    await expect(
      limited.mergeCustomers({
        canonicalCustomerId: "customer-demo-001",
        duplicateCustomerId: "customer-demo-002",
        reason: "No permission",
        idempotencyKey: "merge-denied",
      }),
    ).rejects.toThrow(/permission/);
  });

  it("defaults absent consent to UNKNOWN and withdrawal immediately suppresses marketing", async () => {
    const customer = await crm.createCustomer({
      displayName: "Consent Test",
      email: "consent@example.test",
      createdSource: "POS",
    });
    const before = await crm.customerProfile(customer.id);
    expect(before.consents.find((item) => item.channel === "EMAIL_MARKETING")?.status).toBe(
      "UNKNOWN",
    );
    await crm.appendConsent({
      customerId: customer.id,
      channel: "EMAIL_MARKETING",
      status: "GRANTED",
      source: "SIGNED_FORM",
      policyVersion: "v1",
      proofReference: "proof-1",
    });
    await crm.appendConsent({
      customerId: customer.id,
      channel: "EMAIL_MARKETING",
      status: "WITHDRAWN",
      source: "UNSUBSCRIBE",
      policyVersion: "v1",
    });
    const after = await crm.customerProfile(customer.id);
    expect(after.consents.find((item) => item.channel === "EMAIL_MARKETING")?.status).toBe(
      "WITHDRAWN",
    );
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM customer_suppressions WHERE customer_id=?")
        .get(customer.id),
    ).toMatchObject({
      count: 1,
    });
    expect(() => db.sqlite.prepare("DELETE FROM customer_consents").run()).toThrow(/append-only/);
  });

  it("anonymizes direct identifiers while preserving transaction and financial references", async () => {
    const request = await crm.createPrivacyRequest({
      customerId: "customer-demo-001",
      requestType: "ANONYMIZATION",
      requestReference: "privacy-001",
    });
    await crm.anonymizeCustomer(request.id, "Verified customer request");
    const customer = db.sqlite
      .prepare(
        "SELECT status,phone_display,email_display FROM customers WHERE tenant_id=? AND id=?",
      )
      .get(tenantId, "customer-demo-001");
    expect(customer).toMatchObject({
      status: "ANONYMIZED",
      phone_display: null,
      email_display: null,
    });
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM loyalty_ledger WHERE customer_id='customer-demo-001'",
        )
        .get(),
    ).toMatchObject({
      count: 1,
    });
    expect(
      db.sqlite.prepare("SELECT status FROM customer_privacy_requests WHERE id=?").get(request.id),
    ).toMatchObject({
      status: "COMPLETED",
    });
  });

  it("provides PII-masked search without contact permission", async () => {
    const limited = new CrmService(
      db,
      testActor(tenantId, branchId, [
        permissions.crmCustomerView,
        permissions.crmCustomerValueView,
      ]),
      { defaultCallingCode: "254", nationalPrefix: "0" },
    );
    const result = await limited.searchCustomers({ query: "Kelvin" });
    expect(result.customers[0]?.phone).toMatch(/^\*\*\*/);
    expect(result.customers[0]?.email).toContain("***@");
  });

  it("creates data-driven loyalty programs, tiers and rewards", async () => {
    const program = await value.createProgram({
      code: "CUSTOM",
      name: "Configured program",
      scopeType: "BRANCH",
      branchId,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      earningType: "SPEND",
      spendMinorPerPoint: 10_000,
      minimumSpendMinor: 0,
      roundingPolicy: "FLOOR",
      expiryType: "NONE",
      eligibleBranchIds: [branchId],
      eligibleChannels: ["DINE_IN"],
      redemptionRules: {},
    });
    const tier = await value.createTier({
      programId: program.id,
      code: "LEVEL_A",
      name: "Configured level",
      rank: 0,
      qualificationType: "LIFETIME_SPEND",
      thresholdMinorOrPoints: 0,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    const reward = await value.createReward({
      programId: program.id,
      code: "RWD-A",
      name: "Configured reward",
      rewardType: "FIXED_DISCOUNT",
      pointsCost: 100,
      valueMinor: 10_000,
      minimumTierId: tier.id,
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    expect(program.status).toBe("ACTIVE");
    expect(tier.id).toBeTruthy();
    expect(reward.id).toBeTruthy();
  });

  it("earns points exactly once from a completed transaction and derives balance from ledger", async () => {
    const entries = await value.earnForCompletedTransaction({
      customerId: "customer-demo-001",
      branchId,
      brandId: "brand-demo-mona",
      channel: "DINE_IN",
      netSpendMinor: 150_000,
      sourceType: "ORDER",
      sourceId: "order-loyalty-001",
      businessDate: "2026-09-01",
      idempotencyPrefix: "earn:order-loyalty-001",
    });
    const replay = await value.earnForCompletedTransaction({
      customerId: "customer-demo-001",
      branchId,
      brandId: "brand-demo-mona",
      channel: "DINE_IN",
      netSpendMinor: 150_000,
      sourceType: "ORDER",
      sourceId: "order-loyalty-001",
      businessDate: "2026-09-01",
      idempotencyPrefix: "earn:order-loyalty-001",
    });
    expect(entries.some((entry) => entry.points > 0 && !entry.duplicate)).toBe(true);
    expect(replay.every((entry) => entry.duplicate)).toBe(true);
    expect(await value.loyaltyBalance("customer-demo-001", "loyalty-demo-program")).toBeGreaterThan(
      4820,
    );
  });

  it("blocks insufficient points and makes concurrent redemption single-spend", async () => {
    await expect(
      value.redeemPoints({
        customerId: "customer-demo-002",
        programId: "loyalty-demo-program",
        branchId,
        channel: "DINE_IN",
        points: 3000,
        orderId: "order-too-many",
        businessDate: "2026-09-01",
        idempotencyKey: "redeem-too-many",
      }),
    ).rejects.toThrow(/insufficient/);
    const request = (key: string) =>
      value.redeemPoints({
        customerId: "customer-demo-002",
        programId: "loyalty-demo-program",
        branchId,
        channel: "DINE_IN",
        points: 1500,
        orderId: key,
        businessDate: "2026-09-01",
        idempotencyKey: key,
      });
    const settled = await Promise.allSettled([request("redeem-a"), request("redeem-b")]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await value.loyaltyBalance("customer-demo-002", "loyalty-demo-program")).toBe(640);
  });

  it("reverses refund points idempotently", async () => {
    await value.earnForCompletedTransaction({
      customerId: "customer-demo-002",
      branchId,
      channel: "DINE_IN",
      netSpendMinor: 100_000,
      sourceType: "ORDER",
      sourceId: "order-refund-001",
      businessDate: "2026-09-01",
      idempotencyPrefix: "earn:refund-001",
    });
    const first = await value.reverseTransactionPoints({
      sourceId: "order-refund-001",
      branchId,
      businessDate: "2026-09-01",
      idempotencyPrefix: "refund:001",
    });
    const replay = await value.reverseTransactionPoints({
      sourceId: "order-refund-001",
      branchId,
      businessDate: "2026-09-01",
      idempotencyPrefix: "refund:001",
    });
    expect(first.some((entry) => !entry.duplicate)).toBe(true);
    expect(replay.every((entry) => entry.duplicate)).toBe(true);
  });

  it("expires points idempotently", async () => {
    db.sqlite
      .prepare(
        `INSERT INTO loyalty_ledger
          (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,
           business_date,expires_at,reason,actor_id,correlation_id,idempotency_key,created_at)
         VALUES (?,?,?,?,?,'EARN',100,'TEST','expired-test','2026-01-01','2026-02-01T00:00:00.000Z',
           'Expiry fixture',?,?,?,?)`,
      )
      .run(
        tenantId,
        "ledger-expired-test",
        "customer-demo-002",
        "loyalty-demo-program",
        branchId,
        actor.id,
        "expiry-correlation",
        "expiry-fixture",
        "2026-01-01T00:00:00.000Z",
      );
    const first = await value.expirePoints(new Date("2026-09-01T00:00:00.000Z"));
    const replay = await value.expirePoints(new Date("2026-09-01T00:00:00.000Z"));
    expect(first.expiredEntries).toBe(1);
    expect(replay.expiredEntries).toBe(0);
  });

  it("validates and redeems vouchers idempotently with branch, channel and usage rules", async () => {
    const definition = await value.createVoucherDefinition({
      code: "PROMO10",
      name: "Configured promotion",
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
      branchIds: [branchId],
      channels: ["DINE_IN"],
      itemIds: [],
      categoryCodes: [],
      minimumSpendMinor: 100_000,
      currency: "KES",
      discountType: "PERCENT_BPS",
      discountValue: 1000,
      usageCap: 1,
      perCustomerCap: 1,
      customerSpecific: false,
      singleUse: false,
      stackingPolicy: "BLOCK",
      stackingPriority: 10,
    });
    const input = {
      code: "promo10",
      customerId: "customer-demo-001",
      branchId,
      orderId: "voucher-order-1",
      channel: "DINE_IN",
      subtotalMinor: 200_000,
      currency: "KES",
      idempotencyKey: "voucher-redemption-1",
    };
    await expect(value.redeemVoucher(input)).resolves.toMatchObject({
      discountMinor: 20_000,
      duplicate: false,
    });
    await expect(value.redeemVoucher(input)).resolves.toMatchObject({ duplicate: true });
    await expect(
      value.redeemVoucher({
        ...input,
        orderId: "voucher-order-2",
        idempotencyKey: "voucher-redemption-2",
      }),
    ).rejects.toThrow(/usage cap/);
    expect(definition.id).toBeTruthy();
  });

  it("issues strong customer-specific vouchers without storing plaintext codes", async () => {
    const definition = await value.createVoucherDefinition({
      code: "RECOVERY",
      name: "Service recovery",
      validFrom: "2026-01-01T00:00:00.000Z",
      branchIds: [],
      channels: [],
      itemIds: [],
      categoryCodes: [],
      minimumSpendMinor: 0,
      currency: "KES",
      discountType: "FIXED_MINOR",
      discountValue: 50_000,
      customerSpecific: true,
      singleUse: true,
      stackingPolicy: "BLOCK",
      stackingPriority: 1,
    });
    const issue = await value.issueVoucher({
      voucherDefinitionId: definition.id,
      customerId: "customer-demo-001",
      sourceType: "FEEDBACK_RECOVERY",
    });
    const stored = db.sqlite
      .prepare("SELECT code_hash,code_last_four FROM voucher_issues WHERE id=?")
      .get(issue.id) as {
      code_hash: string;
      code_last_four: string;
    };
    expect(issue.code).toMatch(/^VCH-/);
    expect(stored.code_hash).not.toContain(issue.code);
    expect(stored.code_last_four).toBe(issue.code.slice(-4));
  });

  it("applies deterministic promotion stacking", () => {
    expect(
      LoyaltyValueService.applyStacking([
        { id: "a", discountMinor: 100, stackingPolicy: "ALLOW", stackingPriority: 2 },
        { id: "b", discountMinor: 200, stackingPolicy: "BEST_ONLY", stackingPriority: 1 },
      ]).map((item) => item.id),
    ).toEqual(["b"]);
  });

  it("issues a gift card as liability with hashed token and balanced journal", async () => {
    const card = await value.issueGiftCard({
      amountMinor: 500_000,
      currency: "KES",
      purchaserCustomerId: "customer-demo-001",
      liabilityAccountId: "account-demo-gift-liability",
      collectionAccountId: "account-demo-gift-collection",
      redemptionAccountId: "account-demo-gift-redemption",
      businessDate: "2026-09-01",
      idempotencyKey: "gift-issue-001",
    });
    expect(card.token).toMatch(/^GFT-/);
    const stored = db.sqlite
      .prepare("SELECT token_hash FROM gift_cards WHERE id=?")
      .get(card.id) as {
      token_hash: string;
    };
    expect(stored.token_hash).not.toContain(card.token!);
    const journal = db.sqlite
      .prepare(
        `SELECT SUM(debit_minor) AS debits,SUM(credit_minor) AS credits
         FROM journal_lines WHERE journal_entry_id=(SELECT journal_entry_id FROM gift_card_ledger WHERE gift_card_id=?)`,
      )
      .get(card.id);
    expect(journal).toMatchObject({ debits: 500_000, credits: 500_000 });
  });

  it("prevents gift-card overspend and concurrent double redemption", async () => {
    const card = await value.issueGiftCard({
      amountMinor: 100_000,
      currency: "KES",
      liabilityAccountId: "account-demo-gift-liability",
      collectionAccountId: "account-demo-gift-collection",
      redemptionAccountId: "account-demo-gift-redemption",
      businessDate: "2026-09-01",
      idempotencyKey: "gift-issue-concurrent",
    });
    const redeem = (key: string) =>
      value.redeemGiftCard({
        token: card.token!,
        amountMinor: 75_000,
        currency: "KES",
        branchId,
        orderId: key,
        businessDate: "2026-09-01",
        idempotencyKey: key,
      });
    const settled = await Promise.allSettled([redeem("gift-redeem-a"), redeem("gift-redeem-b")]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    await expect(
      value.redeemGiftCard({
        token: card.token!,
        amountMinor: 50_000,
        currency: "KES",
        branchId,
        orderId: "gift-over",
        businessDate: "2026-09-01",
        idempotencyKey: "gift-over",
      }),
    ).rejects.toThrow(/insufficient/);
    expect((await value.giftCardBalance(card.token!)).balance_minor).toBe(25_000);
  });

  it("rejects gift-card currency mismatch", async () => {
    const card = await value.issueGiftCard({
      amountMinor: 100_000,
      currency: "KES",
      liabilityAccountId: "account-demo-gift-liability",
      collectionAccountId: "account-demo-gift-collection",
      redemptionAccountId: "account-demo-gift-redemption",
      businessDate: "2026-09-01",
      idempotencyKey: "gift-currency",
    });
    await expect(
      value.redeemGiftCard({
        token: card.token!,
        amountMinor: 10_000,
        currency: "USD",
        branchId,
        orderId: "currency-order",
        businessDate: "2026-09-01",
        idempotencyKey: "gift-currency-redeem",
      }),
    ).rejects.toThrow(/currency/);
  });

  it("evaluates deterministic segments and RFM without protected fields", () => {
    expect(
      evaluateSegment(
        { all: [{ field: "orderCount", operator: "GTE", value: 3 }] },
        {
          orderCount: 4,
          netSpendMinor: 100,
          averageOrderMinor: 25,
          daysSinceLastVisit: 2,
          refundMinor: 0,
          discountMinor: 0,
          loyaltyPoints: 10,
        },
      ),
    ).toBe(true);
    expect(
      calculateRfm(
        { daysSinceLastVisit: 5, orderCount: 10, netSpendMinor: 2_000_000 },
        {
          recencyDays: [7, 30, 60, 90],
          frequency: [2, 4, 8, 16],
          monetaryMinor: [100_000, 500_000, 1_000_000, 5_000_000],
        },
      ),
    ).toEqual({ recency: 5, frequency: 4, monetary: 4 });
  });

  it("builds segment snapshots and cohort/retention read models from authoritative links", async () => {
    seedCustomerLinks(db);
    const analytics = new CrmAnalyticsService(db, actor);
    await analytics.recalculateMetrics(branchId);
    const campaigns = new CampaignService(db, actor);
    const segment = await campaigns.createSegment({
      code: "FREQUENT_TEST",
      name: "Frequent test",
      definition: { all: [{ field: "orderCount", operator: "GTE", value: 2 }] },
    });
    await expect(campaigns.buildSegmentSnapshot(segment.id, branchId)).resolves.toMatchObject({
      customerCount: 3,
    });
    await expect(analytics.retentionSummary({ branchId, lapsedDays: 60 })).resolves.toMatchObject({
      identifiedCustomers: 1,
      repeatCustomers: 1,
      lapsedDefinitionDays: 60,
    });
    const cohorts = await analytics.cohortRetention(branchId);
    expect(cohorts[0]?.retention[0]?.rateBps).toBe(10_000);
  });

  it("validates campaign templates and blocks unknown variables", () => {
    expect(validateTemplate("Hello {{customer.firstName}} from {{restaurant.name}}")).toEqual([
      "customer.firstName",
      "restaurant.name",
    ]);
    expect(renderTemplate("Hi {{customer.firstName}}", { "customer.firstName": "A" })).toBe("Hi A");
    expect(() => validateTemplate("{{customer.religion}}")).toThrow(/Unknown template/);
  });

  it("builds a tenant-scoped, consent-gated campaign audience and never returns provider secrets", async () => {
    const registry = new CampaignProviderRegistry().register(new TestCampaignProvider());
    const campaigns = new CampaignService(db, actor, registry);
    await campaigns.upsertProviderConfig({
      id: "provider-test-campaign",
      providerKey: "TEST_COMMUNICATION_PROVIDER",
      displayName: "Configured test provider",
      capabilities: ["SEND_EMAIL"],
      secretReference: "secret://campaign/test",
    });
    const providerHealth = await campaigns.providerHealth();
    expect(providerHealth[0]).not.toHaveProperty("secretReference");
    const campaign = await campaigns.createCampaign({
      name: "Consent campaign",
      objective: "Test consent gate",
      segmentId: "segment-demo-repeat",
      channels: ["EMAIL"],
      templateBody: "Hello {{customer.firstName}}",
      branchIds: [branchId],
      brandIds: [],
      providerConfigId: "provider-test-campaign",
      approvalRequired: true,
    });
    const preview = await campaigns.previewCampaign(campaign.id);
    expect(preview.eligible).toBe(1);
    expect(preview.noConsent).toBeGreaterThanOrEqual(1);
  });

  it("does not send a draft campaign and sends an approved campaign idempotently", async () => {
    const registry = new CampaignProviderRegistry().register(new TestCampaignProvider());
    const campaigns = new CampaignService(db, actor, registry);
    await campaigns.upsertProviderConfig({
      id: "provider-send",
      providerKey: "TEST_COMMUNICATION_PROVIDER",
      displayName: "Configured test provider",
      capabilities: ["SEND_EMAIL"],
      secretReference: "secret://campaign/send",
      batchSize: 50,
    });
    const campaign = await campaigns.createCampaign({
      name: "Approved campaign",
      objective: "Test delivery",
      segmentId: "segment-demo-repeat",
      channels: ["EMAIL"],
      templateBody: "Hello {{customer.firstName}}",
      branchIds: [branchId],
      brandIds: [],
      providerConfigId: "provider-send",
      approvalRequired: true,
    });
    await expect(campaigns.queueCampaign(campaign.id)).rejects.toThrow(/Draft/);
    await campaigns.approveCampaign(campaign.id, "Approved test delivery");
    const first = await campaigns.processCampaign(campaign.id);
    const second = await campaigns.processCampaign(campaign.id);
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM campaign_deliveries WHERE status='SENT'")
        .get(),
    ).toMatchObject({
      count: 1,
    });
  });

  it("moves permanent campaign failures to dead letter without duplicate delivery rows", async () => {
    const registry = new CampaignProviderRegistry().register(new TestCampaignProvider("PERMANENT"));
    const campaigns = new CampaignService(db, actor, registry);
    await campaigns.upsertProviderConfig({
      id: "provider-fail",
      providerKey: "TEST_COMMUNICATION_PROVIDER",
      displayName: "Failing test provider",
      capabilities: ["SEND_EMAIL"],
      maxAttempts: 1,
    });
    const campaign = await campaigns.createCampaign({
      name: "Failure campaign",
      objective: "Test dead letter",
      segmentId: "segment-demo-repeat",
      channels: ["EMAIL"],
      templateBody: "Hello {{customer.firstName}}",
      branchIds: [branchId],
      brandIds: [],
      providerConfigId: "provider-fail",
      approvalRequired: false,
    });
    await campaigns.approveCampaign(campaign.id, "Approved failure fixture");
    await campaigns.processCampaign(campaign.id);
    expect(db.sqlite.prepare("SELECT status FROM campaign_deliveries LIMIT 1").get()).toMatchObject(
      {
        status: "DEAD_LETTER",
      },
    );
  });

  it("records feedback, calculates NPS only from NPS surveys and audits resolution", async () => {
    const feedback = await crm.createFeedback({
      branchId,
      customerId: "customer-demo-001",
      categoryId: "feedback-category-service",
      surveyType: "GENERAL",
      rating: 10,
      comment: "General rating only",
      source: "STAFF_ENTRY",
    });
    await crm.resolveFeedback({
      feedbackId: feedback.id,
      status: "RESOLVED",
      note: "Followed up",
      resolution: "Resolved without automatic compensation",
    });
    await crm.createFeedback({
      branchId,
      categoryId: "feedback-category-service",
      surveyType: "NPS",
      rating: 2,
      source: "POST_PURCHASE",
    });
    const dashboard = await crm.dashboard(branchId);
    expect(dashboard.nps).toBe(-50);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM customer_feedback_events WHERE feedback_id=?")
        .get(feedback.id),
    ).toMatchObject({
      count: 2,
    });
  });

  it("previews and commits customer imports idempotently and rejects unsupported consent evidence", async () => {
    const preview = await crm.previewCustomerImport({
      sourceName: "customers.csv",
      fileHash: "1234567890abcdef1234567890abcdef",
      idempotencyKey: "customer-import-001",
      rows: [
        { displayName: "Imported valid", email: "imported@example.test", tags: [] },
        {
          displayName: "Consent invalid",
          email: "invalid-consent@example.test",
          tags: [],
          consentStatus: "GRANTED",
        },
      ],
    });
    expect(preview.valid).toBe(1);
    expect(preview.invalid).toBe(1);
    await expect(crm.commitCustomerImport(preview.id)).resolves.toMatchObject({
      created: 1,
      duplicate: false,
    });
    await expect(crm.commitCustomerImport(preview.id)).resolves.toMatchObject({ duplicate: true });
  });

  it("keeps customer export tenant scoped and permission controlled", async () => {
    const rows = await crm.exportCustomers();
    expect(rows).toHaveLength(3);
    seedOtherTenant(db);
    db.sqlite
      .prepare(
        `INSERT INTO customers
          (tenant_id,id,customer_code,display_name,status,created_source,created_by,created_at,updated_at)
         VALUES ('tenant-other','other-customer','OTHER-1','Other tenant customer','ACTIVE','TEST','TEST',?,?)`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
    expect(await crm.exportCustomers()).toHaveLength(3);
    const denied = new CrmService(db, testActor(tenantId, branchId, [permissions.crmCustomerView]));
    await expect(denied.exportCustomers()).rejects.toThrow(/permission/);
  });

  it("preserves append-only loyalty, gift-card, consent and redemption histories", () => {
    expect(() => db.sqlite.prepare("DELETE FROM loyalty_ledger").run()).toThrow(/append-only/);
    expect(
      db.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name='gift_card_ledger_no_delete'",
        )
        .get(),
    ).toMatchObject({ name: "gift_card_ledger_no_delete" });
    expect(() => db.sqlite.prepare("DELETE FROM customer_consents").run()).toThrow(/append-only/);
  });

  it("atomically redeems a gift card into payment, allocation, receipt, ledger and balanced journal", async () => {
    const repository = new D1AuthoritativeTransactionRepository(db);
    const { invoiceId, amountMinor } = await openCustomerInvoice(repository, actor, "gift");
    const card = await value.issueGiftCard({
      amountMinor,
      currency: "KES",
      recipientCustomerId: "customer-demo-001",
      liabilityAccountId: "account-demo-gift-card-liability",
      collectionAccountId: "account-demo-gift-card-collection",
      redemptionAccountId: "account-demo-gift-card-redemption",
      businessDate: "2026-09-01",
      idempotencyKey: "gift-checkout-issue",
    });
    const result = await repository.commitMutation({
      actor,
      action: "applyGiftCardRedemption",
      payload: {
        input: {
          invoiceId,
          paymentMethodId: "payment-demo-gift-card",
          token: card.token,
          amountMinor,
        },
      },
      idempotencyKey: "gift-checkout-redeem",
      requestHash: "gift-checkout-hash",
      correlationId: "gift-checkout-correlation",
    });
    expect(result.state.bills.find((bill) => bill.id === invoiceId)?.status).toBe("PAID");
    expect(result.state.paymentOperations?.allocations).toHaveLength(1);
    expect(result.state.receipts).toHaveLength(1);
    expect(
      db.sqlite
        .prepare(
          "SELECT amount_minor FROM gift_card_ledger WHERE source_type='PAYMENT_TRANSACTION'",
        )
        .get(),
    ).toMatchObject({ amount_minor: -amountMinor });
    const journal = db.sqlite
      .prepare(
        `SELECT SUM(debit_minor) AS debit,SUM(credit_minor) AS credit FROM journal_lines
         WHERE tenant_id=? AND journal_entry_id LIKE 'crm-value:%'`,
      )
      .get(tenantId) as { debit: number; credit: number };
    expect(journal.debit).toBe(amountMinor);
    expect(journal.credit).toBe(amountMinor);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM customer_transaction_links WHERE source_type='ORDER'",
        )
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it("server-calculates a voucher checkout and rejects a replay with a different mutation key", async () => {
    const repository = new D1AuthoritativeTransactionRepository(db);
    const { invoiceId, orderId } = await openCustomerInvoice(repository, actor, "voucher");
    const definition = await value.createVoucherDefinition({
      code: "CHECKOUT10",
      name: "Checkout test",
      validFrom: "2026-01-01T00:00:00.000Z",
      branchIds: [branchId],
      channels: ["DINE_IN"],
      itemIds: [],
      categoryCodes: [],
      minimumSpendMinor: 0,
      currency: "KES",
      discountType: "FIXED_MINOR",
      discountValue: 1_000,
      usageCap: 1,
      customerSpecific: false,
      singleUse: false,
      stackingPolicy: "BLOCK",
      stackingPriority: 10,
    });
    expect(definition.id).toBeTruthy();
    const first = repository.commitMutation({
      actor,
      action: "applyVoucherRedemption",
      payload: {
        input: { invoiceId, paymentMethodId: "payment-demo-voucher", code: "CHECKOUT10" },
      },
      idempotencyKey: "voucher-checkout-one",
      requestHash: "voucher-checkout-hash-one",
      correlationId: "voucher-checkout-correlation-one",
    });
    await expect(first).resolves.toMatchObject({ duplicate: false });
    await expect(
      repository.commitMutation({
        actor,
        action: "applyVoucherRedemption",
        payload: {
          input: { invoiceId, paymentMethodId: "payment-demo-voucher", code: "CHECKOUT10" },
        },
        idempotencyKey: "voucher-checkout-two",
        requestHash: "voucher-checkout-hash-two",
        correlationId: "voucher-checkout-correlation-two",
      }),
    ).rejects.toThrow(/usage|limit|available|conflict/i);
    expect(
      db.sqlite
        .prepare("SELECT order_id,discount_minor FROM voucher_redemptions WHERE status='CONFIRMED'")
        .get(),
    ).toMatchObject({ order_id: orderId, discount_minor: 1_000 });
  });

  it("restores a single-use voucher once when its confirmed payment is fully refunded", async () => {
    const repository = new D1AuthoritativeTransactionRepository(db);
    const invoice = await openCustomerInvoice(repository, actor, "voucher-refund");
    const definition = await value.createVoucherDefinition({
      code: "REFUNDABLE10",
      name: "Refundable configured voucher",
      validFrom: "2026-01-01T00:00:00.000Z",
      branchIds: [branchId],
      channels: ["DINE_IN"],
      itemIds: [],
      categoryCodes: [],
      minimumSpendMinor: 0,
      currency: "KES",
      discountType: "FIXED_MINOR",
      discountValue: 1_000,
      customerSpecific: true,
      singleUse: true,
      stackingPolicy: "BLOCK",
      stackingPriority: 1,
      refundPolicy: "RESTORE_ON_FULL_REFUND",
    });
    const issue = await value.issueVoucher({
      voucherDefinitionId: definition.id,
      customerId: "customer-demo-001",
      sourceType: "TEST",
    });
    const paid = await repository.commitMutation({
      actor,
      action: "applyVoucherRedemption",
      payload: {
        input: {
          invoiceId: invoice.invoiceId,
          paymentMethodId: "payment-demo-voucher",
          code: issue.code,
        },
      },
      idempotencyKey: "voucher-refund-payment",
      requestHash: "voucher-refund-payment-hash",
      correlationId: "voucher-refund-payment-correlation",
    });
    const collection = paid.state.paymentOperations!.transactions.find(
      (transaction) => transaction.metadata["customerValueType"] === "VOUCHER",
    )!;
    let refunded = paymentOrchestrator.requestRefund(paid.state, {
      tenantId,
      transactionId: collection.id,
      amountMinor: collection.amountMinor,
      currency: "KES",
      reason: "Confirmed voucher payment refund",
      requestedBy: actor.name,
    });
    const refundId = refunded.paymentOperations!.refunds[0]!.id;
    refunded = paymentOrchestrator.approveRefund(refunded, {
      tenantId,
      refundId,
      approvedBy: actor.name,
    });
    refunded = paymentOrchestrator.confirmRefund(refunded, {
      tenantId,
      refundId,
      providerReference: "VOUCHER-REFUND-CONFIRMED",
      actor: actor.name,
    });
    await repository.saveState(refunded, actor, "Confirmed voucher refund");
    await repository.saveState(refunded, actor, "Idempotent voucher refund replay");
    expect(
      db.sqlite.prepare("SELECT status FROM voucher_issues WHERE id=?").get(issue.id),
    ).toMatchObject({
      status: "ACTIVE",
    });
    expect(
      db.sqlite
        .prepare(
          `SELECT status,COUNT(*) AS count FROM voucher_redemptions
           WHERE voucher_issue_id=? GROUP BY status ORDER BY status`,
        )
        .all(issue.id),
    ).toEqual([
      { status: "CONFIRMED", count: 1 },
      { status: "REVERSED", count: 1 },
    ]);
  });

  it("reverses earned points and restores gift-card value once after a confirmed refund", async () => {
    const repository = new D1AuthoritativeTransactionRepository(db);
    const { invoiceId, amountMinor } = await openCustomerInvoice(repository, actor, "refund");
    const card = await value.issueGiftCard({
      amountMinor,
      currency: "KES",
      recipientCustomerId: "customer-demo-001",
      liabilityAccountId: "account-demo-gift-card-liability",
      collectionAccountId: "account-demo-gift-card-collection",
      redemptionAccountId: "account-demo-gift-card-redemption",
      businessDate: "2026-09-01",
      idempotencyKey: "gift-refund-issue",
    });
    const paid = await repository.commitMutation({
      actor,
      action: "applyGiftCardRedemption",
      payload: {
        input: {
          invoiceId,
          paymentMethodId: "payment-demo-gift-card",
          token: card.token,
          amountMinor,
        },
      },
      idempotencyKey: "gift-refund-payment",
      requestHash: "gift-refund-payment-hash",
      correlationId: "gift-refund-payment-correlation",
    });
    const collection = paid.state.paymentOperations!.transactions.find(
      (transaction) => transaction.metadata["customerValueType"] === "GIFT_CARD",
    )!;
    let refunded = paymentOrchestrator.requestRefund(paid.state, {
      tenantId,
      transactionId: collection.id,
      amountMinor,
      currency: "KES",
      reason: "Confirmed full refund",
      requestedBy: actor.name,
    });
    const refundId = refunded.paymentOperations!.refunds[0]!.id;
    refunded = paymentOrchestrator.approveRefund(refunded, {
      tenantId,
      refundId,
      approvedBy: actor.name,
    });
    refunded = paymentOrchestrator.confirmRefund(refunded, {
      tenantId,
      refundId,
      providerReference: "GIFT-REFUND-CONFIRMED",
      actor: actor.name,
    });
    await repository.saveState(refunded, actor, "Confirmed gift-card refund");
    await repository.saveState(refunded, actor, "Idempotent gift-card refund replay");
    expect(await value.giftCardBalance(card.token!)).toMatchObject({ balance_minor: amountMinor });
    const loyalty = db.sqlite
      .prepare(
        `SELECT COALESCE(SUM(points),0) AS balance FROM loyalty_ledger
         WHERE source_type IN ('ORDER','REFUND') AND customer_id='customer-demo-001'`,
      )
      .get() as { balance: number };
    expect(loyalty.balance).toBe(0);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM gift_card_ledger WHERE entry_type='REFUND'")
        .get(),
    ).toMatchObject({ count: 1 });
    const link = db.sqlite
      .prepare("SELECT gross_minor,net_minor,refund_minor FROM customer_transaction_links")
      .get() as { gross_minor: number; net_minor: number; refund_minor: number };
    expect(link.refund_minor).toBe(amountMinor);
    expect(link.net_minor).toBe(0);
  });

  it("rejects cross-tenant and unauthorized branch customer and privacy access", async () => {
    seedOtherTenant(db);
    const other = new CrmService(db, testActor("tenant-other", "branch-other"), {
      defaultCallingCode: "254",
      nationalPrefix: "0",
    });
    const otherCustomer = await other.createCustomer({
      displayName: "Other tenant customer",
      preferredBranchId: "branch-other",
      createdSource: "TEST",
    });
    await expect(crm.customerProfile(otherCustomer.id)).rejects.toThrow(/not found/i);

    const restrictedActor = branchActor("branch-demo-ngong-road");
    const restricted = new CrmService(db, restrictedActor, {
      defaultCallingCode: "254",
      nationalPrefix: "0",
    });
    await expect(restricted.customerProfile("customer-demo-001")).rejects.toThrow(/branch scope/i);
    await expect(
      restricted.createPrivacyRequest({
        customerId: "customer-demo-001",
        requestType: "EXPORT",
        requestReference: "branch-denied-export",
      }),
    ).rejects.toThrow(/branch scope/i);
    expect((await restricted.searchCustomers({ query: "Kelvin" })).customers).toHaveLength(0);
  });

  it("expires voucher definitions and issued codes durably and idempotently", async () => {
    const definition = await value.createVoucherDefinition({
      code: "EXPIRED10",
      name: "Configured expiry",
      validFrom: "2025-01-01T00:00:00.000Z",
      validTo: "2025-02-01T00:00:00.000Z",
      branchIds: [branchId],
      channels: ["DINE_IN"],
      itemIds: [],
      categoryCodes: [],
      minimumSpendMinor: 0,
      currency: "KES",
      discountType: "FIXED_MINOR",
      discountValue: 1_000,
      customerSpecific: true,
      singleUse: true,
      stackingPolicy: "BLOCK",
      stackingPriority: 1,
    });
    const issue = await value.issueVoucher({
      voucherDefinitionId: definition.id,
      customerId: "customer-demo-001",
      sourceType: "TEST",
    });
    await expect(value.expireVouchers(new Date("2026-09-01T00:00:00.000Z"))).resolves.toEqual({
      expiredDefinitions: 1,
      expiredIssues: 1,
    });
    await expect(value.expireVouchers(new Date("2026-09-01T00:00:00.000Z"))).resolves.toEqual({
      expiredDefinitions: 0,
      expiredIssues: 0,
    });
    expect(
      db.sqlite.prepare("SELECT status FROM voucher_issues WHERE id=?").get(issue.id),
    ).toMatchObject({ status: "EXPIRED" });
  });

  it("records campaign voucher conversion as rule attribution", async () => {
    const campaigns = new CampaignService(db, actor);
    const definition = await value.createVoucherDefinition({
      code: "TRACK10",
      name: "Tracked promotion",
      validFrom: "2026-01-01T00:00:00.000Z",
      branchIds: [branchId],
      channels: ["DINE_IN"],
      itemIds: [],
      categoryCodes: [],
      minimumSpendMinor: 0,
      currency: "KES",
      discountType: "FIXED_MINOR",
      discountValue: 1_000,
      customerSpecific: false,
      singleUse: false,
      stackingPolicy: "BLOCK",
      stackingPriority: 1,
    });
    const campaign = await campaigns.createCampaign({
      name: "Rule attribution",
      objective: "Measure configured voucher redemption",
      segmentId: "segment-demo-repeat",
      channels: ["EMAIL"],
      templateBody: "Configured message",
      voucherDefinitionId: definition.id,
      branchIds: [branchId],
      brandIds: ["brand-demo-mona"],
      approvalRequired: false,
    });
    await campaigns.approveCampaign(campaign.id, "Approved test campaign");
    const repository = new D1AuthoritativeTransactionRepository(db);
    const invoice = await openCustomerInvoice(repository, actor, "campaign-voucher");
    await repository.commitMutation({
      actor,
      action: "applyVoucherRedemption",
      payload: {
        input: {
          invoiceId: invoice.invoiceId,
          paymentMethodId: "payment-demo-voucher",
          code: "TRACK10",
        },
      },
      idempotencyKey: "campaign-voucher-checkout",
      requestHash: "campaign-voucher-checkout-hash",
      correlationId: "campaign-voucher-checkout-correlation",
    });
    const event = db.sqlite
      .prepare(
        `SELECT campaign_id,attribution_type,source_id,payload_json FROM campaign_events
         WHERE provider_event_id LIKE 'voucher-conversion:%'`,
      )
      .get() as Record<string, unknown>;
    expect(event).toMatchObject({
      campaign_id: campaign.id,
      attribution_type: "ATTRIBUTED_BY_RULE",
      source_id: invoice.orderId,
    });
    expect(JSON.parse(String(event["payload_json"]))).toMatchObject({
      evidence: "CAMPAIGN_VOUCHER_REDEMPTION",
    });
  });

  it("records post-delivery orders as correlation without claiming causality", async () => {
    const campaigns = new CampaignService(db, actor);
    const provider = await campaigns.upsertProviderConfig({
      providerKey: "configured-test-provider",
      displayName: "Configured test provider",
      capabilities: ["SEND_EMAIL"],
    });
    const campaign = await campaigns.createCampaign({
      name: "Correlation test",
      objective: "Measure return activity",
      segmentId: "segment-demo-repeat",
      channels: ["EMAIL"],
      templateBody: "Configured message",
      branchIds: [branchId],
      brandIds: ["brand-demo-mona"],
      providerConfigId: provider.id,
      approvalRequired: false,
    });
    await campaigns.approveCampaign(campaign.id, "Approved correlation test");
    const snapshot = await campaigns.buildSegmentSnapshot("segment-demo-repeat", branchId);
    const stamp = new Date(Date.now() - 60_000).toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO campaign_audiences
          (tenant_id,id,campaign_id,snapshot_id,customer_id,channel,contact_hash,
           eligibility_status,eligibility_evidence_json,created_at)
         VALUES (?,?,?,?,?,'EMAIL',?,'ELIGIBLE','{}',?)`,
      )
      .run(
        tenantId,
        "audience-correlation",
        campaign.id,
        snapshot.id,
        "customer-demo-001",
        "correlation-contact-hash",
        stamp,
      );
    db.sqlite
      .prepare(
        `INSERT INTO campaign_deliveries
          (tenant_id,id,campaign_id,audience_id,provider_config_id,channel,status,
           attempt_count,max_attempts,idempotency_key,correlation_id,queued_at,sent_at,updated_at)
         VALUES (?,?,?,?,?,'EMAIL','SENT',1,5,?,?,?,?,?)`,
      )
      .run(
        tenantId,
        "delivery-correlation",
        campaign.id,
        "audience-correlation",
        provider.id,
        "delivery-correlation-key",
        "delivery-correlation-id",
        stamp,
        stamp,
        stamp,
      );
    const repository = new D1AuthoritativeTransactionRepository(db);
    const invoice = await openCustomerInvoice(repository, actor, "campaign-correlation");
    const paid = TransactionEngine.recordCashPayment(invoice.state, invoice.invoiceId, {
      received: invoice.amountMinor / 100,
      cashier: actor.name,
      terminal: "TEST-POS",
    });
    await repository.saveState(paid, actor, "Complete correlated cash order");
    const event = db.sqlite
      .prepare(
        `SELECT attribution_type,source_id,payload_json FROM campaign_events
         WHERE provider_event_id LIKE 'correlated-order:%'`,
      )
      .get() as Record<string, unknown>;
    expect(event).toMatchObject({ attribution_type: "CORRELATED", source_id: invoice.orderId });
    expect(JSON.parse(String(event["payload_json"]))).toMatchObject({
      evidence: "ORDER_WITHIN_CONFIGURED_POST_DELIVERY_WINDOW",
      windowDays: 7,
      causalClaim: false,
    });
  });

  it("blocks protected-trait and autonomous CRM mutations from intelligence and exposes no PII", async () => {
    expect(classifyIntent("Segment customers by religion")).toBe("UNSUPPORTED");
    expect(classifyIntent("Send a campaign and alter consent")).toBe("UNSUPPORTED");
    const aiActor = testActor(tenantId, branchId, [
      permissions.intelligenceAsk,
      permissions.intelligenceManagement,
      permissions.crmView,
    ]);
    const plan = await planIntelligenceQuery(db, aiActor, "Show CRM customer overview");
    const evidence = await new IntelligenceEvidenceService(db, aiActor).build(plan);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toMatch(/kelvin|@example|\+254/i);
    expect(serialized).toContain("CRM_CUSTOMERS");
  });

  it("prints configured loyalty details on receipts but never on KOT output", () => {
    const profile = SerametPrintService.getBranchHardwareProfile(branchId, tenantId);
    const order: OrderForPrint = {
      orderId: "ORDER-CRM-PRINT",
      branch: branchId,
      terminalId: "POS-TEST",
      table: "T-01",
      orderType: "Dine-In",
      requestedBy: actor.name,
      cashier: actor.name,
      waiter: actor.name,
      createdAt: "2026-09-01T12:00:00.000Z",
      customer: "Configured customer",
      lines: [
        {
          id: "line-crm-print",
          name: "Configured menu item",
          category: "MAIN",
          quantity: 1,
          unitPrice: 100,
          productionStation: "MAIN KITCHEN",
        },
      ],
      subtotal: 100,
      tax: 0,
      total: 100,
      paid: 100,
      change: 0,
      paymentMethod: "Configured payment",
      loyaltySummary: {
        memberCode: "4821",
        tier: "Configured tier",
        pointsEarned: 10,
        pointsBalance: 4830,
        rewardUsed: "Configured reward",
        voucherUsed: "Promotion applied",
      },
    };
    const receipt = SerametPrintService.createDocumentJob(profile, order, "RECEIPT").content;
    const kot = SerametPrintService.createProductionTicketJobs(profile, order, [], "NEW").jobs[0]
      ?.content;
    expect(receipt).toContain("POINTS EARNED");
    expect(receipt).toContain("Configured reward");
    expect(kot).not.toMatch(/POINTS|MEMBER|VOUCHER|REWARD/);
  });
});

function testActor(
  tenant = tenantId,
  branch = branchId,
  permissionCodes = allPermissionCodes,
): ServerActor {
  return {
    id: tenant === tenantId ? "user-demo-emmanuel-obiambo" : `user-${tenant}`,
    name: "CRM test manager",
    tenantId: tenant,
    roleIds: ["manager"],
    permissions: [...permissionCodes],
    assignedBranchIds: [branch],
    assignedBranches: [{ id: branch, name: branch }],
    branchScope: { type: "ALL" },
    branchId: branch,
    branch,
    role: "Manager",
  };
}

function branchActor(branch: string): ServerActor {
  return {
    ...testActor(tenantId, branch),
    assignedBranchIds: [branch],
    assignedBranches: [{ id: branch, name: branch }],
    branchScope: { type: "BRANCH", branchId: branch },
  };
}

function seedOtherTenant(db: SqliteD1TestDatabase) {
  const stamp = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT OR IGNORE INTO tenants
        (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
       VALUES ('tenant-other','other','Other','Other','KES','UTC','en',1,'{}',?,?)`,
    )
    .run(stamp, stamp);
  db.sqlite
    .prepare(
      `INSERT OR IGNORE INTO branches
        (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
       VALUES ('tenant-other','branch-other','OTHER','Other','UTC',0,1,'{}')`,
    )
    .run();
}

function seedCustomerLinks(db: SqliteD1TestDatabase) {
  const insert = db.sqlite.prepare(
    `INSERT INTO customer_transaction_links
      (tenant_id,id,customer_id,branch_id,source_type,source_id,link_source,business_date,
       currency,gross_minor,net_minor,refund_minor,discount_minor,completed,channel,item_summary_json,
       correlation_id,created_at,updated_at)
     VALUES (?,?,?,?, 'ORDER',?,'POS_SELECTED',?,'KES',?,?,0,0,1,'DINE_IN','[]',?,?,?)`,
  );
  insert.run(
    tenantId,
    "link-test-1",
    "customer-demo-001",
    branchId,
    "order-link-1",
    "2026-07-01",
    100_000,
    100_000,
    "corr-1",
    "2026-07-01T10:00:00.000Z",
    "2026-07-01T10:00:00.000Z",
  );
  insert.run(
    tenantId,
    "link-test-2",
    "customer-demo-001",
    branchId,
    "order-link-2",
    "2026-08-01",
    150_000,
    150_000,
    "corr-2",
    "2026-08-01T10:00:00.000Z",
    "2026-08-01T10:00:00.000Z",
  );
}

async function openCustomerInvoice(
  repository: D1AuthoritativeTransactionRepository,
  actor: ServerActor,
  suffix: string,
) {
  let state = createEmptyTransactionState(actor.tenantId);
  state = TransactionEngine.createOrder(
    state,
    {
      tenantId: actor.tenantId,
      branchId,
      branch: branchId,
      table: "T-01",
      customer: "Kelvin Otieno",
      customerId: "customer-demo-001",
      customerCode: "CUS-0001",
      channel: "DINE_IN",
      cashier: actor.name,
      lines: [
        {
          id: `line-${suffix}`,
          productId: "menu-demo-main",
          name: "Configured menu item",
          category: "MAIN",
          quantity: 1,
          unitPrice: 100,
          productionStation: "NONE",
        },
      ],
    },
    "OPEN",
  );
  state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
  await repository.saveState(state, actor, `Seed ${suffix} checkout`);
  const invoice = state.bills[0]!;
  return {
    invoiceId: invoice.id,
    orderId: state.orders[0]!.id,
    amountMinor: Math.round(invoice.total * 100),
    state,
  };
}
