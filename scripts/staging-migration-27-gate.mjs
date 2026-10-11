import pg from "pg";
import { appendFileSync } from "node:fs";

// Non-mutating gate for the explicitly authorized, one-time staging migration.
// Never print the DSN, driver exception details, SQL parameters, or user data.
// The migration itself is performed ONLY by scripts/migrate-postgres.ts.
const mode = process.argv[2];
const project = "vnymbavsbxorwxpebkot";
const newTables = [
  "menu_import_staged_items",
  "menu_import_staged_branch_settings",
  "manual_menu_item_requests",
  "file_import_state_events",
];
const prerequisiteTables = [
  "stored_objects",
  "setup_imports",
  "setup_import_rows",
  "worker_jobs",
  "branches",
  "menu_catalog_items",
  "menu_item_branch_settings",
];
const addedColumns = {
  stored_objects: ["scan_evidence_json", "object_version", "scan_evidence_id"],
  setup_imports: [
    "source_object_id",
    "scan_status",
    "scan_evidence_json",
    "approved_plan_digest",
    "approved_by",
    "approved_at",
    "batch_size",
    "publish_status",
    "publish_idempotency_key",
    "published_at",
    "plan_revision",
    "pipeline_state",
  ],
  setup_import_rows: ["materialized_at", "published_at", "publication_verified_at"],
  worker_jobs: ["result_json"],
};
const indexes = {
  idx_setup_import_pipeline: "setup_imports",
  idx_setup_import_rows_batch: "setup_import_rows",
  idx_stored_object_scan_evidence: "stored_objects",
  idx_file_import_state_events: "file_import_state_events",
  idx_menu_import_staged_items: "menu_import_staged_items",
  idx_menu_import_staged_branches: "menu_import_staged_branch_settings",
};
const triggers = {
  setup_import_publish_guard: "setup_imports",
  file_import_state_events_no_update: "file_import_state_events",
  file_import_state_events_no_delete: "file_import_state_events",
};

function reject(code) {
  const error = new Error("Migration gate rejected: " + code);
  error.safeCode = code;
  throw error;
}
function requireCondition(ok, code) {
  if (!ok) reject(code);
}
function requireExactly(rows, names, property, code) {
  requireCondition(
    rows.length === names.length &&
      names.every((name) => rows.some((row) => row[property] === name)),
    code,
  );
}
function addSummary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }
}
function validateTarget() {
  requireCondition(["pre", "post"].includes(mode), "UNKNOWN_GATE_MODE");
  requireCondition(
    process.env.GITHUB_ACTIONS === "true" &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.SERAMET_ENVIRONMENT === "staging",
    "NOT_PROTECTED_MAIN_STAGING",
  );
  const raw = process.env.SERAMET_POSTGRES_URL;
  requireCondition(Boolean(raw), "STAGING_SECRET_MISSING");
  let url;
  try {
    url = new URL(raw);
  } catch {
    reject("INVALID_POSTGRES_URL");
  }
  requireCondition(
    ["postgres:", "postgresql:"].includes(url.protocol),
    "INVALID_POSTGRES_PROTOCOL",
  );
  const host = url.hostname.toLowerCase();
  let username;
  try {
    username = decodeURIComponent(url.username).toLowerCase();
  } catch {
    reject("INVALID_DATABASE_USERNAME_ENCODING");
  }
  const directHost = host === "db." + project + ".supabase.co" && username === "postgres";
  const poolerHost = /(^|\.)pooler\.supabase\.com$/.test(host) && username.endsWith("." + project);
  requireCondition(directHost || poolerHost, "STAGING_PROJECT_REFERENCE_MISMATCH");
  requireCondition(url.pathname === "/postgres", "UNEXPECTED_DATABASE_NAME");
  requireCondition(
    url.port === "" || url.port === "5432",
    "SESSION_POOLER_OR_DIRECT_PORT_5432_REQUIRED",
  );
  requireCondition(url.searchParams.get("sslmode") !== "disable", "SSL_MUST_NOT_BE_DISABLED");
  return raw;
}

