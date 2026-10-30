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
    expect(second.prepare).not.toHaveBeenCalled();

    invalidateAuthoritativeConfiguration(second.db);
    const third = perRequest();
    expect(await hydrateAuthoritativeConfiguration(third.db)).not.toBe(loaded);
    expect(third.prepare).toHaveBeenCalled();
    sqlite.close();
    // Creating the migrated test database is slow when other suites share the machine.
  }, 30_000);
});
