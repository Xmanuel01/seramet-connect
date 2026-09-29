import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStagingMenuReconciliationPlan } from "./staging-menu-reconciliation-plan.mjs";

function incident() {
  const tenant = "test-tenant";
  const branch = "test-bootstrap-branch";
  const imports = [
    {
      tenant_id: tenant,
      id: "legacy",
      branch_id: branch,
      import_kind: "MENU",
      status: "COMMITTING",
      duplicate_strategy: "CREATE",
      template_version: 1,
      file_checksum: "legacy-file",
      preview_fingerprint: "preview-legacy",
      idempotency_key: "legacy-key",
      importer_version: "menu-import-v3",
      target_mode: "SELECTED_BRANCHES",
      target_branch_ids_json: JSON.stringify([branch]),
      column_map_json: "{}",
      reference_map_json: "{}",
      catalogue_revision: "v1",
      report_json: JSON.stringify({ cleanScan: { status: "UNSCANNED_STAGING" } }),
      row_count: 343,
      valid_count: 343,
      warning_count: 1,
      error_count: 0,
      verification_status: "PENDING",
      committed_at: null,
      created_at: "2026-09-27T05:00:00Z",
    },
    {
      tenant_id: tenant,
      id: "canonical",
      branch_id: branch,
      import_kind: "MENU",
      status: "COMMITTING",
      duplicate_strategy: "CREATE",
      template_version: 3,
      file_checksum: "identical-v3",
      preview_fingerprint: "preview-canonical",
      idempotency_key: "canonical-key",
      importer_version: "menu-import-v3",
      target_mode: "SELECTED_BRANCHES",
      target_branch_ids_json: JSON.stringify([branch]),
      column_map_json: "{}",
      reference_map_json: "{}",
      catalogue_revision: "v3",
      report_json: JSON.stringify({
        extension: ".csv",
        cleanScan: { status: "UNSCANNED_STAGING", reference: "earlier" },
      }),
      row_count: 343,
      valid_count: 343,
      warning_count: 1,
      error_count: 0,
      verification_status: "PENDING",
      committed_at: null,
      created_at: "2026-09-27T08:00:00Z",
    },
    {
      tenant_id: tenant,
      id: "repeated",
      branch_id: branch,
      import_kind: "MENU",
      status: "COMMITTING",
      duplicate_strategy: "SKIP",
      template_version: 3,
      file_checksum: "identical-v3",
      preview_fingerprint: "preview-repeated",
      idempotency_key: "repeated-key",
      importer_version: "menu-import-v3",
      target_mode: "SELECTED_BRANCHES",
      target_branch_ids_json: JSON.stringify([branch]),
      column_map_json: "{}",
      reference_map_json: "{}",
      catalogue_revision: "v3",
      report_json: JSON.stringify({
        extension: ".csv",
        cleanScan: { status: "UNSCANNED_STAGING", reference: "later" },
      }),
      row_count: 343,
      valid_count: 343,
      warning_count: 1,
      error_count: 0,
      verification_status: "PENDING",
      committed_at: null,
      created_at: "2026-09-27T09:00:00Z",
    },
  ];
  const rows = [];
  for (const record of imports) {
    for (let index = 1; index <= 343; index += 1) {
      const legacy = record.id === "legacy";
      const normalized = {
        code: "M" + index,
        sellingPriceMinor: 10000,
        menuSection: legacy ? "OLD" : "NEW",
        templateVersion: legacy ? 1 : 3,
        categoryCode: index <= 337 ? (legacy ? "OLD_CATEGORY" : "NEW_CATEGORY") : "SHARED",
      };
      rows.push({
        tenant_id: tenant,
        import_id: record.id,
        row_number: index,
        row_key: "M" + index,
        status: index === 1 ? "WARNING" : "VALID",
        action: "CREATE",
        normalized_json: JSON.stringify(normalized),
        errors_json: "[]",
        warnings_json: index === 1 ? '["VALID_WARNING"]' : "[]",
        before_json: "{}",
        after_json: JSON.stringify(normalized),
        committed_entity_id: null,
        committed_entity_type: null,
      });
    }
  }
  const jobs = imports.map((record) => ({
    tenant_id: tenant,
    id: "job-" + record.id,
    job_type: "SETUP_IMPORT_COMMIT",
    status: "PENDING",
    attempt_count: 0,
    started_at: null,
    lease_owner: null,
    lease_expires_at: null,
    payload_json: JSON.stringify({
      importId: record.id,
      commitKey: "commit:" + record.idempotency_key,
    }),
  }));
  return {
    imports,
    rows,
    jobs,
    branches: [{ tenant_id: tenant, id: branch, lifecycle_state: "CONFIGURING", is_bootstrap: 1 }],
    schemaVersion: 26,
    existingCodeCount: 0,
    appliedAuditCount: 0,
  };
}

