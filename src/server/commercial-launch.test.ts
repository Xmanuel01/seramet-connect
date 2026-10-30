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
import { handleSerametApiRequest } from "@/lib/seramet-api";
import { handleSupabaseAuthApi } from "@/server/supabase-auth-api";
import { DatabaseSerializationError } from "@/server/errors";

let database: SqliteD1TestDatabase;

describe.sequential("commercial launch foundation", () => {
  beforeEach(() => {
    database = createMigratedTestDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    // The registering owner is the active account owner, who may sell from any signed-in
    // browser; other verified accounts still need an enrolled sales terminal.
    expect(actor.salesTerminal).toBe(true);
    expect(actor.permissions).toContain(permissions.posAccess);
    expect(actor.permissions).toContain(permissions.settingsBranchManage);
    expect(actor.permissions).not.toContain(permissions.platformTenantsProvision);
    const session = await database
      .prepare("SELECT revoked_at FROM auth_sessions WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, identity().sessionId)
      .first<{ revoked_at: string | null }>();
    expect(session?.revoked_at).toBeNull();
  });

  it("recovers authentication metadata contention without reviving a revoked session", async () => {
    const provisioned = await new RestaurantRegistrationService(database).register(
      identity(),
      registration(),
    );
    const request = new Request("https://app.seramet.test/api/seramet/auth/session", {
      headers: {
        authorization: "Bearer verified-token",
        "x-seramet-tenant-id": provisioned.tenantId,
      },
    });
    await database
      .prepare("UPDATE auth_sessions SET expires_at=? WHERE tenant_id=? AND id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), provisioned.tenantId, identity().sessionId)
      .run();
    const batch = vi
      .spyOn(database, "batch")
      .mockRejectedValueOnce(new DatabaseSerializationError());
    const actor = await authenticateSerametRequest(request, authEnv());
    expect(actor.tenantId).toBe(provisioned.tenantId);
    expect(batch.mock.calls.length).toBeGreaterThanOrEqual(2);
    await database
      .prepare("UPDATE auth_sessions SET revoked_at=? WHERE tenant_id=? AND id=?")
      .bind(new Date().toISOString(), provisioned.tenantId, identity().sessionId)
      .run();
    await expect(authenticateSerametRequest(request, authEnv())).rejects.toThrow(/revoked/);
  });

  it("keeps repeated session reads read-only and still rejects credential changes", async () => {
    // A verifier call crossing a second boundary would otherwise look like a token refresh.
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const provisioned = await new RestaurantRegistrationService(database).register(
      identity(),
      registration(),
    );
    const request = new Request("https://app.seramet.test/api/seramet/auth/session", {
      headers: {
        authorization: "Bearer verified-token",
        "x-seramet-tenant-id": provisioned.tenantId,
      },
    });
    await authenticateSerametRequest(request, authEnv());
    const batch = vi.spyOn(database, "batch");
    const prepare = vi.spyOn(database, "prepare");
    const actors = await Promise.all(
      Array.from({ length: 20 }, () => authenticateSerametRequest(request, authEnv())),
    );
    expect(actors.every((actor) => actor.tenantId === provisioned.tenantId)).toBe(true);
    expect(batch).not.toHaveBeenCalled();
    const sessionWrites = prepare.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) =>
        /\b(INSERT|UPDATE|DELETE)\b[\s\S]*\b(auth_sessions|identity_accounts)\b/i.test(sql),
      );
    expect(sessionWrites).toEqual([]);
    prepare.mockRestore();
    await database
      .prepare("UPDATE users SET password_version=password_version+1 WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, provisioned.userId)
      .run();
    await expect(authenticateSerametRequest(request, authEnv())).rejects.toThrow(
      /credential change/,
    );
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

  it("returns owner email verification to explicit administrator sign in", async () => {
    const provider = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ user: { id: "disposable-owner", email: "owner@example.test" } }),
      );
    const response = await handleSupabaseAuthApi(
      new Request("https://app.seramet.test/api/seramet/public/auth/signup", {
        method: "POST",
        headers: { origin: "https://app.seramet.test", "content-type": "application/json" },
        body: JSON.stringify({
          name: "Disposable owner",
          email: "owner@example.test",
          password: "disposable-fixture-password",
        }),
      }),
      {
        SERAMET_ENVIRONMENT: "staging",
        SERAMET_IDENTITY_PROVIDER: "supabase",
        SERAMET_DB: database,
        SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
        SERAMET_SUPABASE_URL: "https://example.supabase.co",
        SERAMET_SUPABASE_PUBLISHABLE_KEY: "disposable-publishable-fixture",
      },
    );
    expect(response?.status).toBe(202);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(provider.mock.calls[0]![1]?.body))).toMatchObject({
      data: { display_name: "Disposable owner" },
    });
    const callback = new URL(String(provider.mock.calls[0]![0])).searchParams.get("redirect_to");
    expect(callback).toBe("https://app.seramet.test/login?account=1&verified=1");
    await expect(response?.json()).resolves.toMatchObject({
      verificationRequired: true,
      authenticated: false,
    });
  });

  it.each([true, false])(
    "returns the saved account name for setup with a database binding: %s",
    async (withDatabase) => {
      const response = await handleSupabaseAuthApi(
        new Request("https://app.seramet.test/api/seramet/public/auth/status", {
          headers: { cookie: "seramet_access=verified-token" },
        }),
        {
          ...authEnv(),
          SERAMET_DB: withDatabase ? database : undefined,
          SERAMET_IDENTITY_VERIFIER: {
            verify: async () => ({ ...identity(), displayName: "Saved account owner" }),
          },
        },
      );
      await expect(response?.json()).resolves.toMatchObject({
        authenticated: true,
        identity: {
          email: "owner@example.test",
          phone: null,
          displayName: "Saved account owner",
        },
        restaurants: [],
      });
    },
  );

  it("does not expose a profile name without an authenticated session", async () => {
    const verify = vi.fn(async () => ({ ...identity(), displayName: "Saved account owner" }));
    const response = await handleSupabaseAuthApi(
      new Request("https://app.seramet.test/api/seramet/public/auth/status"),
      { ...authEnv(), SERAMET_IDENTITY_VERIFIER: { verify } },
    );
    await expect(response?.json()).resolves.toEqual({
      ok: true,
      authenticated: false,
      restaurants: [],
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns only the signed-in account's persisted onboarding progress", async () => {
    const service = new RestaurantRegistrationService(database);
    const tenant = await service.register(identity(), registration());
    await service.register(
      { ...identity(), subject: "other-owner" },
      {
        ...registration(),
        idempotencyKey: "other-owner-registration-0002",
        slug: "other-owner-restaurant",
      },
    );
    const status = async () => {
      const response = await handleSupabaseAuthApi(
        new Request("https://app.seramet.test/api/seramet/public/auth/status", {
          headers: { cookie: "seramet_access=verified-token" },
        }),
        authEnv(),
      );
      return response!.json();
    };
    const expected = { tenantId: tenant.tenantId, slug: "launch-kitchen", name: "Launch Kitchen" };
    expect((await status()).restaurants).toEqual([
      { ...expected, onboardingStatus: "IN_PROGRESS" },
    ]);
    await database
      .prepare("UPDATE onboarding_wizard_progress SET status='COMPLETED' WHERE tenant_id=?")
      .bind(tenant.tenantId)
      .run();
    expect((await status()).restaurants).toEqual([{ ...expected, onboardingStatus: "COMPLETED" }]);
  });

  it("allows public auth login before unrelated production bindings are present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          user: { id: "supabase-user-1", email: "owner@example.test" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await handleSerametApiRequest(
      new Request("https://app.seramet.test/api/seramet/public/auth/login", {
        method: "POST",
        headers: {
          origin: "https://app.seramet.test",
          "content-type": "application/json",
          cookie: "seramet_pos_session=previous-employee-token",
        },
        body: JSON.stringify({ email: "owner@example.test", password: "supersecret12" }),
      }),
      {
        SERAMET_ENVIRONMENT: "production",
        SERAMET_DB: database,
        SERAMET_IDENTITY_PROVIDER: "supabase",
        SERAMET_SUPABASE_URL: "https://example.supabase.co",
        SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
      } as SerametEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("seramet_pos_session=;");
    await expect(response.json()).resolves.toEqual({ ok: true, authenticated: true });
  });

  it("reports public auth disabled when the publishable key is missing", async () => {
    const response = await handleSupabaseAuthApi(
      new Request("https://app.seramet.test/api/seramet/public/auth/config"),
      {
        SERAMET_IDENTITY_PROVIDER: "supabase",
        SERAMET_SUPABASE_URL: "https://example.supabase.co",
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ enabled: false });
  });

  it("returns unregistered device startup without requiring database access", async () => {
    const response = await handleSerametApiRequest(
      new Request("https://app.seramet.test/api/seramet/public/device/startup"),
      { SERAMET_ENVIRONMENT: "production" } as SerametEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, state: "UNREGISTERED" });
  });

  it("uses the request origin for development auth redirects and same-origin checks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "development-access-token",
          refresh_token: "development-refresh-token",
          expires_in: 3600,
          user: { id: "supabase-user-1", email: "owner@example.test" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await handleSupabaseAuthApi(
      new Request("http://127.0.0.1:5210/api/seramet/public/auth/login", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5210", "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "supersecret12" }),
      }),
      {
        ...authEnv(),
        SERAMET_ENVIRONMENT: "development",
        SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
        SERAMET_SUPABASE_URL: "https://example.supabase.co",
        SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
      },
    );

    expect(response?.status).toBe(200);
  });

  it("allows public auth login without a database binding", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          user: { id: "supabase-user-1", email: "owner@example.test" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await handleSerametApiRequest(
      new Request("https://app.seramet.test/api/seramet/public/auth/login", {
        method: "POST",
        headers: {
          origin: "https://app.seramet.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "owner@example.test", password: "supersecret12" }),
      }),
      {
        SERAMET_ENVIRONMENT: "production",
        SERAMET_IDENTITY_PROVIDER: "supabase",
        SERAMET_SUPABASE_URL: "https://example.supabase.co",
        SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
      } as SerametEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, authenticated: true });
  });

  it("logs unavailable identity configuration and returns an actionable safe browser error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handleSerametApiRequest(
      new Request("https://app.seramet.test/api/seramet/public/auth/login", {
        method: "POST",
        headers: {
          origin: "https://app.seramet.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "owner@example.test", password: "supersecret12" }),
      }),
      {
        SERAMET_ENVIRONMENT: "production",
        SERAMET_DB: database,
        SERAMET_IDENTITY_PROVIDER: "supabase",
        SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
      } as SerametEnv,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "EXTERNAL_SERVICE_UNAVAILABLE",
      message: "Identity provider is unavailable",
    });
    expect(errorSpy).toHaveBeenCalled();
    const logLine = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logLine).toContain('"operation":"public-auth-login"');
    expect(logLine).toContain('"route":"/api/seramet/public/auth/login"');
    expect(logLine).toContain('"stage":"supabase-auth"');
    errorSpy.mockRestore();
  });

  it("returns a controlled temporary-unavailable response when the identity request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network socket failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handleSupabaseAuthApi(
      new Request("https://app.seramet.test/api/seramet/public/auth/login", {
        method: "POST",
        headers: { origin: "https://app.seramet.test", "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "supersecret12" }),
      }),
      {
        ...authEnv(),
        SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
        SERAMET_SUPABASE_URL: "https://example.supabase.co",
        SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
      },
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      ok: false,
      code: "EXTERNAL_SERVICE_UNAVAILABLE",
      message: "Sign-in service is temporarily unavailable. Please try again.",
    });
    const logLine = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logLine).not.toContain("network socket failed");
    errorSpy.mockRestore();
  });

  it("stores validated files in tenant-scoped random R2 paths and removes orphan uploads", async () => {
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
    const storage = new TenantObjectStorage(database, bucket);
    const stored = await storage.store({
      tenantId: provisioned.tenantId,
      branchId: provisioned.branchId,
      actorId: provisioned.userId,
      objectClass: "PUBLIC_ASSET",
      fileName: "menu photo.png",
      contentType: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer,
    });
    const row = await storage.findPrivate(provisioned.tenantId, stored.id);
    expect(row?.object_key).toMatch(
      new RegExp(`^${provisioned.tenantId}/public/[0-9a-f-]+\\.png$`),
    );
    expect(row?.object_key).not.toContain("menu photo");
    expect(objects.size).toBe(1);
    expect(await storage.findPrivate("another-tenant", stored.id)).toBeNull();
  });

  it("rejects mismatched file signatures before object persistence", async () => {
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
    const storage = new TenantObjectStorage(database, bucket);
    await expect(
      storage.store({
        tenantId: "tenant",
        actorId: "user",
        objectClass: "PRIVATE_DOCUMENT",
        fileName: "report.pdf",
        contentType: "application/pdf",
        bytes: new TextEncoder().encode("unsafe").buffer,
      }),
    ).rejects.toThrow(/signature/i);
    expect(writes).toBe(0);
  });

  it("normalizes D1 placeholders and conflict syntax for PostgreSQL", () => {
    expect(
      replaceQuestionMarkParameters("SELECT '?' literal, ? value, \"?\" identifier, ? other"),
    ).toBe("SELECT '?' literal, $1 value, \"?\" identifier, $2 other");
    expect(
      replaceQuestionMarkParameters(
        "SELECT '? IS NULL' literal FROM menu_catalog_items WHERE (? IS NULL OR branch_id=?)",
      ),
    ).toBe(
      "SELECT '? IS NULL' literal FROM menu_catalog_items WHERE (CAST($1 AS text) IS NULL OR branch_id=$2)",
    );
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

  it("reports full readiness without any malware scanner dependency", async () => {
    const env = {
      SERAMET_ENVIRONMENT: "staging",
      SERAMET_DB: database,
      SERAMET_DATABASE_PROVIDER: "postgres",
      SERAMET_HYPERDRIVE: { connectionString: "postgresql://staging.example.test/seramet" },
      SERAMET_WORK_QUEUE: { send: async () => undefined },
      SERAMET_OBJECTS: {
        head: async () => null,
        get: async () => null,
        put: async () => ({}),
        delete: async () => undefined,
      },
      SERAMET_IDENTITY_PROVIDER: "supabase",
      SERAMET_SUPABASE_URL: "https://example.supabase.co",
      SERAMET_SUPABASE_PUBLISHABLE_KEY: "publishable",
      SERAMET_PUBLIC_ORIGIN: "https://app.seramet.test",
      SERAMET_CALLBACK_BASE_URL: "https://app.seramet.test",
      SERAMET_JWT_SECRET: "a-production-guest-signing-secret-with-enough-entropy",
      SERAMET_SECRET_STORE: "managed",
      SERAMET_REQUIRE_BEARER: "true",
      SERAMET_ENABLE_DEV_AUTH: "false",
      SERAMET_ENABLE_LOCAL_DATABASE: "false",
      SERAMET_ALLOW_TEST_PROVIDERS: "false",
    } as SerametEnv;

    const operational = await handleSerametApiRequest(
      new Request("https://app.seramet.test/api/seramet/health/operational"),
      env,
    );
    expect(operational.status).toBe(200);
    await expect(operational.json()).resolves.toMatchObject({
      ok: true,
      database: "authoritative",
    });

    const fullReadiness = await handleSerametApiRequest(
      new Request("https://app.seramet.test/api/seramet/health/ready"),
      env,
    );
    expect(fullReadiness.status).toBe(200);
    await expect(fullReadiness.json()).resolves.toMatchObject({ ok: true });
  });

  it("fails production readiness without real Hyperdrive, R2 and queue bindings", () => {
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
