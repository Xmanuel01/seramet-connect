import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SerametEnv, ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";

let actor: ServerActor;
vi.mock("@/lib/seramet-auth", async (original) => ({
  ...(await original<typeof import("@/lib/seramet-auth")>()),
  authenticateSerametRequest: vi.fn(async () => actor),
}));
import { handleAttendanceApi } from "./attendance-api";
import { handleCrmApi } from "./crm-api";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";
let db: SqliteD1TestDatabase;
let env: SerametEnv;
const request = (path: string) => new Request("https://disposable.invalid" + path);

describe("attendance and customer API read/error contracts in disposable memory", () => {
  beforeEach(() => {
    db = createDemoFixtureDatabase();
    const user = db.sqlite
      .prepare("SELECT user_id FROM user_branches WHERE tenant_id=? AND branch_id=? LIMIT 1")
      .get(tenantId, branchId) as { user_id: string };
    actor = {
      id: user.user_id,
      name: "Test operator",
      tenantId,
      branchId,
      branch: "Westlands",
      role: "Manager",
      roleIds: [],
      authLevel: "FULL",
      permissions: Object.values(permissions),
      assignedBranchIds: [branchId],
      assignedBranches: [{ id: branchId, name: "Westlands" }],
      branchScope: { type: "BRANCH", branchId },
    };
    env = { SERAMET_DB: db, SERAMET_ENVIRONMENT: "development" } as SerametEnv;
  });
  afterEach(() => db.close());

  it("returns the attendance page payload with a disabled, unconfigured geofence", async () => {
    const response = await handleAttendanceApi(
      request(`/api/seramet/attendance?branchId=${branchId}`),
      env,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("no-store");
    expect(await response?.json()).toMatchObject({
      ok: true,
      branchId,
      records: [],
      geofence: { enabled: false },
      employees: expect.any(Array),
    });
  });
  it("rejects forbidden attendance branches and permissions and missing database", async () => {
    await expect(
      handleAttendanceApi(request("/api/seramet/attendance?branchId=foreign"), env),
    ).rejects.toMatchObject({ status: 403 });
    actor = { ...actor, permissions: [] };
    await expect(
      handleAttendanceApi(request(`/api/seramet/attendance?branchId=${branchId}`), env),
    ).rejects.toMatchObject({ status: 403 });
    await expect(handleAttendanceApi(request("/api/seramet/attendance"), {})).rejects.toMatchObject(
      { status: 503, code: "DATABASE_UNAVAILABLE" },
    );
  });
  it("returns customer directory/profile JSON and maps domain and validation failures", async () => {
    const response = await handleCrmApi(
      request(`/api/seramet/crm/customers?branchId=${branchId}`),
      env,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("no-store");
    const body = (await response?.json()) as { customers: Array<{ id: string }> };
    expect(body.customers.length).toBeGreaterThan(0);
    const profile = await handleCrmApi(
      request(`/api/seramet/crm/customers/${body.customers[0].id}`),
      env,
    );
    expect(profile?.status).toBe(200);
    await expect(
      handleCrmApi(request("/api/seramet/crm/customers/missing"), env),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      handleCrmApi(request("/api/seramet/crm/customers?limit=not-an-integer"), env),
    ).rejects.toMatchObject({ status: 400 });
    actor = { ...actor, permissions: [] };
    await expect(handleCrmApi(request("/api/seramet/crm/customers"), env)).rejects.toMatchObject({
      status: 403,
    });
    await expect(handleCrmApi(request("/api/seramet/crm/customers"), {})).rejects.toMatchObject({
      status: 503,
      code: "DATABASE_UNAVAILABLE",
    });
  });
});
