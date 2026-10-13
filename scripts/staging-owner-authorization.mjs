import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const AUTHORIZATION_MARKER = "SERAMET_STAGING_REMEDIATION_AUTHORIZATION_V1";
export const CONSUMPTION_MARKER = "SERAMET_STAGING_REMEDIATION_AUTHORIZATION_CONSUMED_V1";
export const AUTHORIZATION_OPERATION = "migration-27-and-security-lockdown";
export const AUTHORIZATION_ENVIRONMENT = "staging";
export const AUTHORIZATION_DATABASE_PROJECT = "vnymbavsbxorwxpebkot";
export const AUTHORIZATION_DATABASE_NAME = "postgres";
export const AUTHORIZATION_PR_NUMBER = 112;
export const AUTHORIZATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const authorizationKeys = new Set([
  "repository",
  "commit",
  "environment",
  "database_project",
  "database_name",
  "operation",
  "expires_at",
  "nonce",
]);

function reject(code) {
  const error = new Error(`Owner authorization rejected: ${code}`);
  error.safeCode = code;
  throw error;
}

function requireCondition(condition, code) {
  if (!condition) reject(code);
}

export function parseAuthorizationBody(body) {
  requireCondition(typeof body === "string", "COMMENT_BODY_MISSING");
  const lines = body.replaceAll("\r\n", "\n").trim().split("\n");
  requireCondition(lines.shift() === AUTHORIZATION_MARKER, "COMMENT_MARKER_MISMATCH");
  requireCondition(!lines.some((line) => line.startsWith("consumed_")), "COMMENT_ALREADY_CONSUMED");

  const fields = {};
  for (const line of lines) {
    const separator = line.indexOf("=");
    requireCondition(separator > 0, "COMMENT_FIELD_MALFORMED");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    requireCondition(authorizationKeys.has(key), "COMMENT_FIELD_UNEXPECTED");
    requireCondition(fields[key] === undefined, "COMMENT_FIELD_DUPLICATED");
    requireCondition(value.length > 0, "COMMENT_FIELD_EMPTY");
    fields[key] = value;
  }
  requireCondition(
    authorizationKeys.size === Object.keys(fields).length &&
      [...authorizationKeys].every((key) => fields[key] !== undefined),
    "COMMENT_FIELDS_INCOMPLETE",
  );
  return fields;
}

export function validateOwnerAuthorization({ comment, expected, now = new Date() }) {
  requireCondition(comment && typeof comment === "object", "COMMENT_RESPONSE_INVALID");
  requireCondition(comment.user?.login === expected.owner, "COMMENT_AUTHOR_MISMATCH");
  requireCondition(comment.author_association === "OWNER", "COMMENT_AUTHOR_NOT_OWNER");
  requireCondition(comment.issue_url === expected.issueUrl, "COMMENT_NOT_ON_AUTHORIZATION_PR");
  requireCondition(comment.created_at === comment.updated_at, "EDITED_COMMENT_NOT_ACCEPTED");

  const fields = parseAuthorizationBody(comment.body);
  requireCondition(fields.repository === expected.repository, "REPOSITORY_MISMATCH");
  requireCondition(fields.commit === expected.commit, "COMMIT_MISMATCH");
  requireCondition(fields.environment === AUTHORIZATION_ENVIRONMENT, "ENVIRONMENT_MISMATCH");
  requireCondition(
    fields.database_project === AUTHORIZATION_DATABASE_PROJECT,
    "DATABASE_PROJECT_MISMATCH",
  );
  requireCondition(fields.database_name === AUTHORIZATION_DATABASE_NAME, "DATABASE_NAME_MISMATCH");
  requireCondition(fields.operation === AUTHORIZATION_OPERATION, "OPERATION_MISMATCH");
  requireCondition(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.nonce),
    "NONCE_INVALID",
  );

  const createdAt = Date.parse(comment.created_at);
  const expiresAt = Date.parse(fields.expires_at);
  const nowMs = now.getTime();
  requireCondition(Number.isFinite(createdAt) && Number.isFinite(expiresAt), "TIMESTAMP_INVALID");
  requireCondition(createdAt <= nowMs && expiresAt > nowMs, "AUTHORIZATION_NOT_CURRENT");
  requireCondition(
    expiresAt - createdAt <= AUTHORIZATION_MAX_AGE_MS,
    "AUTHORIZATION_WINDOW_TOO_LONG",
  );
  requireCondition(nowMs - createdAt <= AUTHORIZATION_MAX_AGE_MS, "AUTHORIZATION_TOO_OLD");

  return fields;
}

