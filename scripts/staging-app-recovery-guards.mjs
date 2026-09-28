import { createHash } from "node:crypto";

export const INCIDENT = Object.freeze({
  projectRef: "vnymbavsbxorwxpebkot",
  tenantId: "64d00226-45e6-48eb-b43f-972061e7abac",
  ids: Object.freeze([
    "53dc7989-e0c9-4b01-9f47-119b6bbde582",
    "6422bec8-d19f-405c-af8d-9f280080e978",
    "74950938-5153-4903-817b-830e24178aa2",
  ]),
  archiveSha256: "95e5c05d8fd0d421dc5eba7ceca49e914e72d46a62cfecac7563677512bb1b43",
  archiveSize: 1705540,
  approvedPlanSha256: "a7fb93005c0176decfcb3e94152d39a96ae17da35ba6bcff017ad8a7059c3481",
  tenantRef: "bf9879539d6c",
  canonicalRef: "c6b5a444b49a",
  publicCounts: Object.freeze({ menuImports: 10, previewRows: 3088, importJobs: 3, menuItems: 8 }),
  localDatabase: "seramet_public_restore_20260928",
});

export const auditDigest = (plan) =>
  createHash("sha256")
    .update(JSON.stringify({
      scope: "THREE_STAGING_MENU_IMPORTS_APP_ONLY",
      project: INCIDENT.projectRef,
      archiveSha256: INCIDENT.archiveSha256,
      archiveSize: INCIDENT.archiveSize,
      localDatabase: INCIDENT.localDatabase,
      applicationCounts: INCIDENT.publicCounts,
      planSha256: plan.fingerprint,
      tenantRef: plan.tenantRef,
      canonicalRef: plan.canonicalRef,
    }))
    .digest("hex");

export function assertStagingTarget(stagingUrl) {
  const stage = new URL(stagingUrl);
  if (
    !["postgres:", "postgresql:"].includes(stage.protocol) ||
    !["aws-1-eu-west-1.pooler.supabase.com", "db.vnymbavsbxorwxpebkot.supabase.co"].includes(stage.hostname) ||
    decodeURIComponent(stage.username) !== "postgres." + INCIDENT.projectRef ||
    (stage.port || "5432") !== "5432" ||
    stage.pathname !== "/postgres" ||
    stage.searchParams.get("sslmode") !== "verify-full" ||
    !stage.searchParams.get("sslrootcert")
  ) {
    throw new Error("Staging connection must match the exact project with verify-full and a CA file");
  }
}

export function assertConnectionTargets(stagingUrl, localUrl) {
  assertStagingTarget(stagingUrl);
  const local = new URL(localUrl);
  if (
    !["postgres:", "postgresql:"].includes(local.protocol) ||
    local.hostname !== "127.0.0.1" ||
    (local.port || "5432") !== "5432" ||
    local.pathname !== "/" + INCIDENT.localDatabase ||
    decodeURIComponent(local.username) !== "postgres" ||
    !local.password
  ) {
    throw new Error("Restore connection must target the named, isolated localhost database");
  }
}

export function assertCounts(counts, label) {
  for (const [field, expected] of Object.entries(INCIDENT.publicCounts)) {
    if (Number(counts[field]) !== expected) {
      throw new Error(label + ": application count changed: " + field);
    }
  }
}

export function assertMatchingRecoveryPlans(local, staging) {
  if (
    local.fingerprint !== staging.fingerprint ||
    staging.fingerprint !== INCIDENT.approvedPlanSha256 ||
    local.tenantId !== INCIDENT.tenantId ||
    staging.tenantId !== INCIDENT.tenantId ||
    local.tenantRef !== INCIDENT.tenantRef ||
    staging.tenantRef !== INCIDENT.tenantRef ||
    local.canonicalRef !== INCIDENT.canonicalRef ||
    staging.canonicalRef !== INCIDENT.canonicalRef
  ) {
    throw new Error("Local application restore and current staging are not the approved identical incident snapshot");
  }
  const observed = staging.dispositions.map(({record}) => record.id);
  if (observed.length !== 3 || observed.some((id, i) => id !== INCIDENT.ids[i])) {
    throw new Error("Unexpected staging incident import identities or ordering");
  }
}

export function assertOperatorApproval(env, plan) {
  if (
    env.SERAMET_ENVIRONMENT !== "staging" ||
    env.SERAMET_APP_RECOVERY_APPROVAL !== "APPROVE_THREE_STAGING_IMPORTS_ONLY" ||
    env.SERAMET_APP_RECOVERY_QUEUE_FROZEN !== "true" ||
    env.SERAMET_APP_RECOVERY_PLAN_SHA256 !== plan.fingerprint ||
    env.SERAMET_APP_RECOVERY_EVIDENCE_SHA256 !== auditDigest(plan) ||
    env.SERAMET_APP_RECOVERY_OPERATOR_ID !== plan.dispositions[0].record.created_by ||
    !plan.dispositions.every(({record}) => record.created_by === env.SERAMET_APP_RECOVERY_OPERATOR_ID)
  ) {
    throw new Error("Missing exact incident approval, owner identity, evidence digest, or Queue/Cron freeze acknowledgment");
  }
}
