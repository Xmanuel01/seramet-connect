import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { D1AuthoritativeTransactionRepository } from "../src/server/database/authoritative-transaction-repository";
import { hydrateAuthoritativeConfiguration } from "../src/server/database/authoritative-configuration";
import { PostgresD1Database } from "../src/server/database/postgres-database";
import type { ServerActor } from "../src/lib/seramet-auth";
import {
  authorizeDelivery,
  deriveBridgeSigningKey,
  handlePrintingApi,
  signPrintJob,
} from "../src/server/printing-api";
import { printerConfigurationSchema } from "../src/printing/printer-configuration";

const connectionString = process.env.SERAMET_POSTGRES_URL;
const parsed = connectionString ? new URL(connectionString) : null;
if (
  process.env.CI !== "true" ||
  !parsed ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "5432" ||
  parsed.username !== "pos_ci" ||
  parsed.pathname !== "/seramet_pos_ci"
) {
  throw new Error("The POS PostgreSQL verifier requires its disposable CI database");
}

const firstDb = PostgresD1Database.fromHyperdrive({ connectionString: connectionString! });
const secondDb = PostgresD1Database.fromHyperdrive({ connectionString: connectionString! });
const tenantId = `pos-ci-${randomUUID()}`;
const branchId = `branch-${randomUUID()}`;
const userId = `user-${randomUUID()}`;
const cashMethodId = `cash-${randomUUID()}`;

