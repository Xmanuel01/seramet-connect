import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStagingBacklogReady, inspectStagingBacklog } from "./inspect-staging-backlog.mjs";

test("backlog inspection is exclusively SELECT inside a rolled-back read-only transaction", async () => {
  const statements = [];
  const outputs = [
    [{ import_kind: "MENU", status: "COMMITTING", count: 3 }],
    [{ job_type: "SETUP_IMPORT_COMMIT", status: "PENDING", count: 3 }],
    [{ count: 1 }],
    [{ expired_leases: 419, missing_leases: 0 }],
  ];
  let read = 0;
  const db = {
    async query(sql) {
      statements.push(sql);
      if (/^\s*SELECT/i.test(sql)) return { rows: outputs[read++] };
      return { rows: [] };
    },
  };
  const result = await inspectStagingBacklog(db);
  assert.equal(result.overlappingCommittingMenuFiles, 1);
  assert.deepEqual(result.pendingJobStatusCounts, outputs[1]);
  assert.equal(result.expiredWorkerLeases, 419);
  assert.equal(result.missingWorkerLeases, 0);
  assert.equal(statements[0], "BEGIN READ ONLY");
  assert.equal(statements[statements.length - 1], "ROLLBACK");
  assert.ok(statements.slice(1, -1).every((sql) => /^\s*SELECT/i.test(sql)));
});

test("an empty backlog does not imply that a real queue consumer was certified", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("FROM setup_imports") && sql.includes("HAVING"))
        return { rows: [{ count: 0 }] };
      if (sql.includes("expired_leases"))
        return { rows: [{ expired_leases: 0, missing_leases: 0 }] };
      return { rows: [] };
    },
  };
  const result = await inspectStagingBacklog(db);
  assert.equal(result.overlappingCommittingMenuFiles, 0);
  assert.doesNotThrow(() => assertStagingBacklogReady(result));
});

test("stale or unleased running jobs block release without being replayed", () => {
  const ready = {
    overlappingCommittingMenuFiles: 0,
    expiredWorkerLeases: 0,
    missingWorkerLeases: 0,
  };
  assert.doesNotThrow(() => assertStagingBacklogReady(ready));
  for (const overrides of [{ expiredWorkerLeases: 419 }, { missingWorkerLeases: 1 }]) {
    assert.throws(
      () => assertStagingBacklogReady({ ...ready, ...overrides }),
      /Abandoned worker leases.*reviewed recovery/,
    );
  }
  assert.throws(
    () => assertStagingBacklogReady({ ...ready, overlappingCommittingMenuFiles: 1 }),
    /Overlapping COMMITTING/,
  );
});

test("lease evidence must be complete and valid before release", () => {
  for (const value of [undefined, null, -1, NaN, 0.5, "0"]) {
    assert.throws(
      () =>
        assertStagingBacklogReady({
          overlappingCommittingMenuFiles: 0,
          expiredWorkerLeases: value,
          missingWorkerLeases: 0,
        }),
      /Incomplete staging backlog evidence/,
    );
  }
});

test("query errors still roll back and never produce clean backlog evidence", async () => {
  const statements = [];
  const db = {
    async query(sql) {
      statements.push(sql);
      if (/^\s*SELECT/i.test(sql)) throw new Error("disposable database outage");
      return { rows: [] };
    },
  };
  await assert.rejects(inspectStagingBacklog(db), /disposable database outage/);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.ok(statements.slice(1, -1).every((sql) => /^\s*SELECT/i.test(sql)));
});
