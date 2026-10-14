import { afterEach, expect, test } from "vitest";
import { createEmptyTransactionState, TransactionEngine } from "./transaction-engine";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

afterEach(() => setConfigurationRepositoryForTests(undefined));

test("payroll renders an empty initial snapshot before tenant configuration arrives", () => {
  expect(
    TransactionEngine.getPayrollPreview(createEmptyTransactionState(""), "pending-branch"),
  ).toEqual([]);
});

test("populated payroll retains configured-branch lookup and existing pay calculations", () => {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  const state = createEmptyTransactionState(DEMO_TENANT_ID);
  state.employees.push({
    id: "payroll-test-employee",
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    branch: "Westlands",
    name: "Test employee",
    role: "Cashier",
    department: "Service",
    shift: "09:00-17:00",
    netMonthlyPay: 24000,
    monthlyWorkDays: 25,
    standardDailyHours: 8,
    active: true,
  });
  const rows = TransactionEngine.getPayrollPreview(state, DEMO_WESTLANDS_BRANCH_ID);
  expect(rows).toHaveLength(1);
  expect(rows[0].hourlyRate).toBe(120);
  expect(rows[0].adjustedNetPay).toBe(24000);
  expect(() => TransactionEngine.getPayrollPreview(state, "missing-branch")).toThrow(
    "No active branch",
  );
});