try {
  await seed(firstDb);
  await hydrateAuthoritativeConfiguration(firstDb, {}, true);
  const first = new D1AuthoritativeTransactionRepository(firstDb);
  const second = new D1AuthoritativeTransactionRepository(secondDb);

  const competing = [
    command(
      first,
      "order-a",
      "hash-a",
      "upsertOrderDraft",
      {
        draft: orderDraft("Terminal A"),
        targetStatus: "OPEN",
      },
      0,
    ),
    command(
      second,
      "order-b",
      "hash-b",
      "upsertOrderDraft",
      {
        draft: orderDraft("Terminal B"),
        targetStatus: "OPEN",
      },
      0,
    ),
  ];
  const race = await Promise.allSettled(competing);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  const loser = race.find((result) => result.status === "rejected");
  assert.equal(loser?.status, "rejected");
  assert.deepEqual(
    {
      code: (loser as PromiseRejectedResult).reason.code,
      status: (loser as PromiseRejectedResult).reason.status,
    },
    { code: "CONFLICT", status: 409 },
  );
  await assertCounts({ mutation_commits: 1, realtime_events: 1, audit_events: 1 });
  let state = await first.loadState(tenantId);
  assert.equal(state.orders.length, 1);

  const winnerIndex = race.findIndex((result) => result.status === "fulfilled");
  const winningKey = winnerIndex === 0 ? "order-a" : "order-b";
  const winningHash = winnerIndex === 0 ? "hash-a" : "hash-b";
  const winningLabel = winnerIndex === 0 ? "Terminal A" : "Terminal B";
  const duplicateOrder = await command(
    second,
    winningKey,
    winningHash,
    "upsertOrderDraft",
    { draft: orderDraft(winningLabel), targetStatus: "OPEN" },
    0,
  );
  assert.equal(duplicateOrder.duplicate, true);
  await assert.rejects(
    command(second, winningKey, "altered-hash", "upsertOrderDraft", {
      draft: orderDraft("Altered payload"),
      targetStatus: "OPEN",
    }),
    (error: unknown) => isCommandError(error, 409, "DUPLICATE"),
  );
  await assertCounts({ mutation_commits: 1, realtime_events: 1, audit_events: 1 });

  const orderId = state.orders[0]!.id;
  const kitchen = await command(first, "send-kitchen", "send-kitchen", "upsertAndSendKitchen", {
    orderId,
    draft: orderDraft(winningLabel),
  });
  const obligations = kitchen.state.kitchenPrintObligations ?? [];
  assert.equal(obligations.length, 1);
  const claimRevision = kitchen.revision;
  const claims = await Promise.allSettled([
    command(
      first,
      "claim-a",
      "claim-a",
      "claimKitchenPrintObligations",
      {
        obligationIds: obligations.map((item) => item.id),
        claimToken: "terminal-a-claim",
      },
      claimRevision,
    ),
    command(
      second,
      "claim-b",
      "claim-b",
      "claimKitchenPrintObligations",
      {
        obligationIds: obligations.map((item) => item.id),
        claimToken: "terminal-b-claim",
      },
      claimRevision,
    ),
  ]);
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(claims.filter((result) => result.status === "rejected").length, 1);
  state = await first.loadState(tenantId);
  assert.equal(
    state.kitchenPrintObligations?.filter((item) => item.status === "CLAIMED").length,
    1,
  );

  const invoice = await command(first, "invoice", "invoice", "prepareInvoiceForPayment", {
    orderId,
  });
  const replayedInvoice = await command(second, "invoice", "invoice", "prepareInvoiceForPayment", {
    orderId,
  });
  assert.equal(replayedInvoice.duplicate, true);
  assert.equal(invoice.state.bills.length, 1);

  const opened = await command(first, "drawer-open", "drawer-open", "openPaymentDrawer", {
    input: {
      tenantId,
      branchId,
      employeeId: userId,
      openingFloatMinor: 5_000,
      currency: "KES",
      deviceId: "pos-a",
      actor: userId,
    },
  });
  const bill = opened.state.bills[0]!;
  const paymentPayload = {
    invoiceId: bill.id,
    paymentMethodId: cashMethodId,
    amountMinor: Math.round(bill.total * 100),
    tenderedAmountMinor: Math.round(bill.total * 100),
    terminalId: "pos-a",
  };
  const paid = await command(
    first,
    "cash-leg-1",
    "cash-leg-1",
    "applyConfiguredPayment",
    paymentPayload,
  );
  const replayedPayment = await command(
    second,
    "cash-leg-1",
    "cash-leg-1",
    "applyConfiguredPayment",
    paymentPayload,
  );
  assert.equal(replayedPayment.duplicate, true);
  await assert.rejects(
    command(second, "cash-leg-1", "cash-leg-altered", "applyConfiguredPayment", {
      ...paymentPayload,
      amountMinor: paymentPayload.amountMinor - 1,
    }),
    (error: unknown) => isCommandError(error, 409, "DUPLICATE"),
  );
  assert.equal(paid.state.paymentOperations?.transactions.length, 1);
  assert.equal(paid.state.paymentOperations?.allocations.length, 1);
  assert.equal(paid.state.paymentOperations?.collections.length, 1);
  assert.equal(
    paid.state.paymentOperations?.cashMovements.filter((item) => item.type === "SALE").length,
    1,
  );

  const receipt = paid.state.receipts[0]!;
  const requested = await command(first, "refund-request", "refund-request", "requestRefund", {
    input: {
      tenantId,
      branchId,
      branch: branchId,
      orderId,
      invoiceId: bill.id,
      receiptId: receipt.id,
      amount: 1,
      method: "CASH",
      reason: "PostgreSQL concurrency verification",
      requestedBy: userId,
    },
  });
  const refundId = requested.state.refunds[0]!.id;
  const refundRevision = requested.revision;
  const refundApprovals = await Promise.allSettled([
    command(
      first,
      "refund-approve-a",
      "refund-approve-a",
      "approveRefund",
      { refundId },
      refundRevision,
    ),
    command(
      second,
      "refund-approve-b",
      "refund-approve-b",
      "approveRefund",
      { refundId },
      refundRevision,
    ),
  ]);
  assert.equal(refundApprovals.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(refundApprovals.filter((result) => result.status === "rejected").length, 1);

  state = await first.loadState(tenantId);
  const drawer = state.paymentOperations!.drawerSessions[0]!;
  const countedByCurrency = Object.fromEntries(
    Object.entries(drawer.currencyBalances).map(([currency, value]) => [
      currency,
      value.expectedCashMinor,
    ]),
  );
  const businessDate = bill.businessDate ?? bill.issuedAt.slice(0, 10);
  const prepared = await command(first, "day-prepare", "day-prepare", "prepareDayClose", {
    input: { tenantId, branchId, businessDate, actor: userId },
  });
  const dayCloseId = prepared.state.paymentOperations!.dayCloses[0]!.id;
  const closeRevision = prepared.revision;
  const closes = await Promise.allSettled([
    command(
      first,
      "day-close-a",
      "day-close-a",
      "closeDay",
      {
        input: {
          tenantId,
          dayCloseId,
          actor: userId,
          confirmed: true,
          drawerCounts: [{ drawerSessionId: drawer.id, countedByCurrency }],
        },
      },
      closeRevision,
    ),
    command(
      second,
      "day-close-b",
      "day-close-b",
      "closeDay",
      {
        input: {
          tenantId,
          dayCloseId,
          actor: userId,
          confirmed: true,
          drawerCounts: [{ drawerSessionId: drawer.id, countedByCurrency }],
        },
      },
      closeRevision,
    ),
  ]);
  assert.equal(closes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(closes.filter((result) => result.status === "rejected").length, 1);
  state = await first.loadState(tenantId);
  assert.equal(state.paymentOperations?.dayCloses[0]?.snapshots?.length, 1);
  assert.equal(state.paymentOperations?.drawerSessions[0]?.status, "CLOSED");
  assert.equal(
    state.paymentOperations?.dayCloses[0]?.snapshot?.dailyReport?.drawers[0]?.status,
    "CLOSED",
  );
  await assert.rejects(
    command(first, "closed-day-drawer", "closed-day-drawer", "openPaymentDrawer", {
      input: {
        tenantId,
        branchId,
        employeeId: userId,
        currency: "KES",
        openingFloatMinor: 0,
        actor: userId,
      },
    }),
    /closed/,
  );

  const commits = await count("mutation_commits");
  assert.equal(await count("realtime_events"), commits);
  assert.equal(await count("audit_events"), commits);
  await verifyPrintingReservations();
  console.log("POS PostgreSQL two-connection atomicity and idempotency: PASS");
} finally {
  await Promise.all([firstDb.close(), secondDb.close()]);
}

async function verifyPrintingReservations() {
  const printerId = randomUUID();
  const bridgeId = randomUUID();
  const master = randomUUID() + randomUUID();
  const printer = printerConfigurationSchema.parse({
    branchId,
    name: "Disposable print verifier",
    bridgeId,
    transport: "TCP",
    host: "10.0.0.2",
    roles: ["BILL"],
  });
  await firstDb
    .prepare(
      "INSERT INTO hardware_devices(tenant_id,id,branch_id,device_type,name,trust_status,registered_at,payload_json) VALUES (?,?,?,'PRINTER',?,'ACTIVE',?,?)",
    )
    .bind(
      tenantId,
      printerId,
      branchId,
      printer.name,
      new Date().toISOString(),
      JSON.stringify({ printing: printer }),
    )
    .run();
  const job = {
    v: 1,
    id: `PRINT-CI:${randomUUID()}`,
    tenantId,
    branchId,
    bridgeId,
    actorId: userId,
    target: { id: printerId, transport: "TCP", host: "10.0.0.2", port: 9100 },
    documentType: "BILL",
    content: "DISPOSABLE TEST ONLY",
    expiresAt: Date.now() + 90000,
  };
  const issued = await authorizeDelivery(firstDb, actor(), job);
  const key = await deriveBridgeSigningKey(master, tenantId, branchId, bridgeId);
  const authorization = await signPrintJob(issued, key);
  const consume = (db: PostgresD1Database, proof = authorization) =>
    handlePrintingApi(
      new Request("http://localhost/api/seramet/printing/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization: proof }),
      }),
      { SERAMET_DB: db, SERAMET_PRINT_SIGNING_KEY: master },
      new D1AuthoritativeTransactionRepository(db),
    );
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) => consume(index % 2 ? firstDb : secondDb)),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 11);
  for (const recoveryId of [randomUUID(), randomUUID()]) {
    const recovery = await authorizeDelivery(secondDb, actor(), { ...job, recoveryId });
    await consume(secondDb, await signPrintJob(recovery, key));
    await assert.rejects(
      () => consume(firstDb),
      (error) => (error as { status?: number }).status === 409,
    );
  }
  await assert.rejects(
    () => authorizeDelivery(firstDb, actor(), { ...job, recoveryId: randomUUID() }),
    (error) => (error as { status?: number }).status === 409,
  );
  console.log("Printing PostgreSQL two-connection reservation, replay and attempt limit: PASS");
}

