import { describe, expect, it } from "vitest";
import { permissions } from "@/platform/permissions";
import { createServiceArea, updateConfiguredTable } from "./table-management-api";

const actor = {
  id: "owner-1",
  tenantId: "tenant-1",
  branchId: "branch-1",
  permissions: [permissions.tableManage],
};
type Stmt = { sql: string; values: unknown[] };
function makeDb({
  branch = true,
  area = true,
  duplicateArea = false,
  table = true,
}: { branch?: boolean; area?: boolean; duplicateArea?: boolean; table?: boolean } = {}) {
  const batches: Stmt[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement = { sql, values };
          return {
            ...statement,
            async first() {
              if (sql.includes("FROM branches")) return branch ? { id: "branch-1" } : null;
              if (sql.includes("FROM service_areas") && sql.includes("LOWER(name)"))
                return duplicateArea ? { id: "existing" } : null;
              if (sql.includes("FROM service_areas")) return area ? { id: "area-1" } : null;
              if (sql.includes("FROM restaurant_tables"))
                return table
                  ? { id: "table-1", code: "T01", seats: 4, service_area_id: "area-1" }
                  : null;
              return null;
            },
          };
        },
      };
    },
    async batch(statements: Stmt[]) {
      batches.push(statements);
      return [];
    },
  };
  return { db, batches };
}

describe("scoped dining-area creation", () => {
  it("requires table-management authority and active branch", async () => {
    const { db } = makeDb();
    await expect(
      createServiceArea(db as never, { ...actor, permissions: [] }, { name: "Dining" }),
    ).rejects.toThrow("Table management");
    await expect(
      createServiceArea(makeDb({ branch: false }).db as never, actor, { name: "Dining" }),
    ).rejects.toThrow("Active restaurant branch");
  });
  it("rejects duplicate names and invalid payloads", async () => {
    await expect(
      createServiceArea(makeDb({ duplicateArea: true }).db as never, actor, { name: "Dining" }),
    ).rejects.toThrow("already exists");
    await expect(createServiceArea(makeDb().db as never, actor, { name: "!" })).rejects.toThrow(
      "valid dining area",
    );
  });
  it("atomically writes one branch-scoped area and an audit event", async () => {
    const { db, batches } = makeDb();
    const area = await createServiceArea(db as never, actor, { name: " Dining " });
    expect(area).toMatchObject({ branchId: "branch-1", name: "Dining", active: true });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]![0]!.values).toEqual(["tenant-1", area.id, "branch-1", "Dining"]);
    expect(batches[0]![1]!.sql).toContain("SERVICE_AREA_CREATED");
  });
});
describe("scoped table editing", () => {
  it("rejects unauthorized actor, foreign area and absent table", async () => {
    const body = { seats: 2, serviceAreaId: "area-1" };
    await expect(
      updateConfiguredTable(makeDb().db as never, { ...actor, permissions: [] }, "table-1", body),
    ).rejects.toThrow("Table management");
    await expect(
      updateConfiguredTable(makeDb({ table: false }).db as never, actor, "table-1", body),
    ).rejects.toThrow("not available");
    await expect(
      updateConfiguredTable(makeDb({ area: false }).db as never, actor, "table-1", body),
    ).rejects.toThrow("not in this branch");
  });
  it("changes seats/area only and records before-and-after evidence atomically", async () => {
    const { db, batches } = makeDb();
    const result = await updateConfiguredTable(db as never, actor, "table-1", {
      seats: 2,
      serviceAreaId: "area-1",
    });
    expect(result).toMatchObject({ id: "table-1", code: "T01", seats: 2 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]![0]!.sql).not.toMatch(/UPDATE.*code/i);
    expect(batches[0]![0]!.values).toEqual([2, "area-1", "tenant-1", "branch-1", "table-1"]);
    expect(batches[0]![1]!.sql).toContain("RESTAURANT_TABLE_UPDATED");
  });
});
