import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createEmptyTransactionState } from "@/lib/transaction-engine";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import { afterEach } from "vitest";

const scope = vi.hoisted(() => ({ all: false, populated: false }));

vi.mock("@/components/app/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/app-context", () => ({
  useAppContext: () => ({
    activeTenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    branch: scope.all ? "All Branches" : "Westlands",
    isAllBranches: scope.all,
    branchLabel: "Render branch",
    currentUser: { id: "render-user", permissions: [] },
    hasPermission: () => false,
  }),
}));
vi.mock("@/hooks/use-transaction-engine", () => ({
  useTransactionEngine: () => {
    const state = createEmptyTransactionState(DEMO_TENANT_ID);
    if (scope.all || scope.populated)
      state.employees.push({
        id: "render-employee",
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
    return { state, backendStatus: "loading", mutate: vi.fn() };
  },
}));
import { Route as attendance } from "@/routes/attendance";
import { Route as payroll } from "@/routes/payroll";

describe("workforce route initial render without a browser", () => {
  afterEach(() => {
    scope.all = false;
    scope.populated = false;
    setConfigurationRepositoryForTests(undefined);
  });
  it.each([
    ["attendance", attendance],
    ["payroll", payroll],
  ] as const)("renders %s", (_, route) => {
    const component = route.options.component as () => ReactNode;
    expect(renderToStaticMarkup(createElement(component))).not.toBe("");
  });
  it("requires a branch instead of crashing on populated all-branch payroll", () => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    scope.all = true;
    const component = payroll.options.component as () => ReactNode;
    expect(renderToStaticMarkup(createElement(component))).toContain("Select a single branch");
  });
  it("renders configured branch payroll without enabling writes for a read-only user", () => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    scope.populated = true;
    const component = payroll.options.component as () => ReactNode;
    const html = renderToStaticMarkup(createElement(component));
    expect(html).toContain("Test employee");
    expect(html).toMatch(/aria-label="Base net pay for Test employee" disabled=""/);
  });
});