function command(
  repository: D1AuthoritativeTransactionRepository,
  idempotencyKey: string,
  requestHash: string,
  action: string,
  payload: unknown,
  expectedRevision?: number,
) {
  return repository.commitMutation({
    actor: actor(),
    action,
    payload,
    idempotencyKey,
    requestHash,
    correlationId: `correlation-${idempotencyKey}`,
    deviceId: "pos-a",
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  });
}

function actor(): ServerActor {
  return {
    id: userId,
    name: "POS CI manager",
    tenantId,
    sessionId: "pos-ci-session",
    deviceId: "pos-a",
    roleIds: [`role-${tenantId}`],
    permissions: [
      "orders.create",
      "orders.update",
      "payments.collect",
      "payments.reconcile.approve",
      "inventory.adjust",
      "reconciliation.approve",
    ],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: branchId }],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    branch: branchId,
    role: "Manager",
  };
}

function orderDraft(customer: string) {
  return {
    tenantId,
    branchId,
    branch: branchId,
    businessDate: "2026-10-03",
    customer,
    channel: "DINE_IN" as const,
    cashier: userId,
    lines: [
      {
        id: "line-one",
        productId: "product-one",
        name: "Pilot meal",
        category: "Food",
        quantity: 1,
        unitPrice: 1000,
        productionStation: "MAIN KITCHEN",
      },
    ],
  };
}

