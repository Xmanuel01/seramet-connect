import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateSerametRequest, type SerametEnv, type ServerActor } from "@/lib/seramet-auth";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import {
  createMigratedTestDatabase,
  SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { handleOfflineSyncApi } from "@/server/offline-sync-api";
import { DocumentNumberingService } from "@/server/database/document-numbering";
import { handleWorkerQueue, type SerametWorkerMessage } from "@/server/workers";
import { SnapshotMigrationService } from "@/server/migrations/snapshot-import";
import { validateImportFile } from "@/server/file-import-security";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { handleOperationsApi } from "@/server/operations-api";

const tenantA = "tenant-a";
const tenantB = "tenant-b";
const branchA = "branch-a";
const userA = "user-a";
const deviceA = "device-a";
const sessionA = "session-a";
const jwtSecret = "pass-five-test-signing-secret-that-is-at-least-32-bytes";
const issuer = "https://identity.test.seramet.local";
const audience = "seramet-test";

let database: SqliteD1TestDatabase;

describe.sequential("Pass 5 production foundation", () => {
  beforeEach(async () => {
    database = createMigratedTestDatabase();
    await seedTenant(database, tenantA, branchA, userA);
    await seedTenant(database, tenantB, "branch-b", "user-b");
    await hydrateAuthoritativeConfiguration(database, testEnv(), true);
  });

  afterEach(() => {
    database?.close();
    setConfigurationRepositoryForTests();
  });

  it("applies all versioned migrations and exposes the current schema version", async () => {
    const version = await database
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .first<{ version: number }>();
    expect(version?.version).toBe(17);
    await expect(
      new D1AuthoritativeTransactionRepository(database).migrate(),
    ).resolves.toBeUndefined();
  });

  it("enforces tenant scope and cross-tenant foreign keys in the database", async () => {
    const repository = new D1AuthoritativeTransactionRepository(database);
    await expect(repository.loadState("tenant-missing")).rejects.toThrow(/Tenant is not active/);
    await expect(
      database
        .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
        .bind(tenantA, userA, "branch-b")
        .run(),
    ).rejects.toThrow();
  });

  it("paginates authoritative history with server tenant and branch scope", async () => {
    for (let index = 0; index < 3; index += 1) {
      const updatedAt = new Date(
        Date.parse("2026-08-30T10:00:00.000Z") + index * 1000,
      ).toISOString();
      await database
        .prepare(
          `INSERT INTO authoritative_records
          (tenant_id,entity_type,entity_id,branch_id,status,payload_json,version,created_at,updated_at)
         VALUES (?,'state:orders',?,?,'OPEN',?,1,?,?)`,
        )
        .bind(
          tenantA,
          `paged-order-${index}`,
          branchA,
          JSON.stringify({ id: `paged-order-${index}` }),
          updatedAt,
          updatedAt,
        )
        .run();
    }
    const token = await signToken({ tid: tenantA, sub: userA, sid: sessionA, deviceId: deviceA });
    const first = await handleOperationsApi(
      new Request(`https://seramet.test/api/seramet/query/orders?branchId=${branchA}&limit=2`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      testEnv(),
    );
    const firstBody = (await first!.json()) as { items: unknown[]; nextCursor: string | null };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();
    const second = await handleOperationsApi(
      new Request(
        `https://seramet.test/api/seramet/query/orders?branchId=${branchA}&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
      testEnv(),
    );
    const secondBody = (await second!.json()) as { items: unknown[]; nextCursor: string | null };
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("deduplicates the same mutation and preserves one order effect", async () => {
    const repository = new D1AuthoritativeTransactionRepository(database);
    const commit = mutation(repository, "same-key", "same-hash", "upsertOrderDraft", {
      draft: orderDraft(),
      targetStatus: "OPEN",
    });
    const first = await commit;
    const duplicate = await mutation(repository, "same-key", "same-hash", "upsertOrderDraft", {
      draft: orderDraft(),
      targetStatus: "OPEN",
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state.orders).toHaveLength(1);
    expect(await count("mutation_commits", tenantA)).toBe(1);
  });

  it("allows only one concurrent mutation from the same base revision", async () => {
    const repository = new D1AuthoritativeTransactionRepository(database);
    const results = await Promise.allSettled([
      mutation(repository, "race-a", "hash-a", "upsertOrderDraft", {
        draft: orderDraft("A"),
        targetStatus: "OPEN",
      }),
      mutation(repository, "race-b", "hash-b", "upsertOrderDraft", {
        draft: orderDraft("B"),
        targetStatus: "OPEN",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.loadState(tenantA)).orders).toHaveLength(1);
  });

  it("protects concurrent refunds and two-terminal invoice allocation", async () => {
    await insertProviderPayment("refund-source", "refund-source-ref");
    const refunds = await Promise.allSettled([
      insertRefund("refund-a", 700, "refund-correlation-a"),
      insertRefund("refund-b", 700, "refund-correlation-b"),
    ]);
    expect(refunds.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(refunds.filter((result) => result.status === "rejected")).toHaveLength(1);

    const stamp = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO invoices
        (tenant_id,id,branch_id,invoice_number,status,business_date,currency,total_minor,
         paid_minor,payload_json,created_at,updated_at)
       VALUES (?,?,?,'INV-RACE','OPEN','2026-08-30','KES',1000,0,'{}',?,?)`,
      )
      .bind(tenantA, "invoice-race", branchA, stamp, stamp)
      .run();
    await insertProviderPayment("terminal-a", "terminal-ref-a");
    await insertProviderPayment("terminal-b", "terminal-ref-b");
    const allocations = await Promise.allSettled([
      insertAllocation("allocation-a", "terminal-a", "invoice-race"),
      insertAllocation("allocation-b", "terminal-b", "invoice-race"),
    ]);
    expect(allocations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(allocations.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await count("payment_allocations", tenantA)).toBe(1);
  });

  it("allows only one concurrent settlement posting and cash close", async () => {
    const stamp = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO settlement_batches
        (tenant_id,id,branch_id,connection_id,external_settlement_id,period_start,period_end,
         gross_minor,net_expected_minor,net_settled_minor,currency,status,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,?,'2026-08-29','2026-08-30',1000,750,750,'KES','MATCHED','{}',?,?)`,
      )
      .bind(
        tenantA,
        "settlement-race",
        branchA,
        `provider-${tenantA}`,
        "external-settlement-race",
        stamp,
        stamp,
      )
      .run();
    const postings = await Promise.all([
      postSettlement("settlement-race"),
      postSettlement("settlement-race"),
    ]);
    expect(postings.map((result) => result.meta?.changes ?? 0).sort()).toEqual([0, 1]);

    await database
      .prepare(
        `INSERT INTO cash_drawer_sessions
        (tenant_id,id,branch_id,employee_id,status,opening_float_minor,expected_cash_minor,
         version,payload_json,opened_at)
       VALUES (?,?,?,?,'OPEN',500,500,1,'{}',?)`,
      )
      .bind(tenantA, "drawer-race", branchA, userA, stamp)
      .run();
    const closes = await Promise.all([closeDrawer("drawer-race"), closeDrawer("drawer-race")]);
    expect(closes.map((result) => result.meta?.changes ?? 0).sort()).toEqual([0, 1]);
  });

  it("deduplicates concurrent inventory movements and goods receipts", async () => {
    const stamp = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
       VALUES (?,?,?,'MAIN','Main store',1,'{}')`,
      )
      .bind(tenantA, "warehouse-a", branchA)
      .run();
    await database
      .prepare(
        `INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json)
       VALUES (?,?,'ITEM-A','Item A','EA',1,'{}')`,
      )
      .bind(tenantA, "item-a")
      .run();
    const movements = await Promise.allSettled([
      insertInventoryMovement("movement-a", "stock-command-a", stamp),
      insertInventoryMovement("movement-b", "stock-command-a", stamp),
    ]);
    expect(movements.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    await database
      .prepare(
        `INSERT INTO purchase_orders
        (tenant_id,id,branch_id,purchase_order_number,status,currency,total_minor,payload_json,created_at,updated_at)
       VALUES (?,?,?,'PO-RACE','APPROVED','KES',1000,'{}',?,?)`,
      )
      .bind(tenantA, "po-race", branchA, stamp, stamp)
      .run();
    const receipts = await Promise.allSettled([
      insertGoodsReceipt("goods-a", "goods-command-a", stamp),
      insertGoodsReceipt("goods-b", "goods-command-a", stamp),
    ]);
    expect(receipts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await count("goods_receipts", tenantA)).toBe(1);
  });

  it("rejects duplicate provider transaction references across branches", async () => {
    await insertProviderPayment("payment-1", "provider-reference-1");
    await expect(insertProviderPayment("payment-2", "provider-reference-1")).rejects.toThrow();
    expect(await count("payment_transactions", tenantA)).toBe(1);
  });

  it("validates tenant-bound bearer sessions and rejects revoked devices", async () => {
    const token = await signToken({ tid: tenantA, sub: userA, sid: sessionA, deviceId: deviceA });
    const request = new Request("https://seramet.test/api", {
      headers: { authorization: `Bearer ${token}`, "x-seramet-branch-id": branchA },
    });
    const actor = await authenticateSerametRequest(request, testEnv());
    expect(actor.tenantId).toBe(tenantA);
    expect(actor.deviceId).toBe(deviceA);
    await database
      .prepare(
        "UPDATE hardware_devices SET trust_status='REVOKED', revoked_at=? WHERE tenant_id=? AND id=?",
      )
      .bind(new Date().toISOString(), tenantA, deviceA)
      .run();
    await expect(authenticateSerametRequest(request, testEnv())).rejects.toThrow(
      /Device is not active/,
    );
  });

  it("rejects development headers in production", async () => {
    const request = new Request("https://seramet.test/api", {
      headers: { "x-seramet-dev-auth": "enabled" },
    });
    await expect(authenticateSerametRequest(request, testEnv())).rejects.toThrow(
      /Bearer authentication required/,
    );
  });

  it("invalidates every session after a credential version change", async () => {
    const token = await signToken({ tid: tenantA, sub: userA, sid: sessionA, deviceId: deviceA });
    await database
      .prepare("UPDATE users SET password_version=2 WHERE tenant_id=? AND id=?")
      .bind(tenantA, userA)
      .run();
    await expect(
      authenticateSerametRequest(
        new Request("https://seramet.test/api", {
          headers: { authorization: `Bearer ${token}` },
        }),
        testEnv(),
      ),
    ).rejects.toThrow(/credential change/);
  });

  it("syncs the same offline cash-order command exactly once", async () => {
    const repository = new D1AuthoritativeTransactionRepository(database);
    const token = await signToken({ tid: tenantA, sub: userA, sid: sessionA, deviceId: deviceA });
    const command = {
      id: "offline-command-a",
      tenantId: tenantA,
      branchId: branchA,
      deviceId: deviceA,
      actorId: userA,
      commandType: "upsertOrderDraft" as const,
      payload: { draft: orderDraft("Offline"), targetStatus: "OPEN" },
      createdAt: new Date().toISOString(),
      clientSequence: 1,
      idempotencyKey: "offline-order-a",
      syncStatus: "PENDING" as const,
      correlationId: "offline-correlation-a",
      localEffects: { kotPrinted: true },
    };
    const response = await handleOfflineSyncApi(
      new Request("https://seramet.test/api/seramet/offline/sync", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ commands: [command, command] }),
      }),
      testEnv(),
      repository,
    );
    const body = (await response!.json()) as {
      commands: Array<{ status: string; printPolicy?: string }>;
    };
    expect(body.commands.map((item) => item.status)).toEqual(["accepted", "duplicate"]);
    expect(body.commands[0]?.printPolicy).toBe("ALREADY_PRINTED_LOCAL");
    expect((await repository.loadState(tenantA)).orders).toHaveLength(1);
  });

  it("blocks digital payment commands from the offline synchronization path", async () => {
    const repository = new D1AuthoritativeTransactionRepository(database);
    const token = await signToken({ tid: tenantA, sub: userA, sid: sessionA, deviceId: deviceA });
    const command = {
      id: "offline-digital",
      tenantId: tenantA,
      branchId: branchA,
      deviceId: deviceA,
      actorId: userA,
      commandType: "applyConfiguredPayment",
      payload: { invoiceId: "invoice-a", paymentMethodId: "wallet-a", amountMinor: 1000 },
      createdAt: new Date().toISOString(),
      clientSequence: 2,
      idempotencyKey: "offline-digital-a",
      syncStatus: "PENDING",
      correlationId: "offline-digital-correlation",
    };
    await expect(
      handleOfflineSyncApi(
        new Request("https://seramet.test/api/seramet/offline/sync", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ commands: [command] }),
        }),
        testEnv(),
        repository,
      ),
    ).rejects.toThrow(/Only configured cash collection/);
  });

  it("allocates document numbers without collisions", async () => {
    const service = new DocumentNumberingService(database);
    const values = await Promise.all(
      Array.from({ length: 25 }, () =>
        service.next({
          tenantId: tenantA,
          branchId: branchA,
          documentType: "RECEIPT",
          businessDate: "2026-08-30",
          prefix: "RCP",
          padding: 6,
        }),
      ),
    );
    expect(new Set(values.map((value) => value.number)).size).toBe(25);
  });

  it("keeps authoritative audit and confirmed payment records immutable", async () => {
    await insertProviderPayment("immutable-payment", "immutable-ref");
    await expect(
      database
        .prepare("UPDATE payment_transactions SET amount_minor=1 WHERE tenant_id=? AND id=?")
        .bind(tenantA, "immutable-payment")
        .run(),
    ).rejects.toThrow(/CONFIRMED_PAYMENT_IMMUTABLE/);
    await database
      .prepare(
        `INSERT INTO audit_events (tenant_id,id,actor_id,action,entity_type,entity_id,correlation_id,metadata_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        tenantA,
        "audit-a",
        userA,
        "TEST",
        "TEST",
        "record-a",
        "audit-correlation",
        "{}",
        new Date().toISOString(),
      )
      .run();
    await expect(
      database
        .prepare("DELETE FROM audit_events WHERE tenant_id=? AND id=?")
        .bind(tenantA, "audit-a")
        .run(),
    ).rejects.toThrow(/AUDIT_IMMUTABLE/);
  });

  it("persists worker failure and dead-letters at the configured attempt limit", async () => {
    const stamp = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO worker_jobs (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,
       status,attempt_count,max_attempts,scheduled_at,created_at,updated_at)
       VALUES (?,?,?,'{}',?,?,'PENDING',0,1,?,?,?)`,
      )
      .bind(
        tenantA,
        "worker-failure",
        "UNKNOWN_JOB",
        "worker-failure-key",
        "worker-correlation",
        stamp,
        stamp,
        stamp,
      )
      .run();
    let acknowledged = false;
    let retried = false;
    const body: SerametWorkerMessage = {
      kind: "worker-job",
      tenantId: tenantA,
      jobId: "worker-failure",
      correlationId: "worker-correlation",
    };
    await handleWorkerQueue(
      {
        queue: "test",
        messages: [
          {
            id: "message-a",
            timestamp: new Date(),
            body,
            attempts: 1,
            ack: () => {
              acknowledged = true;
            },
            retry: () => {
              retried = true;
            },
          },
        ],
      },
      testEnv(),
    );
    const row = await database
      .prepare("SELECT status,last_error FROM worker_jobs WHERE tenant_id=? AND id=?")
      .bind(tenantA, "worker-failure")
      .first<{ status: string; last_error: string }>();
    expect(row?.status).toBe("DEAD_LETTER");
    expect(row?.last_error).toMatch(/No live worker implementation/);
    expect(acknowledged).toBe(true);
    expect(retried).toBe(false);
  });

  it("previews and idempotently imports a mapped legacy snapshot with reconciled totals", async () => {
    const repository = new D1AuthoritativeTransactionRepository(database);
    const created = await mutation(
      repository,
      "migration-source",
      "migration-source-hash",
      "upsertOrderDraft",
      {
        draft: orderDraft("Migrated"),
        targetStatus: "OPEN",
      },
    );
    const source = structuredClone(created.state);
    source.tenantId = "legacy-tenant";
    source.orders.forEach((order) => {
      order.tenantId = "legacy-tenant";
      order.branchId = "legacy-branch";
      order.branch = "Legacy Branch";
    });
    const service = new SnapshotMigrationService(database, repository);
    const preview = await service.preview({
      source,
      actor: actor(),
      branchMap: { "legacy-branch": branchA },
    });
    expect(preview.report.invalidReferences).toEqual([]);
    expect(preview.report.recordsRead["orders"]).toBe(1);
    expect(preview.report.financialTotalsAfter).toEqual(preview.report.financialTotalsBefore);
    const applied = await service.apply({
      source,
      actor: actor(),
      branchMap: { "legacy-branch": branchA },
    });
    const duplicate = await service.apply({
      source,
      actor: actor(),
      branchMap: { "legacy-branch": branchA },
    });
    expect(applied.status).toBe("SUCCEEDED");
    expect(duplicate.sourceChecksum).toBe(applied.sourceChecksum);
    expect(await count("data_migration_runs", tenantA)).toBe(1);
    expect((await repository.loadState(tenantA)).orders[0]?.branchId).toBe(branchA);
  });

  it("enforces shared database rate limits and secure file boundaries", async () => {
    const limiter = new DatabaseRateLimiter(database);
    await limiter.consume("tenant-a:user-a", {
      bucket: "test-sensitive",
      limit: 2,
      windowSeconds: 60,
    });
    await limiter.consume("tenant-a:user-a", {
      bucket: "test-sensitive",
      limit: 2,
      windowSeconds: 60,
    });
    await expect(
      limiter.consume("tenant-a:user-a", {
        bucket: "test-sensitive",
        limit: 2,
        windowSeconds: 60,
      }),
    ).rejects.toThrow(/Rate limit exceeded/);
    await expect(
      validateImportFile({
        kind: "SETTLEMENT",
        filename: "../statement.csv",
        contentType: "text/csv",
        bytes: new TextEncoder().encode("a,b"),
      }),
    ).rejects.toThrow(/filename is unsafe/);
    await expect(
      validateImportFile({
        kind: "BANK",
        filename: "statement.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: new TextEncoder().encode("not-a-workbook"),
      }),
    ).rejects.toThrow(/signature is invalid/);
  });
});

