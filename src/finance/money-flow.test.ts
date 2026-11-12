import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyTransactionState, type BillingRecord } from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import { hydrateSeededTenantsForTests } from "@/testing/configuration-fixture";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { businessDateForTimestamp } from "@/lib/business-date";
import { FinancialLedgerService } from "@/finance/financial-ledger-service";
import { DocumentListService } from "@/server/documents-api";
import { balanceSheet, profitAndLoss } from "@/finance/StatementsPage";
import { SerametPrintService } from "@/lib/seramet-print-service";
import { receiptRecordToPrintOrder } from "@/lib/print-order-adapter";

// One sale followed from the till to every report people read, through the
// same server commands the till sends and with ledger posting on, as in
// production. Each report must agree with the others.

let db: SqliteD1TestDatabase;
let repo: D1AuthoritativeTransactionRepository;
const tenantId = "flow-tenant";
const branchId = "flow-branch";
const actor: ServerActor = {
  id: "flow-cashier",
  name: "Flow cashier",
  tenantId,
  branchId,
  branch: branchId,
  role: "Manager",
  roleIds: [],
  permissions: [...allPermissionCodes],
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: branchId }],
  branchScope: { type: "BRANCH", branchId },
};

// Gross 100.00, discount 5.00, service 10% (9.50), VAT 16% on 104.50 (16.72): total 121.22.
const sale = {
  grossSalesMinor: 10_000,
  discountsMinor: 500,
  netSalesMinor: 9_500,
  serviceChargeMinor: 950,
  taxMinor: 1_672,
  totalMinor: 12_122,
};
const tendered = 15_000;
let businessDate = "";
let command = 0;

function invoice(): BillingRecord {
  const stamp = new Date().toISOString();
  return {
    id: "flow-invoice",
    tenantId,
    branchId,
    branch: branchId,
    orderIds: ["flow-order"],
    customer: "Walk-in",
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt: stamp,
    dueAt: stamp,
    businessDate,
    lines: [
      { id: "flow-line", name: "Grilled tilapia", category: "Mains", quantity: 1, unitPrice: 100 },
    ],
    subtotal: (sale.netSalesMinor + sale.serviceChargeMinor) / 100,
    tax: sale.taxMinor / 100,
    total: sale.totalMinor / 100,
    paid: 0,
    financialComponents: { version: 1, currency: "KES", ...sale },
  };
}

async function run(action: string, payload: unknown) {
  command += 1;
  return repo.commitMutation({
    actor,
    action,
    payload,
    idempotencyKey: `flow-command-${command}`,
    requestHash: `flow-hash-${command}`,
    correlationId: `flow-correlation-${command}`,
  });
}

async function statement() {
  return new FinancialLedgerService(db, actor).statement({
    branchId,
    from: businessDate,
    to: businessDate,
  });
}

beforeEach(async () => {
  db = createMigratedTestDatabase();
  const stamp = new Date().toISOString();
  businessDate = businessDateForTimestamp(stamp, "Africa/Nairobi", 240);
  command = 0;
  const exec = (sql: string, ...values: unknown[]) =>
    db
      .prepare(sql)
      .bind(...values)
      .run();
  await exec(
    "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    tenantId,
    tenantId,
    tenantId,
    tenantId,
    stamp,
    stamp,
  );
  await exec(
    "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')",
    tenantId,
    branchId,
    branchId,
    branchId,
  );
  await exec(
    "INSERT INTO users (tenant_id,id,name,active,payload_json,created_at,updated_at) VALUES (?,?,'Cashier',1,'{}',?,?)",
    tenantId,
    actor.id,
    stamp,
    stamp,
  );
  // A small chart of accounts, mapped and approved the way Setup Centre leaves it.
  for (const [key, id, type] of [
    ["CUSTOMER_RECEIVABLE", "receivable", "ASSET"],
    ["SALES_REVENUE", "revenue", "INCOME"],
    ["TAX_PAYABLE", "vat", "LIABILITY"],
    ["SERVICE_CHARGE", "service", "INCOME"],
    ["CASH", "drawer-cash", "CASH"],
    ["PAYMENT_CLEARING", "clearing", "ASSET"],
  ] as const) {
    await exec(
      "INSERT INTO accounts (tenant_id,id,code,name,account_type,currency,active,payload_json) VALUES (?,?,?,?,?,'KES',1,'{}')",
      tenantId,
      id,
      id,
      id,
      type,
    );
    await exec(
      "INSERT INTO setup_account_mappings (tenant_id,id,scope_key,mapping_key,requirement,account_id,status,finance_signoff_status,updated_by,updated_at) VALUES (?,?,'TENANT',?,'REQUIRED',?,'CONFIGURED','APPROVED',?,?)",
      tenantId,
      key,
      key,
      id,
      actor.id,
      stamp,
    );
  }
  await exec(
    "INSERT INTO payment_methods (tenant_id,id,code,category,active,payload_json) VALUES (?,?,?,?,1,?)",
    tenantId,
    "cash",
    "CASH",
    "CASH",
    JSON.stringify({
      id: "cash",
      tenantId,
      code: "CASH",
      category: "CASH",
      displayName: "Cash",
      enabled: true,
      metadata: {},
    }),
  );
  await hydrateSeededTenantsForTests(db, {});
  repo = new D1AuthoritativeTransactionRepository(db, { requireInvoiceLedger: true });
});

