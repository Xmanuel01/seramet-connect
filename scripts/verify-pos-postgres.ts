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
  assert.deepEqual(bill.financialComponents, {
    version: 1,
    currency: "KES",
    grossSalesMinor: 100_000,
    discountsMinor: 10_000,
    netSalesMinor: 90_000,
    serviceChargeMinor: 5_000,
    taxMinor: 14_400,
    totalMinor: 109_400,
  });
  const persistedInvoice = await firstDb
    .prepare("SELECT payload_json FROM invoices WHERE tenant_id=? AND id=?")
    .bind(tenantId, bill.id)
    .first<{ payload_json: string }>();
  assert.deepEqual(
    JSON.parse(persistedInvoice!.payload_json).financialComponents,
    bill.financialComponents,
  );
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

  state = await first.loadState(tenantId);
  const drawer = state.paymentOperations!.drawerSessions[0]!;
  const countedByCurrency = Object.fromEntries(
    Object.entries(drawer.currencyBalances).map(([currency, value]) => [
      currency,
      value.expectedCashMinor,
    ]),
  );
  const businessDate = bill.businessDate ?? bill.issuedAt.slice(0, 10);
  await command(first, "closing-policy", "closing-policy", "configureDailyClosing", {
    branchId,
    mode: "SUPERVISOR_DAILY_CLOSE",
    materialVarianceMinor: 50000,
    recipientUserIds: [userId],
  });
  const prepared = await command(first, "day-prepare", "day-prepare", "prepareDayClose", {
    input: { tenantId, branchId, businessDate, actor: userId },
  });
  const dayCloseId = prepared.state.paymentOperations!.dayCloses[0]!.id;
  const closeRevision = prepared.revision;
  // Disposable-only database fault after closure statements begin. The repository
  // must roll back the drawer, close snapshot, outbox and mutation evidence together.
  const faultName = `closing_fault_${randomUUID().replaceAll("-", "")}`;
  const beforeFailure = JSON.stringify(await first.loadState(tenantId));
  const countsBeforeFailure = Object.fromEntries(
    await Promise.all(
      ["mutation_commits", "realtime_events", "audit_events", "worker_jobs"].map(async (table) => [
        table,
        await count(table),
      ]),
    ),
  );
  await firstDb.exec(`CREATE FUNCTION ${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.tenant_id='${tenantId}' AND NEW.status='CLOSED' THEN RAISE EXCEPTION 'disposable closing fault'; END IF; RETURN NEW; END $$`);
  try {
    await firstDb.exec(
      `CREATE TRIGGER ${faultName} BEFORE INSERT OR UPDATE ON day_closes FOR EACH ROW EXECUTE FUNCTION ${faultName}()`,
    );
    await assert.rejects(
      command(
        first,
        "forced-close-failure",
        "forced-close-failure",
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
    );
    assert.equal(JSON.stringify(await second.loadState(tenantId)), beforeFailure);
    await assertCounts(countsBeforeFailure);
  } finally {
    await firstDb.exec(`DROP TRIGGER IF EXISTS ${faultName} ON day_closes`);
    await firstDb.exec(`DROP FUNCTION ${faultName}()`);
  }
  console.log("PostgreSQL failed daily-close rollback and fresh-connection recovery: PASS");
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
  assert.deepEqual(state.bills[0]!.financialComponents, bill.financialComponents);
  assert.equal(
    state.paymentOperations!.dayCloses[0]!.snapshot!.invoicedMinor,
    bill.financialComponents!.totalMinor,
  );
  assert.equal(
    state.paymentOperations!.dayCloses[0]!.snapshot!.taxMinor,
    bill.financialComponents!.taxMinor,
  );
  assert.equal(state.paymentOperations?.drawerSessions[0]?.status, "CLOSED");
  assert.equal(
    state.paymentOperations?.dayCloses[0]?.snapshot?.dailyReport?.drawers[0]?.status,
    "CLOSED",
  );
  assert.equal(
    await firstDb
      .prepare(
        "SELECT COUNT(*) AS count FROM worker_jobs WHERE tenant_id=? AND job_type='DAILY_CLOSING_EMAIL'",
      )
      .bind(tenantId)
      .first("count"),
    1,
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

  const immutableClose = JSON.stringify(state.paymentOperations!.dayCloses[0]!.snapshot);
  await command(first, "refund-reopen", "refund-reopen", "reopenDay", {
    dayCloseId,
    reason: "Disposable post-close refund concurrency verification",
  });
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

  await assert.rejects(
    command(first, "pending-refund-close", "pending-refund-close", "closeBusinessDay", {
      businessDate,
      drawerCounts: [],
      confirmed: true,
    }),
    /Refund/,
  );
  assert.equal(
    JSON.stringify((await first.loadState(tenantId)).paymentOperations!.dayCloses[0]!.snapshot),
    immutableClose,
  );

  const commits = await count("mutation_commits");
  assert.equal(await count("realtime_events"), commits);
  assert.equal(await count("audit_events"), commits);
  await verifyPrintingReservations();
  await verifyTransactionClosingRace();
  console.log("POS PostgreSQL two-connection atomicity and idempotency: PASS");
} finally {
  await Promise.all([firstDb.close(), secondDb.close()]);
}

async function verifyTransactionClosingRace() {
  const isolatedBranch = `closing-race-${randomUUID()}`;
  await firstDb
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')",
    )
    .bind(tenantId, isolatedBranch, isolatedBranch, isolatedBranch)
    .run();
  await firstDb
    .prepare("INSERT INTO user_branches VALUES (?,?,?)")
    .bind(tenantId, userId, isolatedBranch)
    .run();
  await hydrateAuthoritativeConfiguration(firstDb, {}, true);
  const scopedActor = {
    ...actor(),
    branchId: isolatedBranch,
    branch: isolatedBranch,
    branchScope: { type: "BRANCH" as const, branchId: isolatedBranch },
    assignedBranchIds: [isolatedBranch],
    assignedBranches: [{ id: isolatedBranch, name: isolatedBranch }],
  };
  const mutate = (
    repository: D1AuthoritativeTransactionRepository,
    action: string,
    payload: unknown,
    revision?: number,
  ) =>
    repository.commitMutation({
      actor: scopedActor,
      action,
      payload,
      idempotencyKey: randomUUID(),
      requestHash: JSON.stringify(payload),
      correlationId: randomUUID(),
      expectedRevision: revision,
    });
  const opened = await mutate(
    new D1AuthoritativeTransactionRepository(firstDb),
    "openPaymentDrawer",
    {
      input: {
        tenantId,
        branchId: isolatedBranch,
        employeeId: userId,
        currency: "KES",
        openingFloatMinor: 10000,
        actor: userId,
      },
    },
  );
  const drawer = opened.state.paymentOperations!.drawerSessions.find(
    (d) => d.branchId === isolatedBranch,
  )!;
  const commitsBefore = await count("mutation_commits");
  const results = await Promise.allSettled([
    mutate(
      new D1AuthoritativeTransactionRepository(firstDb),
      "closeBusinessDay",
      {
        businessDate: drawer.businessDate,
        confirmed: true,
        drawerCounts: [{ drawerSessionId: drawer.id, countedByCurrency: { KES: 10000 } }],
      },
      opened.revision,
    ),
    mutate(
      new D1AuthoritativeTransactionRepository(secondDb),
      "upsertOrderDraft",
      {
        draft: { ...orderDraft("Closing race"), branchId: isolatedBranch, branch: isolatedBranch },
        targetStatus: "OPEN",
      },
      opened.revision,
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await count("mutation_commits"), commitsBefore + 1);
  const stored = await new D1AuthoritativeTransactionRepository(firstDb).loadState(tenantId);
  const closed = stored.paymentOperations!.dayCloses.find(
    (d) => d.branchId === isolatedBranch && d.status === "CLOSED",
  );
  const orders = stored.orders.filter((o) => o.branchId === isolatedBranch);
  if (closed) {
    assert.equal(orders.length, 0);
    assert.equal(closed.snapshot?.orderCount, 0);
    assert.equal(
      stored.paymentOperations!.drawerSessions.find((d) => d.id === drawer.id)!.status,
      "CLOSED",
    );
  } else {
    assert.equal(orders.length, 1);
    assert.equal(
      stored.paymentOperations!.drawerSessions.find((d) => d.id === drawer.id)!.status,
      "OPEN",
    );
  }
  console.log("PostgreSQL transaction versus daily-close race: PASS");
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
      "dayclose.reopen",
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
    financialOverride: {
      subtotal: 950,
      tax: 144,
      total: 1094,
      financialComponents: {
        version: 1 as const,
        currency: "KES",
        grossSalesMinor: 100_000,
        discountsMinor: 10_000,
        netSalesMinor: 90_000,
        serviceChargeMinor: 5_000,
        taxMinor: 14_400,
        totalMinor: 109_400,
      },
    },
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
    "reconciliation.view",
    "reconciliation.approve",
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
