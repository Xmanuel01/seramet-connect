import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresD1Database } from "../src/server/database/postgres-database";
import { FinancialLedgerService } from "../src/finance/financial-ledger-service";
import { allPermissionCodes, permissions } from "../src/platform/permissions";
import type { ServerActor } from "../src/lib/seramet-auth";
import { D1AuthoritativeTransactionRepository } from "../src/server/database/authoritative-transaction-repository";
import { hydrateAuthoritativeConfiguration } from "../src/server/database/authoritative-configuration";
import { createEmptyTransactionState, type BillingRecord } from "../src/lib/transaction-engine";
import { businessDateForTimestamp } from "../src/lib/business-date";
import { PaymentOrchestrator } from "../src/payments/payment-orchestrator";

const url = process.env.SERAMET_POSTGRES_URL;
const parsed = url ? new URL(url) : null;
if (
  process.env.CI !== "true" ||
  !parsed ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "5432" ||
  parsed.username !== "finance_ci" ||
  parsed.pathname !== "/seramet_finance_ci"
) {
  throw new Error("The finance PostgreSQL integration probe requires its disposable CI database");
}
const db = PostgresD1Database.fromHyperdrive({ connectionString: url! });
try {
  const stamp = new Date().toISOString();
  const tenantId = "finance-ci-" + randomUUID();
  const branchId = "branch-" + randomUUID();
  const otherId = "another-" + randomUUID();
  await db
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .bind(tenantId, tenantId, tenantId, tenantId, stamp, stamp)
    .run();
  for (const id of [branchId, otherId]) {
    await db
      .prepare(
        "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{}')",
      )
      .bind(tenantId, id, id, id)
      .run();
  }
  for (const [id, code, type] of [
    ["bank", "1000", "BANK"],
    ["revenue", "4000", "REVENUE"],
    ["tax", "2300", "LIABILITY"],
  ]) {
    await db
      .prepare(
        "INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json) VALUES (?,?,NULL,?,?,?,'KES',1,'{}')",
      )
      .bind(tenantId, id, code, id, type)
      .run();
  }
  const voucherId = randomUUID();
  const window = { branchId, from: "2026-01-01", to: "2026-12-31" };
  await db
    .prepare(
      "INSERT INTO journal_entries (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,correlation_id,payload_json,created_at) VALUES (?,?,?,'CI_SALE',?,'2026-09-26','DRAFT','Isolated journal',?,'{}',?)",
    )
    .bind(tenantId, voucherId, branchId, voucherId, voucherId, stamp)
    .run();
  const entries: Array<[string, number, number]> = [
    ["bank", 1250, 0],
    ["revenue", 0, 1000],
    ["tax", 0, 250],
  ];
  for (let index = 0; index < entries.length; index++) {
    const [account, debit, credit] = entries[index]!;
    await db
      .prepare(
        "INSERT INTO journal_lines (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json) VALUES (?,?,?,?,?,?,?,'{}')",
      )
      .bind(tenantId, voucherId, index + 1, account, debit, credit, "KES")
      .run();
  }
  await db
    .prepare(
      "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=? AND status='DRAFT'",
    )
    .bind(stamp, tenantId, voucherId)
    .run();
  const actor: ServerActor = {
    id: "ci-reviewer",
    name: "Financial reviewer",
    tenantId,
    roleIds: ["ci"],
    permissions: [...allPermissionCodes],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    branch: branchId,
    role: "Accountant",
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: branchId }],
  };
  const service = new FinancialLedgerService(db, actor);
  const report = await service.statement(window);
  assert.equal(report.trial.periodDebitMinor, 1250);
  assert.equal(report.trial.periodCreditMinor, 1250);
  assert.equal(report.incomeStatement.incomeMinor, 1000);
  assert.equal(report.balanceSheet.assetsMinor, 1250);
  assert.equal(report.balanceSheet.differenceMinor, 0);
  assert.equal((await service.ledger(window)).rows.length, 3);
  assert.equal((await service.receivables(window)).rows.length, 0);
  assert.equal((await service.payables(window)).rows.length, 0);
  await assert.rejects(service.statement({ ...window, branchId: otherId }), /branch/i);
  await assert.rejects(
    new FinancialLedgerService(db, { ...actor, permissions: [permissions.posAccess] }).ledger(
      window,
    ),
    /permission/i,
  );
  await assert.rejects(
    db
      .prepare(
        "UPDATE journal_lines SET credit_minor=999 WHERE tenant_id=? AND journal_entry_id=? AND line_number=2",
      )
      .bind(tenantId, voucherId)
      .run(),
    /IMMUTABLE/i,
  );
  console.log("Real PostgreSQL finance isolation, journal balance and immutability: PASS");

  await db
    .prepare(
      "INSERT INTO users (tenant_id,id,name,active,payload_json,created_at,updated_at) VALUES (?,?,'Disposable reviewer',1,'{}',?,?)",
    )
    .bind(tenantId, actor.id, stamp, stamp)
    .run();
  for (const [id, type] of [
    ["receivable", "ASSET"],
    ["service", "REVENUE"],
    ["cash", "CASH"],
  ]) {
    await db
      .prepare(
        "INSERT INTO accounts (tenant_id,id,code,name,account_type,currency,active,payload_json) VALUES (?,?,?,?,?,'KES',1,'{}')",
      )
      .bind(tenantId, id, id, id, type)
      .run();
  }
  for (const [key, account] of [
    ["CUSTOMER_RECEIVABLE", "receivable"],
    ["SALES_REVENUE", "revenue"],
    ["TAX_PAYABLE", "tax"],
    ["SERVICE_CHARGE", "service"],
  ]) {
    await db
      .prepare(
        "INSERT INTO setup_account_mappings (tenant_id,id,scope_key,mapping_key,requirement,account_id,status,finance_signoff_status,updated_by,updated_at) VALUES (?,?,'TENANT',?,'REQUIRED',?,'CONFIGURED','APPROVED',?,?)",
      )
      .bind(tenantId, key, key, account, actor.id, stamp)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO payment_methods (tenant_id,id,code,category,receivable_account_id,cash_account_id,settlement_account_id,active,payload_json) VALUES (?,'cash-method','CASH','CASH','receivable','cash','cash',1,'{}')",
    )
    .bind(tenantId)
    .run();
  await hydrateAuthoritativeConfiguration(db, {}, true);
  const repository = new D1AuthoritativeTransactionRepository(db, { requireInvoiceLedger: true });
  const businessDate = businessDateForTimestamp(stamp, "Africa/Nairobi", 240);
  const invoice: BillingRecord = {
    id: "ci-invoice",
    tenantId,
    branchId,
    branch: branchId,
    orderIds: [],
    customer: "Disposable customer",
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt: stamp,
    dueAt: stamp,
    businessDate,
    lines: [],
    subtotal: 11,
    tax: 2.5,
    total: 13.5,
    paid: 0,
    financialComponents: {
      version: 1,
      currency: "KES",
      grossSalesMinor: 1000,
      discountsMinor: 0,
      netSalesMinor: 1000,
      serviceChargeMinor: 100,
      taxMinor: 250,
      totalMinor: 1350,
    },
  };
  let state = createEmptyTransactionState(tenantId);
  state.bills.push(invoice);
  await repository.saveState(state, actor, "Disposable PostgreSQL invoice issuance");
  const orchestrator = new PaymentOrchestrator();
  state = orchestrator.openDrawer(await repository.loadState(tenantId), {
    tenantId,
    branchId,
    employeeId: actor.id,
    openingFloatMinor: 0,
    currency: "KES",
    actor: actor.name,
  });
  await repository.saveState(state, actor, "Disposable PostgreSQL drawer");
  state = orchestrator.recordCash(state, {
    tenantId,
    branchId,
    drawerSessionId: state.paymentOperations!.drawerSessions[0]!.id,
    paymentMethodId: "cash-method",
    invoiceId: invoice.id,
    amountMinor: 1350,
    cashTenderedMinor: 1350,
    currency: "KES",
    actor: actor.name,
  });
  await repository.saveState(state, actor, "Disposable PostgreSQL cash collection");
  await repository.saveState(state, actor, "Repeated state must not duplicate recognition");
  const recognition = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id=? AND source_type='POS_INVOICE' AND source_id=? AND status='POSTED'",
    )
    .bind(tenantId, invoice.id)
    .first<{ count: number }>();
  assert.equal(Number(recognition?.count), 1);
  const receivable = await db
    .prepare(
      "SELECT SUM(debit_minor)-SUM(credit_minor) AS balance FROM journal_lines WHERE tenant_id=? AND account_id='receivable'",
    )
    .bind(tenantId)
    .first<{ balance: number }>();
  assert.equal(Number(receivable?.balance), 0);
  const updated = await service.statement({ branchId, from: businessDate, to: businessDate });
  assert.ok(!updated.issues.some((issue) => issue.code === "SETTLED_SALES_NOT_IN_GL"));
  assert.equal(updated.trial.periodDebitMinor, updated.trial.periodCreditMinor);
  console.log(
    "Real PostgreSQL source-linked invoice, cash collection and no duplicate revenue: PASS",
  );

  const revisionBeforeRace = await repository.revision(tenantId);
  const racingState = await repository.loadState(tenantId);
  racingState.bills.push({ ...invoice, id: "ci-invoice-approval-race" });
  const batch = db.batch.bind(db);
  const financeConnection = PostgresD1Database.fromHyperdrive({ connectionString: url! });
  let revoked = false;
  db.batch = async (statements) => {
    if (!revoked) {
      revoked = true;
      await financeConnection
        .prepare(
          "UPDATE setup_account_mappings SET finance_signoff_status='REJECTED' WHERE tenant_id=? AND mapping_key='SALES_REVENUE'",
        )
        .bind(tenantId)
        .run();
    }
    return batch(statements);
  };
  try {
    await assert.rejects(
      repository.saveState(racingState, actor, "Disposable concurrent finance revocation"),
    );
    assert.equal(revoked, true);
    assert.equal(await repository.revision(tenantId), revisionBeforeRace);
    const remaining = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM invoices WHERE tenant_id=? AND id='ci-invoice-approval-race'",
      )
      .bind(tenantId)
      .first<{ count: number }>();
    assert.equal(Number(remaining?.count), 0);
    const journal = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id=? AND source_id='ci-invoice-approval-race'",
      )
      .bind(tenantId)
      .first<{ count: number }>();
    assert.equal(Number(journal?.count), 0);
    assert.ok(
      !(await repository.loadState(tenantId)).bills.some(
        (bill) => bill.id === "ci-invoice-approval-race",
      ),
    );
  } finally {
    db.batch = batch;
    await financeConnection.close();
  }
  console.log(
    "Real PostgreSQL separate-connection finance approval withdrawal and atomic rollback: PASS",
  );
} finally {
  await db.close();
}
