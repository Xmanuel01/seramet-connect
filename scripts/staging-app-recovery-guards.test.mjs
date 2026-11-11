import test from "node:test";
import assert from "node:assert/strict";
import {
  INCIDENT,
  auditDigest,
  assertConnectionTargets,
  assertStagingTarget,
  assertCounts,
  assertMatchingRecoveryPlans,
  assertOperatorApproval,
} from "./staging-app-recovery-guards.mjs";

const stage =
  "postgresql://postgres.vnymbavsbxorwxpebkot@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C%3A%2Fca.crt";
const local = "postgresql://postgres:p%40ss@127.0.0.1:5432/seramet_public_restore_20260928";
const operator = "d8fb62a3-97bb-457d-8a1c-f37b203c3048";
const plan = {
  fingerprint: INCIDENT.approvedPlanSha256,
  tenantId: INCIDENT.tenantId,
  tenantRef: INCIDENT.tenantRef,
  canonicalRef: INCIDENT.canonicalRef,
  dispositions: INCIDENT.ids.map((id) => ({ record: { id, created_by: operator } })),
};

test("connection restrictions accept exact staging project and isolated restored local DB", () => {
  assert.doesNotThrow(() => assertConnectionTargets(stage, local));
  assert.doesNotThrow(() => assertStagingTarget(stage));
});
test("refuse any staging hostname that merely contains the project reference", () => {
  const spoof = stage.replace(
    "aws-1-eu-west-1.pooler.supabase.com",
    "vnymbavsbxorwxpebkot.attacker.test",
  );
  assert.throws(() => assertStagingTarget(spoof));
});
test("refuse weakened TLS, wrong project or missing CA", () => {
  assert.throws(() => assertStagingTarget(stage.replace("verify-full", "require")));
  assert.throws(() => assertStagingTarget(stage.replace("&sslrootcert=C%3A%2Fca.crt", "")));
  assert.throws(() => assertStagingTarget(stage.replace(INCIDENT.projectRef, "production")));
});
test("refuse remote destination in place of isolated localhost restoration", () => {
  assert.throws(() => assertConnectionTargets(stage, local.replace("127.0.0.1", "some.remote")));
  assert.throws(() =>
    assertConnectionTargets(stage, local.replace(INCIDENT.localDatabase, "postgres")),
  );
  assert.throws(() => assertConnectionTargets(stage, local.replace("p%40ss@", "")));
});
test("expected public counts are exact rather than only lower bounds", () => {
  assert.doesNotThrow(() => assertCounts(INCIDENT.publicCounts, "test"));
  assert.throws(() => assertCounts({ ...INCIDENT.publicCounts, previewRows: 3089 }, "test"));
  assert.throws(() => assertCounts({ ...INCIDENT.publicCounts, menuItems: 9 }, "test"));
});
test("local restored snapshot must match the immutable approved staging plan", () => {
  assert.doesNotThrow(() => assertMatchingRecoveryPlans(plan, structuredClone(plan)));
  assert.throws(() => assertMatchingRecoveryPlans(plan, { ...plan, fingerprint: "other" }));
  assert.throws(() =>
    assertMatchingRecoveryPlans(plan, { ...plan, dispositions: plan.dispositions.slice(1) }),
  );
});
test("operator approval is explicit and evidence-bound", () => {
  const approved = {
    SERAMET_ENVIRONMENT: "staging",
    SERAMET_APP_RECOVERY_APPROVAL: "APPROVE_THREE_STAGING_IMPORTS_ONLY",
    SERAMET_APP_RECOVERY_QUEUE_FROZEN: "true",
    SERAMET_APP_RECOVERY_PLAN_SHA256: plan.fingerprint,
    SERAMET_APP_RECOVERY_EVIDENCE_SHA256: auditDigest(plan),
    SERAMET_APP_RECOVERY_OPERATOR_ID: operator,
  };
  assert.match(auditDigest(plan), /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertOperatorApproval(approved, plan));
  assert.throws(() =>
    assertOperatorApproval({ ...approved, SERAMET_APP_RECOVERY_QUEUE_FROZEN: "false" }, plan),
  );
  assert.throws(() =>
    assertOperatorApproval({ ...approved, SERAMET_APP_RECOVERY_EVIDENCE_SHA256: "x" }, plan),
  );
  assert.throws(() =>
    assertOperatorApproval({ ...approved, SERAMET_APP_RECOVERY_OPERATOR_ID: "someone-else" }, plan),
  );
});
