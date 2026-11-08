import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { payrollAttendance } from "@/server/payroll-attendance";
import { createEmptyTransactionState, TransactionEngine } from "@/lib/transaction-engine";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";
let db: SqliteD1TestDatabase;
let actor: ServerActor;

function addEmployee(id: string, name: string, status = "ACTIVE", until: string | null = null) {
  const stamp = "2026-10-01T00:00:00.000Z";
  db.sqlite
    .prepare(
      "INSERT INTO users(tenant_id,id,name,email,employee_code,job_title,employment_status,active,effective_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      tenantId,
      id,
      name,
      `${id}@example.test`,
      id.toUpperCase(),
      "Cook",
      status,
      status === "ACTIVE" ? 1 : 0,
      until,
      stamp,
      stamp,
    );
  db.sqlite.prepare("INSERT INTO user_branches VALUES(?,?,?)").run(tenantId, id, branchId);
  db.sqlite
    .prepare(
      "INSERT INTO user_primary_branches(tenant_id,user_id,branch_id,assigned_at) VALUES(?,?,?,?)",
    )
    .run(tenantId, id, branchId, stamp);
}

function addShift(userId: string, date: string, inAt: string, outAt: string | null, late: number) {
  db.sqlite
    .prepare(
      "INSERT INTO employee_attendance_sessions(tenant_id,id,user_id,branch_id,business_date,clock_in_at,clock_out_at,clock_in_key,minutes_late,clock_in_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'SUPERVISOR',?,?)",
    )
    .run(
      tenantId,
      crypto.randomUUID(),
      userId,
      branchId,
      date,
      inAt,
      outAt,
      crypto.randomUUID(),
      late,
      inAt,
      inAt,
    );
}

beforeEach(() => {
  db = createDemoFixtureDatabase();
  actor = {
    id: "payroll-manager",
    name: "Payroll manager",
    tenantId,
    branchId,
    branch: "Westlands",
    authLevel: "FULL",
    role: "Manager",
    roleIds: [],
    permissions: [permissions.payrollManage],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Westlands" }],
    branchScope: { type: "BRANCH", branchId },
  } as unknown as ServerActor;
});
afterEach(() => {
  db.close();
  setConfigurationRepositoryForTests();
});

describe("payroll attendance", () => {
  it("totals a month of real clock-ins per employee, including someone who left", async () => {
    addEmployee("cook-a", "Cook A");
    addEmployee("cook-b", "Cook B", "TERMINATED", "2026-11-10T09:00:00.000Z");
    addEmployee("cook-c", "Cook C", "TERMINATED", "2026-10-20T09:00:00.000Z");
    addShift("cook-a", "2026-11-02", "2026-11-02T05:00:00.000Z", "2026-11-02T13:30:00.000Z", 15);
    addShift("cook-a", "2026-11-03", "2026-11-03T05:00:00.000Z", "2026-11-03T13:00:00.000Z", 0);
    addShift("cook-a", "2026-11-04", "2026-11-04T05:00:00.000Z", null, 5);
    addShift("cook-a", "2026-10-31", "2026-10-31T05:00:00.000Z", "2026-10-31T13:00:00.000Z", 60);

    const result = await payrollAttendance(db, actor, branchId, "2026-11");
    const byId = Object.fromEntries(result.employees.map((row) => [row.id, row]));
    expect(byId["cook-a"]).toMatchObject({
      daysWorked: 3,
      workedMinutes: 510 + 480,
      lateMinutes: 20,
      openShifts: 1,
      left: false,
    });
    // Left during November: still on November's payroll. Left in October: not.
    expect(byId["cook-b"]).toMatchObject({ left: true, daysWorked: 0 });
    expect(byId["cook-c"]).toBeUndefined();
  });

  it("refuses without payroll permission, a bad month or another branch", async () => {
    await expect(
      payrollAttendance(db, { ...actor, permissions: [] }, branchId, "2026-11"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(payrollAttendance(db, actor, branchId, "2026-13")).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      payrollAttendance(db, actor, "branch-somewhere-else", "2026-11"),
    ).rejects.toBeTruthy();
  });

  it("creates a pay record the first time pay is set for a register employee", () => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    const state = createEmptyTransactionState(DEMO_TENANT_ID);
    const next = TransactionEngine.setEmployeeNetPay(state, "cook-a", 30000, "Owner", {
      name: "Cook A",
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      branch: "Westlands",
      role: "Cook",
    });
    expect(next.employees.find((employee) => employee.id === "cook-a")).toMatchObject({
      netMonthlyPay: 30000,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      monthlyWorkDays: 26,
      standardDailyHours: 8,
    });
    // Without a profile an unknown id is still ignored, and negative pay never saves.
    expect(
      TransactionEngine.setEmployeeNetPay(state, "ghost", 100, "Owner").employees,
    ).toHaveLength(0);
    expect(
      TransactionEngine.setEmployeeNetPay(next, "cook-a", -1, "Owner").employees.find(
        (employee) => employee.id === "cook-a",
      )?.netMonthlyPay,
    ).toBe(30000);
  });
});
