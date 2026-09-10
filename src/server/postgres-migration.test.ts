import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import { migrationFiles } from "@/server/database/sqlite-test-adapter";

describe("PostgreSQL migration compatibility", () => {
  it("migrates the complete production schema from zero with translated invariants", async () => {
    const database = new PGlite();
    try {
      await database.exec(postgresCompatibilityPrelude);
      let triggerCount = 0;
      for (const file of migrationFiles) {
        const source = readFileSync(resolve(process.cwd(), "migrations", file), "utf8");
        const compiled = compileSqliteMigrationForPostgres(source);
        triggerCount += compiled.triggerCount;
        await database.exec(compiled.sql);
      }
      const versions = await database.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      const tables = await database.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
      );
      expect(versions.rows.map((row) => row.version)).toEqual(
        migrationFiles.map((file) => Number(file.slice(0, 4))),
      );
      expect(tables.rows.length).toBeGreaterThan(140);
      expect(triggerCount).toBeGreaterThan(120);
      const triggers = await database.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM information_schema.triggers WHERE trigger_schema='public'",
      );
      expect(triggers.rows[0]?.count).toBeGreaterThan(120);
      await database.exec(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES ('trigger-tenant','trigger-tenant','Trigger Ltd','Trigger','KES','Africa/Nairobi','en-KE',1,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
         INSERT INTO realtime_events
          (tenant_id,id,branch_id,topic,entity_type,entity_id,event_type,correlation_id,payload_json,created_at,expires_at)
         VALUES ('trigger-tenant','event-1',NULL,'orders','ORDER','order-1','UPDATED','correlation-1','{}',CURRENT_TIMESTAMP,NULL);`,
      );
      await expect(
        database.exec(
          "UPDATE realtime_events SET topic='payments' WHERE tenant_id='trigger-tenant' AND id='event-1'",
        ),
      ).rejects.toThrow(/append-only/i);
    } finally {
      await database.close();
    }
  }, 120_000);
});
