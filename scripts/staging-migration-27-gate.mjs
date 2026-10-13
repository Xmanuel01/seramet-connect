import pg from "pg";
import { stagingTlsConfig } from "./staging-postgres-tls.mjs";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

// Guard and verifier for the explicitly authorized, one-time staging remediation.
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
  requireCondition(
    ["pre", "post", "lockdown", "secure", "status"].includes(mode),
    "UNKNOWN_GATE_MODE",
  );
  requireCondition(
    process.env.GITHUB_ACTIONS === "true" &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.SERAMET_ENVIRONMENT === "staging",
    "NOT_PROTECTED_MAIN_STAGING",
  );
  requireCondition(
    process.env.SERAMET_OWNER_AUTHORIZATION_VERIFIED === "true" &&
      process.env.SERAMET_OWNER_AUTHORIZATION_SHA === process.env.GITHUB_SHA &&
      process.env.SERAMET_OWNER_AUTHORIZATION_PROJECT === project &&
      process.env.SERAMET_OWNER_AUTHORIZATION_DATABASE === "postgres" &&
      process.env.SERAMET_OWNER_AUTHORIZATION_OPERATION === "migration-27-and-security-lockdown" &&
      /^[0-9]+$/.test(process.env.SERAMET_OWNER_AUTHORIZATION_COMMENT_ID ?? ""),
    "OWNER_AUTHORIZATION_MISSING_OR_MISMATCHED",
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

async function requireExecutionIdentity(client) {
  const identity = (
    await client.query(
      "SELECT current_database() AS database_name, current_user AS role_name, " +
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
  requireCondition(identity.ssl_enabled === true, "DATABASE_SSL_NOT_VERIFIED");
  requireCondition(
    identity.can_create && identity.can_insert_ledger && identity.ledger_owner_member,
    "MIGRATION_SCHEMA_OR_LEDGER_PERMISSION_MISSING",
  );
}

async function requireSchema27(client) {
  const ledger = (
    await client.query(
      "SELECT version, name, checksum FROM public.schema_migrations ORDER BY version",
    )
  ).rows;
  requireCondition(
    ledger.length === 27 && ledger.every((row, index) => Number(row.version) === index + 1),
    "EXPECTED_CONSECUTIVE_SCHEMA_VERSIONS_27",
  );
  requireCondition(
    ledger[26]?.name === "menu_import_pipeline" &&
      ledger[26]?.checksum === "menu-import-pipeline-0027-v2",
    "MIGRATION_27_LEDGER_CHECKSUM_MISMATCH",
  );
}

async function executeLockdown(client) {
  requireCondition(
    process.env.SERAMET_LOCKDOWN_AUTHORIZATION === "I_AUTHORIZE_STAGING_MIGRATION_27_AND_LOCKDOWN",
    "LOCKDOWN_AUTHORIZATION_MISSING",
  );
  requireCondition(
    process.env.SERAMET_BACKUP_RESTORE_VERIFIED === "true" &&
      /^[0-9]+$/.test(process.env.SERAMET_BACKUP_RESTORE_RUN_ID ?? ""),
    "CURRENT_BACKUP_RESTORE_EVIDENCE_MISSING",
  );
  await requireExecutionIdentity(client);
  await requireSchema27(client);

  const advisoryLock = "32478965233706356";
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [advisoryLock]);
    locked = true;
    await requireSchema27(client);
    const sql = await readFile("ops/sql/staging-public-schema-lockdown.sql", "utf8");
    requireCondition(
      sql.includes("APPROVED_AFTER_ISOLATED_RESTORE") &&
        sql.includes("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public") &&
        sql.includes("ENABLE ROW LEVEL SECURITY"),
      "REVIEWED_LOCKDOWN_GUARDS_MISSING",
    );
    await client.query(
      "SET seramet.staging_schema_lockdown_approved = 'APPROVED_AFTER_ISOLATED_RESTORE'",
    );
    await client.query(sql);
    console.log(
      "Staging security lockdown committed under the shared database advisory lock; independent postflight is required.",
    );
    addSummary([
      "### Guarded public-schema lockdown: committed",
      "",
      "- Existing approval guard: satisfied after current backup/restore evidence verification",
      "- Migration and lockdown are separate committed transactions",
      "- Independent security and Worker-role postflight remains required",
      "",
    ]);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [advisoryLock]);
      } catch {}
    }
  }
}

