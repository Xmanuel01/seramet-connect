import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FinancialLedgerService } from "@/finance/financial-ledger-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const t = "finance-tenant", a = "finance-westlands", b = "finance-ngong";
const other = "finance-other";
const window = { from: "2026-09-01", to: "2026-09-30" };
const stamp = "2026-09-20T12:00:00.000Z";

function actor(
  tenantId = t,
  branchId = a,
  permissionsList: string[] = allPermissionCodes,
): ServerActor {
  return {
    id: "finance-actor", name: "Test finance reviewer", tenantId,
    roleIds: ["finance-role"], permissions: [...permissionsList],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: branchId }],
    branchScope: { type: "BRANCH", branchId },
    branchId, branch: branchId, role: "Accountant",
  };
}

function seed(db: SqliteD1TestDatabase) {
  const sql = db.sqlite;
  for (const id of [t, other]) {
    sql.prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    ).run(id, id, id, id, stamp, stamp);
  }
  for (const [tenant, branch] of [[t, a], [t, b], [other, "outside-branch"]]) {
    sql.prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{}')",
    ).run(tenant, branch, branch, branch);
  }
  for (const [tenant, id, branch, code, type, currency] of [
    [t, "cash", null, "1000", "BANK", "KES"],
    [t, "income", null, "4000", "INCOME", "KES"],
    [t, "tax", null, "2200", "LIABILITY", "KES"],
    [t, "other-branch-account", b, "1020", "ASSET", "KES"],
    [t, "foreign", null, "EUR1", "ASSET", "EUR"],
    [other, "foreign-bank", null, "1000", "BANK", "KES"],
  ]) {
    sql.prepare(
      "INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json) VALUES (?,?,?,?,?,?,?,1,'{}')",
    ).run(tenant, id, branch, code, code, type, currency);
  }
  post(db, { tenant: t, branch: a, id: "sale-a", entries: [
    ["cash", 1000, 0], ["income", 0, 900], ["tax", 0, 100],
  ] });
  post(db, { tenant: t, branch: b, id: "other-branch", entries: [
    ["cash", 700, 0], ["income", 0, 700],
  ] });
  post(db, { tenant: other, branch: "outside-branch", id: "other-tenant", entries: [
    ["foreign-bank", 400, 0], ["foreign-bank", 0, 400],
  ] });
  sql.prepare(
    "INSERT INTO invoices (tenant_id,id,branch_id,invoice_number,status,business_date,currency,total_minor,paid_minor,payload_json,created_at,updated_at) VALUES (?,?,?,'INV-TEST','PARTIALLY_PAID','2026-09-20','KES',1000,400,'{}',?,?)",
  ).run(t, "invoice-test", a, stamp, stamp);
  sql.prepare(
    "INSERT INTO suppliers (tenant_id,id,code,name,active,payload_json,created_at,updated_at) VALUES (?,?,'SUP','Actual Supplier',1,'{}',?,?)",
  ).run(t, "supplier", stamp, stamp);
  sql.prepare(
    "INSERT INTO supplier_invoices (tenant_id,id,branch_id,supplier_id,invoice_number,invoice_date,due_date,currency,subtotal_minor,tax_minor,total_minor,status,payload_json,created_at,updated_at) VALUES (?,?,?,?,'SUP-100','2026-09-20','2026-10-04','KES',700,0,700,'POSTED','{}',?,?)",
  ).run(t, "supplier-bill", a, "supplier", stamp, stamp);
}

function post(db: SqliteD1TestDatabase, input: {
  tenant: string; branch: string; id: string;
  entries: Array<[string, number, number]>;
  date?: string; currency?: string;
}) {
  db.sqlite.prepare(
    "INSERT INTO journal_entries (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,correlation_id,payload_json,created_at,posted_at) VALUES (?,?,?,'TEST_SALE',?,?,'POSTED','Test posting',?,'{}',?,?)",
  ).run(input.tenant, input.id, input.branch, input.id,
    input.date ?? "2026-09-20", input.id, stamp, stamp);
  for (const [index, [account, debit, credit]] of input.entries.entries()) {
    db.sqlite.prepare(
      "INSERT INTO journal_lines (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency) VALUES (?,?,?,?,?,?,?)",
    ).run(input.tenant, input.id, index + 1, account, debit, credit, input.currency ?? "KES");
  }
}

