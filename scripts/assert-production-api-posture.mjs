import pg from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assessStagingApiPosture,
  inspectStagingApiPosture,
} from "./assert-staging-api-posture.mjs";

export const PRODUCTION_PROJECT_REF = "qnhqylslyhxjcksuhgyq";
const STAGING_PROJECT_REF = "vnymbavsbxorwxpebkot";

/** Refuse any DSN that is not unambiguously the production Supabase project. */
export function assertProductionDsn(urlText) {
  let url;
  try {
    url = new URL(urlText ?? "");
  } catch {
    throw new Error("PRODUCTION_DSN_INVALID");
  }
  const identity = `${url.hostname} ${decodeURIComponent(url.username)}`;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !identity.includes(PRODUCTION_PROJECT_REF) ||
    identity.includes(STAGING_PROJECT_REF)
  )
    throw new Error("Refusing production SQL against an unidentified PostgreSQL project");
}

/**
 * Before migrations an empty (never-migrated) production schema is acceptable; any existing
 * table must already be locked down. After migrations the full lock-down is mandatory.
 */
export function assessProductionApiPosture(row, phase) {
  if (phase === "pre-migration" && row && Number(row.public_tables) === 0) {
    return assessStagingApiPosture({ ...row, public_tables: 1 });
  }
  return assessStagingApiPosture(row);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const phase = process.argv[2];
  if (!["pre-migration", "post-migration"].includes(phase))
    throw new Error("Phase must be pre-migration or post-migration");
  if (process.env.SERAMET_ENVIRONMENT !== "production")
    throw new Error("Production security check requires the production environment");
  assertProductionDsn(process.env.SERAMET_POSTGRES_URL);
  const db = new pg.Client({ connectionString: process.env.SERAMET_POSTGRES_URL });
  await db.connect();
  try {
    const posture = await inspectStagingApiPosture(db);
    const problems = assessProductionApiPosture(posture, phase);
    if (problems.length) {
      console.error(`Production database security (${phase}) is unsafe: ${problems.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.info(
        `Verified (${phase}): ${posture.public_tables} public tables, RLS on, no anon/auth grants.`,
      );
    }
  } finally {
    await db.end();
  }
}
