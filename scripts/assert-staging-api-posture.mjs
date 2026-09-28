import pg from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Independent, read-only authorization gate. An operator checkbox cannot
 * overrule live PostgreSQL RLS and effective anonymous client grants.
 */
export function assessStagingApiPosture(row) {
  const issues = [];
  if (!row || Number(row.public_tables) < 1) issues.push("NO_PUBLIC_TABLE_INVENTORY");
  if (Number(row?.rls_disabled) !== 0) issues.push("PUBLIC_RLS_DISABLED");
  if (Number(row?.anon_select) !== 0) issues.push("PUBLIC_ANON_SELECT_REMAINS");
  if (Number(row?.authenticated_select) !== 0)
    issues.push("PUBLIC_AUTHENTICATED_SELECT_REMAINS");
  if (row?.anon_schema_usage === true) issues.push("ANON_PUBLIC_SCHEMA_USAGE_REMAINS");
  if (row?.authenticated_schema_usage === true)
    issues.push("AUTHENTICATED_PUBLIC_SCHEMA_USAGE_REMAINS");
  if (typeof row?.anon_schema_usage !== "boolean" ||
      typeof row?.authenticated_schema_usage !== "boolean")
    issues.push("SCHEMA_PRIVILEGE_PROBE_FAILED");
  return issues;
}

export async function inspectStagingApiPosture(db) {
  await db.query("BEGIN READ ONLY");
  try {
    const result = await db.query(
      "SELECT COUNT(*)::integer AS public_tables, " +
        "COUNT(*) FILTER (WHERE NOT rowsecurity)::integer AS rls_disabled, " +
        "COUNT(*) FILTER (WHERE has_table_privilege('anon', " +
          "format('%I.%I',schemaname,tablename),'SELECT'))::integer AS anon_select, " +
        "COUNT(*) FILTER (WHERE has_table_privilege('authenticated', " +
          "format('%I.%I',schemaname,tablename),'SELECT'))::integer AS authenticated_select, " +
        "has_schema_privilege('anon','public','USAGE') AS anon_schema_usage, " +
        "has_schema_privilege('authenticated','public','USAGE') AS authenticated_schema_usage " +
        "FROM pg_tables WHERE schemaname='public'",
    );
    return result.rows[0];
  } finally {
    await db.query("ROLLBACK");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const urlText = process.env.SERAMET_POSTGRES_URL;
  if (process.env.SERAMET_ENVIRONMENT !== "staging" || !urlText)
    throw new Error("Read-only staging security preflight requires staging environment and DSN");
  const url = new URL(urlText);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !(url.hostname.includes("vnymbavsbxorwxpebkot") ||
        decodeURIComponent(url.username).includes("vnymbavsbxorwxpebkot"))) {
    throw new Error("Refusing SQL security gate against an unidentified PostgreSQL project");
  }
  const db = new pg.Client({ connectionString: urlText });
  await db.connect();
  try {
    const posture = await inspectStagingApiPosture(db);
    const problems = assessStagingApiPosture(posture);
    if (problems.length) {
      console.error("Staging database security remains unsafe: " + problems.join(", "));
      process.exitCode = 1;
    } else {
      console.info("Verified: public-schema table RLS and anon/auth grants are locked down.");
    }
  } finally {
    await db.end();
  }
}