describe("Authoritative finance and ERP-style reporting integrity", () => {
  let db: SqliteD1TestDatabase;
  beforeEach(() => { db = createMigratedTestDatabase(); seed(db); });
  afterEach(() => db.close());

  it("shows only scoped, posted, source-traceable journals and branch-safe account masters", async () => {
    const service = new FinancialLedgerService(db, actor());
    const ledger = await service.ledger(window);
    expect(ledger.rows).toHaveLength(3);
    expect(ledger.rows.every((row) => row.voucher_id === "sale-a")).toBe(true);
    const statement = await service.statement(window);
    expect(statement.lines.map((row) => row.code)).not.toContain("1020");
    expect(statement.scope.currency).toBe("KES");
    expect(statement.trial).toMatchObject({ periodDebitMinor: 1000, periodCreditMinor: 1000, balanced: true });
    expect(statement.balanceSheet).toMatchObject({
      assetsMinor: 1000, liabilitiesMinor: 100, unclosedEarningsMinor: 900,
      differenceMinor: 0,
    });
    expect(statement.incomeStatement).toMatchObject({ incomeMinor: 900, expenseMinor: 0 });
    expect(statement.cashMovement).toMatchObject({ openingMinor: 0, periodMinor: 1000 });
    expect(statement.issues.map((row) => row.code)).toContain("SUPPLIER_BILLS_MISSING_GL");
  });

  it("rejects cross-tenant, cross-branch and unauthorized reporting", async () => {
    const scope = new FinancialLedgerService(db, actor(t, b));
    expect((await scope.ledger(window)).rows.every((row) => row.voucher_id === "other-branch")).toBe(true);
    await expect(scope.statement({ ...window, branchId: a })).rejects.toThrow();
    await expect(scope.ledger({ ...window, branchId: "outside-branch" })).rejects.toThrow();
    await expect(new FinancialLedgerService(db, actor(t, a, [permissions.posAccess]))
      .statement(window)).rejects.toThrow(/permission/);
  });

  it("enforces correct source values and explains missing supplier allocation", async () => {
    const s = new FinancialLedgerService(db, actor());
    const ar = await s.receivables(window);
    expect(ar.rows).toHaveLength(1);
    expect(ar.rows[0]).toMatchObject({ total_minor: 1000, paid_minor: 400 });
    const ap = await s.payables(window);
    expect(ap.rows).toHaveLength(1);
    expect(ap.rows[0]).toMatchObject({
      supplier_name: "Actual Supplier", invoice_number: "SUP-100",
    });
    expect(ap.allocationVerified).toBe(false);
  });

  it("refuses invalid dates and unbounded ledger pages", async () => {
    const s = new FinancialLedgerService(db, actor());
    await expect(s.statement({ from: "2026-02-31", to: "2026-09-30" })).rejects.toThrow();
    await expect(s.statement({ from: "2024-01-01", to: "2026-09-30" })).rejects.toThrow(/367/);
    await expect(s.ledger({ ...window, limit: 999 })).rejects.toThrow();
  });

  it("reports imbalanced posted vouchers and missing sales bridge without false success", async () => {
    const s = new FinancialLedgerService(db, actor());
    db.sqlite.prepare(
      "DELETE FROM journal_lines WHERE tenant_id=? AND journal_entry_id=? AND account_id=?",
    ).run(t, "sale-a", "income");
    const report = await s.statement(window);
    const codes = report.issues.map((issue) => issue.code);
    expect(codes).toContain("IMBALANCED_POSTED_JOURNALS");
    expect(codes).toContain("SETTLED_SALES_NOT_IN_GL");
    expect(report.trial.balanced).toBe(false);
    expect(report.quality).toBe("INCOMPLETE");
  });

  it("preserves opening balances and distinguishes the selected period from lifetime earnings", async () => {
    post(db, { tenant: t, branch: a, id: "opening", date: "2026-08-20", entries: [
      ["cash", 250, 0], ["income", 0, 250],
    ] });
    const report = await new FinancialLedgerService(db, actor()).statement(window);
    const cash = report.lines.find((row) => row.accountId === "cash");
    expect(cash).toMatchObject({ openingDebitMinor: 250, periodDebitMinor: 1000 });
    expect(report.incomeStatement.incomeMinor).toBe(900);
    expect(report.balanceSheet.unclosedEarningsMinor).toBe(1150);
  });

  it("separately flags foreign currency accounts without silently converting their balances", async () => {
    post(db, { tenant: t, branch: a, id: "euro-posting", currency: "EUR", entries: [
      ["foreign", 200, 0], ["foreign", 0, 200],
    ] });
    const report = await new FinancialLedgerService(db, actor()).statement(window);
    expect(report.issues.map((issue) => issue.code)).toContain("FOREIGN_CURRENCY_REVALUATION_REQUIRED");
    expect(report.scope.currency).toBe("KES");
  });

  it("refuses fake cash-flow totals if there is no explicit bank/cash account", async () => {
    db.sqlite.prepare(
      "UPDATE accounts SET account_type='ASSET' WHERE tenant_id=? AND id='cash'",
    ).run(t);
    const report = await new FinancialLedgerService(db, actor()).statement(window);
    expect(report.cashMovement).toBeNull();
    expect(report.issues.map((issue) => issue.code)).toContain("CASH_ACCOUNT_CLASSIFICATION_MISSING");
  });
});
