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
});
