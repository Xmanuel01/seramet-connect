import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyTransactionState, type BillingRecord } from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { hydrateAuthoritativeConfiguration } from "./authoritative-configuration";
import { createMigratedTestDatabase, type SqliteD1TestDatabase } from "./sqlite-test-adapter";
import { D1AuthoritativeTransactionRepository } from "./authoritative-transaction-repository";
import { createTransactionRepository } from "./create-transaction-repository";
import { PaymentOrchestrator } from "@/payments/payment-orchestrator";
import { businessDateForTimestamp } from "@/lib/business-date";
import { FinancialLedgerService } from "@/finance/financial-ledger-service";

let db: SqliteD1TestDatabase;
let repo: D1AuthoritativeTransactionRepository;
const tenantId = "ledger-disposable";
const branchId = "ledger-branch";
const actor: ServerActor = {
  id: "operator",
  name: "Disposable operator",
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
const mappings = {
  CUSTOMER_RECEIVABLE: ["receivable", "ASSET"],
  SALES_REVENUE: ["revenue", "INCOME"],
  TAX_PAYABLE: ["tax", "LIABILITY"],
  SERVICE_CHARGE: ["service", "INCOME"],
} as const;

function invoice(): BillingRecord {
  const stamp = new Date().toISOString();
  return {
    id: "invoice-1",
    tenantId,
    branchId,
    branch: branchId,
    orderIds: [],
    customer: "Walk-in",
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt: stamp,
    dueAt: stamp,
    businessDate: businessDateForTimestamp(stamp, "Africa/Nairobi", 240),
    lines: [],
    subtotal: 110,
    tax: 14,
    total: 124,
    paid: 0,
    financialComponents: {
      version: 1,
      currency: "KES",
      grossSalesMinor: 10000,
      discountsMinor: 0,
      netSalesMinor: 10000,
      serviceChargeMinor: 1000,
      taxMinor: 1400,
      totalMinor: 12400,
    },
  };
}

beforeEach(async () => {
  db = createMigratedTestDatabase();
  const stamp = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .bind(tenantId, tenantId, tenantId, tenantId, stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')",
    )
    .bind(tenantId, branchId, branchId, branchId)
    .run();
  await db
    .prepare(
      "INSERT INTO users (tenant_id,id,name,active,payload_json,created_at,updated_at) VALUES (?,?,'Operator',1,'{}',?,?)",
    )
    .bind(tenantId, actor.id, stamp, stamp)
    .run();
  for (const [key, [id, type]] of Object.entries(mappings)) {
    await db
      .prepare(
        "INSERT INTO accounts (tenant_id,id,code,name,account_type,currency,active,payload_json) VALUES (?,?,?,?,?,'KES',1,'{}')",
      )
      .bind(tenantId, id, id, id, type)
      .run();
    await db
      .prepare(
        "INSERT INTO setup_account_mappings (tenant_id,id,scope_key,mapping_key,requirement,account_id,status,finance_signoff_status,updated_by,updated_at) VALUES (?,?,'TENANT',?,'REQUIRED',?,'CONFIGURED','APPROVED',?,?)",
      )
      .bind(tenantId, key, key, id, actor.id, stamp)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO accounts (tenant_id,id,code,name,account_type,currency,active,payload_json) VALUES (?,'cash','cash','Cash','CASH','KES',1,'{}')",
    )
    .bind(tenantId)
    .run();
  await db
    .prepare(
      "INSERT INTO payment_methods (tenant_id,id,code,category,receivable_account_id,cash_account_id,settlement_account_id,active,payload_json) VALUES (?,'cash-method','CASH','CASH','receivable','cash','cash',1,'{}')",
    )
    .bind(tenantId)
    .run();
  await hydrateAuthoritativeConfiguration(db, {}, true);
  repo = new D1AuthoritativeTransactionRepository(db, { requireInvoiceLedger: true });
});

afterEach(() => {
  db.close();
  setConfigurationRepositoryForTests();
});

async function issued() {
  const state = createEmptyTransactionState(tenantId);
  state.bills.push(invoice());
  await repo.saveState(state, actor, "Issue disposable invoice");
  return repo.loadState(tenantId);
}
async function movements() {
  return (
    await db
      .prepare(
        "SELECT account_id,SUM(debit_minor)-SUM(credit_minor) AS balance FROM journal_lines WHERE tenant_id=? GROUP BY account_id ORDER BY account_id",
      )
      .bind(tenantId)
      .all<{ account_id: string; balance: number }>()
  ).results;
}

describe("authoritative invoice recognition", () => {
  it("posts exact net sales, service and tax against receivables in the invoice transaction", async () => {
    await issued();
    expect(await movements()).toEqual([
      { account_id: "receivable", balance: 12400 },
      { account_id: "revenue", balance: -10000 },
      { account_id: "service", balance: -1000 },
      { account_id: "tax", balance: -1400 },
    ]);
    expect(
      await db
        .prepare("SELECT source_type,source_id,status FROM journal_entries WHERE tenant_id=?")
        .bind(tenantId)
        .first(),
    ).toEqual({ source_type: "POS_INVOICE", source_id: "invoice-1", status: "POSTED" });
  });

  it("collects disposable cash through the existing orchestrator without recognizing revenue twice", async () => {
    let state = await issued();
    const orchestrator = new PaymentOrchestrator();
    state = orchestrator.openDrawer(state, {
      tenantId,
      branchId,
      employeeId: actor.id,
      openingFloatMinor: 0,
      currency: "KES",
      actor: actor.name,
    });
    await repo.saveState(state, actor, "Open disposable drawer");
    state = orchestrator.recordCash(state, {
      tenantId,
      branchId,
      drawerSessionId: state.paymentOperations!.drawerSessions[0]!.id,
      paymentMethodId: "cash-method",
      invoiceId: "invoice-1",
      amountMinor: 12400,
      cashTenderedMinor: 12400,
      currency: "KES",
      actor: actor.name,
    });
    await repo.saveState(state, actor, "Collect disposable cash");
    expect(await movements()).toEqual([
      { account_id: "cash", balance: 12400 },
      { account_id: "receivable", balance: 0 },
      { account_id: "revenue", balance: -10000 },
      { account_id: "service", balance: -1000 },
      { account_id: "tax", balance: -1400 },
    ]);
    const date = invoice().businessDate!;
    const statement = await new FinancialLedgerService(db, actor).statement({
      branchId,
      from: date,
      to: date,
    });
    expect(JSON.stringify(statement)).not.toContain("SETTLED_SALES_NOT_IN_GL");
    await repo.saveState(state, actor, "Repeated state causes no duplicate journal");
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id=? AND source_type='POS_INVOICE'",
        )
        .bind(tenantId)
        .first("count"),
    ).toBe(1);
  });

  it.each(["SPLIT", "MERGED", "VOID"] as const)(
    "reverses an unpaid %s invoice exactly once",
    async (status) => {
      const state = await issued();
      state.bills[0]!.status = status;
      await repo.saveState(state, actor, "Reverse unpaid invoice");
      await repo.saveState(state, actor, "Repeat reversal");
      expect((await movements())!.every((row) => row.balance === 0)).toBe(true);
      expect(
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM journal_entries WHERE source_type='POS_INVOICE_REVERSAL'",
          )
          .first("count"),
      ).toBe(1);
      state.bills[0]!.status = "OPEN";
      await expect(repo.saveState(state, actor, "Invalid resurrection")).rejects.toThrow(
        /cannot be reopened/,
      );
    },
  );

  it("does not rewrite posted amounts or manufacture missing historical components", async () => {
    const state = await issued();
    state.bills[0]!.financialComponents = undefined;
    const before = await movements();
    await expect(repo.saveState(state, actor, "Missing components")).rejects.toThrow(
      /components are required/,
    );
    expect(await movements()).toEqual(before);
    state.bills[0] = invoice();
    state.bills[0]!.total = 125;
    state.bills[0]!.subtotal = 111;
    state.bills[0]!.financialComponents!.totalMinor = 12500;
    state.bills[0]!.financialComponents!.netSalesMinor = 10100;
    state.bills[0]!.financialComponents!.grossSalesMinor = 10100;
    await expect(repo.saveState(state, actor, "Rewrite posted invoice")).rejects.toThrow(
      /Posted invoice amounts cannot change/,
    );
    expect(await movements()).toEqual(before);
  });

  it("requires actual posted journal evidence, not only a persisted posting flag", async () => {
    const state = createEmptyTransactionState(tenantId);
    state.bills.push({ ...invoice(), status: "DRAFT_BILL" });
    await repo.saveState(state, actor, "Create disposable draft");
    const row = await db
      .prepare("SELECT payload_json FROM invoices WHERE tenant_id=? AND id=?")
      .bind(tenantId, "invoice-1")
      .first<{ payload_json: string }>();
    const payload = JSON.parse(row!.payload_json);
    payload.invoiceLedger.posted = true;
    await db
      .prepare("UPDATE invoices SET payload_json=? WHERE tenant_id=? AND id=?")
      .bind(JSON.stringify(payload), tenantId, "invoice-1")
      .run();
    state.bills[0]!.status = "OPEN";
    await expect(
      repo.saveState(state, actor, "Cannot trust incomplete posting evidence"),
    ).rejects.toThrow(/Persisted invoice posting is missing/);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM journal_entries").first("count")).toBe(
      0,
    );
  });

  it.each(["PENDING", "REJECTED"])(
    "requires approved mappings, not %s signoff",
    async (signoff) => {
      await db
        .prepare(
          "UPDATE setup_account_mappings SET finance_signoff_status=? WHERE mapping_key='SALES_REVENUE'",
        )
        .bind(signoff)
        .run();
      await expect(issued()).rejects.toThrow(/approved, active SALES_REVENUE/);
      expect(await db.prepare("SELECT COUNT(*) AS count FROM invoices").first("count")).toBe(0);
      expect(
        await db.prepare("SELECT COUNT(*) AS count FROM mutation_commits").first("count"),
      ).toBe(0);
    },
  );

  it.each(["inactive", "currency", "classification"])(
    "rejects an invalid %s revenue account",
    async (fault) => {
      if (fault === "inactive")
        await db.prepare("UPDATE accounts SET active=0 WHERE id='revenue'").run();
      if (fault === "currency")
        await db.prepare("UPDATE accounts SET currency='USD' WHERE id='revenue'").run();
      if (fault === "classification")
        await db.prepare("UPDATE accounts SET account_type='ASSET' WHERE id='revenue'").run();
      await expect(issued()).rejects.toThrow(/approved, active SALES_REVENUE/);
      expect(await db.prepare("SELECT COUNT(*) AS count FROM journal_entries").first("count")).toBe(
        0,
      );
    },
  );

  it("revalidates account approval when an unposted draft becomes an invoice", async () => {
    const state = createEmptyTransactionState(tenantId);
    state.bills.push({ ...invoice(), status: "DRAFT_BILL" });
    await repo.saveState(state, actor, "Unposted invoice draft");
    expect(await db.prepare("SELECT COUNT(*) AS count FROM journal_entries").first("count")).toBe(
      0,
    );
    await db
      .prepare(
        "UPDATE setup_account_mappings SET finance_signoff_status='REJECTED' WHERE mapping_key='SALES_REVENUE'",
      )
      .run();
    state.bills[0]!.status = "OPEN";
    await expect(
      repo.saveState(state, actor, "Approval withdrawn before issuance"),
    ).rejects.toThrow(/approved, active SALES_REVENUE/);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM journal_entries").first("count")).toBe(
      0,
    );
  });

  it("does not use another branch's account or fall back past a pending branch override", async () => {
    await db
      .prepare(
        "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,'other','other','Other','Africa/Nairobi',240,1,'{}')",
      )
      .bind(tenantId)
      .run();
    await db.prepare("UPDATE accounts SET branch_id='other' WHERE id='revenue'").run();
    await expect(issued()).rejects.toThrow(/approved, active SALES_REVENUE/);
    await db.prepare("UPDATE accounts SET branch_id=NULL WHERE id='revenue'").run();
    await db
      .prepare(
        "INSERT INTO setup_account_mappings (tenant_id,id,branch_id,scope_key,mapping_key,requirement,account_id,status,finance_signoff_status,updated_by,updated_at) VALUES (?,'override',?,?,'SALES_REVENUE','REQUIRED','revenue','CONFIGURED','PENDING',?,?)",
      )
      .bind(tenantId, branchId, `BRANCH:${branchId}`, actor.id, new Date().toISOString())
      .run();
    await expect(issued()).rejects.toThrow(/approved, active SALES_REVENUE/);
  });

  it("keeps house-account credit control without a second revenue posting", async () => {
    const state = new PaymentOrchestrator().chargeHouseAccount(await issued(), {
      tenantId,
      branchId,
      customerId: "disposable-customer",
      invoiceId: "invoice-1",
      amountMinor: 12400,
      currency: "KES",
      receivableAccountId: "receivable",
      revenueAccountId: "revenue",
      actor: actor.name,
    });
    await repo.saveState(state, actor, "Place invoice on authorized house account");
    expect(state.paymentOperations!.customerAccounts[0]!.balanceMinor).toBe(12400);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM journal_entries").first("count")).toBe(
      1,
    );
    expect((await movements())!.find((row) => row.account_id === "revenue")!.balance).toBe(-10000);
  });

  it("rolls back invoice, journal and revision together when final posting fails", async () => {
    db.sqlite.exec(
      "CREATE TRIGGER disposable_reject_post BEFORE UPDATE OF status ON journal_entries WHEN NEW.source_type='POS_INVOICE' BEGIN SELECT RAISE(ABORT,'Disposable posting failure'); END;",
    );
    await expect(issued()).rejects.toThrow(/Disposable posting failure/);
    for (const table of [
      "invoices",
      "journal_entries",
      "journal_lines",
      "mutation_commits",
      "authoritative_records",
    ])
      expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first("count")).toBe(0);
  });

  it("serializes concurrent invoice issuance without duplicate revenue", async () => {
    const state = createEmptyTransactionState(tenantId);
    state.bills.push(invoice());
    const results = await Promise.allSettled([
      repo.saveState(state, actor, "Concurrent terminal one"),
      repo.saveState(state, actor, "Concurrent terminal two"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM journal_entries").first("count")).toBe(
      1,
    );
    expect(await db.prepare("SELECT COUNT(*) AS count FROM invoices").first("count")).toBe(1);
  });

  it("rejects even a new invoice in an already closed business period", async () => {
    const bill = invoice();
    const stamp = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO day_closes (tenant_id,id,branch_id,business_date,status,version,payload_json,created_at,updated_at) VALUES (?,'closed',?,?,'CLOSED',1,'{}',?,?)",
      )
      .bind(tenantId, branchId, bill.businessDate, stamp, stamp)
      .run();
    await expect(issued()).rejects.toThrow(/closed business period/);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM invoices").first("count")).toBe(0);
  });

  it.each(["production", "staging"])(
    "enforces posting on the real %s repository factory",
    async (environment) => {
      await db.prepare("DELETE FROM setup_account_mappings").run();
      const state = createEmptyTransactionState(tenantId);
      state.bills.push(invoice());
      await expect(
        createTransactionRepository(db, { SERAMET_ENVIRONMENT: environment }).saveState(
          state,
          actor,
          "Missing financial setup",
        ),
      ).rejects.toThrow(/approved, active CUSTOMER_RECEIVABLE/);
    },
  );
});
