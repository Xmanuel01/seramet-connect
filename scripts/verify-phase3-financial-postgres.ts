import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CrmService } from "@/crm/crm-service";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import { PostgresD1Database } from "@/server/database/postgres-database";

const raw = process.env.SERAMET_POSTGRES_URL;
const target = raw ? new URL(raw) : null;
if (
  process.env.CI !== "true" ||
  !target ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5432" ||
  target.username !== "finance_ci" ||
  target.pathname !== "/seramet_finance_ci"
) {
  throw new Error("Phase 3 financial certification requires disposable CI PostgreSQL");
}
const db = PostgresD1Database.fromHyperdrive({ connectionString: raw! });
const second = PostgresD1Database.fromHyperdrive({ connectionString: raw! });
const control = new pg.Client({ connectionString: raw });
const tenantId = "phase3-finance-" + randomUUID();
const branchId = "branch-" + randomUUID();
const warehouseId = "warehouse-" + randomUUID();
const stamp = new Date().toISOString();
const businessDate = stamp.slice(0, 10);
const actor: ServerActor = {
  id: "phase3-operator",
  name: "Disposable Phase 3 operator",
  tenantId,
  branchId,
  roleIds: [],
  permissions: [...allPermissionCodes],
  role: "Manager",
  branch: "CI",
  branchScope: { type: "ALL" },
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: "CI" }],
};
try {
  await control.connect();
  await db
    .prepare(
      "INSERT INTO tenants(id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES(?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .bind(tenantId, tenantId, "Disposable financial verification", "CI", stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO branches(tenant_id,id,code,name,timezone) VALUES(?,?,?,'CI','Africa/Nairobi')",
    )
    .bind(tenantId, branchId, branchId)
    .run();
  await db
    .prepare("INSERT INTO warehouses(tenant_id,id,branch_id,code,name) VALUES(?,?,?,?,'CI')")
    .bind(tenantId, warehouseId, branchId, warehouseId)
    .run();
  for (const [id, type] of [
    ["stock", "ASSET"],
    ["opening", "EQUITY"],
    ["payable", "LIABILITY"],
    ["cogs", "COGS"],
    ["loss", "EXPENSE"],
    ["liability", "LIABILITY"],
    ["cash", "ASSET"],
    ["redemption", "ASSET"],
  ]) {
    await db
      .prepare(
        "INSERT INTO accounts(tenant_id,id,code,name,account_type,currency,active,payload_json) VALUES(?,?,?,?,?,'KES',1,'{}')",
      )
      .bind(tenantId, id, id, id, type)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO inventory_account_mappings(tenant_id,id,inventory_account_id,opening_balance_account_id,accounts_payable_account_id,cogs_account_id,wastage_account_id,variance_account_id,accounting_mode,created_at,updated_at) VALUES(?,'phase3','stock','opening','payable','cogs','loss','loss','PERPETUAL',?,?)",
    )
    .bind(tenantId, stamp, stamp)
    .run();
  await verifyStock();
  await verifyValue();
  const unbalanced = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.tenant_id=e.tenant_id AND l.journal_entry_id=e.id WHERE e.tenant_id=? AND e.status='POSTED' GROUP BY e.id HAVING SUM(l.debit_minor)<>SUM(l.credit_minor)) invalid",
    )
    .bind(tenantId)
    .first<{ count: number }>();
  assert.equal(Number(unbalanced?.count), 0);
  console.log("PHASE3_POSTGRES_NONEMPTY_FINANCIAL_CERTIFICATION_PASS");
} finally {
  await control.query("ROLLBACK").catch(() => undefined);
  await control.end();
  await db.close();
  await second.close();
}