afterEach(() => {
  db.close();
  setConfigurationRepositoryForTests();
});

describe("one sale, from the till to the reports", () => {
  it("issues, collects cash with change, and keeps every report in agreement", async () => {
    const state = createEmptyTransactionState(tenantId);
    state.bills.push(invoice());
    await repo.saveState(state, actor, "Issue the sale");

    // Issued: income is recognised once, VAT is owed, the customer owes the total.
    let report = await statement();
    expect(report.trial.balanced).toBe(true);
    let pnl = profitAndLoss(report);
    expect(pnl.totals.income).toBe(sale.netSalesMinor + sale.serviceChargeMinor);
    expect(pnl.totals.netResult).toBe(sale.netSalesMinor + sale.serviceChargeMinor);
    expect(pnl.totals.netResult).toBe(report.incomeStatement.netResultMinor);
    const unpaid = await new FinancialLedgerService(db, actor).receivables({
      branchId,
      from: businessDate,
      to: businessDate,
    });
    expect(unpaid.rows.map((row) => row.id)).toEqual(["flow-invoice"]);

    // The cashier opens a drawer and takes 150.00 for a 121.22 bill.
    await run("openPaymentDrawer", {
      input: {
        tenantId,
        branchId,
        employeeId: actor.id,
        openingFloatMinor: 0,
        currency: "KES",
        deviceId: `${branchId}-POS`,
        actor: actor.name,
      },
    });
    const paid = await run("applyConfiguredPayment", {
      invoiceId: "flow-invoice",
      paymentMethodId: "cash",
      amountMinor: sale.totalMinor,
      tenderedAmountMinor: tendered,
    });
    expect(paid.state.bills[0]).toMatchObject({ paymentStatus: "PAID" });
    const payment = paid.state.paymentOperations!.transactions[0]!;
    expect(payment.amountMinor).toBe(sale.totalMinor);

    // Collected: cash replaces the receivable; income is not recognised twice.
    report = await statement();
    expect(report.trial.balanced).toBe(true);
    expect(report.issues.map((issue) => issue.code)).not.toContain("SETTLED_SALES_NOT_IN_GL");
    pnl = profitAndLoss(report);
    expect(pnl.totals.income).toBe(sale.netSalesMinor + sale.serviceChargeMinor);
    const sheet = balanceSheet(report);
    const total = (lines: Array<{ amount: number }>) =>
      lines.reduce((sum, line) => sum + line.amount, 0);
    // Only the 121.22 kept is cash; the 28.78 change went back to the customer.
    expect(sheet.assets.find((line) => line.account.code === "drawer-cash")?.amount).toBe(
      sale.totalMinor,
    );
    expect(sheet.assets.find((line) => line.account.code === "receivable")).toBeUndefined();
    expect(total(sheet.assets)).toBe(report.balanceSheet.assetsMinor);
    expect(total(sheet.liabilities)).toBe(sale.taxMinor);
    // Assets = liabilities + equity + this period's profit, to the cent.
    expect(report.balanceSheet.differenceMinor).toBe(0);
    expect(total(sheet.assets)).toBe(
      total(sheet.liabilities) + total(sheet.equity) + report.balanceSheet.unclosedEarningsMinor,
    );

    // Receivables is empty and the day's lists show the paid invoice.
    const open = await new FinancialLedgerService(db, actor).receivables({
      branchId,
      from: businessDate,
      to: businessDate,
    });
    expect(open.rows).toHaveLength(0);
    const documents = new DocumentListService(db, actor);
    const today = { from: businessDate, to: businessDate };
    expect(
      (await documents.invoices({ ...today, status: "paid" })).rows.map((row) => row.id),
    ).toEqual(["flow-invoice"]);
    expect((await documents.invoices({ ...today, status: "unpaid" })).rows).toHaveLength(0);

    // The receipt shows what the customer handed over and the change, not internal ids.
    const receipts = (await documents.receipts(today)).rows;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      invoiceId: "flow-invoice",
      paidAmount: 121.22,
      change: 28.78,
    });
    // The receipt's figures come from this database; the printer profile is the
    // standard demo one, since this database has no printers set up.
    const order = receiptRecordToPrintOrder(receipts[0]!, paid.state)!;
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    const profile = SerametPrintService.getBranchHardwareProfile(
      DEMO_WESTLANDS_BRANCH_ID,
      DEMO_TENANT_ID,
    );
    for (const template of Object.values(profile.templateSettings)) template.width = "80mm";
    for (const route of Object.values(profile.documentRoutes)) route.template = "80mm";
    const printed = SerametPrintService.createDocumentJob(profile, order, "RECEIPT").content;
    await hydrateSeededTenantsForTests(db, {});
    expect(printed).toMatch(/\|CASH\s+\|\s*\|\s+150\.00\|/);
    expect(printed).toMatch(/\|Change\s+\|\s*\|\s+28\.78\|/);
    expect(printed).toMatch(/\|TOTAL\s+\|\s+121\.22\|/);
    expect(printed).not.toMatch(/PTX-|CASH-/);

    // Replaying the same command creates nothing twice.
    const journals = await db
      .prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id=?")
      .bind(tenantId)
      .first<{ count: number }>();
    await repo.saveState(paid.state, actor, "Repeat the saved state");
    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id=?")
        .bind(tenantId)
        .first<{ count: number }>(),
    ).toEqual(journals);
  });
});
