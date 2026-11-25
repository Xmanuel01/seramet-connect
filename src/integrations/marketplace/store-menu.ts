import { createMenuCatalogReader } from "@/integrations/marketplace/menu-catalog-reader";
import type { D1Database } from "@/server/database/d1";

/**
 * Which branch menu items a marketplace store sells. A branch can run several storefronts on
 * one app (for example two brands from one kitchen), each with its own menu, so the choice is
 * kept per connection as `configuration.menuItemIds`. No list means the whole branch menu.
 */
export type StoreMenu = {
  connectionId: string;
  branchId: string;
  items: Array<{ id: string; name: string; category: string; price: number }>;
  /** null: the store sells the whole branch menu. */
  selectedItemIds: string[] | null;
};

export class StoreMenuError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Narrows a branch catalog to a store's chosen items; no choice keeps the whole catalog. */
export function storeMenuCatalog<T extends { id: string }>(
  catalog: T[],
  configuration: Record<string, unknown>,
): T[] {
  const chosen = configuration["menuItemIds"];
  if (!Array.isArray(chosen)) return catalog;
  const ids = new Set(chosen.filter((id): id is string => typeof id === "string"));
  return catalog.filter((item) => ids.has(item.id));
}

export async function readStoreMenu(
  db: D1Database,
  tenantId: string,
  connectionId: string,
): Promise<StoreMenu> {
  const { branchId, payload } = await loadConnection(db, tenantId, connectionId);
  const catalog = await createMenuCatalogReader(db)(tenantId, branchId);
  const chosen = configurationOf(payload)["menuItemIds"];
  return {
    connectionId,
    branchId,
    items: catalog.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
    })),
    selectedItemIds: Array.isArray(chosen)
      ? chosen.filter((id): id is string => typeof id === "string")
      : null,
  };
}

/** Saves the store's items; `null` returns the store to the whole branch menu. */
export async function saveStoreMenu(
  db: D1Database,
  tenantId: string,
  connectionId: string,
  itemIds: string[] | null,
) {
  const { branchId, payload } = await loadConnection(db, tenantId, connectionId);
  let chosen: string[] | null = null;
  if (itemIds) {
    const catalog = new Set(
      (await createMenuCatalogReader(db)(tenantId, branchId)).map((item) => item.id),
    );
    chosen = [...new Set(itemIds)];
    const unknown = chosen.filter((id) => !catalog.has(id));
    if (unknown.length)
      throw new StoreMenuError(
        400,
        `${unknown.length} chosen item(s) are not on this branch's menu; refresh and try again`,
      );
    if (!chosen.length)
      throw new StoreMenuError(400, "Choose at least one item for this store's menu");
  }
  const configuration = { ...configurationOf(payload) };
  if (chosen) configuration["menuItemIds"] = chosen;
  else delete configuration["menuItemIds"];
  await db
    .prepare(
      "UPDATE provider_connections SET payload_json=?,updated_at=? WHERE tenant_id=? AND id=?",
    )
    .bind(
      JSON.stringify({ ...payload, configuration }),
      new Date().toISOString(),
      tenantId,
      connectionId,
    )
    .run();
  return { connectionId, selectedItemIds: chosen };
}

async function loadConnection(db: D1Database, tenantId: string, connectionId: string) {
  const row = await db
    .prepare("SELECT branch_id,payload_json FROM provider_connections WHERE tenant_id=? AND id=?")
    .bind(tenantId, connectionId)
    .first<{ branch_id: string | null; payload_json: string | null }>();
  if (!row) throw new StoreMenuError(404, "Marketplace store was not found");
  if (!row.branch_id) throw new StoreMenuError(400, "This connection is not linked to a branch");
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload_json ?? "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { branchId: row.branch_id, payload };
}

function configurationOf(payload: Record<string, unknown>) {
  const configuration = payload["configuration"];
  return configuration && typeof configuration === "object" && !Array.isArray(configuration)
    ? (configuration as Record<string, unknown>)
    : {};
}
