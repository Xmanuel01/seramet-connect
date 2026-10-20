import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { createMigratedTestDatabase, migrationFiles } from "@/server/database/sqlite-test-adapter";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import { PostgresD1Database } from "@/server/database/postgres-database";
import type { D1Database } from "@/server/database/d1";
import { OnboardingService } from "@/onboarding/onboarding-service";
import { InventoryIntelligenceService } from "./inventory-intelligence-service";
import type { SerametEnv, ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import type { ImportPreview } from "@/onboarding/types";

const actor: ServerActor = {
  id: "manager",
  name: "Disposable manager",
  tenantId: "import-test",
  branchId: "branch-a",
  branch: "Branch A",
  role: "Manager",
  roleIds: ["manager"],
  permissions: [...allPermissionCodes],
  assignedBranchIds: ["branch-a"],
  assignedBranches: [{ id: "branch-a", name: "Branch A" }],
  branchScope: { type: "BRANCH", branchId: "branch-a" },
};
for (const provider of ["sqlite", "postgres"] as const)
  describe.sequential(`inventory import (${provider}, disposable)`, () => {
    let db: D1Database;
    let close: () => unknown;
    let service: OnboardingService;
    let env: SerametEnv;
    beforeAll(async () => {
      if (provider === "sqlite") {
        const sqlite = createMigratedTestDatabase();
        db = sqlite;
        close = () => sqlite.close();
      } else {
        const pg = new PGlite();
        close = () => pg.close();
        await pg.exec(postgresCompatibilityPrelude);
        for (const file of migrationFiles)
          await pg.exec(
            compileSqliteMigrationForPostgres(readFileSync(resolve("migrations", file), "utf8"))
              .sql,
          );
        const client = {
          async query(sql: string, values?: unknown[]) {
            const result = await pg.query(sql, values);
            return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
          },
          release() {},
        };
        db = new PostgresD1Database({ ...client, connect: async () => client } as unknown as Pool);
      }
      const stamp = new Date().toISOString();
      await db
        .prepare(
          "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,created_at,updated_at) VALUES ('import-test','import-test','Test','Test','KES','Africa/Nairobi','en-KE',?,?)",
        )
        .bind(stamp, stamp)
        .run();
      await db
        .prepare(
          "INSERT INTO branches (tenant_id,id,code,name,timezone) VALUES ('import-test','branch-a','A','Branch A','Africa/Nairobi')",
        )
        .run();
      await db
        .prepare(
          "INSERT INTO users (tenant_id,id,name,created_at,updated_at) VALUES ('import-test','manager','Disposable manager',?,?)",
        )
        .bind(stamp, stamp)
        .run();
      await db
        .prepare(
          "INSERT INTO roles (tenant_id,id,code,name) VALUES ('import-test','manager','MANAGER','Manager')",
        )
        .run();
      await db
        .prepare(
          "INSERT INTO permissions (code,description) VALUES (?,'Import') ON CONFLICT(code) DO NOTHING",
        )
        .bind(permissions.setupImport)
        .run();
      await db
        .prepare(
          "INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES ('import-test','manager',?)",
        )
        .bind(permissions.setupImport)
        .run();
      await db
        .prepare(
          "INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES ('import-test','manager','manager')",
        )
        .run();
      await db
        .prepare(
          "INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES ('import-test','manager','branch-a')",
        )
        .run();
      const inventory = new InventoryIntelligenceService(db, actor);
      await inventory.createWarehouse({
        id: "warehouse-a",
        branchId: "branch-a",
        code: "MAIN",
        name: "Store",
        locationType: "MAIN",
      });
      await inventory.createUnit({
        id: "kg",
        code: "KG",
        name: "Kilogram",
        symbol: "kg",
        dimension: "MASS",
      });
      await inventory.createInventoryCategory({ id: "food", code: "FOOD", name: "Food" });
      env = {
        SERAMET_DB: db,
        SERAMET_ENVIRONMENT: "test",
        SERAMET_MALWARE_SCANNER: {
          async fetch(_url, init) {
            const h = new Headers(init?.headers);
            return Response.json({
              verdict: "CLEAN",
              sha256: h.get("x-seramet-content-sha256"),
              evidenceId: crypto.randomUUID(),
              scannerId: "test-only",
              engine: "test-fixture-not-antivirus",
              signatureVersion: "test-only",
              scannedAt: new Date().toISOString(),
              jobId: h.get("x-seramet-scan-job-id"),
              objectKey: h.get("x-seramet-object-key"),
              objectVersion: h.get("x-seramet-object-version"),
            });
          },
        },
      };
      service = new OnboardingService(db, actor, env);
    }, 120_000);
    afterAll(async () => {
      await close?.();
    });
    async function preview(
      code: string,
      rows = 1,
      strategy: "ERROR" | "SKIP" = "ERROR",
      warehouse = "warehouse-a",
    ) {
      const text =
        "code,name,categoryCode,baseUnit,dimension,warehouseId\n" +
        Array.from(
          { length: rows },
          (_, i) => `${code}-${i},Imported ${code} ${i},FOOD,KG,MASS,${warehouse}`,
        ).join("\n");
      return service.previewImport({
        kind: "INVENTORY",
        branchId: "branch-a",
        originalName: `${code}.csv`,
        mimeType: "text/csv",
        bytes: new TextEncoder().encode(text),
        duplicateStrategy: strategy,
        idempotencyKey: `${code}:${strategy}:${crypto.randomUUID()}`,
      });
    }
    async function stage(p: ImportPreview) {
      await service.commitImport(p.id, p.commitKey);
      for (let i = 0; i < 10; i++) {
        const result = await service.commitImport(p.id, p.commitKey, { worker: true });
        if (!result.queued) return;
      }
      throw new Error("Bounded test worker did not finish staging");
    }
    async function publish(p: ImportPreview) {
      const approved = await service.inspectImport(p.id);
      await service.publishImport(p.id, approved.publishKey!);
      for (let i = 0; i < 10; i++) {
        const result = await service.publishImport(p.id, approved.publishKey!, { worker: true });
        if (!result.queued) return result;
      }
      throw new Error("Bounded test worker did not finish publication");
    }
    async function count(code: string) {
      return Number(
        (
          await db
            .prepare("SELECT COUNT(*) count FROM inventory_items WHERE tenant_id=? AND sku LIKE ?")
            .bind(actor.tenantId, `${code}-%`)
            .first<{ count: number }>()
        )?.count,
      );
    }
    it("stages 21 rows in bounded batches without changing stock, then atomically publishes and survives a worker restart", async () => {
      const p = await preview("BATCH", 21);
      expect(p.canCommit).toBe(true);
      expect(await service.commitImport(p.id, p.commitKey)).toMatchObject({ queued: true });
      expect(await service.commitImport(p.id, p.commitKey, { worker: true })).toMatchObject({
        queued: true,
      });
      expect(await count("BATCH")).toBe(0);
      service = new OnboardingService(db, actor, env);
      await service.commitImport(p.id, p.commitKey, { worker: true });
      expect(await count("BATCH")).toBe(0);
      const ready = await service.inspectImport(p.id);
      await service.publishImport(p.id, ready.publishKey!);
      expect(await service.publishImport(p.id, ready.publishKey!, { worker: true })).toMatchObject({
        queued: true,
      });
      expect(await count("BATCH")).toBe(0);
      service = new OnboardingService(db, actor, env);
      expect(await service.publishImport(p.id, ready.publishKey!, { worker: true })).toMatchObject({
        status: "PUBLISHED",
      });
      expect(await count("BATCH")).toBe(21);
      expect(await service.publishImport(p.id, ready.publishKey!)).toMatchObject({
        duplicate: true,
      });
      expect(
        await db
          .prepare("SELECT COUNT(*) count FROM inventory_movements WHERE tenant_id=?")
          .bind(actor.tenantId)
          .first("count"),
      ).toBe(0);
    });
    it("uses configured category/unit identities and the selected branch warehouse", async () => {
      const p = await preview("IDENTITY");
      await stage(p);
      await publish(p);
      expect(
        await db
          .prepare(
            "SELECT base_unit_id,category_id,default_warehouse_id FROM inventory_items WHERE tenant_id=? AND sku='IDENTITY-0'",
          )
          .bind(actor.tenantId)
          .first(),
      ).toMatchObject({
        base_unit_id: "kg",
        category_id: "food",
        default_warehouse_id: "warehouse-a",
      });
    });
    it("skips existing items without overwriting them", async () => {
      const p = await preview("IDENTITY", 1, "SKIP");
      expect(p.rows[0]?.action).toBe("SKIP");
      await stage(p);
      await publish(p);
      expect(await count("IDENTITY")).toBe(1);
    });
    it("rejects unknown warehouses and cross-branch use", async () => {
      expect((await preview("INVALID", 1, "ERROR", "other-branch-store")).canCommit).toBe(false);
      const p = await preview("SCOPE");
      const outsider = new OnboardingService(
        db,
        { ...actor, assignedBranchIds: [], assignedBranches: [] },
        env,
      );
      await expect(outsider.inspectImport(p.id)).rejects.toThrow();
      await expect(outsider.commitImport(p.id, p.commitKey)).rejects.toThrow();
    });
    it("refuses modified approved plans and altered publication keys", async () => {
      const p = await preview("TAMPER");
      await stage(p);
      await expect(service.publishImport(p.id, "publish:altered")).rejects.toThrow(/immutable/);
      await db
        .prepare("UPDATE setup_import_rows SET after_json='{}' WHERE tenant_id=? AND import_id=?")
        .bind(actor.tenantId, p.id)
        .run();
      await expect(
        service.publishImport(p.id, (await service.inspectImport(p.id)).publishKey!),
      ).rejects.toThrow(/immutable/);
      expect(await count("TAMPER")).toBe(0);
    });
    it("rolls back every inserted item if an authoritative category is disabled during preparation", async () => {
      const p = await preview("ROLLBACK", 2);
      await stage(p);
      const ready = await service.inspectImport(p.id);
      await service.publishImport(p.id, ready.publishKey!);
      await db
        .prepare("UPDATE inventory_categories SET active=0 WHERE tenant_id=? AND id='food'")
        .bind(actor.tenantId)
        .run();
      try {
        await expect(
          service.publishImport(p.id, ready.publishKey!, { worker: true }),
        ).rejects.toThrow(/publication invariant/);
      } finally {
        await db
          .prepare("UPDATE inventory_categories SET active=1 WHERE tenant_id=? AND id='food'")
          .bind(actor.tenantId)
          .run();
      }
      expect(await count("ROLLBACK")).toBe(0);
      expect((await service.inspectImport(p.id)).publishStatus).toBe("PUBLISHING");
      await service.publishImport(p.id, ready.publishKey!, { worker: true });
      expect(await count("ROLLBACK")).toBe(2);
    });
    it("refuses file submission when scanning is unavailable", async () => {
      const offline = new OnboardingService(db, actor, {
        SERAMET_DB: db,
        SERAMET_ENVIRONMENT: "test",
      });
      await expect(
        offline.queueImportPreparation({
          kind: "INVENTORY",
          branchId: "branch-a",
          originalName: "safe.csv",
          mimeType: "text/csv",
          bytes: new TextEncoder().encode("code,name\nA,A"),
          duplicateStrategy: "ERROR",
          idempotencyKey: "no-scanner",
        }),
      ).rejects.toThrow(/security scanning/);
    });
  });
