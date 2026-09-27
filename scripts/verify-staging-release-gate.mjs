import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** A release-specific manual gate: no database migration or worker activation on an unreviewed SHA. */
export function assessStagingReleaseApproval(env) {
  const issues = [];
  const sha = (env.GITHUB_SHA ?? "").trim();
  const approved = (env.SERAMET_STAGING_APPROVED_SHA ?? "").trim();
  if (!/^[a-f0-9]{40}$/i.test(sha) || approved.toLowerCase() !== sha.toLowerCase()) {
    issues.push("RELEASE_SHA_NOT_APPROVED");
  }
  if (env.SERAMET_STAGING_BACKUP_RESTORE_VERIFIED !== "true") {
    issues.push("STAGING_BACKUP_RESTORE_NOT_VERIFIED");
  }
  if (env.SERAMET_STAGING_BACKLOG_REVIEW_APPROVED !== "true") {
    issues.push("PENDING_WORK_NOT_REVIEWED");
  }
  return issues;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const issues = assessStagingReleaseApproval(process.env);
  if (issues.length) {
    console.error(
      "Unsafe staging release blocked before migrations: " +
        issues.join(", ") +
        ". Approve this exact commit only after independently verifying staging backup/restore, " +
        "pending import/job reconciliation, and the scanner resource. Do not disable this gate.",
    );
    process.exitCode = 1;
  } else {
    console.log("Release-specific staging safety approval: PASS");
  }
}
