import { readdirSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getVisibleNavGroups, navGroups } from "@/components/app/nav";
import {
  buildModuleAccessProfile,
  canAccessPath,
  moduleAccessRegistry,
  moduleDecision,
  moduleDefinitionsForPath,
  type ModuleAction,
  type ModuleKey,
} from "@/platform/module-access-registry";
import type { EnterpriseNodeType } from "@/enterprise/types";
import { permissions } from "@/platform/permissions";
import { createDefaultDemoPlatformState, DEMO_TENANT_ID } from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

describe("enterprise module access registry", () => {
  beforeEach(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
  });

  it("registers every staff route and every visible navigation target", () => {
    const routePaths = readdirSync("src/routes")
      .filter(
        (file) =>
          file.endsWith(".tsx") &&
          file !== "__root.tsx" &&
          file !== "login.tsx" &&
          file !== "register.tsx" &&
          !file.startsWith("guest.") &&
          file !== "guest.$restaurant.tsx",
      )
      .map(routePathFromFile);
    expect(routePaths.filter((path) => moduleDefinitionsForPath(path).length === 0)).toEqual([]);
    const navPaths = navGroups.flatMap((group) => group.items.flatMap((item) => item.to ?? []));
    expect(navPaths.filter((path) => moduleDefinitionsForPath(path).length === 0)).toEqual([]);
  });

  it("defines navigation, route, action, scope, entitlement and policy metadata", () => {
    expect(moduleAccessRegistry.length).toBeGreaterThanOrEqual(32);
    for (const module of moduleAccessRegistry) {
      expect(module.key).toBeTruthy();
      expect(module.label).toBeTruthy();
      expect(module.navigationPermission).toBeTruthy();
      expect(module.routePermission).toBeTruthy();
      expect(Object.keys(module.actionPermissions).sort()).toEqual([
        "APPROVE",
        "CREATE",
        "EDIT",
        "READ",
        "SENSITIVE",
      ]);
      expect(module.supportedScopes.length).toBeGreaterThan(0);
      expect(module.policyCode).toMatch(/^MODULE_ACCESS\./);
    }
  });

  it("keeps view, create, edit, approval and sensitive invoice authority separate", () => {
    const profile = branchProfile([permissions.invoicesView]);
    const invoice = moduleDecision(profile, "invoices")!;
    expect(invoice.route).toBe(true);
    expect(invoice.actions.READ).toBe(true);
    expect(invoice.actions.CREATE).toBe(false);
    expect(invoice.actions.EDIT).toBe(false);
    expect(invoice.actions.APPROVE).toBe(false);
    expect(invoice.actions.SENSITIVE).toBe(false);
  });

  it("shows waiter operational tabs without exposing finance or HQ", () => {
    const actorPermissions = [
      permissions.posAccess,
      permissions.ordersView,
      permissions.ordersCreate,
      permissions.ordersUpdate,
    ];
    const profile = branchProfile(actorPermissions);
    const labels = getVisibleNavGroups(
      "Configured service role",
      "Westlands",
      actorPermissions,
      DEMO_TENANT_ID,
      profile,
    ).flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toContain("POS");
    expect(labels).toContain("Orders");
    expect(labels).not.toContain("Enterprise");
    expect(labels).not.toContain("General Ledger");
    expect(canAccessPath(profile, "/enterprise")).toBe(false);
  });

  it("allows branch operations without letting branch authority climb to HQ", () => {
    const profile = branchProfile([
      permissions.dashboardView,
      permissions.posAccess,
      permissions.ordersView,
      permissions.inventoryView,
      permissions.procurementView,
      permissions.reportsView,
      permissions.enterpriseView,
    ]);
    expect(canAccessPath(profile, "/inventory")).toBe(true);
    expect(canAccessPath(profile, "/reports")).toBe(true);
    expect(canAccessPath(profile, "/enterprise")).toBe(false);
    expect(moduleDecision(profile, "hq-command")?.reasons).toContain("ORGANIZATIONAL_SCOPE_DENIED");
  });

  it("allows a regional actor only the enterprise tabs backed by permissions", () => {
    const profile = buildModuleAccessProfile({
      permissions: [
        permissions.enterpriseView,
        permissions.enterprisePolicyView,
        permissions.enterpriseReadinessView,
      ],
      organizationalScopes: ["REGION", "BRANCH"],
      entitlements: [],
      entitlementsEnforced: false,
    });
    expect(canAccessPath(profile, "/enterprise")).toBe(true);
    expect(moduleDecision(profile, "hq-command")?.route).toBe(true);
    expect(moduleDecision(profile, "policies")?.route).toBe(true);
    expect(moduleDecision(profile, "compliance")?.route).toBe(true);
    expect(moduleDecision(profile, "rollouts")?.route).toBe(false);
    expect(moduleDecision(profile, "enterprise-finance")?.route).toBe(false);
  });

  it("keeps franchise and finance views constrained to their granted modules", () => {
    const franchise = buildModuleAccessProfile({
      permissions: [permissions.enterpriseView, permissions.enterpriseFranchiseView],
      organizationalScopes: ["LEGAL_ENTITY", "BRANCH"],
      entitlements: [],
      entitlementsEnforced: false,
    });
    const finance = buildModuleAccessProfile({
      permissions: [permissions.enterpriseView, permissions.enterpriseFinanceView],
      organizationalScopes: ["GROUP"],
      entitlements: [],
      entitlementsEnforced: false,
    });
    expect(moduleDecision(franchise, "franchises")?.route).toBe(true);
    expect(moduleDecision(franchise, "enterprise-finance")?.route).toBe(false);
    expect(moduleDecision(finance, "enterprise-finance")?.route).toBe(true);
    expect(moduleDecision(finance, "franchises")?.route).toBe(false);
  });

  it("requires configured entitlement and feature state for Ask Seramet", () => {
    const missing = buildModuleAccessProfile({
      permissions: [permissions.intelligenceAsk],
      organizationalScopes: ["BRANCH"],
      entitlements: [],
      entitlementsEnforced: true,
      featureFlags: { "intelligence.enabled": true },
    });
    const disabled = buildModuleAccessProfile({
      permissions: [permissions.intelligenceAsk],
      organizationalScopes: ["BRANCH"],
      entitlements: ["intelligence.basic"],
      entitlementsEnforced: true,
      featureFlags: { "intelligence.enabled": false },
    });
    const enabled = buildModuleAccessProfile({
      permissions: [permissions.intelligenceAsk],
      organizationalScopes: ["BRANCH"],
      entitlements: ["intelligence.basic"],
      entitlementsEnforced: true,
      featureFlags: { "intelligence.enabled": true },
    });
    expect(canAccessPath(missing, "/ai")).toBe(false);
    expect(canAccessPath(disabled, "/ai")).toBe(false);
    expect(canAccessPath(enabled, "/ai")).toBe(true);
  });

  it("applies an effective module policy as a deny-only constraint", () => {
    const profile = buildModuleAccessProfile({
      permissions: [permissions.inventoryView],
      organizationalScopes: ["BRANCH"],
      entitlements: [],
      entitlementsEnforced: false,
      policies: { inventory: "DENY" },
    });
    expect(canAccessPath(profile, "/inventory")).toBe(false);
    expect(moduleDecision(profile, "inventory")?.reasons).toContain("POLICY_DENIED");
  });

  it("derives authority from permissions and scope, never a role name", () => {
    const denied = branchProfile([]);
    const allowed = branchProfile([permissions.posAccess]);
    expect(canAccessPath(denied, "/pos")).toBe(false);
    expect(canAccessPath(allowed, "/pos")).toBe(true);
  });

  it("shows granted pages even when a branch has no hardware profile", () => {
    const actorPermissions = [permissions.posAccess, permissions.ordersView];
    const profile = branchProfile(actorPermissions);
    const paths = getVisibleNavGroups(
      "Configured service role",
      "Branch without hardware setup",
      actorPermissions,
      DEMO_TENANT_ID,
      profile,
    ).flatMap((group) => group.items.flatMap((item) => item.to ?? []));

    expect(paths).toContain("/pos");
    expect(paths).toContain("/orders");
    expect(paths).not.toContain("/accounting");
  });

  it.each([
    actorCase(
      "Waiter",
      [permissions.posAccess, permissions.ordersView, permissions.ordersCreate],
      ["BRANCH"],
      "orders",
      "finance",
      "/orders",
      "/finance",
      ["orders", "CREATE"],
      ["orders", "SENSITIVE"],
    ),
    actorCase(
      "Cashier",
      [
        permissions.posAccess,
        permissions.ordersView,
        permissions.invoicesView,
        permissions.receiptsView,
        permissions.paymentsView,
        permissions.paymentsCollect,
      ],
      ["BRANCH"],
      "payments",
      "inventory",
      "/payment-control",
      "/inventory",
      ["payments", "CREATE"],
      ["payments", "APPROVE"],
    ),
    actorCase(
      "Supervisor",
      [
        permissions.dashboardView,
        permissions.ordersView,
        permissions.ordersUpdate,
        permissions.inventoryView,
        permissions.inventoryAdjust,
        permissions.reportsView,
      ],
      ["BRANCH"],
      "inventory",
      "hq-command",
      "/inventory",
      "/enterprise",
      ["inventory", "EDIT"],
      ["inventory", "APPROVE"],
    ),
    actorCase(
      "Branch Manager",
      [
        permissions.dashboardView,
        permissions.posAccess,
        permissions.ordersView,
        permissions.invoicesView,
        permissions.receiptsView,
        permissions.inventoryView,
        permissions.procurementView,
        permissions.procurementApprove,
        permissions.kitchenView,
        permissions.reportsView,
      ],
      ["BRANCH"],
      "procurement",
      "hq-command",
      "/procurement",
      "/enterprise",
      ["procurement", "APPROVE"],
      ["procurement", "SENSITIVE"],
    ),
    actorCase(
      "Regional Manager",
      [permissions.enterpriseView, permissions.enterprisePolicyView, permissions.reportsView],
      ["REGION", "BRANCH"],
      "policies",
      "finance",
      "/enterprise",
      "/finance",
      ["policies", "READ"],
      ["policies", "EDIT"],
    ),
    actorCase(
      "General Manager",
      [
        permissions.enterpriseView,
        permissions.enterpriseOrganisationManage,
        permissions.enterpriseAccessManage,
      ],
      ["GROUP", "LEGAL_ENTITY", "BRAND", "REGION", "AREA", "BRANCH"],
      "organization",
      "staff",
      "/enterprise",
      "/payroll",
      ["organization", "APPROVE"],
      ["enterprise-audit", "SENSITIVE"],
    ),
    actorCase(
      "CFO",
      [
        permissions.financeView,
        permissions.accountingView,
        permissions.enterpriseView,
        permissions.enterpriseFinanceView,
      ],
      ["GROUP"],
      "enterprise-finance",
      "users",
      "/finance",
      "/settings",
      ["enterprise-finance", "READ"],
      ["enterprise-finance", "APPROVE"],
    ),
    actorCase(
      "Owner",
      [
        permissions.enterpriseView,
        permissions.enterpriseRolloutView,
        permissions.enterpriseRolloutApprove,
        permissions.enterpriseFinanceView,
        permissions.enterpriseAuditView,
        permissions.usersView,
      ],
      ["GROUP"],
      "rollouts",
      "ai",
      "/enterprise",
      "/ai",
      ["rollouts", "APPROVE"],
      ["users", "SENSITIVE"],
    ),
    actorCase(
      "Franchisee",
      [
        permissions.enterpriseView,
        permissions.enterpriseFranchiseView,
        permissions.inventoryView,
        permissions.financeView,
      ],
      ["LEGAL_ENTITY", "BRANCH"],
      "franchises",
      "enterprise-finance",
      "/inventory",
      "/accounting",
      ["franchises", "READ"],
      ["franchises", "EDIT"],
    ),
  ])(
    "$label receives only its configured navigation, route and action authority",
    ({
      permissionCodes,
      scopes,
      visibleModule,
      hiddenModule,
      allowedPath,
      deniedPath,
      permittedAction,
      prohibitedAction,
    }) => {
      const profile = buildModuleAccessProfile({
        permissions: permissionCodes,
        organizationalScopes: scopes,
        entitlements: [],
        entitlementsEnforced: false,
      });
      expect(moduleDecision(profile, visibleModule)?.navigation).toBe(true);
      expect(moduleDecision(profile, hiddenModule)?.navigation).toBe(false);
      expect(canAccessPath(profile, allowedPath)).toBe(true);
      expect(canAccessPath(profile, deniedPath)).toBe(false);
      expect(moduleDecision(profile, permittedAction[0])?.actions[permittedAction[1]]).toBe(true);
      expect(moduleDecision(profile, prohibitedAction[0])?.actions[prohibitedAction[1]]).toBe(
        false,
      );
    },
  );
});

function actorCase(
  label: string,
  permissionCodes: string[],
  scopes: EnterpriseNodeType[],
  visibleModule: ModuleKey,
  hiddenModule: ModuleKey,
  allowedPath: string,
  deniedPath: string,
  permittedAction: [ModuleKey, ModuleAction],
  prohibitedAction: [ModuleKey, ModuleAction],
) {
  return {
    label,
    permissionCodes,
    scopes,
    visibleModule,
    hiddenModule,
    allowedPath,
    deniedPath,
    permittedAction,
    prohibitedAction,
  };
}

function branchProfile(permissionCodes: string[]) {
  return buildModuleAccessProfile({
    permissions: permissionCodes,
    organizationalScopes: ["BRANCH"],
    entitlements: [],
    entitlementsEnforced: false,
  });
}

function routePathFromFile(file: string) {
  if (file === "index.tsx") return "/";
  const route = file.replace(/\.tsx$/, "");
  if (route === "items.$sku") return "/items/example";
  return `/${route}`;
}
