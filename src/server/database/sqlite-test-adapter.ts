import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import type { D1Database, D1PreparedStatement, D1Result } from "@/server/database/d1";

export class SqliteD1TestDatabase implements D1Database {
  readonly provider = "sqlite" as const;
  readonly sqlite: DatabaseSync;

  constructor(path = ":memory:") {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.sqlite, query, []);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(query: string) {
    this.sqlite.exec(query);
    return { success: true };
  }

  close() {
    this.sqlite.close();
  }
}

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: SQLInputValue[],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteD1Statement(this.database, this.query, values as SQLInputValue[]);
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.statement().get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T | null;
    return row as T;
  }

  async all<T = unknown>() {
    const rows = this.statement().all(...this.values) as T[];
    return { success: true, results: rows, meta: { rows_read: rows.length } };
  }

  async run<T = unknown>() {
    const result = this.statement().run(...this.values);
    return {
      success: true,
      results: [] as T[],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
        rows_written: Number(result.changes),
      },
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

export const migrationFiles = [
  "0001_production_schema.sql",
  "0002_reliability_runtime.sql",
  "0003_constraints_indexes.sql",
  "0004_runtime_metadata.sql",
  "0005_authoritative_record_invariants.sql",
  "0006_concurrency_guards.sql",
  "0007_inventory_procurement_intelligence.sql",
  "0008_management_intelligence_finance.sql",
  "0009_commercial_productization_onboarding.sql",
  "0010_seramet_intelligence_copilot.sql",
  "0011_crm_loyalty_customer_intelligence.sql",
  "0012_digital_guest_reservations.sql",
  "0013_enterprise_franchise_hq.sql",
  "0014_enterprise_module_access.sql",
  "0015_branch_context_authority.sql",
  "0016_commercial_launch_foundation.sql",
  "0017_guided_onboarding_multi_currency.sql",
  "0018_authoritative_menu_import.sql",
  "0019_historical_sales_migration.sql",
  "0020_identity_device_branch_hardening.sql",
] as const;

export function applyPendingMigrations(database: SqliteD1TestDatabase) {
  let currentVersion = 0;
  try {
    currentVersion = Number(
      database.sqlite
        .prepare("SELECT COALESCE(MAX(version),0) version FROM schema_migrations")
        .get()?.["version"] ?? 0,
    );
  } catch {
    currentVersion = 0;
  }
  for (const file of migrationFiles) {
    const version = Number(file.slice(0, 4));
    if (version <= currentVersion) continue;
    database.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations", file), "utf8"));
  }
  return database;
}

export function createMigratedTestDatabase() {
  const database = new SqliteD1TestDatabase();
  applyPendingMigrations(database);
  return database;
}
