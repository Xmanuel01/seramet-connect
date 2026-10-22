import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { CrmService } from "./crm-service";
import { CampaignService } from "./campaign-service";
import { CampaignProviderRegistry } from "./campaign-provider-registry";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { PostgresD1Database } from "@/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import { migrationFiles } from "@/server/database/sqlite-test-adapter";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { D1Database } from "@/server/database/d1";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";
const actor: ServerActor = {
  id: "regression-operator",
  name: "Test operator",
  tenantId,
  branchId,
  branch: "Westlands",
  role: "Manager",
  roleIds: [],
  permissions: Object.values(permissions),
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: "Westlands" }],
  branchScope: { type: "BRANCH", branchId },
};

describe("CRM route regressions on disposable databases only", () => {
  it("executes Customer360 directory and full scoped profile SQL on PostgreSQL", async () => {
    const pg = new PGlite();
    const query = async (sql: string, values?: unknown[]) => {
      const result = await pg.query(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    };
    const db = new PostgresD1Database({
      query,
      connect: async () => ({ query, release: () => {} }),
    } as unknown as Pool);
    try {
      await expect(pg.query("SELECT 'name' LIKE 'Name' COLLATE NOCASE")).rejects.toThrow(
        /collation/i,
      );
      await expect(
        pg.query(
          "SELECT SUM(amount) AS balance_minor FROM (VALUES (1)) AS ledger(amount) HAVING balance_minor>0",
        ),
      ).rejects.toThrow(/balance_minor/i);
      await pg.exec(postgresCompatibilityPrelude);
      for (const file of migrationFiles) {
        await pg.exec(
          compileSqliteMigrationForPostgres(readFileSync(resolve("migrations", file), "utf8")).sql,
        );
      }
      await pg.exec(readFileSync(resolve("migrations/seed/demo.sql"), "utf8"));
      const crm = new CrmService(db, actor);
      const customer = await crm.createCustomer({
        displayName: "Case!_% Match",
        createdSource: "DISPOSABLE_TEST",
      });
      expect(
        (await crm.searchCustomers({ query: "case!_%" })).customers.map((row) => row.id),
      ).toEqual([customer.id]);
      expect((await crm.searchCustomers({ query: "not present" })).customers).toEqual([]);
      expect(await crm.customerProfile(customer.id)).toMatchObject({
        id: customer.id,
        displayName: "Case!_% Match",
      });
      await db
        .prepare(
          `INSERT INTO customer_feedback_categories
        (tenant_id,id,code,name,active,created_at,updated_at) VALUES (?,'regression-category','REGRESSION','Test',1,?,?)`,
        )
        .bind(tenantId, new Date().toISOString(), new Date().toISOString())
        .run();
      await verifyInvoiceTrace(db, crm, "regression-category");
      const restricted = new CrmService(db, { ...actor, permissions: [] });
      await expect(restricted.searchCustomers({})).rejects.toThrow(/permission/);
      await expect(crm.searchCustomers({ branchId: "unassigned" })).rejects.toThrow();
    } finally {
      await pg.close();
    }
  }, 120_000);

  it("rejects nonexistent/cross-branch complaint orders before writing a case", async () => {
    const db = createDemoFixtureDatabase();
    try {
      const crm = new CrmService(db, actor);
      const category = await crm.listFeedbackCategories();
      const input = {
        branchId,
        categoryId: String(category[0].id),
        surveyType: "GENERAL" as const,
        rating: 2,
        source: "DISPOSABLE_TEST",
      };
      const before = db.sqlite.prepare("SELECT COUNT(*) AS count FROM customer_feedback").get();
      await expect(crm.createFeedback({ ...input, orderId: "missing" })).rejects.toThrow(/Order/);
      await expect(crm.createFeedback({ ...input, invoiceReference: "missing" })).rejects.toThrow(
        /invoice/,
      );
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM customer_feedback").get()).toEqual(
        before,
      );
      await verifyInvoiceTrace(db, crm, input.categoryId);
    } finally {
      db.close();
    }
  });

  it("does not advertise a healthy email provider when no production adapter is registered", async () => {
    const db = createDemoFixtureDatabase();
    try {
      const campaigns = new CampaignService(db, actor, new CampaignProviderRegistry());
      expect(
        (await campaigns.providerHealth()).every((row) => row.liveStatus !== "CONFIGURED"),
      ).toBe(true);
      const segment = await campaigns.createSegment({
        code: "NO_PROVIDER",
        name: "Test only",
        definition: { all: [{ field: "orderCount", operator: "GTE", value: 1 }] },
      });
      const campaign = await campaigns.createCampaign({
        name: "Unconfigured email",
        objective: "Test blocker",
        segmentId: segment.id,
        channels: ["EMAIL"],
        templateBody: "Test only",
        branchIds: [branchId],
        brandIds: [],
        approvalRequired: false,
      });
      await campaigns.approveCampaign(campaign.id, "Disposable test approval");
      await expect(campaigns.queueCampaign(campaign.id)).rejects.toThrow(
        /no provider configuration/,
      );
      expect(
        await db
          .prepare("SELECT COUNT(*) AS count FROM campaign_deliveries WHERE campaign_id=?")
          .bind(campaign.id)
          .first(),
      ).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });
});

async function verifyInvoiceTrace(db: D1Database, crm: CrmService, categoryId: string) {
  const stamp = new Date().toISOString();
  for (const [id, branch] of [
    ["trace-order", branchId],
    ["second-order", branchId],
    ["foreign-order", "branch-demo-ngong-road"],
  ]) {
    await db
      .prepare(
        `INSERT INTO orders
      (tenant_id,id,branch_id,status,business_date,currency,total_minor,correlation_id,payload_json,created_at,updated_at)
      VALUES (?,?,?,'OPEN','2026-10-18','KES',100,'test','{}',?,?)`,
      )
      .bind(tenantId, id, branch, stamp, stamp)
      .run();
  }
  for (const id of ["trace-invoice", "other-invoice"]) {
    await db
      .prepare(
        `INSERT INTO invoices
      (tenant_id,id,branch_id,invoice_number,status,business_date,currency,total_minor,payload_json,created_at,updated_at)
      VALUES (?,?,?,?,'OPEN','2026-10-18','KES',100,'{}',?,?)`,
      )
      .bind(tenantId, id, branchId, id.toUpperCase(), stamp, stamp)
      .run();
    await db
      .prepare(
        `INSERT INTO invoice_lines
      (tenant_id,id,invoice_id,order_id,description,quantity_minor,unit_price_minor,amount_minor)
      VALUES (?,?,?,'trace-order','Test only',1,100,100)`,
      )
      .bind(tenantId, id + "-line", id)
      .run();
  }
  const input = {
    branchId,
    categoryId,
    rating: 1,
    surveyType: "GENERAL" as const,
    source: "DISPOSABLE_TEST",
  };
  await expect(crm.createFeedback({ ...input, orderId: "foreign-order" })).rejects.toThrow(
    /branch/,
  );
  await expect(
    crm.createFeedback({ ...input, invoiceReference: "TRACE-INVOICE", orderId: "foreign-order" }),
  ).rejects.toThrow(/belonging/);
  const customer = await crm.createCustomer({
    displayName: "Unlinked test customer",
    createdSource: "DISPOSABLE_TEST",
  });
  await expect(
    crm.createFeedback({ ...input, invoiceReference: "TRACE-INVOICE", customerId: customer.id }),
  ).rejects.toThrow(/not linked/);
  const feedback = await crm.createFeedback({ ...input, invoiceReference: "TRACE-INVOICE" });
  expect((await crm.listFeedback(branchId)).find((row) => row.id === feedback.id)).toMatchObject({
    order_id: "trace-order",
    invoice_id: "trace-invoice",
    invoice_number: "TRACE-INVOICE",
  });
  expect(
    await db
      .prepare(
        "SELECT payload_json FROM customer_feedback_events WHERE tenant_id=? AND feedback_id=? AND event_type='SUBMITTED'",
      )
      .bind(tenantId, feedback.id)
      .first(),
  ).toMatchObject({
    payload_json: JSON.stringify({ orderId: "trace-order", invoiceId: "trace-invoice" }),
  });
  const denied = new CrmService(db, { ...actor, permissions: [permissions.feedbackView] });
  await expect(denied.createFeedback(input)).rejects.toThrow(/permission/);
  await db
    .prepare(
      `INSERT INTO invoice_lines
    (tenant_id,id,invoice_id,order_id,description,quantity_minor,unit_price_minor,amount_minor)
    VALUES (?,'multi-order-line','trace-invoice','second-order','Test only',1,100,100)`,
    )
    .bind(tenantId)
    .run();
  await expect(crm.createFeedback({ ...input, invoiceReference: "TRACE-INVOICE" })).rejects.toThrow(
    /Select an order/,
  );
  const multi = await crm.createFeedback({
    ...input,
    invoiceReference: "TRACE-INVOICE",
    orderId: "second-order",
  });
  expect((await crm.listFeedback(branchId)).find((row) => row.id === multi.id)).toMatchObject({
    order_id: "second-order",
    invoice_id: "trace-invoice",
  });
}
