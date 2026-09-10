import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CampaignService } from "@/crm/campaign-service";
import { CrmAnalyticsService } from "@/crm/crm-analytics";
import { CrmService } from "@/crm/crm-service";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import { createMigratedTestDatabase } from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";

describe.sequential("Pass 10 scaled CRM performance fixture", () => {
  it("measures indexed authoritative CRM operations at a scaled restaurant workload", async () => {
    const db = createMigratedTestDatabase();
    for (const file of [
      "demo.sql",
      "pass7-demo.sql",
      "pass8-demo.sql",
      "pass9-demo.sql",
      "pass10-demo.sql",
    ]) {
      db.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations", "seed", file), "utf8"));
    }
    const actor = performanceActor();
    const crm = new CrmService(db, actor, {
      defaultCallingCode: "254",
      nationalPrefix: "0",
    });
    const loyalty = new LoyaltyValueService(db, actor);
    const campaigns = new CampaignService(db, actor);
    const analytics = new CrmAnalyticsService(db, actor);

    const numbers = numberCte(2_500);
    db.sqlite.exec(`${numbers}
      INSERT INTO customers
        (tenant_id,id,customer_code,display_name,preferred_branch_id,brand_id,status,
         created_source,created_by,last_activity_at,payload_json,created_at,updated_at)
      SELECT '${tenantId}',printf('perf-customer-%04d',n),printf('PERF-%04d',n),
        printf('Performance Customer %04d',n),'${branchId}','brand-demo-mona','ACTIVE',
        'PERFORMANCE_FIXTURE','performance-test','2026-08-31T10:00:00.000Z','{}',
        '2026-01-01T00:00:00.000Z','2026-08-31T10:00:00.000Z'
      FROM numbers;`);
    db.sqlite.exec(`${numbers}
      INSERT INTO customer_metric_snapshots
        (tenant_id,customer_id,brand_id,branch_id,period_key,currency,visit_count,order_count,
         gross_spend_minor,net_spend_minor,refund_minor,discount_minor,average_order_minor,
         first_visit_at,last_visit_at,favorite_branch_id,favorite_channel,favorite_items_json,
         rfm_json,quality,evidence_watermark,calculated_at)
      SELECT '${tenantId}',printf('perf-customer-%04d',n),'brand-demo-mona','${branchId}',
        'LIFETIME','KES',10,10,1000000,980000,10000,10000,98000,
        '2026-01-01T00:00:00.000Z','2026-08-31T10:00:00.000Z','${branchId}',
        'DINE_IN','[]','{"recencyDays":1,"frequency":10,"monetaryMinor":980000}',
        'HIGH','performance-fixture','2026-09-01T00:00:00.000Z'
      FROM numbers;`);
    db.sqlite.exec(`${numbers}
      INSERT INTO customer_transaction_links
        (tenant_id,id,customer_id,branch_id,source_type,source_id,link_source,business_date,
         currency,gross_minor,net_minor,refund_minor,discount_minor,completed,channel,
         item_summary_json,correlation_id,created_at,updated_at)
      SELECT '${tenantId}',printf('perf-link-%04d-%02d',n,o),printf('perf-customer-%04d',n),
        '${branchId}','ORDER',printf('perf-order-%04d-%02d',n,o),'POS_SELECTED',
        printf('2026-08-%02d',20+(o%9)),'KES',100000,98000,1000,1000,1,'DINE_IN','[]',
        printf('perf-correlation-%04d-%02d',n,o),'2026-08-31T10:00:00.000Z',
        '2026-08-31T10:00:00.000Z'
      FROM numbers CROSS JOIN
        (SELECT 1 o UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
         UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10);`);
    db.sqlite.exec(`${numbers}
      INSERT INTO loyalty_ledger
        (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,
         business_date,reason,actor_id,correlation_id,idempotency_key,created_at)
      SELECT '${tenantId}',printf('perf-loyalty-%04d-%d',n,e),printf('perf-customer-%04d',n),
        'loyalty-demo-program','${branchId}','EARN',50,'PERFORMANCE_FIXTURE',
        printf('perf-loyalty-source-%04d-%d',n,e),'2026-08-31','Performance fixture',
        'performance-test',printf('perf-loyalty-correlation-%04d-%d',n,e),
        printf('perf-loyalty-key-%04d-%d',n,e),'2026-08-31T10:00:00.000Z'
      FROM numbers CROSS JOIN (SELECT 1 e UNION ALL SELECT 2);`);

    const voucher = await loyalty.createVoucherDefinition({
      code: "PERF10",
      name: "Performance voucher",
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
    db.sqlite.exec(`${numberCte(1_000)}
      INSERT INTO voucher_redemptions
        (tenant_id,id,voucher_definition_id,customer_id,branch_id,order_id,invoice_id,channel,
         discount_minor,currency,status,actor_id,idempotency_key,correlation_id,redeemed_at)
      SELECT '${tenantId}',printf('perf-voucher-redemption-%04d',n),'${voucher.id}',
        printf('perf-customer-%04d',n),'${branchId}',printf('perf-voucher-order-%04d',n),
        printf('perf-voucher-invoice-%04d',n),'DINE_IN',1000,'KES','CONFIRMED',
        'performance-test',printf('perf-voucher-key-%04d',n),
        printf('perf-voucher-correlation-%04d',n),'2026-08-31T10:00:00.000Z'
      FROM numbers;`);

    db.sqlite.exec(`${numberCte(1_000)}
      INSERT INTO gift_cards
        (tenant_id,id,token_hash,token_last_four,status,currency,original_value_minor,
         recipient_customer_id,liability_account_id,collection_account_id,redemption_account_id,
         issued_at,created_by,created_at,updated_at)
      SELECT '${tenantId}',printf('perf-gift-card-%04d',n),printf('perf-gift-hash-%04d',n),
        printf('%04d',n),'ACTIVE','KES',10000,printf('perf-customer-%04d',n),
        'account-demo-gift-card-liability','account-demo-gift-card-collection',
        'account-demo-gift-card-redemption','2026-08-31T10:00:00.000Z','performance-test',
        '2026-08-31T10:00:00.000Z','2026-08-31T10:00:00.000Z'
      FROM numbers;`);
    db.sqlite.exec(`${numberCte(1_000)}
      INSERT INTO gift_card_ledger
        (tenant_id,id,gift_card_id,branch_id,entry_type,amount_minor,currency,source_type,
         source_id,actor_id,business_date,reason,idempotency_key,correlation_id,created_at)
      SELECT '${tenantId}',printf('perf-gift-ledger-%04d',n),printf('perf-gift-card-%04d',n),
        '${branchId}','ISSUE',10000,'KES','PERFORMANCE_FIXTURE',printf('perf-gift-source-%04d',n),
        'performance-test','2026-08-31','Performance fixture',printf('perf-gift-key-%04d',n),
        printf('perf-gift-correlation-%04d',n),'2026-08-31T10:00:00.000Z'
      FROM numbers;`);

    seedCampaignPerformanceRows(db.sqlite);
    db.sqlite.exec(`${numberCte(500)}
      INSERT INTO customer_feedback
        (tenant_id,id,branch_id,customer_id,category_id,survey_type,rating,source,status,
         submitted_at,created_at,updated_at)
      SELECT '${tenantId}',printf('perf-feedback-%04d',n),'${branchId}',
        printf('perf-customer-%04d',n),'feedback-category-service','CSAT',5,
        'PERFORMANCE_FIXTURE','OPEN','2026-08-31T10:00:00.000Z',
        '2026-08-31T10:00:00.000Z','2026-08-31T10:00:00.000Z' FROM numbers;`);

    const giftCard = await loyalty.issueGiftCard({
      amountMinor: 10_000,
      currency: "KES",
      recipientCustomerId: "perf-customer-0001",
      liabilityAccountId: "account-demo-gift-card-liability",
      collectionAccountId: "account-demo-gift-card-collection",
      redemptionAccountId: "account-demo-gift-card-redemption",
      businessDate: "2026-09-01",
      idempotencyKey: "perf-live-gift-issue",
    });

    const timings: Record<string, number> = {};
    const measure = async <T>(name: string, operation: () => Promise<T>) => {
      const started = performance.now();
      const result = await operation();
      timings[name] = Number((performance.now() - started).toFixed(2));
      return result;
    };

    const search = await measure("customerSearchMs", () =>
      crm.searchCustomers({ query: "Performance Customer 1250", limit: 20 }),
    );
    const profile = await measure("customerProfileMs", () =>
      crm.customerProfile("perf-customer-1250"),
    );
    const dashboard = await measure("crmDashboardMs", () => crm.dashboard(branchId));
    const segment = await measure("segmentSnapshotMs", () =>
      campaigns.buildSegmentSnapshot("segment-demo-repeat", branchId),
    );
    const balance = await measure("loyaltyBalanceMs", () =>
      loyalty.loyaltyBalance("perf-customer-1250", "loyalty-demo-program"),
    );
    const voucherValidation = await measure("voucherValidationMs", () =>
      loyalty.validateVoucher({
        code: "PERF10",
        customerId: "perf-customer-1250",
        branchId,
        channel: "DINE_IN",
        subtotalMinor: 100_000,
        currency: "KES",
      }),
    );
    const giftRedemption = await measure("giftCardRedemptionMs", () =>
      loyalty.redeemGiftCard({
        token: giftCard.token!,
        amountMinor: 1_000,
        currency: "KES",
        branchId,
        orderId: "perf-live-gift-order",
        invoiceId: "perf-live-gift-invoice",
        businessDate: "2026-09-01",
        idempotencyKey: "perf-live-gift-redemption",
      }),
    );
    const campaignResults = await measure("campaignResultsMs", () => campaigns.listCampaigns());
    const cohorts = await measure("cohortQueryMs", () => analytics.cohortRetention(branchId));

    expect(search.customers[0]?.id).toBe("perf-customer-1250");
    expect(profile.orderCount).toBe(10);
    expect(dashboard.totalCustomers).toBeGreaterThanOrEqual(2_500);
    expect(segment.customerCount).toBeGreaterThanOrEqual(2_500);
    expect(balance).toBe(100);
    expect(voucherValidation.discountMinor).toBe(1_000);
    expect(giftRedemption.duplicate).toBe(false);
    expect(campaignResults).toHaveLength(10);
    expect(cohorts.length).toBeGreaterThan(0);
    for (const duration of Object.values(timings)) expect(duration).toBeLessThan(5_000);

    console.info(
      "PASS10_PERFORMANCE",
      JSON.stringify({
        fixture: {
          customers: 2_500,
          representedOrders: 25_000,
          loyaltyLedgerEntries: 5_000,
          voucherRedemptions: 1_000,
          giftCardEvents: 1_000,
          campaigns: 10,
          campaignDeliveries: 5_000,
          feedback: 500,
        },
        timings,
      }),
    );
  }, 30_000);
});

function numberCte(max: number) {
  return `WITH digits(n) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
    numbers(n) AS (
      SELECT ones.n + tens.n*10 + hundreds.n*100 + thousands.n*1000 + 1
      FROM digits ones CROSS JOIN digits tens CROSS JOIN digits hundreds CROSS JOIN digits thousands
      WHERE ones.n + tens.n*10 + hundreds.n*100 + thousands.n*1000 < ${max}
    )`;
}

function seedCampaignPerformanceRows(sqlite: { exec(sql: string): void }) {
  sqlite.exec(`
    INSERT INTO communication_provider_configs
      (tenant_id,id,provider_key,display_name,status,capabilities_json,per_minute_limit,batch_size,
       max_attempts,configuration_json,created_by,created_at,updated_at)
    VALUES ('${tenantId}','perf-provider','performance-provider','Performance provider','CONFIGURED',
      '["SEND_EMAIL"]',10000,1000,5,'{}','performance-test','2026-08-31T09:00:00.000Z',
      '2026-08-31T09:00:00.000Z');
    INSERT INTO crm_segment_snapshots
      (tenant_id,id,segment_id,branch_id,as_of,customer_count,quality,definition_hash,
       evidence_watermark,metrics_json,created_at)
    VALUES ('${tenantId}','perf-segment-snapshot','segment-demo-repeat','${branchId}',
      '2026-08-31T09:00:00.000Z',2500,'HIGH','performance-hash','performance-watermark','{}',
      '2026-08-31T09:00:00.000Z');
    ${numberCte(10)}
    INSERT INTO campaigns
      (tenant_id,id,name,status,objective,segment_id,channels_json,template_body,
       template_variables_json,branch_scope_json,brand_scope_json,provider_config_id,
       approval_required,created_by,approved_by,created_at,updated_at)
    SELECT '${tenantId}',printf('perf-campaign-%02d',n),printf('Performance campaign %02d',n),
      'COMPLETED','Performance fixture','segment-demo-repeat','["EMAIL"]','Configured message',
      '[]','["${branchId}"]','["brand-demo-mona"]','perf-provider',0,'performance-test',
      'performance-test','2026-08-31T09:00:00.000Z','2026-08-31T10:00:00.000Z'
    FROM numbers;
    ${numberCte(500)}
    INSERT INTO campaign_audiences
      (tenant_id,id,campaign_id,snapshot_id,customer_id,channel,contact_hash,
       eligibility_status,eligibility_evidence_json,created_at)
    SELECT '${tenantId}',printf('perf-audience-%02d-%04d',c,n),printf('perf-campaign-%02d',c),
      'perf-segment-snapshot',printf('perf-customer-%04d',n),'EMAIL',
      printf('perf-contact-hash-%02d-%04d',c,n),'ELIGIBLE','{}','2026-08-31T09:00:00.000Z'
    FROM numbers CROSS JOIN
      (SELECT 1 c UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
       UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10);
    ${numberCte(500)}
    INSERT INTO campaign_deliveries
      (tenant_id,id,campaign_id,audience_id,provider_config_id,channel,status,attempt_count,
       max_attempts,idempotency_key,correlation_id,queued_at,sent_at,updated_at)
    SELECT '${tenantId}',printf('perf-delivery-%02d-%04d',c,n),printf('perf-campaign-%02d',c),
      printf('perf-audience-%02d-%04d',c,n),'perf-provider','EMAIL','SENT',1,5,
      printf('perf-delivery-key-%02d-%04d',c,n),printf('perf-delivery-correlation-%02d-%04d',c,n),
      '2026-08-31T09:00:00.000Z','2026-08-31T10:00:00.000Z',
      '2026-08-31T10:00:00.000Z'
    FROM numbers CROSS JOIN
      (SELECT 1 c UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
       UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10);
  `);
}

function performanceActor(): ServerActor {
  return {
    id: "performance-test",
    name: "Performance test actor",
    tenantId,
    roleIds: ["performance-test"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: branchId }],
    branchScope: { type: "ALL" },
    branchId,
    branch: branchId,
    role: "Performance test",
  };
}