async function verifyStock() {
  const service = new InventoryIntelligenceService(db, actor);
  const competing = new InventoryIntelligenceService(second, actor);
  await service.createUnit({
    id: "kg",
    code: "KG",
    name: "Kilogram",
    symbol: "kg",
    dimension: "MASS",
  });
  await service.createInventoryItem({
    id: "item",
    code: "ITEM",
    name: "CI stock",
    baseUnitId: "kg",
    defaultWarehouseId: warehouseId,
  });
  await db
    .prepare(
      "INSERT INTO inventory_par_policies(tenant_id,id,branch_id,warehouse_id,inventory_item_id,negative_stock_policy,updated_at) VALUES(?,'phase3',?,?,'item','BLOCK',?)",
    )
    .bind(tenantId, branchId, warehouseId, stamp)
    .run();
  const common = { branchId, warehouseId, inventoryItemId: "item", businessDate };
  const opening = {
    ...common,
    movementType: "OPENING" as const,
    quantityBaseMicro: 10_000_000,
    unitCostMinor: 55_000,
    totalCostMinor: 550_000,
    sourceType: "OPENING",
    sourceId: "opening",
    idempotencyKey: "opening",
  };
  assert.equal((await service.appendMovement(opening)).duplicate, false);
  assert.equal((await service.appendMovement(opening)).duplicate, true);
  const consume = (key: string, quantity = -2_000_000) => ({
    ...common,
    movementType: "SALE_CONSUMPTION" as const,
    quantityBaseMicro: quantity,
    sourceType: "ORDER",
    sourceId: key,
    idempotencyKey: key,
  });
  await service.appendMovement(consume("sale"));
  await assertStock(8_000_000, 440_000);
  const before = await count("inventory_movements");
  await assert.rejects(
    service.appendMovement(consume("oversell", -9_000_000)),
    /NEGATIVE|insufficient/i,
  );
  assert.equal(await count("inventory_movements"), before);
  const race = await blockedRace(
    "journal_entries",
    () => service.appendMovement(consume("race-a", -6_000_000)),
    () => competing.appendMovement(consume("race-b", -6_000_000)),
  );
  assert.equal(
    race.filter((r) => r.status === "fulfilled").length,
    1,
    "Exactly one competing stock deduction must commit",
  );
  await assertStock(2_000_000, 110_000);
  await assert.rejects(
    db
      .prepare("UPDATE inventory_movements SET quantity_minor=1 WHERE tenant_id=?")
      .bind(tenantId)
      .run(),
    /IMMUTABLE/i,
  );
  const denied = new InventoryIntelligenceService(db, { ...actor, tenantId: "nonexistent-tenant" });
  await assert.rejects(denied.appendMovement(consume("cross-tenant")));
  console.log(
    "PostgreSQL non-empty stock: value/GL reconciliation, replay, oversell, forced race, immutability and tenant denial PASS",
  );
}

async function assertStock(quantity: number, value: number) {
  const row = await db
    .prepare(
      "SELECT quantity_minor,total_value_minor FROM inventory_balances WHERE tenant_id=? AND warehouse_id=? AND item_id='item'",
    )
    .bind(tenantId, warehouseId)
    .first<{ quantity_minor: number; total_value_minor: number }>();
  const ledger = await db
    .prepare(
      "SELECT SUM(quantity_minor) AS quantity,SUM(total_cost_minor) AS value FROM inventory_movements WHERE tenant_id=? AND item_id='item'",
    )
    .bind(tenantId)
    .first<{ quantity: number; value: number }>();
  assert.equal(Number(row?.quantity_minor), quantity);
  assert.equal(Number(row?.total_value_minor), value);
  assert.equal(Number(ledger?.quantity), quantity);
  assert.equal(Number(ledger?.value), value);
  assert.equal(await accountBalance("stock"), value);
}