async function run() {
  const raw = validateTarget();
  const client = new pg.Client({
    connectionString: raw,
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
    application_name: "seramet-staging-migration-27-" + mode,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");

    const identity = (
      await client.query(
        "SELECT current_database() AS database_name, current_user AS role_name, " +
          "current_setting('transaction_read_only') AS read_only, " +
          "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl_enabled, " +
          "has_schema_privilege(current_user,'public','CREATE') AS can_create, " +
          "has_table_privilege(current_user,'public.schema_migrations','INSERT') AS can_insert_ledger, " +
          "pg_has_role(current_user,(SELECT relowner FROM pg_class " +
          "WHERE oid='public.schema_migrations'::regclass),'MEMBER') AS ledger_owner_member",
      )
    ).rows[0];
    requireCondition(
      identity?.database_name === "postgres" && identity.role_name === "postgres",
      "DATABASE_IDENTITY_OR_ROLE_MISMATCH",
    );
    requireCondition(identity.read_only === "on", "READ_ONLY_GATE_NOT_ENFORCED");
    requireCondition(identity.ssl_enabled === true, "DATABASE_SSL_NOT_VERIFIED");
    requireCondition(
      identity.can_create && identity.can_insert_ledger && identity.ledger_owner_member,
      "MIGRATION_SCHEMA_OR_LEDGER_PERMISSION_MISSING",
    );

    const ledger = (
      await client.query(
        "SELECT version, name, checksum FROM public.schema_migrations ORDER BY version",
      )
    ).rows;
    const requiredVersion = mode === "pre" ? 26 : 27;
    requireCondition(
      ledger.length === requiredVersion &&
        ledger.every((row, index) => Number(row.version) === index + 1),
      "EXPECTED_CONSECUTIVE_SCHEMA_VERSIONS_" + requiredVersion,
    );
    if (mode === "post") {
      const last = ledger[26];
      requireCondition(
        last?.name === "menu_import_pipeline" && last?.checksum === "menu-import-pipeline-0027-v2",
        "MIGRATION_27_LEDGER_CHECKSUM_MISMATCH",
      );
    }

    const prerequisites = (
      await client.query(
        "SELECT c.relname, pg_has_role(current_user,c.relowner,'MEMBER') AS owner_member " +
          "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
          "WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])",
        [prerequisiteTables],
      )
    ).rows;
    requireExactly(prerequisites, prerequisiteTables, "relname", "PREREQUISITE_TABLES_MISSING");
    requireCondition(
      prerequisites.every((row) => row.owner_member === true),
      "PREREQUISITE_TABLE_OWNERSHIP_MISSING",
    );

    const functions = (
      await client.query(
        "SELECT p.oid::regprocedure::text AS signature, " +
          "pg_has_role(current_user,p.proowner,'MEMBER') AS owner_member " +
          "FROM pg_proc p WHERE p.oid=ANY(ARRAY[" +
          "to_regprocedure('public.json_extract(text,text)')," +
          "to_regprocedure('public.json_each(text)')])",
      )
    ).rows;
    requireCondition(
      functions.length === 2 && functions.every((row) => row.owner_member === true),
      "COMPATIBILITY_FUNCTION_OWNERSHIP_MISSING",
    );

    const tables = (
      await client.query(
        "SELECT c.relname, c.relrowsecurity FROM pg_class c " +
          "JOIN pg_namespace n ON n.oid=c.relnamespace " +
          "WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])",
        [newTables],
      )
    ).rows;

    const desiredColumns = Object.entries(addedColumns).flatMap(([table, names]) =>
      names.map((name) => table + "." + name),
    );
    const columns = (
      await client.query(
        "SELECT table_name || '.' || column_name AS name " +
          "FROM information_schema.columns " +
          "WHERE table_schema='public' AND table_name=ANY($1::text[])",
        [Object.keys(addedColumns)],
      )
    ).rows.filter((row) => desiredColumns.includes(row.name));

    const indexRows = (
      await client.query(
        "SELECT idx.relname AS name, tab.relname AS table_name, ix.indisunique AS is_unique " +
          "FROM pg_class idx JOIN pg_index ix ON ix.indexrelid=idx.oid " +
          "JOIN pg_class tab ON tab.oid=ix.indrelid " +
          "JOIN pg_namespace n ON n.oid=tab.relnamespace " +
          "WHERE n.nspname='public' AND idx.relname=ANY($1::text[])",
        [Object.keys(indexes)],
      )
    ).rows;
    const triggerRows = (
      await client.query(
        "SELECT tr.tgname AS name, tab.relname AS table_name FROM pg_trigger tr " +
          "JOIN pg_class tab ON tab.oid=tr.tgrelid " +
          "JOIN pg_namespace n ON n.oid=tab.relnamespace " +
          "WHERE NOT tr.tgisinternal AND n.nspname='public' " +
          "AND tr.tgname=ANY($1::text[])",
        [Object.keys(triggers)],
      )
    ).rows;
    const triggerFunctions = (
      await client.query(
        "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace " +
          "WHERE n.nspname='public' AND p.proname=ANY($1::text[])",
        [Object.keys(triggers).map((name) => "seramet_trigger_" + name)],
      )
    ).rows;
    if (mode === "pre") {
      requireCondition(
        tables.length === 0 &&
          columns.length === 0 &&
          indexRows.length === 0 &&
          triggerRows.length === 0 &&
          triggerFunctions.length === 0,
        "MIGRATION_27_OBJECT_COLLISION_BEFORE_EXECUTION",
      );
    } else {
      requireExactly(tables, newTables, "relname", "MIGRATION_27_TABLES_MISSING");
      requireCondition(
        tables.every((row) => row.relrowsecurity === true),
        "MIGRATION_27_NEW_TABLE_RLS_DISABLED",
      );
      requireExactly(columns, desiredColumns, "name", "MIGRATION_27_COLUMNS_MISSING");
      requireExactly(indexRows, Object.keys(indexes), "name", "MIGRATION_27_INDEXES_MISSING");
      requireCondition(
        indexRows.every(
          (row) =>
            row.table_name === indexes[row.name] &&
            (row.name !== "idx_stored_object_scan_evidence" || row.is_unique),
        ),
        "MIGRATION_27_INDEX_DEFINITIONS_WRONG",
      );
      requireExactly(triggerRows, Object.keys(triggers), "name", "MIGRATION_27_TRIGGERS_MISSING");
      requireCondition(
        triggerRows.every((row) => row.table_name === triggers[row.name]),
        "MIGRATION_27_TRIGGER_TARGET_WRONG",
      );
      requireExactly(
        triggerFunctions,
        Object.keys(triggers).map((name) => "seramet_trigger_" + name),
        "proname",
        "MIGRATION_27_TRIGGER_FUNCTIONS_MISSING",
      );
      const constraints = (
        await client.query(
          "SELECT t.relname AS table_name, " +
            "count(*) FILTER (WHERE co.contype='p')::int AS primary_keys, " +
            "count(*) FILTER (WHERE co.contype='f')::int AS foreign_keys " +
            "FROM pg_constraint co JOIN pg_class t ON t.oid=co.conrelid " +
            "JOIN pg_namespace n ON n.oid=t.relnamespace " +
            "WHERE n.nspname='public' AND t.relname=ANY($1::text[]) GROUP BY t.relname",
          [newTables],
        )
      ).rows;
      const expectedForeignKeys = {
        menu_import_staged_items: 1,
        menu_import_staged_branch_settings: 2,
        manual_menu_item_requests: 1,
        file_import_state_events: 2,
      };
      requireExactly(constraints, newTables, "table_name", "MIGRATION_27_CONSTRAINTS_MISSING");
      requireCondition(
        constraints.every(
          (row) =>
            row.primary_keys === 1 && row.foreign_keys === expectedForeignKeys[row.table_name],
        ),
        "MIGRATION_27_KEYS_WRONG",
      );
    }

    await client.query("ROLLBACK");
    console.log(
      "Staging migration 27 " +
        mode +
        "flight: PASS; " +
        "database=postgres, role=postgres, SSL=enabled, schema=" +
        requiredVersion +
        ", prerequisite_tables=7, new_tables=" +
        (mode === "post" ? "4 RLS-enabled" : "absent"),
    );
    addSummary([
      "### Staging migration 27 " + mode + "flight: PASS",
      "",
      "- Target: staging Supabase DSN project-ref constraint matched; database `postgres`, role `postgres`",
      "- TLS: enabled; SQL verification transaction: read-only",
      "- Migration versions: 1–" + requiredVersion + " consecutive",
      mode === "post"
        ? "- Migration 27 checksum, columns, six indexes, three triggers/functions, keys and four RLS flags: PASS"
        : "- Migration 27 targets absent; prerequisite owners and compatibility-function ownership: PASS",
      "",
    ]);
  } catch (error) {
    if (connected) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    throw error;
  } finally {
    if (connected) {
      try {
        await client.end();
      } catch {}
    }
  }
}

try {
  await run();
} catch (error) {
  const code =
    typeof error?.safeCode === "string" ? error.safeCode : "DATABASE_CONNECTION_OR_QUERY_FAILED";
  console.error(
    "Staging migration 27 " +
      (mode === "pre" ? "preflight" : "postflight") +
      " BLOCKED: " +
      code +
      "; no automatic retry.",
  );
  addSummary([
    "### Staging migration 27 " + (mode === "pre" ? "preflight" : "postflight") + ": BLOCKED",
    "",
    "- Failure category: " + code,
    "- No retry or repair initiated.",
    "",
  ]);
  process.exitCode = 1;
}
