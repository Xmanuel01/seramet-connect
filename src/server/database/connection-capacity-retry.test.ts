import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  isConnectionCapacityError,
  PostgresD1Database,
  retryConnectionCapacity,
} from "@/server/database/postgres-database";

const refused = () =>
  Object.assign(new Error('too many connections for role "seramet_runtime"'), { code: "53300" });

describe("connection capacity retry", () => {
  it("recognises the database refusing a connection, and nothing else", () => {
    expect(isConnectionCapacityError(refused())).toBe(true);
    expect(isConnectionCapacityError(Object.assign(new Error("x"), { code: "57P03" }))).toBe(true);
    expect(isConnectionCapacityError(new Error("sorry, too many clients already"))).toBe(true);
    expect(isConnectionCapacityError(Object.assign(new Error("dup"), { code: "23505" }))).toBe(
      false,
    );
    expect(isConnectionCapacityError(new Error("syntax error at or near"))).toBe(false);
  });

  it("asks again after a short wait and gives up after three retries", async () => {
    const waits: number[] = [];
    let attempts = 0;
    await expect(
      retryConnectionCapacity(
        async () => {
          attempts += 1;
          if (attempts < 3) throw refused();
          return "ok";
        },
        async (ms) => void waits.push(ms),
      ),
    ).resolves.toBe("ok");
    expect(attempts).toBe(3);
    expect(waits).toHaveLength(2);

    attempts = 0;
    await expect(
      retryConnectionCapacity(
        async () => {
          attempts += 1;
          throw refused();
        },
        async () => undefined,
      ),
    ).rejects.toThrow(/too many connections/);
    expect(attempts).toBe(4);
  });

  it("never repeats a statement that failed for another reason", async () => {
    let attempts = 0;
    await expect(
      retryConnectionCapacity(async () => {
        attempts += 1;
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }),
    ).rejects.toThrow(/duplicate key/);
    expect(attempts).toBe(1);
  });

  it("retries reads and opening a transaction in the Postgres adapter", async () => {
    let queries = 0;
    let connects = 0;
    const client = {
      query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }),
      release() {},
    };
    const pool = {
      query: async () => {
        queries += 1;
        if (queries === 1) throw refused();
        return { rows: [{ ok: 1 }], rowCount: 1 };
      },
      connect: async () => {
        connects += 1;
        if (connects === 1) throw refused();
        return client;
      },
    } as unknown as Pool;
    const db = new PostgresD1Database(pool);
    expect(await db.prepare("SELECT 1 AS ok").first()).toEqual({ ok: 1 });
    expect(queries).toBe(2);
    await db.batch([db.prepare("UPDATE t SET a=1")]);
    expect(connects).toBe(2);
  });
});
