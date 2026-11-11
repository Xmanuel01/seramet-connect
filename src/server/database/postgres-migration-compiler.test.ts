import { describe, expect, it } from "vitest";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";

describe("SQLite-to-PostgreSQL trigger compilation", () => {
  it("provides a TEXT JSON-array iterator for CRM branch scope queries", () => {
    expect(postgresCompatibilityPrelude).toContain("FUNCTION json_each(document TEXT)");
    expect(postgresCompatibilityPrelude).toContain("jsonb_array_elements_text(document::jsonb)");
    expect(postgresCompatibilityPrelude).toContain("RETURNS TABLE(key TEXT, value TEXT)");
  });

  it("compiles the CRM lead's immutable event triggers to PostgreSQL", () => {
    const sql = `
CREATE TRIGGER crm_lead_events_no_update BEFORE UPDATE ON crm_lead_events
BEGIN SELECT RAISE(ABORT,'lead events are immutable'); END;
CREATE TRIGGER crm_lead_events_no_delete BEFORE DELETE ON crm_lead_events
BEGIN SELECT RAISE(ABORT,'lead events are immutable'); END;
`;
    const compiled = compileSqliteMigrationForPostgres(sql);
    expect(compiled.triggerCount).toBe(2);
    expect(compiled.sql).toContain("RAISE EXCEPTION 'lead events are immutable'");
    expect(compiled.sql).toContain("BEFORE DELETE ON crm_lead_events");
  });

  it("qualifies the access-control revision in UPSERT triggers", () => {
    const compiled = compileSqliteMigrationForPostgres(`
CREATE TRIGGER access_revision_user_role_insert AFTER INSERT ON user_roles
BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;
`);
    expect(compiled.triggerCount).toBe(1);
    expect(compiled.sql).toContain("revision=access_control_revisions.revision+1");
    expect(compiled.sql).not.toMatch(/revision\s*=\s*revision\s*\+\s*1/);
  });

  it("does not change revision expressions for other tables", () => {
    const compiled = compileSqliteMigrationForPostgres(`
CREATE TRIGGER other_revision AFTER INSERT ON other_events
BEGIN
  UPDATE other_revisions SET revision=revision+1 WHERE id=NEW.id;
END;
`);
    expect(compiled.sql).toContain("revision=revision+1");
  });

  it("emits explicitly marked PostgreSQL-only migration statements", () => {
    const compiled = compileSqliteMigrationForPostgres(`
CREATE TABLE secure_records (id TEXT PRIMARY KEY);
-- POSTGRES_ONLY: ALTER TABLE secure_records ENABLE ROW LEVEL SECURITY;
`);

    expect(compiled.sql).toContain("ALTER TABLE secure_records ENABLE ROW LEVEL SECURITY;");
    expect(compiled.sql).not.toContain("POSTGRES_ONLY");
  });

  it("pins the search_path of compiled trigger functions", () => {
    const compiled = compileSqliteMigrationForPostgres(`
CREATE TRIGGER pinned_no_delete BEFORE DELETE ON pinned_records
BEGIN SELECT RAISE(ABORT,'pinned records are immutable'); END;
`);
    expect(compiled.sql).toContain(
      "FUNCTION seramet_trigger_pinned_no_delete() RETURNS trigger\nLANGUAGE plpgsql SET search_path = public, pg_temp AS $$",
    );
  });
});

describe("Row level security in migrations", () => {
  // Migrations 0001-0026 predate per-migration RLS; their tables were locked down together
  // (ops/sql/staging-public-schema-lockdown.sql). Every table created from 0027 on must turn
  // RLS on in a migration, or Supabase's Data API could expose it.
  it("turns RLS on for every table created from migration 0027 on", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const { migrationFiles } = await import("@/server/database/sqlite-test-adapter");
    const created = new Map<string, string>();
    const secured = new Set<string>();
    for (const file of migrationFiles) {
      const source = await readFile(resolve(process.cwd(), "migrations", file), "utf8");
      if (Number(file.slice(0, 4)) >= 27) {
        for (const match of source.matchAll(
          /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)/gim,
        ))
          created.set(match[1]!.toLowerCase(), file);
      }
      for (const match of source.matchAll(
        /^\s*--\s*POSTGRES_ONLY:\s*ALTER\s+TABLE\s+([a-z0-9_]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gim,
      ))
        secured.add(match[1]!.toLowerCase());
    }
    const missing = [...created].filter(([table]) => !secured.has(table));
    expect(missing).toEqual([]);
  });
});
