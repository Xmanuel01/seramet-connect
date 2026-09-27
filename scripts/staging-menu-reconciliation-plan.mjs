import { createHash } from "node:crypto";

export const STAGING_PROJECT_REF = "vnymbavsbxorwxpebkot";

const fail = (reason) => {
  throw new Error("STAGING_RECONCILIATION_REFUSED: " + reason);
};
const json = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? JSON.parse(value) : value;
};
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
};
const same = (a, b) => JSON.stringify(stable(json(a))) === JSON.stringify(stable(json(b)));
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
const ref = (id) => createHash("md5").update(id).digest("hex").slice(0, 12);
const changedTopLevelKeys = (a, b) => {
  const oldRow = json(a);
  const newRow = json(b);
  return [...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])]
    .filter((key) => !same(oldRow[key] ?? null, newRow[key] ?? null))
    .sort();
};

/**
 * Pure, deliberately incident-specific validation. No table is changed here.
 * The earlier V3 CREATE is the canonical reference, NOT an authorized runnable
 * import: all three staging preview reports explicitly say UNSCANNED_STAGING.
 */
export function buildStagingMenuReconciliationPlan({ imports, rows, jobs, branches, existingCodeCount, appliedAuditCount, schemaVersion }) {
  if (schemaVersion !== 26) fail("Unexpected staging schema; review the new migration first");
  if (imports.length !== 3) fail("Expected exactly three pending menu commits");
  const tenantIds = new Set(imports.map((record) => record.tenant_id));
  if (tenantIds.size !== 1) fail("Commits span multiple tenants");
  const tenantId = imports[0].tenant_id;
  if (branches.length !== 1 || branches[0].tenant_id !== tenantId ||
      branches[0].lifecycle_state !== "CONFIGURING" ||
      Number(branches[0].is_bootstrap) !== 1) {
    fail("Bootstrap branch state changed; reconcile branch setup before retrying");
  }

  const chronological = [...imports].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [legacy, canonical, repeated] = chronological;
  if (legacy.template_version !== 1 || legacy.duplicate_strategy !== "CREATE" ||
      canonical.template_version !== 3 || canonical.duplicate_strategy !== "CREATE" ||
      repeated.template_version !== 3 || repeated.duplicate_strategy !== "SKIP") {
    fail("Import version/order/strategy does not match the verified incident");
  }
  if (legacy.file_checksum === canonical.file_checksum ||
      canonical.file_checksum !== repeated.file_checksum) {
    fail("V1 and V3 file-checksum relationship changed");
  }
  for (const record of chronological) {
    if (record.status !== "COMMITTING" || record.import_kind !== "MENU" ||
        record.verification_status !== "PENDING" || record.committed_at !== null ||
        record.row_count !== 343 || record.valid_count !== 343 ||
        record.warning_count !== 1 || record.error_count !== 0 ||
        record.target_mode !== "SELECTED_BRANCHES" ||
        !record.preview_fingerprint || !record.idempotency_key ||
        json(record.report_json)?.cleanScan?.status !== "UNSCANNED_STAGING") {
      fail("An import's validation, commit or malware-scan state changed");
    }
    if (!same(record.target_branch_ids_json, [branches[0].id]) ||
        record.branch_id !== branches[0].id) {
      fail("Target is not the original single bootstrap branch");
    }
    if (!same(record.target_branch_ids_json, canonical.target_branch_ids_json)) {
      fail("The imports target different branches");
    }
  }
  for (const key of ["column_map_json", "reference_map_json"]) {
    if (!same(canonical[key], repeated[key])) fail("V3 duplicate mapping differs: " + key);
  }
  if (canonical.target_mode !== repeated.target_mode ||
      canonical.catalogue_revision !== repeated.catalogue_revision ||
      canonical.importer_version !== repeated.importer_version) {
    fail("V3 previews are no longer equivalent");
  }
  const withoutScan = (report) => {
    const output = { ...json(report) };
    delete output.cleanScan;
    return output;
  };
  if (!same(withoutScan(canonical.report_json), withoutScan(repeated.report_json))) {
    fail("V3 preview report differs beyond scanner metadata");
  }

  const byImport = new Map(chronological.map((record) => [record.id, []]));
  if (rows.length !== 1029) fail("Expected 343 saved preview rows for each of three imports");
  for (const row of rows) {
    const bucket = byImport.get(row.import_id);
    if (!bucket || row.tenant_id !== tenantId) fail("Unexpected preview row tenant/import");
    if (!["VALID", "WARNING"].includes(row.status) ||
        row.committed_entity_id !== null || row.committed_entity_type !== null) {
      fail("Preview row has already been changed or committed");
    }
    bucket.push(row);
  }
  for (const record of chronological) {
    const bucket = byImport.get(record.id);
    bucket.sort((a, b) => a.row_number - b.row_number);
    if (bucket.length !== 343 ||
        bucket.some((row, index) => row.row_number !== index + 1)) {
      fail("Preview row count or sequence is inconsistent");
    }
  }
  const oldRows = byImport.get(legacy.id);
  const newRows = byImport.get(canonical.id);
  const duplicateRows = byImport.get(repeated.id);
  const allowedOldTemplateDifferences = new Set(["menuSection", "templateVersion", "categoryCode"]);
  const observedDifferences = new Map();
  for (let index = 0; index < 343; index += 1) {
    const oldRow = oldRows[index];
    const newRow = newRows[index];
    const duplicateRow = duplicateRows[index];
    for (const key of ["row_key", "status", "action"]) {
      if (oldRow[key] !== newRow[key] || newRow[key] !== duplicateRow[key]) {
        fail("Preview row identity/status/action differs");
      }
    }
    for (const key of ["normalized_json", "errors_json", "warnings_json", "before_json", "after_json"]) {
      if (!same(newRow[key], duplicateRow[key])) fail("V3 duplicate preview rows differ: " + key);
    }
    for (const key of changedTopLevelKeys(oldRow.normalized_json, newRow.normalized_json)) {
      if (!allowedOldTemplateDifferences.has(key)) {
        fail("Legacy V1 differs in business values outside the known menu metadata fields");
      }
      observedDifferences.set(key, (observedDifferences.get(key) ?? 0) + 1);
    }
  }
  if (observedDifferences.get("menuSection") !== 343 ||
      observedDifferences.get("templateVersion") !== 343 ||
      observedDifferences.get("categoryCode") !== 337) {
    fail("V1/V3 business metadata differences changed");
  }
  if (Number(existingCodeCount) !== 0 || Number(appliedAuditCount) !== 0) {
    fail("Import rows or relevant menu codes were already applied; do not quarantine automatically");
  }

  if (jobs.length !== 3) fail("Expected exactly one queued import job for each preview");
  const jobByImport = new Map();
  for (const job of jobs) {
    const payload = json(job.payload_json);
    const record = chronological.find((item) => item.id === payload.importId);
    if (!record || job.tenant_id !== tenantId || job.job_type !== "SETUP_IMPORT_COMMIT" ||
        jobByImport.has(record.id) || job.status !== "PENDING" ||
        Number(job.attempt_count) !== 0 || job.started_at !== null ||
        job.lease_owner !== null || job.lease_expires_at !== null ||
        payload.commitKey !== "commit:" + record.idempotency_key) {
      fail("Import worker job is missing, altered, leased or has attempted execution");
    }
    jobByImport.set(record.id, job);
  }
  if (jobByImport.size !== 3) fail("An import has no matching pending job");

  const dispositions = [
    { record: legacy, job: jobByImport.get(legacy.id), reason: "SUPERSEDED_V1_TEMPLATE" },
    {
      record: canonical,
      job: jobByImport.get(canonical.id),
      reason: "CANONICAL_V3_REFERENCE_ONLY_REQUIRES_FRESH_MALWARE_SCAN",
    },
    { record: repeated, job: jobByImport.get(repeated.id), reason: "EXACT_V3_DUPLICATE" },
  ];
  const fingerprint = sha256(JSON.stringify(stable({
    schemaVersion,
    tenantId,
    branches,
    imports: chronological,
    rows: rows.map((row) => row).sort((a, b) =>
      a.import_id.localeCompare(b.import_id) || a.row_number - b.row_number,
    ),
    jobs: jobs.sort((a, b) => a.id.localeCompare(b.id)),
    existingCodeCount,
    appliedAuditCount,
    dispositions: dispositions.map((item) => [item.record.id, item.job.id, item.reason]),
  })));

  return {
    tenantId,
    tenantRef: ref(tenantId),
    canonicalRef: ref(canonical.id),
    canonicalId: canonical.id,
    fingerprint,
    dispositions,
    publicSummary: {
      tenant_ref: ref(tenantId),
      reference_only_v3: ref(canonical.id),
      duplicate_v3: ref(repeated.id),
      superseded_v1: ref(legacy.id),
      preserved_preview_rows: rows.length,
      worker_jobs_to_terminally_quarantine: 3,
      importer_replay_allowed: false,
      required_next_step: "Configure real scanner and correct branches; create a fresh scanned V3 preview",
      plan_sha256: fingerprint,
    },
  };
}
