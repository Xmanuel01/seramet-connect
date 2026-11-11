import type { SerametEnv } from "@/lib/seramet-auth";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { hydrateTenantConfiguration } from "@/server/database/authoritative-configuration";
import type { D1Database } from "@/server/database/d1";

/**
 * Tests only: loads the configuration of every restaurant seeded in a test database, each
 * through its own tenant-filtered load. Servers load a restaurant only when a request acts for
 * it; tests that call services directly (or mock authentication) have no such request.
 */
export async function hydrateSeededTenantsForTests(db: D1Database, env: SerametEnv = {}) {
  const tenants = await db
    .prepare("SELECT id FROM tenants WHERE active = 1 ORDER BY created_at,id")
    .all<{ id: string }>();
  let repository = getConfigurationRepository();
  for (const tenant of tenants.results ?? []) {
    repository = await hydrateTenantConfiguration(db, env, tenant.id, true);
  }
  return repository;
}
