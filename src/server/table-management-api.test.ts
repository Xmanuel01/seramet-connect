import { describe, expect, it } from "vitest";
import { permissions } from "@/platform/permissions";
import { createConfiguredTable, parseCreateTableInput } from "./table-management-api";

const actor = {
  id: "owner",
  tenantId: "tenant-mona",
  branchId: "branch-westlands",
  permissions: [permissions.tableManage],
};
type Statement = { sql: string; values: unknown[] };
function mockDatabase(input: { area?: boolean; duplicate?: boolean; branch?: boolean } = {}) {
  const statements: Statement[] = [];
  const batches: Statement[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement = { sql, values };
          statements.push(statement);
          return {
            ...statement,
            async first() {
              if (sql.includes("FROM branches"))
                return input.branch === false ? null : { id: actor.branchId };
              if (sql.includes("FROM service_areas"))
                return input.area === false ? null : { id: "area-westlands" };
              if (sql.includes("FROM restaurant_tables"))
                return input.duplicate ? { id: "existing" } : null;
              return null;
            },
          };
        },
      };
    },
    async batch(batch: Statement[]) {
      batches.push(batch);
      return [];
    },
  };
  return { db, statements, batches };
}

describe("authorized table configuration", () => {
  it("rejects invalid capacity and unsafe table codes", () => {
    expect(() => parseCreateTableInput({ code: "T01", seats: 0 })).toThrow();
    expect(() => parseCreateTableInput({ code: "T01", seats: 31 })).toThrow();
    expect(() => parseCreateTableInput({ code: "T01';DROP TABLE", seats: 4 })).toThrow();
    expect(parseCreateTableInput({ code: "T01", seats: 4 })).toMatchObject({
      code: "T01",
      seats: 4,
    });
  });
  it("requires explicit permission and a valid authorized active branch", async () => {
    const { db } = mockDatabase();
    await expect(
      createConfiguredTable(db as never, { ...actor, permissions: [] }, { code: "T01", seats: 4 }),
    ).rejects.toThrow("Table management permission");
    const missing = mockDatabase({ branch: false });
    await expect(
      createConfiguredTable(missing.db as never, actor, { code: "T01", seats: 4 }),
    ).rejects.toThrow("Active restaurant branch");
  });
  it("rejects cross-branch areas and existing table identities before making changes", async () => {
    const foreign = mockDatabase({ area: false });
    await expect(
      createConfiguredTable(foreign.db as never, actor, {
        code: "T02",
        seats: 2,
        serviceAreaId: "area-other-branch",
      }),
    ).rejects.toThrow("not in this branch");
    expect(foreign.batches).toHaveLength(0);
    const duplicate = mockDatabase({ duplicate: true });
    await expect(
      createConfiguredTable(duplicate.db as never, actor, {
        code: "T01",
        seats: 2,
      }),
    ).rejects.toThrow("already exists");
    expect(duplicate.batches).toHaveLength(0);
  });
  it("writes just one scoped restaurant table and immutable audit in the same atomic batch", async () => {
    const { db, batches } = mockDatabase();
    const result = await createConfiguredTable(db as never, actor, {
      code: "t03",
      seats: 6,
      serviceAreaId: "area-westlands",
    });
    expect(result).toMatchObject({
      code: "T03",
      seats: 6,
      branchId: "branch-westlands",
      serviceAreaId: "area-westlands",
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]![0]!.sql).toContain("INSERT INTO restaurant_tables");
    expect(batches[0]![0]!.values).toEqual([
      "tenant-mona",
      result.id,
      "branch-westlands",
      "area-westlands",
      "T03",
      6,
    ]);
    expect(batches[0]![1]!.sql).toContain("INSERT INTO audit_events");
    expect(batches[0]![1]!.values).toContain("owner");
  });
});
