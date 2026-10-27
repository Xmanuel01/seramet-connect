import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresD1Database } from "./postgres-database";
import { publicError } from "@/server/errors";

function fixture(failure?: Error & { code?: string }) {
  const query = vi.fn(async (sql: string) => {
    if (sql === "SELECT 1 AS value" && failure) throw failure;
    return { rows: [{ value: 1 }], rowCount: 1 };
  });
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) };
  const db = new PostgresD1Database(pool as unknown as Pool);
  return { db, query, release };
}

describe("PostgreSQL serializable batch contract", () => {
  it("commits the complete batch at serializable isolation and releases its connection", async () => {
    const { db, query, release } = fixture();
    const result = await db.batch([db.prepare("SELECT 1 AS value")]);
    expect(result[0]?.success).toBe(true);
    expect(query.mock.calls.map((c) => c[0])).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SELECT 1 AS value",
      "COMMIT",
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(["40001", "40P01"])(
    "rolls back %s and requests a fresh operation instead of replaying stale parameters",
    async (code) => {
      const { db, query, release } = fixture(
        Object.assign(new Error("private SQL details"), { code }),
      );
      const error = await db.batch([db.prepare("SELECT 1 AS value")]).catch((e) => e);
      expect(publicError(error, "test")).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
      expect(publicError(error, "test").body.message).not.toContain("private SQL");
      expect(query.mock.calls.map((c) => c[0])).toEqual([
        "BEGIN ISOLATION LEVEL SERIALIZABLE",
        "SELECT 1 AS value",
        "ROLLBACK",
      ]);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves other database failures and never commits a partial batch", async () => {
    const original = Object.assign(new Error("constraint rejected"), { code: "23503" });
    const { db, query, release } = fixture(original);
    await expect(db.batch([db.prepare("SELECT 1 AS value")])).rejects.toBe(original);
    expect(query.mock.calls.map((c) => c[0])).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SELECT 1 AS value",
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