function testEnv(): SerametEnv {
  return {
    SERAMET_DB: database,
    SERAMET_ENVIRONMENT: "production",
    SERAMET_JWT_SECRET: jwtSecret,
    SERAMET_JWT_ISSUER: issuer,
    SERAMET_JWT_AUDIENCE: audience,
  };
}

async function seedTenant(
  db: SqliteD1TestDatabase,
  tenantId: string,
  branchId: string,
  userId: string,
) {
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
    )
    .bind(
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      "KES",
      "Africa/Nairobi",
      "en-KE",
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
      `INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
     VALUES (?,?,?,?,?,240,1,?)`,
    )
    .bind(
      tenantId,
      branchId,
      branchId,
      branchId,
      "Africa/Nairobi",
      JSON.stringify({
        id: branchId,
        tenantId,
        code: branchId,
        name: branchId,
        address: "",
        phone: "",
        email: "",
        active: true,
        metadata: {},
      }),
    )
    .run();
  for (const code of [
    "orders.view",
    "orders.create",
    "orders.update",
    "payments.collect",
    "settings.hardware.manage",
    "inventory.adjust",
  ]) {
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
  for (const code of [
    "orders.view",
    "orders.create",
    "orders.update",
    "payments.collect",
    "settings.hardware.manage",
    "inventory.adjust",
  ]) {
    await db
      .prepare("INSERT INTO role_permissions VALUES (?,?,?)")
      .bind(tenantId, `role-${tenantId}`, code)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,1,1,'{}',?,?)",
    )
    .bind(tenantId, userId, `${userId}@test.local`, userId, stamp, stamp)
    .run();
  await db
    .prepare("INSERT INTO user_roles VALUES (?,?,?)")
    .bind(tenantId, userId, `role-${tenantId}`)
    .run();
  await db
    .prepare("INSERT INTO user_branches VALUES (?,?,?)")
    .bind(tenantId, userId, branchId)
    .run();
  await db
    .prepare(
      `INSERT INTO hardware_devices (tenant_id,id,branch_id,device_type,name,trust_status,registered_at,payload_json)
     VALUES (?,?,?,'POS_TERMINAL',?,'ACTIVE',?,'{}')`,
    )
    .bind(tenantId, tenantId === tenantA ? deviceA : `device-${tenantId}`, branchId, "POS", stamp)
    .run();
  await db
    .prepare(
      `INSERT INTO auth_sessions (tenant_id,id,user_id,device_id,issued_at,expires_at,last_seen_at,token_version,metadata_json)
     VALUES (?,?,?,?,?,?,?,?, '{}')`,
    )
    .bind(
      tenantId,
      tenantId === tenantA ? sessionA : `session-${tenantId}`,
      userId,
      tenantId === tenantA ? deviceA : `device-${tenantId}`,
      stamp,
      new Date(Date.now() + 3_600_000).toISOString(),
      stamp,
      1,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO provider_connections (tenant_id,id,branch_id,provider_id,environment,status,payload_json,created_at,updated_at)
     VALUES (?,?,?,'test-provider','SANDBOX','DISABLED','{}',?,?)`,
    )
    .bind(tenantId, `provider-${tenantId}`, branchId, stamp, stamp)
    .run();
  await db
    .prepare(
      `INSERT INTO payment_methods (tenant_id,id,code,category,provider_connection_id,active,payload_json)
     VALUES (?,?,?,?,?,1,?)`,
    )
    .bind(
      tenantId,
      `wallet-${tenantId}`,
      "WALLET",
      "DIGITAL_WALLET",
      `provider-${tenantId}`,
      JSON.stringify({
        id: `wallet-${tenantId}`,
        tenantId,
        code: "WALLET",
        displayName: "Configured wallet",
        category: "DIGITAL_WALLET",
        enabled: true,
        sortOrder: 1,
        requiresReference: true,
        requiresCustomer: false,
        supportsRefund: true,
        supportsSplit: true,
        providerConnectionId: `provider-${tenantId}`,
        metadata: {},
      }),
    )
    .run();
}

function actor(): ServerActor {
  return {
    id: userA,
    name: userA,
    tenantId: tenantA,
    sessionId: sessionA,
    deviceId: deviceA,
    roleIds: [`role-${tenantA}`],
    permissions: ["orders.create", "orders.update", "payments.collect", "inventory.adjust"],
    assignedBranchIds: [branchA],
    assignedBranches: [{ id: branchA, name: branchA }],
    branchScope: { type: "BRANCH", branchId: branchA },
    branchId: branchA,
    role: "Manager",
    branch: branchA,
  };
}

function mutation(
  repository: D1AuthoritativeTransactionRepository,
  idempotencyKey: string,
  requestHash: string,
  action: string,
  payload: unknown,
) {
  return repository.commitMutation({
    actor: actor(),
    action,
    payload,
    idempotencyKey,
    requestHash,
    correlationId: `correlation-${idempotencyKey}`,
    deviceId: deviceA,
  });
}

function orderDraft(label = "Order") {
  return {
    tenantId: tenantA,
    branchId: branchA,
    branch: branchA,
    customer: label,
    channel: "DINE_IN" as const,
    cashier: userA,
    lines: [
      {
        id: `line-${label}`,
        productId: "product-a",
        name: "Dish",
        category: "Food",
        quantity: 1,
        unitPrice: 1000,
        productionStation: "MAIN KITCHEN",
      },
    ],
  };
}

async function insertProviderPayment(id: string, reference: string) {
  const stamp = new Date().toISOString();
  return database
    .prepare(
      `INSERT INTO payment_transactions (tenant_id,id,branch_id,payment_method_id,provider_connection_id,direction,
     amount_minor,unallocated_amount_minor,currency,status,provider_transaction_id,merchant_reference,
     correlation_id,payload_json,occurred_at,confirmed_at,created_at)
     VALUES (?,?,?,?,?,'COLLECTION',1000,1000,'KES','CONFIRMED',?,?,?,'{}',?,?,?)`,
    )
    .bind(
      tenantA,
      id,
      branchA,
      `wallet-${tenantA}`,
      `provider-${tenantA}`,
      reference,
      `merchant-${id}`,
      `correlation-${id}`,
      stamp,
      stamp,
      stamp,
    )
    .run();
}

async function insertRefund(id: string, amountMinor: number, correlationId: string) {
  const stamp = new Date().toISOString();
  return database
    .prepare(
      `INSERT INTO payment_refunds
      (tenant_id,id,branch_id,original_transaction_id,provider_connection_id,amount_minor,
       currency,status,correlation_id,payload_json,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'KES','REQUESTED',?,'{}',?,?)`,
    )
    .bind(
      tenantA,
      id,
      branchA,
      "refund-source",
      `provider-${tenantA}`,
      amountMinor,
      correlationId,
      stamp,
      stamp,
    )
    .run();
}

async function insertAllocation(id: string, transactionId: string, invoiceId: string) {
  return database
    .prepare(
      `INSERT INTO payment_allocations
      (tenant_id,id,branch_id,payment_transaction_id,invoice_id,amount_minor,currency,payload_json,created_at)
     VALUES (?,?,?,?,?,1000,'KES','{}',?)`,
    )
    .bind(tenantA, id, branchA, transactionId, invoiceId, new Date().toISOString())
    .run();
}

async function postSettlement(id: string) {
  return database
    .prepare(
      `UPDATE settlement_batches SET status='POSTED',version=version+1,updated_at=?
     WHERE tenant_id=? AND id=? AND status='MATCHED'`,
    )
    .bind(new Date().toISOString(), tenantA, id)
    .run();
}

async function closeDrawer(id: string) {
  const stamp = new Date().toISOString();
  return database
    .prepare(
      `UPDATE cash_drawer_sessions
     SET status='CLOSED',counted_cash_minor=500,variance_minor=0,closed_at=?,version=version+1
     WHERE tenant_id=? AND id=? AND status='OPEN'`,
    )
    .bind(stamp, tenantA, id)
    .run();
}

async function insertInventoryMovement(id: string, idempotencyKey: string, stamp: string) {
  return database
    .prepare(
      `INSERT INTO inventory_movements
      (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,source_type,
       source_id,idempotency_key,correlation_id,payload_json,created_at)
     VALUES (?,?,?,?,?,'RECEIPT',100,'GOODS_RECEIPT',?,?,?,'{}',?)`,
    )
    .bind(
      tenantA,
      id,
      branchA,
      "warehouse-a",
      "item-a",
      id,
      idempotencyKey,
      `correlation-${id}`,
      stamp,
    )
    .run();
}

async function insertGoodsReceipt(id: string, idempotencyKey: string, stamp: string) {
  return database
    .prepare(
      `INSERT INTO goods_receipts
      (tenant_id,id,branch_id,purchase_order_id,receipt_number,idempotency_key,status,payload_json,received_at)
     VALUES (?,?,?,?,?,?,'POSTED','{}',?)`,
    )
    .bind(tenantA, id, branchA, "po-race", `GRN-${id}`, idempotencyKey, stamp)
    .run();
}

async function count(table: string, tenantId: string) {
  const row = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?`)
    .bind(tenantId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function signToken(input: { tid: string; sub: string; sid: string; deviceId: string }) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...input, iss: issuer, aud: audience, iat: now, exp: now + 3600 });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}
