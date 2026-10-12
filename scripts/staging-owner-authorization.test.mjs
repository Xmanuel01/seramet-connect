import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORIZATION_DATABASE_NAME,
  AUTHORIZATION_DATABASE_PROJECT,
  AUTHORIZATION_ENVIRONMENT,
  AUTHORIZATION_MARKER,
  AUTHORIZATION_OPERATION,
  CONSUMPTION_MARKER,
  hasConsumptionRecord,
  validateOwnerAuthorization,
} from "./staging-owner-authorization.mjs";

const repository = "Xmanuel01/seramet-connect";
const owner = "Xmanuel01";
const commit = "5f00fb7de1507528795be9268803a1e52e850a2c";
const createdAt = "2026-10-12T10:00:00.000Z";

function body(overrides = {}) {
  const fields = {
    repository,
    commit,
    environment: AUTHORIZATION_ENVIRONMENT,
    database_project: AUTHORIZATION_DATABASE_PROJECT,
    database_name: AUTHORIZATION_DATABASE_NAME,
    operation: AUTHORIZATION_OPERATION,
    expires_at: "2026-10-12T11:30:00.000Z",
    nonce: "123e4567-e89b-42d3-a456-426614174000",
    ...overrides,
  };
  return [
    AUTHORIZATION_MARKER,
    ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
  ].join("\n");
}

function comment(overrides = {}) {
  return {
    body: body(),
    user: { login: owner },
    author_association: "OWNER",
    issue_url: `https://api.github.com/repos/${repository}/issues/112`,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function validate(candidate) {
  return validateOwnerAuthorization({
    comment: candidate,
    expected: {
      owner,
      repository,
      commit,
      issueUrl: `https://api.github.com/repos/${repository}/issues/112`,
    },
    now: new Date("2026-10-12T10:30:00.000Z"),
  });
}

test("accepts a current unedited owner authorization bound to the exact operation", () => {
  const result = validate(comment());
  assert.equal(result.commit, commit);
  assert.equal(result.operation, AUTHORIZATION_OPERATION);
});

test("rejects altered commit, target, author, edited, expired and consumed authorizations", () => {
  const rejected = [
    comment({ body: body({ commit: "a".repeat(40) }) }),
    comment({ body: body({ database_project: "other-project" }) }),
    comment({ user: { login: "another-user" }, author_association: "COLLABORATOR" }),
    comment({ updated_at: "2026-10-12T10:01:00.000Z" }),
    comment({ body: body({ expires_at: "2026-10-12T10:20:00.000Z" }) }),
    comment({ body: `${body()}\nconsumed_by_run=123` }),
  ];
  for (const candidate of rejected) {
    assert.throws(() => validate(candidate), /Owner authorization rejected/);
  }
});

test("rejects authorization windows longer than two hours", () => {
  assert.throws(
    () => validate(comment({ body: body({ expires_at: "2026-10-12T12:01:00.000Z" }) })),
    /AUTHORIZATION_WINDOW_TOO_LONG/,
  );
});

test("detects a durable consumption record for the exact authorization comment", () => {
  const consumption = {
    body: [
      CONSUMPTION_MARKER,
      "authorization_comment_id=987654",
      "authorization_nonce=123e4567-e89b-42d3-a456-426614174000",
      `commit=${commit}`,
      "run_id=123456",
    ].join("\n"),
  };
  assert.equal(hasConsumptionRecord([consumption], "987654"), true);
  assert.equal(hasConsumptionRecord([consumption], "987655"), false);
});

test("workflow requires and consumes owner authorization before staging credentials", async () => {
  const { readFile } = await import("node:fs/promises");
  const workflow = await readFile(
    new URL("../.github/workflows/staging-migration-27.yml", import.meta.url),
    "utf8",
  );
  const authorizationStep = workflow.indexOf("Verify and consume separate owner authorization");
  const credentialStep = workflow.indexOf("Read-only target, role, permissions");
  assert.match(workflow, /owner_authorization_comment_id:/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /needs: authorize/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /group: seramet-staging/);
  assert.match(workflow, /environment: staging/);
  assert.ok(authorizationStep > 0 && authorizationStep < credentialStep);
});
