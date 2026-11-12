import type { D1Database } from "@/server/database/d1";

/**
 * Remembers a passing schema-version check for this server instance, so the version is not
 * read on every request. Only a pass is remembered, and only for a minute: a database whose
 * schema moves (a migration applied ahead of a deploy) is noticed on the next check, and a
 * failing check is repeated on every request until it passes.
 */
const recheckAfterMs = 60_000;
const passedByIdentity = new Map<string, number>();
let passedByDatabase = new WeakMap<object, Map<string, number>>();

/**
 * `kind` names the check, so a weaker one (schema at least N) never stands in for a stricter
 * one (schema exactly N).
 */
export async function withCachedSchemaCheck(
  db: D1Database,
  kind: string,
  check: () => Promise<void>,
) {
  // Postgres opens a pool per request but names the database behind it; other adapters are
  // long-lived objects.
  const identity = (db as { cacheIdentity?: unknown }).cacheIdentity;
  const key = typeof identity === "string" && identity ? `${identity}#${kind}` : undefined;
  const passedAt = key ? passedByIdentity.get(key) : passedByDatabase.get(db as object)?.get(kind);
  if (passedAt !== undefined && Date.now() - passedAt < recheckAfterMs) return;
  await check();
  if (key) {
    passedByIdentity.set(key, Date.now());
    return;
  }
  const checks = passedByDatabase.get(db as object) ?? new Map<string, number>();
  checks.set(kind, Date.now());
  passedByDatabase.set(db as object, checks);
}

export function resetSchemaCheckForTests() {
  passedByIdentity.clear();
  passedByDatabase = new WeakMap();
}