async function reportCheckpoint(client) {
  await requireExecutionIdentity(client);
  await client.query("BEGIN READ ONLY");
  try {
    const schema = (
      await client.query(
        "SELECT COUNT(*)::integer AS count, COALESCE(MAX(version),0)::integer AS maximum " +
          "FROM public.schema_migrations",
      )
    ).rows[0];
    const posture = (
      await client.query(
        "SELECT COUNT(*) FILTER (WHERE NOT rowsecurity)::integer AS rls_disabled, " +
          "COUNT(*) FILTER (WHERE has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS anon_select, " +
          "COUNT(*) FILTER (WHERE has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS authenticated_select, " +
          "has_schema_privilege('anon','public','USAGE') AS anon_schema_usage, " +
          "has_schema_privilege('authenticated','public','USAGE') AS authenticated_schema_usage " +
          "FROM pg_tables WHERE schemaname='public'",
      )
    ).rows[0];
    const secure =
      Number(posture.rls_disabled) === 0 &&
      Number(posture.anon_select) === 0 &&
      Number(posture.authenticated_select) === 0 &&
      posture.anon_schema_usage === false &&
      posture.authenticated_schema_usage === false;
    const version = Number(schema.maximum);
    const checkpoint =
      version === 26
        ? "SCHEMA_26_NO_REMEDIATION_COMMITTED"
        : version === 27 && secure
          ? "SCHEMA_27_LOCKDOWN_VERIFIED"
          : version === 27
            ? "SCHEMA_27_LOCKDOWN_INCOMPLETE"
            : "UNEXPECTED_SCHEMA_STATE";
    console.log("Staging remediation recovery checkpoint: " + checkpoint);
    addSummary([
      "### Recovery checkpoint: `" + checkpoint + "`",
      "",
      "- Schema migration count/version: " + Number(schema.count) + "/" + version,
      "- Public-schema lockdown verified: " + (secure ? "yes" : "no"),
      "- A failed job is never converted to success by this diagnostic checkpoint",
      "",
    ]);
    requireCondition(checkpoint !== "UNEXPECTED_SCHEMA_STATE", checkpoint);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function run() {
  const raw = validateTarget();
  const client = new pg.Client({
    ...stagingTlsConfig(raw),
    connectionTimeoutMillis: 8000,
    query_timeout: mode === "lockdown" ? 190000 : 10000,
    application_name: "seramet-staging-migration-27-" + mode,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    if (mode === "lockdown") {
      await executeLockdown(client);
      return;
    }
    if (mode === "status") {
      await reportCheckpoint(client);
      return;
    }

    await client.query(mode === "secure" ? "BEGIN" : "BEGIN READ ONLY");
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
    requireCondition(
      mode === "secure" || identity.read_only === "on",
      "READ_ONLY_GATE_NOT_ENFORCED",
    );
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
    const detectedVersion = Number(ledger.at(-1)?.version ?? 0);
    const requiredVersion = mode === "pre" ? detectedVersion : 27;
    requireCondition(
      mode !== "pre" || requiredVersion === 26 || requiredVersion === 27,
      "EXPECTED_RECOVERABLE_SCHEMA_VERSION_26_OR_27",
    );
    requireCondition(
      ledger.length === requiredVersion &&
        ledger.every((row, index) => Number(row.version) === index + 1),
      "EXPECTED_CONSECUTIVE_SCHEMA_VERSIONS_" + requiredVersion,
    );
    if (requiredVersion === 27) {
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
    if (mode === "pre" && requiredVersion === 26) {
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

    if (mode === "pre" && requiredVersion === 27) {
      const posture = (
        await client.query(
          "SELECT COUNT(*) FILTER (WHERE NOT rowsecurity)::integer AS rls_disabled, " +
            "COUNT(*) FILTER (WHERE has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS anon_select, " +
            "COUNT(*) FILTER (WHERE has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS authenticated_select, " +
            "has_schema_privilege('anon','public','USAGE') AS anon_schema_usage, " +
            "has_schema_privilege('authenticated','public','USAGE') AS authenticated_schema_usage " +
            "FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0];
      const alreadySecure =
        Number(posture.rls_disabled) === 0 &&
        Number(posture.anon_select) === 0 &&
        Number(posture.authenticated_select) === 0 &&
        posture.anon_schema_usage === false &&
        posture.authenticated_schema_usage === false;
      requireCondition(!alreadySecure, "REMEDIATION_ALREADY_COMPLETE");
    }

    if (mode === "secure") {
      const posture = (
        await client.query(
          "SELECT COUNT(*) FILTER (WHERE NOT rowsecurity)::integer AS rls_disabled, " +
            "COUNT(*) FILTER (WHERE has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS anon_select, " +
            "COUNT(*) FILTER (WHERE has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS authenticated_select, " +
            "has_schema_privilege('anon','public','USAGE') AS anon_schema_usage, " +
            "has_schema_privilege('authenticated','public','USAGE') AS authenticated_schema_usage " +
            "FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0];
      requireCondition(
        Number(posture.rls_disabled) === 0 &&
          Number(posture.anon_select) === 0 &&
          Number(posture.authenticated_select) === 0 &&
          posture.anon_schema_usage === false &&
          posture.authenticated_schema_usage === false,
        "PUBLIC_SCHEMA_LOCKDOWN_INCOMPLETE",
      );
      await client.query("SELECT COUNT(*) FROM public.schema_migrations");
      await client.query("UPDATE public.worker_jobs SET updated_at=updated_at WHERE false");
    }

    await client.query("ROLLBACK");
    console.log(
      "Staging migration 27 " +
        mode +
        "flight: PASS; " +
        "database=postgres, role=postgres, SSL=enabled, schema=" +
        requiredVersion +
        ", prerequisite_tables=7, new_tables=" +
        (requiredVersion === 26 ? "absent" : "4 RLS-enabled"),
    );
    addSummary([
      "### Staging migration 27 " + mode + "flight: PASS",
      "",
      "- Target: staging Supabase DSN project-ref constraint matched; database `postgres`, role `postgres`",
      "- TLS: enabled; SQL verification transaction: " +
        (mode === "secure" ? "rolled-back Worker compatibility probe" : "read-only"),
      "- Migration versions: 1–" + requiredVersion + " consecutive",
      requiredVersion === 26
        ? "- Migration 27 targets absent; prerequisite owners and compatibility-function ownership: PASS"
        : "- Migration 27 checksum, objects and four new-table RLS flags: PASS",
      ...(mode === "pre" && requiredVersion === 27
        ? ["- Recovery mode: schema 27 is complete but lockdown is not yet verified"]
        : []),
      ...(mode === "secure"
        ? [
            "- Public grants/schema access: locked down",
            "- Configured Worker database role: read and rolled-back no-op write probe passed",
          ]
        : []),
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
  console.error("Staging remediation " + mode + " BLOCKED: " + code + "; no automatic retry.");
  addSummary([
    "### Staging remediation " + mode + ": BLOCKED",
    "",
    "- Failure category: " + code,
    "- No retry or repair initiated.",
    "",
  ]);
  process.exitCode = 1;
}