test("identifies the exact duplicate, superseded V1 and unscanned canonical V3", () => {
  const plan = buildStagingMenuReconciliationPlan(incident());
  assert.equal(plan.canonicalId, "canonical");
  assert.deepEqual(
    plan.dispositions.map((item) => item.reason),
    [
      "SUPERSEDED_V1_TEMPLATE",
      "CANONICAL_V3_REFERENCE_ONLY_REQUIRES_FRESH_VALIDATION",
      "EXACT_V3_DUPLICATE",
    ],
  );
  assert.equal(plan.publicSummary.preserved_preview_rows, 1029);
  assert.equal(plan.publicSummary.importer_replay_allowed, false);
  assert.match(plan.fingerprint, /^[0-9a-f]{64}$/);
});

test("different V3 normalized prices cannot be misidentified as duplicates", () => {
  const state = incident();
  const repeated = state.rows.find((row) => row.import_id === "repeated");
  repeated.normalized_json = JSON.stringify({
    ...JSON.parse(repeated.normalized_json),
    sellingPriceMinor: 999999,
  });
  assert.throws(
    () => buildStagingMenuReconciliationPlan(state),
    /V3 duplicate preview rows differ/,
  );
});

test("material price differences between V1 and V3 require manual review", () => {
  const state = incident();
  const legacy = state.rows.find((row) => row.import_id === "legacy");
  legacy.normalized_json = JSON.stringify({
    ...JSON.parse(legacy.normalized_json),
    sellingPriceMinor: 199999,
  });
  assert.throws(
    () => buildStagingMenuReconciliationPlan(state),
    /Legacy V1 differs in business values/,
  );
});

test("started or leased queue work cannot be quarantined as untouched", () => {
  const state = incident();
  state.jobs[2].status = "RUNNING";
  state.jobs[2].attempt_count = 1;
  assert.throws(
    () => buildStagingMenuReconciliationPlan(state),
    /job is missing, altered, leased or has attempted execution/,
  );
});

test("existing catalogue effects cannot be erased by a quarantine", () => {
  const state = incident();
  state.existingCodeCount = 1;
  assert.throws(() => buildStagingMenuReconciliationPlan(state), /already applied/);
});

test("unverified and changed scanner metadata must block automatic recovery", () => {
  const state = incident();
  state.imports[1].report_json = JSON.stringify({ cleanScan: { status: "CLEAN" } });
  assert.throws(() => buildStagingMenuReconciliationPlan(state), /malware-scan state changed/);
});

test("different target branches must be reviewed separately", () => {
  const state = incident();
  state.imports[2].target_branch_ids_json = '["a-different-branch"]';
  assert.throws(
    () => buildStagingMenuReconciliationPlan(state),
    /not the original single bootstrap branch/,
  );
});

test("a previous import application or audit quarantine blocks replay", () => {
  const state = incident();
  state.appliedAuditCount = 1;
  assert.throws(() => buildStagingMenuReconciliationPlan(state), /already applied/);
});

test("changes to schema or row counts require a new reviewed plan", () => {
  const state = incident();
  state.schemaVersion = 27;
  assert.throws(() => buildStagingMenuReconciliationPlan(state), /Unexpected staging schema/);
  const state2 = incident();
  state2.rows.pop();
  assert.throws(() => buildStagingMenuReconciliationPlan(state2), /Expected 343 saved/);
});
