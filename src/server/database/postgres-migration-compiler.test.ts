import { describe, expect, it } from "vitest";
import { compileSqliteMigrationForPostgres } from "@/server/database/postgres-migration-compiler";

describe("SQLite-to-PostgreSQL trigger compilation", () => {
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
});
