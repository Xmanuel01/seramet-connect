import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  applyPendingMigrations,
  createMigratedTestDatabase,
  SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

/**
 * Empty local authoritative store. Production and staging never load this module.
 * Test fixtures are applied only by createDemoFixtureDatabase below.
 */
export function createLocalDevelopmentDatabase(options: { databasePath?: string } = {}) {
  const databasePath =
    options.databasePath ?? resolve(process.cwd(), ".seramet", "development.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new SqliteD1TestDatabase(databasePath);
  applyPendingMigrations(database);
  return database;
}

/** Test-only database with explicit demonstration fixtures for historical suites. */
export function createDemoFixtureDatabase() {
  const database = createMigratedTestDatabase();
  for (const file of [
    "demo.sql",
    "pass7-demo.sql",
    "pass8-demo.sql",
    "pass9-demo.sql",
    "pass10-demo.sql",
    "pass11-demo.sql",
    "pass12-demo.sql",
  ]) {
    database.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations", "seed", file), "utf8"));
  }
  return database;
}