export function hasConsumptionRecord(comments, commentId) {
  const prefix = `${CONSUMPTION_MARKER}\nauthorization_comment_id=${commentId}\n`;
  return comments.some((comment) =>
    comment && typeof comment.body === "string" ? comment.body.startsWith(prefix) : false,
  );
}

export async function githubRequest(path, token, options = {}, request = fetch) {
  const response = await request(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!response.ok) {
    // Paths are constructed from validated repository/comment identifiers;
    // never include tokens, response bodies or authorization comment contents.
    console.error(`GitHub authorization request failed: ${options.method ?? "GET"} ${path}`);
    reject(`GITHUB_API_${response.status}`);
  }
  return response.json();
}

function requiredEnvironment(name) {
  const value = process.env[name];
  requireCondition(Boolean(value), `${name}_MISSING`);
  return value;
}

async function main() {
  try {
    const token = requiredEnvironment("GITHUB_TOKEN");
    const repository = requiredEnvironment("GITHUB_REPOSITORY");
    const owner = requiredEnvironment("SERAMET_OWNER_LOGIN");
    const actor = requiredEnvironment("SERAMET_DISPATCH_ACTOR");
    const commit = requiredEnvironment("SERAMET_APPROVED_SHA");
    const commentId = requiredEnvironment("SERAMET_OWNER_AUTH_COMMENT_ID");
    const runId = requiredEnvironment("GITHUB_RUN_ID");
    requireCondition(actor === owner, "DISPATCH_ACTOR_NOT_OWNER");
    requireCondition(/^[0-9]+$/.test(commentId), "COMMENT_ID_INVALID");
    requireCondition(/^[0-9a-f]{40}$/.test(commit), "COMMIT_SHA_INVALID");

    const apiPath = `/repos/${repository}/issues/comments/${commentId}`;
    const comment = await githubRequest(apiPath, token);
    const auditComments = await githubRequest(
      `/repos/${repository}/issues/${AUTHORIZATION_PR_NUMBER}/comments?per_page=100`,
      token,
    );
    requireCondition(Array.isArray(auditComments), "COMMENT_AUDIT_RESPONSE_INVALID");
    requireCondition(auditComments.length < 100, "COMMENT_AUDIT_SET_TOO_LARGE");
    requireCondition(
      !hasConsumptionRecord(auditComments, commentId),
      "COMMENT_AUTHORIZATION_ALREADY_CONSUMED",
    );
    const fields = validateOwnerAuthorization({
      comment,
      expected: {
        owner,
        repository,
        commit,
        issueUrl: `https://api.github.com/repos/${repository}/issues/${AUTHORIZATION_PR_NUMBER}`,
      },
    });

    const consumedAt = new Date().toISOString();
    await githubRequest(`/repos/${repository}/issues/${AUTHORIZATION_PR_NUMBER}/comments`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: [
          CONSUMPTION_MARKER,
          `authorization_comment_id=${commentId}`,
          `authorization_nonce=${fields.nonce}`,
          `commit=${fields.commit}`,
          `run_id=${runId}`,
          `consumed_at=${consumedAt}`,
        ].join("\n"),
      }),
    });

    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        [
          "verified=true",
          `approved_sha=${fields.commit}`,
          `database_project=${fields.database_project}`,
          `database_name=${fields.database_name}`,
          `operation=${fields.operation}`,
          `comment_id=${commentId}`,
          "",
        ].join("\n"),
      );
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
          "### Single-owner staging authorization: PASS and consumed",
          "",
          `- Authorization comment: ${commentId}`,
          `- Approved commit: \`${fields.commit}\``,
          `- Target: ${fields.environment} / ${fields.database_project} / ${fields.database_name}`,
          `- Operation: ${fields.operation}`,
          `- Consumed by workflow run: ${runId}`,
          "- Control limitation: owner authorization is separation of actions, not independent review",
          "",
        ].join("\n"),
      );
    }
    console.log("Single-owner staging authorization verified and consumed.");
  } catch (error) {
    console.error(`::error::${error?.safeCode ?? "OWNER_AUTHORIZATION_FAILED"}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
