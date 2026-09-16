import type { Product } from "@/lib/menu-product";
import { majorFromMinor } from "@/payments/money";
import type { D1Database } from "@/server/database/d1";

export type MenuCatalogReader = (tenantId: string, branchId: string) => Promise<Product[]>;

export function createMenuCatalogReader(database?: D1Database): MenuCatalogReader {
  if (!database) return async () => [];
  return async (tenantId, branchId) => {
    const result = await database
      .prepare(
        `SELECT m.id,m.code,m.sku,m.name,m.category_code,m.selling_price_minor,m.currency,
                s.code station_code,bs.selling_price_minor branch_price_minor,bs.available
         FROM menu_catalog_items m
         JOIN menu_item_branch_settings bs ON bs.tenant_id=m.tenant_id
           AND bs.menu_item_id=m.id AND bs.branch_id=?
         LEFT JOIN stations s ON s.tenant_id=m.tenant_id
           AND s.id=COALESCE(bs.station_id,m.station_id) AND s.branch_id=?
         WHERE m.tenant_id=? AND m.active=1 AND m.sellable=1 AND bs.available=1
         ORDER BY m.category_code,m.name LIMIT 5000`,
      )
      .bind(branchId, branchId, tenantId)
      .all<{
        id: string;
        code: string;
        sku: string | null;
        name: string;
        category_code: string;
        selling_price_minor: number;
        currency: string;
        station_code: string | null;
        branch_price_minor: number | null;
        available: number | null;
      }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      itemCode: row.code,
      ...(row.sku ? { sku: row.sku } : {}),
      name: row.name,
      category: row.category_code.replaceAll("_", " "),
      price: majorFromMinor(row.branch_price_minor ?? row.selling_price_minor, row.currency),
      prep: 0,
      out: row.available === 0,
      productionStation: row.station_code ?? "NONE",
      importSource: "menu-import" as const,
    }));
  };
}
