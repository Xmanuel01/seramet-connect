import { describe, expect, it } from "vitest";
import type { D1Database } from "@/server/database/d1";
import { findOverdueDurableWork } from "@/server/worker-health";

function dbWithOverdue(overdue: boolean, recorded: string[]): D1Database {
  return {
    prepare(sql: string) {
      recorded.push(sql);
      return {
        bind(cutoff: string) {
          recorded.push(cutoff);
          return {
            async first() {
              return overdue ? { overdue: 1 } : null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe("read-only worker readiness", () => {
  const now = Date.parse("2026-09-27T20:00:00.000Z");

  it("stops a release with overdue work, without mutating or enqueueing", async () => {
    const recorded: string[] = [];
    const result = await findOverdueDurableWork(dbWithOverdue(true, recorded), now);
    expect(result).toEqual([expect.objectContaining({ code: "WORKER_BACKLOG_STALE" })]);
    expect(recorded[0]).toContain("LIMIT 1");
    expect(recorded[0]).toContain("FROM worker_jobs");
    expect(recorded[0]).not.toMatch(/UPDATE|DELETE|INSERT/);
    expect(recorded[1]).toBe("2026-09-27T19:30:00.000Z");
  });

  it("allows an empty backlog but never treats it as consumer proof", async () => {
    const result = await findOverdueDurableWork(dbWithOverdue(false, []), now);
    expect(result).toEqual([]);
  });
});
