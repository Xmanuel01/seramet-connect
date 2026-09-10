import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateSerametRequest, type SerametEnv } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import {
  normalizePostgresSql,
  replaceQuestionMarkParameters,
} from "@/server/database/postgres-database";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { createLocalDevelopmentDatabase } from "@/server/database/local-development-database";
import { resolveRuntimeConfiguration, validateRuntimeConfiguration } from "@/server/environment";
import { TenantObjectStorage } from "@/server/object-storage";
import {
  RestaurantRegistrationService,
  type RestaurantRegistrationInput,
} from "@/server/registration-service";
import type { VerifiedExternalIdentity } from "@/server/identity/supabase-identity";
import { listRealtimeEvents, publishRealtimeEvent } from "@/server/realtime";
import { handleSupabaseAuthApi } from "@/server/supabase-auth-api";

let database: SqliteD1TestDatabase;

describe.sequential("commercial launch foundation", () => {
  beforeEach(() => {
    database = createMigratedTestDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it("provisions a verified restaurant administrator into a clean tenant idempotently", async () => {
    const service = new RestaurantRegistrationService(database);
    const first = await service.register(identity(), registration());
    const replay = await service.register(identity(), registration());
    expect(replay).toEqual(first);
    expect(first.goLiveState).toBe("SETUP");

    const tenant = await database
      .prepare("SELECT trading_name FROM tenants WHERE id=?")
      .bind(first.tenantId)
      .first<{ trading_name: string }>();
    const rolePermissionCount = await database
      .prepare("SELECT COUNT(*) AS count FROM role_permissions WHERE tenant_id=?")
      .bind(first.tenantId)
      .first<{ count: number }>();
    const operationalCounts = await database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM orders WHERE tenant_id=?) AS orders,
          (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id=?) AS movements,
          (SELECT COUNT(*) FROM payment_transactions WHERE tenant_id=?) AS payments,
          (SELECT COUNT(*) FROM customers WHERE tenant_id=?) AS customers`,
      )
      .bind(first.tenantId, first.tenantId, first.tenantId, first.tenantId)
      .first<{ orders: number; movements: number; payments: number; customers: number }>();

    expect(tenant?.trading_name).toBe("Launch Kitchen");
    expect(rolePermissionCount?.count).toBeGreaterThan(50);
    expect(operationalCounts).toEqual({ orders: 0, movements: 0, payments: 0, customers: 0 });
  });

  it("rejects unverified account provisioning and conflicting idempotency reuse", async () => {
    const service = new RestaurantRegistrationService(database);
    await expect(
      service.register({ ...identity(), emailVerified: false }, registration()),
    ).rejects.toThrow(/verified/i);
    await service.register(identity(), registration());
    await expect(
      service.register(identity(), { ...registration(), tradingName: "Changed Name" }),
    ).rejects.toThrow(/different details/i);
  });

  it("generates an optional public URL name and normalizes a pasted website URL", async () => {
    const service = new RestaurantRegistrationService(database);
    const { slug: _generatedSlug, ...generatedRegistration } = registration();
    const generated = await service.register(identity(), generatedRegistration);
    const { slug: _collisionSlug, ...collisionRegistration } = registration();
    const collision = await service.register(
      { ...identity(), subject: "second-owner", sessionId: "supabase:second-owner" },
      {
        ...collisionRegistration,
        idempotencyKey: "registration-idempotency-key-optional-0002",
      },
    );
    const normalized = await service.register(
      { ...identity(), subject: "third-owner", sessionId: "supabase:third-owner" },
      {
        ...registration(),
        idempotencyKey: "registration-idempotency-key-url-0003",
        slug: "https://mona-swahili.vercel.app",
      },
    );

    const rows = await database
      .prepare("SELECT id,slug FROM tenants WHERE id IN (?,?,?) ORDER BY slug")
      .bind(generated.tenantId, collision.tenantId, normalized.tenantId)
      .all<{ id: string; slug: string }>();
    expect((rows.results ?? []).map((row) => row.slug)).toEqual([
      "launch-kitchen",
      "launch-kitchen-2",
      "mona-swahili",
    ]);
  });

  it("resolves a Supabase identity through the authoritative membership and session", async () => {
    const provisioned = await new RestaurantRegistrationService(database).register(
      identity(),
      registration(),
    );
    const actor = await authenticateSerametRequest(
      new Request("https://app.seramet.test/api/seramet/auth/session", {
        headers: {
          authorization: "Bearer verified-token",
          "x-seramet-tenant-id": provisioned.tenantId,
        },
      }),
      authEnv(),
    );
    expect(actor.tenantId).toBe(provisioned.tenantId);
    expect(actor.permissions).toContain(permissions.posAccess);
    expect(actor.permissions).not.toContain(permissions.platformTenantsProvision);
    const session = await database
      .prepare("SELECT revoked_at FROM auth_sessions WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, identity().sessionId)
      .first<{ revoked_at: string | null }>();
    expect(session?.revoked_at).toBeNull();
  });

  it("revokes the authoritative session when secure cookie logout runs", async () => {
    const provisioned = await new RestaurantRegistrationService(database).register(
      identity(),
      registration(),
    );
    await authenticateSerametRequest(
      new Request("https://app.seramet.test/api/seramet/auth/session", {
        headers: {
          authorization: "Bearer verified-token",
          "x-seramet-tenant-id": provisioned.tenantId,
        },
      }),
      authEnv(),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const response = await handleSupabaseAuthApi(
      new Request("https://app.seramet.test/api/seramet/public/auth/logout", {
        method: "POST",
        headers: { cookie: "seramet_access=verified-token", origin: "https://app.seramet.test" },
      }),
      {
        ...authEnv(),
        SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
        SERAMET_SUPABASE_URL: "https://example.supabase.co",
        SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
      },
    );
    expect(response?.status).toBe(200);
    const session = await database
      .prepare("SELECT revoked_at FROM auth_sessions WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, identity().sessionId)
      .first<{ revoked_at: string | null }>();
    expect(session?.revoked_at).not.toBeNull();
  });

  it("stores clean files in tenant-scoped random R2 paths and removes orphan uploads", async () => {
    const provisioned = await new RestaurantRegistrationService(database).register(
      identity(),
      registration(),
    );
    const objects = new Map<string, ArrayBuffer>();
    const bucket = {
      head: async (key: string) => (objects.has(key) ? {} : null),
      get: async (key: string) => {
        const bytes = objects.get(key);
        return bytes ? { arrayBuffer: async () => bytes } : null;
      },
      put: async (key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string) => {
        if (!(value instanceof ArrayBuffer)) throw new Error("expected ArrayBuffer");
        objects.set(key, value);
        return {};
      },
      delete: async (key: string | string[]) => {
        for (const entry of Array.isArray(key) ? key : [key]) objects.delete(entry);
      },
    };
    const storage = new TenantObjectStorage(database, bucket, {
      scan: async () => ({ status: "CLEAN" as const, reference: "scan-1" }),
    });
    const stored = await storage.store({
      tenantId: provisioned.tenantId,
      branchId: provisioned.branchId,
      actorId: provisioned.userId,
      objectClass: "PUBLIC_ASSET",
      fileName: "menu photo.png",
      contentType: "image/png",
      bytes: new TextEncoder().encode("image-fixture").buffer,
    });
    const row = await storage.findPrivate(provisioned.tenantId, stored.id);
    expect(row?.object_key).toMatch(
      new RegExp(`^${provisioned.tenantId}/public/[0-9a-f-]+\\.png$`),
    );
    expect(row?.object_key).not.toContain("menu photo");
    expect(objects.size).toBe(1);
    expect(await storage.findPrivate("another-tenant", stored.id)).toBeNull();
  });

  it("refuses infected and oversized uploads before object persistence", async () => {
    let writes = 0;
    const bucket = {
      head: async () => null,
      get: async () => null,
      put: async () => {
        writes += 1;
        return {};
      },
      delete: async () => undefined,
    };
    const storage = new TenantObjectStorage(database, bucket, {
      scan: async () => ({ status: "INFECTED" as const }),
    });
    await expect(
      storage.store({
        tenantId: "tenant",
        actorId: "user",
        objectClass: "PRIVATE_DOCUMENT",
        fileName: "report.pdf",
        contentType: "application/pdf",
        bytes: new TextEncoder().encode("unsafe").buffer,
      }),
    ).rejects.toThrow(/security scanning/i);
    expect(writes).toBe(0);
  });

  it("normalizes D1 placeholders and conflict syntax for PostgreSQL", () => {
    expect(
      replaceQuestionMarkParameters("SELECT '?' literal, ? value, \"?\" identifier, ? other"),
    ).toBe("SELECT '?' literal, $1 value, \"?\" identifier, $2 other");
    expect(normalizePostgresSql("INSERT OR IGNORE INTO jobs(id,name) VALUES (?,?);")).toBe(
      "INSERT INTO jobs(id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    );
    expect(
      normalizePostgresSql(
        "SELECT * FROM rows WHERE created_at>=datetime('now','-30 days') AND expires_at<=datetime('now','+5 minutes')",
      ),
    ).toContain("CURRENT_TIMESTAMP - INTERVAL '30 days'");
    expect(normalizePostgresSql("SELECT datetime('now') AS stamp")).toContain(
      "to_char(CURRENT_TIMESTAMP",
    );
  });

  it("scopes durable real-time events by tenant and branch", async () => {
    const first = await new RestaurantRegistrationService(database).register(
      identity(),
      registration(),
    );
    const second = await new RestaurantRegistrationService(database).register(
      { ...identity(), subject: "second-user", sessionId: "supabase:second" },
      {
        ...registration(),
        idempotencyKey: "registration-idempotency-key-0002",
        slug: "other-kitchen",
      },
    );
    const after = new Date(Date.now() - 1_000).toISOString();
    await publishRealtimeEvent(database, {
      tenantId: first.tenantId,
      branchId: first.branchId,
      topic: "orders",
      entityType: "ORDER",
      entityId: "order-1",
      eventType: "UPDATED",
      correlationId: "correlation-1",
    });
    await publishRealtimeEvent(database, {
      tenantId: second.tenantId,
      branchId: second.branchId,
      topic: "orders",
      entityType: "ORDER",
      entityId: "order-2",
      eventType: "UPDATED",
      correlationId: "correlation-2",
    });
    const events = await listRealtimeEvents(database, {
      tenantId: first.tenantId,
      branchId: first.branchId,
      after,
    });
    expect(events.map((event) => event.entityId)).toEqual(["order-1"]);
  });

  it("fails production readiness without real Hyperdrive, R2, queue and scanner bindings", () => {
    const issues = validateRuntimeConfiguration({
      SERAMET_ENVIRONMENT: "production",
      SERAMET_IDENTITY_PROVIDER: "supabase",
      SERAMET_SUPABASE_URL: "https://example.supabase.co",
      SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
      SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
      SERAMET_CALLBACK_BASE_URL: "https://app.seramet.test",
      SERAMET_JWT_SECRET: "a-production-guest-signing-secret-with-enough-entropy",
      SERAMET_SECRET_STORE: "managed",
    });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "DATABASE_REQUIRED",
        "POSTGRES_HYPERDRIVE_REQUIRED",
        "QUEUE_REQUIRED",
        "OBJECT_STORAGE_REQUIRED",
        "MALWARE_SCANNER_REQUIRED",
      ]),
    );
  });

  it("starts development with secure authentication defaults and an empty authoritative store", async () => {
    expect(resolveRuntimeConfiguration({ SERAMET_ENVIRONMENT: "development" })).toMatchObject({
      devAuthEnabled: false,
      bearerRequired: false,
    });

    const directory = mkdtempSync(join(tmpdir(), "seramet-empty-development-"));
    const local = createLocalDevelopmentDatabase({ databasePath: join(directory, "state.sqlite") });
    try {
      const counts = await local
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM tenants) tenants,
            (SELECT COUNT(*) FROM branches) branches,
            (SELECT COUNT(*) FROM users) users,
            (SELECT COUNT(*) FROM orders) orders,
            (SELECT COUNT(*) FROM payment_transactions) payments,
            (SELECT COUNT(*) FROM inventory_movements) movements`,
        )
        .first<Record<string, number>>();
      expect(counts).toEqual({
        tenants: 0,
        branches: 0,
        users: 0,
        orders: 0,
        payments: 0,
        movements: 0,
      });
    } finally {
      local.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});

function identity(): VerifiedExternalIdentity {
  return {
    provider: "supabase",
    subject: "supabase-user-1",
    sessionId: "supabase:session-1",
    email: "owner@example.test",
    emailVerified: true,
    issuedAt: Math.floor(Date.now() / 1000) - 60,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function registration(): RestaurantRegistrationInput {
  return {
    idempotencyKey: "registration-idempotency-key-0001",
    administratorName: "Restaurant Owner",
    slug: "launch-kitchen",
    legalName: "Launch Kitchen Limited",
    tradingName: "Launch Kitchen",
    countryCode: "KE",
    currency: "KES",
    timezone: "Africa/Nairobi",
    locale: "en-KE",
    brandCode: "PRIMARY",
    brandName: "Launch Kitchen",
    branchCode: "MAIN",
    branchName: "Main Branch",
    businessDayCutoffMinutes: 240,
    negativeStockPolicy: "MANAGER_OVERRIDE",
    serviceModes: ["DINE_IN", "TAKEAWAY"],
  };
}

function authEnv(): SerametEnv {
  return {
    SERAMET_ENVIRONMENT: "test",
    SERAMET_DB: database,
    SERAMET_IDENTITY_PROVIDER: "supabase",
    SERAMET_IDENTITY_VERIFIER: { verify: async () => identity() },
  };
}