async function verifyValue() {
  const service = new LoyaltyValueService(db, actor);
  const competing = new LoyaltyValueService(second, actor);
  const customer = await new CrmService(db, actor).createCustomer({
    displayName: "Synthetic financial customer",
    preferredBranchId: branchId,
    createdSource: "PHASE3_CI",
  });
  const program = await service.createProgram({
    code: "PHASE3",
    name: "Synthetic program",
    scopeType: "TENANT",
    effectiveFrom: "2020-01-01T00:00:00Z",
    earningType: "SPEND",
    spendMinorPerPoint: 100,
    minimumSpendMinor: 0,
    roundingPolicy: "FLOOR",
    expiryType: "DAYS_AFTER_EARN",
    expiryDays: 30,
    eligibleBranchIds: [],
    eligibleChannels: [],
    redemptionRules: {},
  });
  await service.joinProgram(customer.id, program.id);
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      "INSERT INTO loyalty_ledger(tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,business_date,expires_at,reason,actor_id,correlation_id,idempotency_key,created_at) VALUES(?,'earn',?,?,?,'EARN',100,'CI','earn',?,?,'Synthetic balance',?,'earn','earn',?)",
    )
    .bind(tenantId, customer.id, program.id, branchId, businessDate, expiry, actor.id, stamp)
    .run();
  const redeem = (key: string) => ({
    customerId: customer.id,
    programId: program.id,
    branchId,
    channel: "Dine-in",
    points: 75,
    orderId: key,
    businessDate,
    idempotencyKey: key,
  });
  const race = await blockedRace(
    "audit_events",
    () => service.redeemPoints(redeem("points-a")),
    () => competing.redeemPoints(redeem("points-b")),
  );
  assert.equal(
    race.filter((r) => r.status === "fulfilled").length,
    1,
    "Exactly one competing points redemption must commit",
  );
  const balance = () =>
    db
      .prepare(
        "SELECT SUM(points) AS points FROM loyalty_ledger WHERE tenant_id=? AND customer_id=? AND program_id=?",
      )
      .bind(tenantId, customer.id, program.id)
      .first<number>("points");
  assert.equal(Number(await balance()), 25);
  const asOf = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
  assert.equal((await service.expirePoints(asOf)).expiredEntries, 1);
  assert.equal(Number(await balance()), 0);
  assert.equal((await service.expirePoints(asOf)).expiredEntries, 0);
  console.log(
    "PostgreSQL non-empty loyalty: forced double-spend race, residual expiry and replay PASS",
  );
  const issue = {
    amountMinor: 100_000,
    currency: "KES",
    liabilityAccountId: "liability",
    collectionAccountId: "cash",
    redemptionAccountId: "redemption",
    businessDate,
    idempotencyKey: "gift-issue",
  };
  const card = await service.issueGiftCard(issue);
  assert.ok(card.token);
  assert.equal((await service.issueGiftCard(issue)).duplicate, true);
  const giftRedeem = (key: string) => ({
    token: card.token!,
    amountMinor: 75_000,
    currency: "KES",
    branchId,
    orderId: key,
    businessDate,
    idempotencyKey: key,
  });
  const gifts = await blockedRace(
    "journal_entries",
    () => service.redeemGiftCard(giftRedeem("gift-a")),
    () => competing.redeemGiftCard(giftRedeem("gift-b")),
  );
  assert.equal(
    gifts.filter((r) => r.status === "fulfilled").length,
    1,
    "Exactly one competing funded gift redemption must commit",
  );
  assert.equal(Number((await service.giftCardBalance(card.token)).balance_minor), 25_000);
  assert.equal(-(await accountBalance("liability")), 25_000);
  const winner = gifts.find((r) => r.status === "fulfilled");
  assert.ok(winner?.status === "fulfilled");
  const refund = {
    giftCardId: card.id,
    originalRedemptionId: winner.value.id,
    amountMinor: 25_000,
    currency: "KES",
    branchId,
    businessDate,
    idempotencyKey: "gift-refund",
  };
  await service.refundGiftCardValue(refund);
  await service.refundGiftCardValue(refund);
  assert.equal(Number((await service.giftCardBalance(card.token)).balance_minor), 50_000);
  assert.equal(-(await accountBalance("liability")), 50_000);
  assert.ok((await service.listGiftCards()).some((entry) => entry.id === card.id));
  const expiring = await service.issueGiftCard({
    ...issue,
    amountMinor: 2_000,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    idempotencyKey: "gift-expiry-issue",
  });
  assert.ok(expiring.token);
  const giftExpiryAsOf = new Date(Date.now() + 31 * 86_400_000);
  await service.expireStoredValue(giftExpiryAsOf);
  const expired = await service.giftCardBalance(expiring.token);
  assert.equal(Number(expired.balance_minor), 0);
  assert.equal(expired.status, "EXPIRED");
  assert.equal((await service.expireStoredValue(giftExpiryAsOf)).expiredGiftCards, 0);
  // Expiry does not recognize breakage revenue without the tenant's finance policy.
  assert.equal(-(await accountBalance("liability")), 52_000);
  await assert.rejects(
    service.redeemGiftCard({ ...giftRedeem("currency"), currency: "USD" }),
    /currency/i,
  );
  await assert.rejects(
    db.prepare("UPDATE gift_card_ledger SET amount_minor=1 WHERE tenant_id=?").bind(tenantId).run(),
    /append-only|immutable/i,
  );
  console.log(
    "PostgreSQL funded gift cards: issue/redeem/refund, liability reconciliation, replay, currency and forced double-spend race PASS",
  );
}

async function count(table: "inventory_movements") {
  return Number(
    await db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?`)
      .bind(tenantId)
      .first("count"),
  );
}
async function accountBalance(accountId: string) {
  return Number(
    await db
      .prepare(
        "SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0) AS balance FROM journal_lines l JOIN journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.journal_entry_id WHERE l.tenant_id=? AND l.account_id=? AND e.status='POSTED'",
      )
      .bind(tenantId, accountId)
      .first("balance"),
  );
}

// Hold the downstream write so both sessions overlap; also works when an earlier
// parent-row lock correctly serializes the second operation. Never runs remotely.
async function blockedRace<T>(
  table: "audit_events" | "journal_entries",
  first: () => Promise<T>,
  other: () => Promise<T>,
) {
  await control.query("BEGIN");
  await control.query(`LOCK TABLE public.${table} IN SHARE MODE`);
  const result = Promise.allSettled([first(), other()]);
  let waiting = 0;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await control.query("SELECT pg_stat_clear_snapshot()");
      const observed = await control.query(
        "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock'",
      );
      waiting = observed.rows[0].count;
      if (waiting >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    await control.query("ROLLBACK");
  }
  const outcomes = await result;
  assert.ok(
    waiting >= 2,
    "Both isolated sessions must overlap: " +
      outcomes.map((r) => (r.status === "rejected" ? String(r.reason) : "fulfilled")).join("; "),
  );
  return outcomes;
}
