import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const policy = JSON.parse(
  readFileSync(new URL("../certification/main-branch-protection.json", import.meta.url), "utf8"),
);

test("automatic release input requires current core checks from GitHub Actions", () => {
  assert.equal(policy.required_status_checks.strict, true);
  assert.deepEqual(policy.required_status_checks.checks, [
    { context: "validate", app_id: 15368 },
    { context: "postgres-crm", app_id: 15368 },
    { context: "postgres-recovery-fixture", app_id: 15368 },
  ]);
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const { context } of policy.required_status_checks.checks) {
    assert.ok(
      ci.includes(`\n  ${context}:`),
      `${context} must remain an existing mandatory CI job`,
    );
  }
});

test("approval cannot be reused after a new push or bypassed by administrators", () => {
  assert.equal(policy.enforce_admins, true);
  assert.equal(policy.required_pull_request_reviews.required_approving_review_count, 1);
  assert.equal(policy.required_pull_request_reviews.dismiss_stale_reviews, true);
  assert.equal(policy.required_pull_request_reviews.require_last_push_approval, true);
  assert.equal(policy.required_conversation_resolution, true);
  assert.equal(policy.allow_force_pushes, false);
  assert.equal(policy.allow_deletions, false);
});
