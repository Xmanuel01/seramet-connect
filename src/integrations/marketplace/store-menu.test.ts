import { describe, expect, it } from "vitest";
import { saveStoreMenu, storeMenuCatalog } from "./store-menu";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

const catalog = [{ id: "pilau" }, { id: "nyama-choma" }, { id: "chips" }];

describe("marketplace store menu", () => {
  it("keeps the whole branch menu until a store has its own list", () => {
    expect(storeMenuCatalog(catalog, {})).toEqual(catalog);
    expect(storeMenuCatalog(catalog, { menuItemIds: ["nyama-choma", "chips"] })).toEqual([
      { id: "nyama-choma" },
      { id: "chips" },
    ]);
    expect(storeMenuCatalog(catalog, { menuItemIds: [] })).toEqual([]);
  });

  it("saves only items on the branch menu and keeps the rest of the configuration", async () => {
    const writes: unknown[][] = [];
    const statement = (query: string, values: unknown[] = []): D1PreparedStatement => ({
      bind: (...next) => statement(query, next),
      first: async <T>() =>
        (query.includes("FROM provider_connections")
          ? {
              branch_id: "branch-1",
              payload_json: JSON.stringify({
                displayName: "Uber Eats · Grill",
                configuration: { externalStoreId: "store-1", orderChannelId: "channel-1" },
              }),
            }
          : null) as T,
      all: async <T>() =>
        ({
          results: query.includes("FROM menu_catalog_items")
            ? catalog.map((item) => ({
                ...item,
                code: item.id,
                sku: null,
                name: item.id,
                category_code: "MAINS",
                selling_price_minor: 50000,
                currency: "KES",
                station_code: null,
                branch_price_minor: null,
                available: 1,
              }))
            : [],
        }) as { results: T[] },
      run: async <T>() => {
        writes.push(values);
        return { success: true } as { success: boolean; results?: T[] };
      },
    });
    const db: D1Database = {
      prepare: (query) => statement(query),
      batch: async <T>(statements: D1PreparedStatement[]) =>
        Promise.all(statements.map((item) => item.run<T>())),
    };

    await expect(saveStoreMenu(db, "tenant-1", "connection-1", ["unknown"])).rejects.toThrow(
      /not on this branch's menu/,
    );
    await expect(saveStoreMenu(db, "tenant-1", "connection-1", [])).rejects.toThrow(
      /at least one item/,
    );
    await saveStoreMenu(db, "tenant-1", "connection-1", ["chips", "nyama-choma", "chips"]);
    const saved = JSON.parse(String(writes.at(-1)![0])) as {
      displayName: string;
      configuration: Record<string, unknown>;
    };
    expect(saved.displayName).toBe("Uber Eats · Grill");
    expect(saved.configuration).toEqual({
      externalStoreId: "store-1",
      orderChannelId: "channel-1",
      menuItemIds: ["chips", "nyama-choma"],
    });
  });
});
