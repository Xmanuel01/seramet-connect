import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateAuthoritativeConfiguration,
  invalidateAuthoritativeConfiguration,
} from "@/server/database/authoritative-configuration";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { createMigratedTestDatabase } from "@/server/database/sqlite-test-adapter";
import type { D1Database } from "@/server/database/d1";

afterEach(() => setConfigurationRepositoryForTests(undefined));

describe("configuration cache across per-request database pools", () => {
  it("reuses configuration for a new pool to the same database, until refreshed", async () => {
    const sqlite = createMigratedTestDatabase();
    const perRequest = () => {
      const prepare = vi.fn((query: string) => sqlite.prepare(query));
      const db = { ...sqlite, prepare, batch: sqlite.batch.bind(sqlite), cacheIdentity: "same-db" };
      return { db: db as unknown as D1Database, prepare };
    };
    const first = perRequest();
    const loaded = await hydrateAuthoritativeConfiguration(first.db, {}, true);
    expect(first.prepare).toHaveBeenCalled();

    const second = perRequest();
    expect(await hydrateAuthoritativeConfiguration(second.db)).toBe(loaded);
    // Only the one-row revision check, not the twenty configuration queries.
    expect(second.prepare).toHaveBeenCalledTimes(1);
    expect(second.prepare.mock.calls[0]?.[0]).toContain("configuration_revisions");

    await invalidateAuthoritativeConfiguration(second.db);
    const third = perRequest();
    expect(await hydrateAuthoritativeConfiguration(third.db)).not.toBe(loaded);
    expect(third.prepare).toHaveBeenCalled();
    sqlite.close();
    // Creating the migrated test database is slow when other suites share the machine.
  }, 30_000);

  it("keeps a copy while the shared revision is unchanged and reloads once another server bumps it", async () => {
    const sqlite = createMigratedTestDatabase();
    const now = vi.spyOn(Date, "now");
    try {
      const server = (identity: string) => {
        const prepare = vi.fn((query: string) => sqlite.prepare(query));
        return {
          db: { ...sqlite, prepare, batch: sqlite.batch.bind(sqlite), cacheIdentity: identity },
          prepare,
        } as { db: D1Database; prepare: typeof prepare };
      };
      now.mockReturnValue(1_000_000);
      const a = server("server-a");
      const loaded = await hydrateAuthoritativeConfiguration(a.db);
      // A minute later the copy is still current: the revision hasn't moved.
      now.mockReturnValue(1_060_000);
      const again = server("server-a");
      expect(await hydrateAuthoritativeConfiguration(again.db)).toBe(loaded);
      expect(again.prepare).toHaveBeenCalledTimes(1);
      // Another server records a change; this one reloads on its next request.
      await invalidateAuthoritativeConfiguration(server("server-b").db);
      const after = server("server-a");
      expect(await hydrateAuthoritativeConfiguration(after.db)).not.toBe(loaded);
      expect(after.prepare.mock.calls.length).toBeGreaterThan(1);
      // Even with no change, a copy is refreshed after five minutes.
      const refreshed = await hydrateAuthoritativeConfiguration(server("server-a").db);
      now.mockReturnValue(1_060_000 + 5 * 60_000 + 1);
      expect(await hydrateAuthoritativeConfiguration(server("server-a").db)).not.toBe(refreshed);
    } finally {
      now.mockRestore();
      sqlite.close();
    }
  }, 30_000);

  it("does not let a load that started before a change replace the newer configuration", async () => {
    const sqlite = createMigratedTestDatabase();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = {
      ...sqlite,
      cacheIdentity: "race-db",
      batch: sqlite.batch.bind(sqlite),
      prepare: (query: string) => {
        const statement = sqlite.prepare(query);
        const all = statement.all.bind(statement);
        return Object.assign(statement, {
          all: async (...args: unknown[]) => {
            await held;
            return (all as (...a: unknown[]) => unknown)(...args);
          },
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
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
    const stale = hydrateAuthoritativeConfiguration(slow, {}, true);
    await invalidateAuthoritativeConfiguration(fast);
    const fresh = await hydrateAuthoritativeConfiguration(fast, {}, true);
    release();
    await stale;
    expect(await hydrateAuthoritativeConfiguration(fast)).toBe(fresh);
    sqlite.close();
  }, 30_000);
});
