import assert from "node:assert/strict";
import test from "node:test";
import { compareDatabaseEvidence } from "./verify-staging-backup-restore.mjs";

const evidence = {
  tableCount: 3,
  tableNames: ["branches", "schema_migrations", "tenants"],
  totalRows: "12",
  rowCountSha256: "a".repeat(64),
  migration: { count: 27, maximum: 27 },
  orphans: {
    branches_without_tenant: 0,
    worker_jobs_without_tenant: 0,
    worker_jobs_without_branch: 0,
    setup_imports_without_tenant: 0,
    setup_imports_without_branch: 0,
  },
  schemaObjects: {
    views: 1,
    materialized_views: 0,
    indexes: 8,
    routines: 2,
    triggers: 3,
    constraints: 7,
    sequences: 0,
  },
};

test("accepts an exact restore with intact critical relationships", () => {
  assert.deepEqual(compareDatabaseEvidence(evidence, structuredClone(evidence)), []);
});

test("rejects row, migration, and relationship drift", () => {
  const restored = structuredClone(evidence);
  restored.rowCountSha256 = "b".repeat(64);
  restored.migration.maximum = 26;
  restored.orphans.worker_jobs_without_tenant = 1;
  restored.schemaObjects.indexes = 7;
  assert.deepEqual(compareDatabaseEvidence(evidence, restored), [
    "PUBLIC_ROW_COUNTS_MISMATCH",
    "MIGRATION_VERSION_MISMATCH",
    "RELATIONSHIP_EVIDENCE_MISMATCH",
    "PUBLIC_SCHEMA_OBJECT_MISMATCH",
    "CRITICAL_ORPHANS_PRESENT",
  ]);
});
