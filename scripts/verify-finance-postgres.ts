import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresD1Database } from "../src/server/database/postgres-database";
import { FinancialLedgerService } from "../src/finance/financial-ledger-service";
import { allPermissionCodes, permissions } from "../src/platform/permissions";
import type { ServerActor } from "../src/lib/seramet-auth";

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
} finally {
  await db.close();
}
