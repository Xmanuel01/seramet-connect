import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateAuthoritativeConfiguration,
  hydrateTenantConfiguration,
  invalidateAuthoritativeConfiguration,
} from "@/server/database/authoritative-configuration";
import {
  getConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import type { D1Database } from "@/server/database/d1";

afterEach(() => setConfigurationRepositoryForTests(undefined));

const stamp = "2026-11-11T00:00:00.000Z";

/** Two restaurants with their own branch, role and permission rows. */
async function seedRestaurants(sqlite: SqliteD1TestDatabase, tenantIds: string[]) {
  for (const tenantId of tenantIds) {
    const run = (query: string, ...values: unknown[]) =>
      sqlite
        .prepare(query)
        .bind(...values)
        .run();
    await run(
      `INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,
         active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
      tenantId,
      tenantId,
      `${tenantId} Ltd`,
      tenantId,
      stamp,
      stamp,
    );
    await run(
      `INSERT INTO branches (tenant_id,id,code,name,timezone,active,payload_json)
       VALUES (?,?,?,?,'Africa/Nairobi',1,'{}')`,
      tenantId,
      `${tenantId}-main`,
      "MAIN",
      `${tenantId} main branch`,
    );
    await run(
      `INSERT INTO roles (tenant_id,id,code,name,active,payload_json)
       VALUES (?,?,'MANAGER','Manager',1,'{}')`,
      tenantId,
      `${tenantId}-manager`,
    );
    await run(
      `INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,'orders.create')`,
      tenantId,
      `${tenantId}-manager`,
    );
  }
}

/** A per-request pool to the shared database that records every query and its bound values. */
function recordingPool(sqlite: SqliteD1TestDatabase, identity: string) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const prepare = vi.fn((query: string) => {
    const statement = sqlite.prepare(query);
    const call = { query, values: [] as unknown[] };
    calls.push(call);
    const bind = statement.bind.bind(statement);
    return Object.assign(statement, {
      bind: (...values: unknown[]) => {
        call.values = values;
        return bind(...values);
      },
    });
  });
  const db = {
    ...sqlite,
    prepare,
    batch: sqlite.batch.bind(sqlite),
    cacheIdentity: identity,
  } as unknown as D1Database;
  const configurationQueries = () =>
    calls.filter((call) => !call.query.includes("configuration_revisions"));
  return { db, prepare, calls, configurationQueries };
}

describe("per-restaurant configuration cache", () => {
  it("loads only the requested restaurant's rows", async () => {
    const sqlite = createMigratedTestDatabase();
    try {
      await seedRestaurants(sqlite, ["tenant-a", "tenant-b"]);
      const pool = recordingPool(sqlite, "isolation-db");
      const repository = await hydrateTenantConfiguration(pool.db, {}, "tenant-a");

      const queries = pool.configurationQueries();
      expect(queries.length).toBeGreaterThan(0);
      // Every configuration query is filtered by the restaurant, bound to tenant A only.
      for (const call of queries) {
        expect(call.query).toMatch(/tenant_id=\?|t\.id=\?/);
        expect(call.values).toEqual(["tenant-a"]);
      }
      expect(queries.some((call) => call.query.includes("FROM role_permissions"))).toBe(true);

      const state = repository.snapshot();
      expect(state.tenants.map((tenant) => tenant.id)).toEqual(["tenant-a"]);
      expect(state.branches.map((branch) => branch.id)).toEqual(["tenant-a-main"]);
      expect(state.roles.map((role) => [role.id, role.permissions])).toEqual([
        ["tenant-a-manager", ["orders.create"]],
      ]);
      expect(() => repository.getTenant("tenant-b")).toThrow();
      expect(getConfigurationRepository()).toBe(repository);
    } finally {
      sqlite.close();
    }
  }, 30_000);

  it("adds a second restaurant with its own rows, keeping the first cached", async () => {
    const sqlite = createMigratedTestDatabase();
    try {
      await seedRestaurants(sqlite, ["tenant-a", "tenant-b"]);
      await hydrateTenantConfiguration(recordingPool(sqlite, "two-db").db, {}, "tenant-a");

      const second = recordingPool(sqlite, "two-db");
      const repository = await hydrateTenantConfiguration(second.db, {}, "tenant-b");
      for (const call of second.configurationQueries()) expect(call.values).toEqual(["tenant-b"]);
      expect(
        repository
          .listTenants()
          .map((tenant) => tenant.id)
          .sort(),
      ).toEqual(["tenant-a", "tenant-b"]);
      expect(repository.listBranches("tenant-b").map((branch) => branch.id)).toEqual([
        "tenant-b-main",
      ]);

      // Tenant A is still current: only the revision check runs.
      const again = recordingPool(sqlite, "two-db");
      expect(await hydrateTenantConfiguration(again.db, {}, "tenant-a")).toBe(repository);
      expect(again.prepare).toHaveBeenCalledTimes(1);
      expect(again.calls[0]?.query).toContain("configuration_revisions");
    } finally {
      sqlite.close();
    }
  }, 30_000);

  it("reuses a restaurant's configuration for a new pool to the same database, until invalidated", async () => {
    const sqlite = createMigratedTestDatabase();
    try {
      await seedRestaurants(sqlite, ["tenant-a"]);
      const first = recordingPool(sqlite, "same-db");
      const loaded = await hydrateTenantConfiguration(first.db, {}, "tenant-a", true);
      expect(first.configurationQueries().length).toBeGreaterThan(0);

      const second = recordingPool(sqlite, "same-db");
      expect(await hydrateTenantConfiguration(second.db, {}, "tenant-a")).toBe(loaded);
      // Only the one-row revision check, not the configuration queries.
      expect(second.prepare).toHaveBeenCalledTimes(1);
      expect(second.calls[0]?.query).toContain("configuration_revisions");

      await invalidateAuthoritativeConfiguration(second.db);
      const third = recordingPool(sqlite, "same-db");
      expect(await hydrateTenantConfiguration(third.db, {}, "tenant-a")).not.toBe(loaded);
      expect(third.configurationQueries().length).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  }, 30_000);

  it("reloads a restaurant once another server bumps the shared revision, and sees the change", async () => {
    const sqlite = createMigratedTestDatabase();
    const now = vi.spyOn(Date, "now");
    try {
      await seedRestaurants(sqlite, ["tenant-a", "tenant-b"]);
      now.mockReturnValue(1_000_000);
      const loaded = await hydrateTenantConfiguration(
        recordingPool(sqlite, "server-a").db,
        {},
        "tenant-a",
      );
      await hydrateTenantConfiguration(recordingPool(sqlite, "server-a").db, {}, "tenant-b");

      // A minute later the copy is still current: the revision hasn't moved.
      now.mockReturnValue(1_060_000);
      const again = recordingPool(sqlite, "server-a");
      const current = await hydrateTenantConfiguration(again.db, {}, "tenant-a");
      expect(current.getBranch("tenant-a", "tenant-a-main").name).toBe("tenant-a main branch");
      expect(again.prepare).toHaveBeenCalledTimes(1);

      // Another server renames tenant A's branch and records the change.
      await sqlite
        .prepare("UPDATE branches SET name='Renamed' WHERE tenant_id=? AND id=?")
        .bind("tenant-a", "tenant-a-main")
        .run();
      await invalidateAuthoritativeConfiguration(recordingPool(sqlite, "server-b").db);

      const after = recordingPool(sqlite, "server-a");
      const reloaded = await hydrateTenantConfiguration(after.db, {}, "tenant-a");
      expect(reloaded).not.toBe(loaded);
      expect(reloaded.getBranch("tenant-a", "tenant-a-main").name).toBe("Renamed");
      // The reload reads tenant A's rows only; tenant B reloads when it is next served.
      expect(after.configurationQueries().length).toBeGreaterThan(0);
      for (const call of after.configurationQueries()) expect(call.values).toEqual(["tenant-a"]);
      expect(reloaded.listTenants().map((tenant) => tenant.id)).toEqual(["tenant-a"]);

      const tenantB = recordingPool(sqlite, "server-a");
      await hydrateTenantConfiguration(tenantB.db, {}, "tenant-b");
      for (const call of tenantB.configurationQueries()) expect(call.values).toEqual(["tenant-b"]);
      expect(tenantB.configurationQueries().length).toBeGreaterThan(0);

      // Even with no change, a copy is refreshed after five minutes.
      const refreshed = await hydrateTenantConfiguration(
        recordingPool(sqlite, "server-a").db,
        {},
        "tenant-a",
      );
      now.mockReturnValue(1_060_000 + 5 * 60_000 + 1);
      expect(
        await hydrateTenantConfiguration(recordingPool(sqlite, "server-a").db, {}, "tenant-a"),
      ).not.toBe(refreshed);
    } finally {
      now.mockRestore();
      sqlite.close();
    }
  }, 30_000);

  it("revalidating without a restaurant never loads one this server has not served", async () => {
    const sqlite = createMigratedTestDatabase();
    try {
      await seedRestaurants(sqlite, ["tenant-a", "tenant-b"]);
      await hydrateTenantConfiguration(recordingPool(sqlite, "held-db").db, {}, "tenant-a");
      const refresh = recordingPool(sqlite, "held-db");
      const repository = await hydrateAuthoritativeConfiguration(refresh.db, {}, true);
      for (const call of refresh.configurationQueries()) expect(call.values).toEqual(["tenant-a"]);
      expect(repository.listTenants().map((tenant) => tenant.id)).toEqual(["tenant-a"]);

      const cold = recordingPool(sqlite, "cold-db");
      const empty = await hydrateAuthoritativeConfiguration(cold.db);
      expect(cold.configurationQueries()).toEqual([]);
      expect(empty.listTenants()).toEqual([]);
    } finally {
      sqlite.close();
    }
  }, 30_000);

  it("does not let a load that started before a change replace the newer configuration", async () => {
    const sqlite = createMigratedTestDatabase();
    try {
      await seedRestaurants(sqlite, ["tenant-a"]);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const slow = {
        ...sqlite,
        cacheIdentity: "race-db",
        batch: sqlite.batch.bind(sqlite),
        prepare: (query: string) => {
          const statement = sqlite.prepare(query);
          const bind = statement.bind.bind(statement);
          return Object.assign(statement, {
            bind: (...values: unknown[]) => {
              const bound = bind(...values);
              const boundAll = bound.all.bind(bound);
              return Object.assign(bound, {
                all: async () => {
                  await held;
                  return boundAll();
                },
              });
            },
          });
        },
      } as unknown as D1Database;
      const fast = {
        ...sqlite,
        cacheIdentity: "race-db",
        prepare: sqlite.prepare.bind(sqlite),
        batch: sqlite.batch.bind(sqlite),
      } as unknown as D1Database;
      const stale = hydrateTenantConfiguration(slow, {}, "tenant-a", true);
      await invalidateAuthoritativeConfiguration(fast);
      const fresh = await hydrateTenantConfiguration(fast, {}, "tenant-a", true);
      release();
      await stale;
      expect(await hydrateTenantConfiguration(fast, {}, "tenant-a")).toBe(fresh);
    } finally {
      sqlite.close();
    }
  }, 30_000);
});