async function seed(db: PostgresD1Database) {
  const stamp = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,?,?,?)",
    )
    .bind(
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      JSON.stringify({
        id: tenantId,
        slug: tenantId,
        legalName: tenantId,
        tradingName: tenantId,
        active: true,
        defaultCurrency: "KES",
        timezone: "Africa/Nairobi",
        locale: "en-KE",
        countryCode: "KE",
        createdAt: stamp,
        updatedAt: stamp,
      }),
      stamp,
      stamp,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,?)",
    )
    .bind(
      tenantId,
      branchId,
      branchId,
      branchId,
      JSON.stringify({
        id: branchId,
        tenantId,
        code: branchId,
        name: branchId,
        address: "",
        phone: "",
        email: "",
        timezone: "Africa/Nairobi",
        businessDayCutoffMinutes: 240,
        active: true,
        metadata: {},
      }),
    )
    .run();
  const permissionCodes = [
    "orders.view",
    "orders.create",
    "orders.update",
    "payments.collect",
    "payments.reconcile.approve",
    "settings.hardware.manage",
    "inventory.adjust",
  ];
  for (const code of permissionCodes) {
    await db
      .prepare("INSERT INTO permissions (code,description) VALUES (?,?) ON CONFLICT DO NOTHING")
      .bind(code, code)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
    )
    .bind(tenantId, `role-${tenantId}`, "MANAGER", "Manager")
    .run();
  for (const code of permissionCodes) {
    await db
      .prepare("INSERT INTO role_permissions VALUES (?,?,?)")
      .bind(tenantId, `role-${tenantId}`, code)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,1,1,'{}',?,?)",
    )
    .bind(tenantId, userId, `${userId}@test.local`, "POS CI manager", stamp, stamp)
    .run();
  await db
    .prepare("INSERT INTO user_roles VALUES (?,?,?)")
    .bind(tenantId, userId, `role-${tenantId}`)
    .run();
  await db
    .prepare("INSERT INTO user_branches VALUES (?,?,?)")
    .bind(tenantId, userId, branchId)
    .run();
  for (const account of [
    { id: "cash-on-hand", code: "1100", name: "Cash on hand" },
    { id: "accounts-receivable", code: "1200", name: "Customer receivables" },
  ]) {
    await db
      .prepare(
        "INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json) VALUES (?,?,?,?,?,'ASSET','KES',1,?)",
      )
      .bind(
        tenantId,
        account.id,
        branchId,
        account.code,
        account.name,
        JSON.stringify({ ...account, tenantId, branchId, type: "ASSET", currency: "KES" }),
      )
      .run();
  }
  await db
    .prepare(
      "INSERT INTO payment_methods (tenant_id,id,code,category,settlement_account_id,receivable_account_id,cash_account_id,active,payload_json) VALUES (?,?,?,'CASH','cash-on-hand','accounts-receivable','cash-on-hand',1,?)",
    )
    .bind(
      tenantId,
      cashMethodId,
      "CASH",
      JSON.stringify({
        id: cashMethodId,
        tenantId,
        code: "CASH",
        displayName: "Cash",
        category: "CASH",
        enabled: true,
        sortOrder: 1,
        requiresReference: false,
        requiresCustomer: false,
        supportsRefund: true,
        supportsSplit: true,
        settlementAccountId: "cash-on-hand",
        receivableAccountId: "accounts-receivable",
        cashAccountId: "cash-on-hand",
        metadata: {},
      }),
    )
    .run();
}

async function count(table: string) {
  const row = await firstDb
    .prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?`)
    .bind(tenantId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function isCommandError(error: unknown, status: number, code: string) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === status && candidate.code === code;
}

async function assertCounts(expected: Record<string, number>) {
  for (const [table, value] of Object.entries(expected))
    assert.equal(await count(table), value, table);
}
