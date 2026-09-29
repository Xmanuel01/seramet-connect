import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectStagingBacklog } from "./inspect-staging-backlog.mjs";

test("backlog inspection is exclusively SELECT inside a rolled-back read-only transaction", async () => {
  const statements = [];
  const outputs = [
    [{ import_kind: "MENU", status: "COMMITTING", count: 3 }],
    [{ job_type: "SETUP_IMPORT_COMMIT", status: "PENDING", count: 3 }],
    [{ count: 1 }],
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
  assert.equal(statements[0], "BEGIN READ ONLY");
  assert.equal(statements[statements.length - 1], "ROLLBACK");
  assert.ok(statements.slice(1, -1).every((sql) => /^\s*SELECT/i.test(sql)));
});

test("an empty backlog does not imply that a real queue consumer was certified", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("FROM setup_imports") && sql.includes("HAVING"))
        return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
  };
  const result = await inspectStagingBacklog(db);
  assert.equal(result.overlappingCommittingMenuFiles, 0);
});
