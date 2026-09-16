import type { EnterpriseNodeType } from "@/enterprise/types";
import { permissions } from "@/platform/permissions";
import type { PermissionCode } from "@/platform/types";

export type ModuleAction = "READ" | "CREATE" | "EDIT" | "APPROVE" | "SENSITIVE";

export type PermissionRequirement =
  | PermissionCode
  | { allOf: readonly PermissionCode[] }
  | { anyOf: readonly PermissionCode[] }
  | null;

export type ModuleKey =
  | "dashboard"
  | "pos"
  | "orders"
  | "invoices"
  | "receipts"
  | "payments"
  | "guest-operations"
  | "delivery"
  | "kitchen"
  | "production"
  | "cost-control"
  | "inventory"
  | "warehouses"
  | "transfers"
  | "procurement"
  | "crm"
  | "loyalty"
  | "staff"
  | "finance"
  | "accounting"
  | "reports"
  | "management"
  | "marketing"
  | "audit"
  | "users"
  | "setup"
  | "hardware"
  | "integrations"
  | "ai"
  | "hq-command"
  | "organization"
  | "franchises"
  | "policies"
  | "rollouts"
  | "central-procurement"
  | "compliance"
  | "enterprise-finance"
  | "enterprise-audit";

export type ModuleAccessDefinition = {
  key: ModuleKey;
  label: string;
  navigationPermission: PermissionRequirement;
  routePermission: PermissionRequirement;
  actionPermissions: Record<ModuleAction, PermissionRequirement>;
  supportedScopes: readonly EnterpriseNodeType[];
  entitlement?: string;
  featureFlag?: string;
  policyCode: string;
  routes: readonly string[];
  routePrefixes?: readonly string[];
};

export type ModulePolicyDecision = "ALLOW" | "DENY";

export type ModuleAccessContext = {
  permissions: readonly PermissionCode[];
  organizationalScopes: readonly EnterpriseNodeType[];
  entitlements: readonly string[];
  entitlementsEnforced: boolean;
  featureFlags?: Readonly<Record<string, boolean>>;
  policies?: Partial<Record<ModuleKey, ModulePolicyDecision>>;
};

export type ModuleAccessDecision = {
  moduleKey: ModuleKey;
  navigation: boolean;
  route: boolean;
  actions: Record<ModuleAction, boolean>;
  authorizedScopes: EnterpriseNodeType[];
  entitlement: string | null;
  policy: ModulePolicyDecision;
  reasons: string[];
};

export type ModuleAccessProfile = {
  registryVersion: 1;
  accessRevision: number;
  generatedAt: string;
  decisions: ModuleAccessDecision[];
};

const branchScopes = ["GROUP", "LEGAL_ENTITY", "BRAND", "REGION", "AREA", "BRANCH"] as const;
const stockScopes = [...branchScopes, "WAREHOUSE", "COMMISSARY"] as const;
const hqScopes = ["GROUP", "LEGAL_ENTITY", "BRAND", "REGION", "AREA"] as const;

const actions = (
  read: PermissionRequirement,
  create: PermissionRequirement = null,
  edit: PermissionRequirement = null,
  approve: PermissionRequirement = null,
  sensitive: PermissionRequirement = null,
): Record<ModuleAction, PermissionRequirement> => ({
  READ: read,
  CREATE: create,
  EDIT: edit,
  APPROVE: approve,
  SENSITIVE: sensitive,
});

const allOf = (...codes: PermissionCode[]): PermissionRequirement => ({ allOf: codes });
const anyOf = (...codes: PermissionCode[]): PermissionRequirement => ({ anyOf: codes });

export const moduleAccessRegistry: readonly ModuleAccessDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    navigationPermission: permissions.dashboardView,
    routePermission: permissions.dashboardView,
    actionPermissions: actions(
      permissions.dashboardView,
      null,
      null,
      null,
      permissions.branchSwitch,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.DASHBOARD",
    routes: ["/"],
  },
  {
    key: "pos",
    label: "POS",
    navigationPermission: permissions.posAccess,
    routePermission: permissions.posAccess,
    actionPermissions: actions(
      permissions.posAccess,
      permissions.ordersCreate,
      permissions.ordersUpdate,
      null,
      permissions.ordersCancel,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.POS",
    routes: ["/pos", "/pos-login"],
  },
  {
    key: "orders",
    label: "Orders",
    navigationPermission: permissions.ordersView,
    routePermission: permissions.ordersView,
    actionPermissions: actions(
      permissions.ordersView,
      permissions.ordersCreate,
      permissions.ordersUpdate,
      null,
      permissions.ordersCancel,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.ORDERS",
    routes: ["/orders"],
  },
  {
    key: "invoices",
    label: "Invoices",
    navigationPermission: permissions.invoicesView,
    routePermission: permissions.invoicesView,
    actionPermissions: actions(
      permissions.invoicesView,
      permissions.invoicesCreate,
      permissions.invoicesManage,
      null,
      anyOf(permissions.invoicesCancel, permissions.invoicesReprint),
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.INVOICES",
    routes: ["/invoices", "/pending"],
  },
  {
    key: "receipts",
    label: "Receipts",
    navigationPermission: permissions.receiptsView,
    routePermission: permissions.receiptsView,
    actionPermissions: actions(
      permissions.receiptsView,
      null,
      null,
      null,
      permissions.receiptsReprint,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.RECEIPTS",
    routes: ["/receipts"],
  },
  {
    key: "payments",
    label: "Payments & Reconciliation",
    navigationPermission: permissions.paymentsView,
    routePermission: permissions.paymentsView,
    actionPermissions: actions(
      permissions.paymentsView,
      permissions.paymentsCollect,
      permissions.paymentsMatch,
      permissions.paymentsRefundApprove,
      anyOf(permissions.reconciliationApprove, permissions.settlementsPost),
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.PAYMENTS",
    routes: ["/payment-control", "/reconciliation", "/refunds", "/returns"],
  },
  {
    key: "guest-operations",
    label: "Reservations & Guest Operations",
    navigationPermission: anyOf(
      permissions.reservationView,
      permissions.waitlistView,
      permissions.guestOrderView,
      permissions.tableManage,
    ),
    routePermission: anyOf(
      permissions.reservationView,
      permissions.waitlistView,
      permissions.guestOrderView,
      permissions.tableManage,
    ),
    actionPermissions: actions(
      anyOf(permissions.reservationView, permissions.waitlistView, permissions.guestOrderView),
      permissions.reservationCreate,
      permissions.reservationModify,
      anyOf(permissions.reservationSeat, permissions.guestOrderAccept),
      permissions.reservationCancel,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.GUEST_OPERATIONS",
    routes: [
      "/online-orders",
      "/tables",
      "/reservations",
      "/host",
      "/waitlist",
      "/guest-service",
      "/qr-management",
    ],
  },
  {
    key: "delivery",
    label: "Delivery",
    navigationPermission: anyOf(permissions.deliveryDispatch, permissions.ridersManage),
    routePermission: anyOf(permissions.deliveryDispatch, permissions.ridersManage),
    actionPermissions: actions(
      anyOf(permissions.deliveryDispatch, permissions.ridersManage),
      permissions.ridersManage,
      permissions.deliveryDispatch,
      null,
      permissions.ridersManage,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.DELIVERY",
    routes: ["/delivery", "/riders"],
  },
  {
    key: "kitchen",
    label: "Kitchen / KDS",
    navigationPermission: permissions.kitchenView,
    routePermission: permissions.kitchenView,
    actionPermissions: actions(
      permissions.kitchenView,
      null,
      permissions.kitchenOperate,
      permissions.ordersServe,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.KITCHEN",
    routes: ["/kitchen", "/bar", "/kitchen-analytics"],
  },
  {
    key: "production",
    label: "Production & Recipes",
    navigationPermission: permissions.productionView,
    routePermission: permissions.productionView,
    actionPermissions: actions(
      permissions.productionView,
      permissions.productionPlan,
      permissions.productionStart,
      permissions.productionComplete,
      permissions.productionAdjust,
    ),
    supportedScopes: stockScopes,
    policyCode: "MODULE_ACCESS.PRODUCTION",
    routes: ["/production", "/recipes", "/prep"],
  },
  {
    key: "cost-control",
    label: "Cost Control",
    navigationPermission: permissions.inventoryCostControlView,
    routePermission: permissions.inventoryCostControlView,
    actionPermissions: actions(
      permissions.inventoryCostControlView,
      null,
      permissions.inventoryCostControlManage,
      permissions.inventoryAdjustApprove,
    ),
    supportedScopes: stockScopes,
    policyCode: "MODULE_ACCESS.COST_CONTROL",
    routes: ["/cost-control"],
  },
  {
    key: "inventory",
    label: "Inventory",
    navigationPermission: permissions.inventoryView,
    routePermission: permissions.inventoryView,
    actionPermissions: actions(
      permissions.inventoryView,
      permissions.inventoryCount,
      permissions.inventoryAdjust,
      permissions.inventoryCountApprove,
      permissions.inventoryAdjustApprove,
    ),
    supportedScopes: stockScopes,
    policyCode: "MODULE_ACCESS.INVENTORY",
    routes: [
      "/inventory",
      "/categories",
      "/stock-detail",
      "/stock-count",
      "/adjustments",
      "/wastage",
      "/breakages",
      "/par",
    ],
    routePrefixes: ["/items/"],
  },
  {
    key: "warehouses",
    label: "Warehouses",
    navigationPermission: anyOf(permissions.inventoryView, permissions.settingsWarehouseView),
    routePermission: anyOf(permissions.inventoryView, permissions.settingsWarehouseView),
    actionPermissions: actions(
      anyOf(permissions.inventoryView, permissions.settingsWarehouseView),
      permissions.settingsWarehouseManage,
      permissions.settingsWarehouseManage,
      null,
      permissions.inventoryAdjustApprove,
    ),
    supportedScopes: stockScopes,
    policyCode: "MODULE_ACCESS.WAREHOUSES",
    routes: ["/warehouses"],
  },
  {
    key: "transfers",
    label: "Transfers",
    navigationPermission: permissions.inventoryView,
    routePermission: permissions.inventoryView,
    actionPermissions: actions(
      permissions.inventoryView,
      permissions.inventoryTransfer,
      permissions.inventoryTransfer,
      permissions.enterpriseTransferManage,
      permissions.inventoryAdjustApprove,
    ),
    supportedScopes: stockScopes,
    policyCode: "MODULE_ACCESS.TRANSFERS",
    routes: ["/transfers"],
  },
  {
    key: "procurement",
    label: "Procurement",
    navigationPermission: permissions.procurementView,
    routePermission: permissions.procurementView,
    actionPermissions: actions(
      permissions.procurementView,
      anyOf(permissions.procurementRequisitionCreate, permissions.procurementCreate),
      permissions.procurementCreate,
      anyOf(permissions.procurementRequisitionApprove, permissions.procurementApprove),
      permissions.procurementCancel,
    ),
    supportedScopes: stockScopes,
    policyCode: "MODULE_ACCESS.PROCUREMENT",
    routes: [
      "/procurement",
      "/requisitions",
      "/purchase-orders",
      "/receiving",
      "/suppliers",
      "/supplier-bills",
      "/supplier-performance",
    ],
  },
  {
    key: "crm",
    label: "CRM & Customers",
    navigationPermission: permissions.crmView,
    routePermission: permissions.crmView,
    actionPermissions: actions(
      permissions.crmView,
      permissions.crmCustomerManage,
      permissions.crmCustomerManage,
      null,
      anyOf(permissions.crmCustomerMerge, permissions.crmPrivacyManage),
    ),
    supportedScopes: branchScopes,
    featureFlag: "crm.enabled",
    policyCode: "MODULE_ACCESS.CRM",
    routes: [
      "/customers",
      "/crm",
      "/crm-pipeline",
      "/complaints",
      "/feedback",
      "/privacy-requests",
    ],
  },
  {
    key: "loyalty",
    label: "Loyalty, Vouchers & Gift Cards",
    navigationPermission: anyOf(
      permissions.loyaltyView,
      permissions.voucherView,
      permissions.giftCardView,
    ),
    routePermission: anyOf(
      permissions.loyaltyView,
      permissions.voucherView,
      permissions.giftCardView,
    ),
    actionPermissions: actions(
      anyOf(permissions.loyaltyView, permissions.voucherView, permissions.giftCardView),
      anyOf(permissions.loyaltyManage, permissions.voucherManage, permissions.giftCardManage),
      anyOf(permissions.loyaltyManage, permissions.voucherManage, permissions.giftCardManage),
      permissions.loyaltyRedeem,
      anyOf(permissions.loyaltyAdjust, permissions.giftCardAdjust),
    ),
    supportedScopes: branchScopes,
    featureFlag: "crm.enabled",
    policyCode: "MODULE_ACCESS.LOYALTY",
    routes: ["/loyalty", "/vouchers", "/gift-cards"],
  },
  {
    key: "staff",
    label: "Staff & People",
    navigationPermission: permissions.staffView,
    routePermission: permissions.staffView,
    actionPermissions: actions(
      permissions.staffView,
      permissions.attendanceUse,
      permissions.staffManage,
      null,
      permissions.payrollManage,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.STAFF",
    routes: [
      "/people",
      "/employees",
      "/attendance",
      "/schedule",
      "/payroll",
      "/leave",
      "/performance",
      "/recruitment",
    ],
  },
  {
    key: "finance",
    label: "Finance",
    navigationPermission: permissions.financeView,
    routePermission: permissions.financeView,
    actionPermissions: actions(
      permissions.financeView,
      permissions.financeManage,
      permissions.financeManage,
      permissions.financeJournalPost,
      permissions.dayCloseReopen,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.FINANCE",
    routes: [
      "/finance",
      "/profit-loss",
      "/balance-sheet",
      "/cash-flow",
      "/expenses",
      "/payables",
      "/receivables",
      "/assets",
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    navigationPermission: permissions.accountingView,
    routePermission: permissions.accountingView,
    actionPermissions: actions(
      permissions.accountingView,
      permissions.financeManage,
      permissions.financeManage,
      permissions.financeJournalPost,
      permissions.dayCloseReopen,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.ACCOUNTING",
    routes: [
      "/accounting",
      "/daily-sales-journal",
      "/trial-balance",
      "/prime-cost",
      "/budgets",
      "/cost-centres",
      "/tax-centre",
      "/credit-notes",
      "/depreciation",
      "/period-close",
      "/general-ledger",
    ],
  },
  {
    key: "reports",
    label: "Reports",
    navigationPermission: permissions.reportsView,
    routePermission: permissions.reportsView,
    actionPermissions: actions(permissions.reportsView),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.REPORTS",
    routes: ["/reports"],
  },
  {
    key: "management",
    label: "Management Actions",
    navigationPermission: anyOf(permissions.managementView, permissions.dashboardView),
    routePermission: anyOf(permissions.managementView, permissions.dashboardView),
    actionPermissions: actions(
      anyOf(permissions.managementView, permissions.dashboardView),
      permissions.managementActionsManage,
      permissions.managementActionsManage,
      permissions.managementTargetsManage,
      permissions.auditView,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.MANAGEMENT",
    routes: ["/command-centre", "/decisions", "/approvals", "/tasks", "/notifications"],
  },
  {
    key: "marketing",
    label: "Marketing",
    navigationPermission: permissions.marketingView,
    routePermission: permissions.marketingView,
    actionPermissions: actions(
      permissions.marketingView,
      permissions.campaignManage,
      permissions.marketingManage,
      permissions.campaignApprove,
      permissions.campaignSend,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.MARKETING",
    routes: ["/marketing", "/campaigns", "/segments"],
  },
  {
    key: "audit",
    label: "Audit & System Health",
    navigationPermission: permissions.auditView,
    routePermission: permissions.auditView,
    actionPermissions: actions(permissions.auditView),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.AUDIT",
    routes: ["/audit-trail", "/system-health"],
  },
  {
    key: "users",
    label: "Users & Access",
    navigationPermission: permissions.usersView,
    routePermission: permissions.usersView,
    actionPermissions: actions(
      permissions.usersView,
      permissions.usersManage,
      permissions.settingsRoleManage,
      permissions.enterpriseAccessManage,
      permissions.enterpriseAccessManage,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.USERS",
    routes: ["/settings"],
  },
  {
    key: "setup",
    label: "Setup & Configuration",
    navigationPermission: anyOf(permissions.settingsView, permissions.setupView),
    routePermission: anyOf(permissions.settingsView, permissions.setupView),
    actionPermissions: actions(
      anyOf(permissions.settingsView, permissions.setupView),
      permissions.setupManage,
      permissions.settingsOrganisationManage,
      permissions.setupGoLiveApprove,
      permissions.setupDemoReset,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.SETUP",
    routes: ["/settings", "/design-system", "/branches", "/menu-import"],
  },
  {
    key: "hardware",
    label: "Hardware & Printing",
    navigationPermission: permissions.settingsHardwareView,
    routePermission: permissions.settingsHardwareView,
    actionPermissions: actions(
      permissions.settingsHardwareView,
      permissions.settingsHardwareManage,
      permissions.settingsHardwareManage,
      null,
      permissions.settingsHardwareManage,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.HARDWARE",
    routes: ["/seramet-printers", "/seramet-setup"],
  },
  {
    key: "integrations",
    label: "Integrations & Marketplace",
    navigationPermission: permissions.integrationsView,
    routePermission: permissions.integrationsView,
    actionPermissions: actions(
      permissions.integrationsView,
      permissions.integrationsConnectionManage,
      anyOf(permissions.integrationsMenuSync, permissions.integrationsStoreManage),
      permissions.settingsIntegrationManage,
      permissions.integrationsConnectionManage,
    ),
    supportedScopes: branchScopes,
    policyCode: "MODULE_ACCESS.INTEGRATIONS",
    routes: ["/integrations", "/marketplace"],
  },
  {
    key: "ai",
    label: "Ask Seramet",
    navigationPermission: permissions.intelligenceAsk,
    routePermission: permissions.intelligenceAsk,
    actionPermissions: actions(
      permissions.intelligenceAsk,
      permissions.intelligenceBriefsManage,
      permissions.intelligenceActionsSuggest,
      null,
      permissions.intelligenceAdmin,
    ),
    supportedScopes: branchScopes,
    entitlement: "intelligence.basic",
    featureFlag: "intelligence.enabled",
    policyCode: "MODULE_ACCESS.AI",
    routes: ["/ai"],
  },
  {
    key: "hq-command",
    label: "HQ Command Centre",
    navigationPermission: permissions.enterpriseView,
    routePermission: permissions.enterpriseView,
    actionPermissions: actions(
      permissions.enterpriseView,
      null,
      permissions.enterpriseOrganisationManage,
      null,
      permissions.enterpriseExport,
    ),
    supportedScopes: hqScopes,
    policyCode: "MODULE_ACCESS.HQ_COMMAND",
    routes: ["/enterprise"],
  },
  {
    key: "organization",
    label: "Organization, Brands & Regions",
    navigationPermission: permissions.enterpriseView,
    routePermission: permissions.enterpriseView,
    actionPermissions: actions(
      permissions.enterpriseView,
      permissions.enterpriseOrganisationManage,
      permissions.enterpriseOrganisationManage,
      anyOf(permissions.enterpriseAccessManage, permissions.enterpriseAccessDelegate),
      permissions.enterpriseOrganisationManage,
    ),
    supportedScopes: hqScopes,
    policyCode: "MODULE_ACCESS.ORGANIZATION",
    routes: ["/enterprise"],
  },
  {
    key: "franchises",
    label: "Franchises",
    navigationPermission: allOf(permissions.enterpriseView, permissions.enterpriseFranchiseView),
    routePermission: allOf(permissions.enterpriseView, permissions.enterpriseFranchiseView),
    actionPermissions: actions(
      permissions.enterpriseFranchiseView,
      permissions.enterpriseFranchiseManage,
      permissions.enterpriseFranchiseManage,
      permissions.enterprisePolicyApprove,
      permissions.enterpriseFranchiseManage,
    ),
    supportedScopes: ["GROUP", "LEGAL_ENTITY", "BRAND", "REGION"],
    policyCode: "MODULE_ACCESS.FRANCHISES",
    routes: ["/enterprise"],
  },
  {
    key: "policies",
    label: "Enterprise Policies",
    navigationPermission: allOf(permissions.enterpriseView, permissions.enterprisePolicyView),
    routePermission: allOf(permissions.enterpriseView, permissions.enterprisePolicyView),
    actionPermissions: actions(
      permissions.enterprisePolicyView,
      permissions.enterprisePolicyManage,
      permissions.enterprisePolicyManage,
      permissions.enterprisePolicyApprove,
      permissions.enterprisePolicyApprove,
    ),
    supportedScopes: hqScopes,
    policyCode: "MODULE_ACCESS.POLICIES",
    routes: ["/enterprise"],
  },
  {
    key: "rollouts",
    label: "Enterprise Rollouts",
    navigationPermission: allOf(permissions.enterpriseView, permissions.enterpriseRolloutView),
    routePermission: allOf(permissions.enterpriseView, permissions.enterpriseRolloutView),
    actionPermissions: actions(
      permissions.enterpriseRolloutView,
      permissions.enterpriseRolloutManage,
      permissions.enterpriseRolloutManage,
      permissions.enterpriseRolloutApprove,
      permissions.enterpriseRolloutApprove,
    ),
    supportedScopes: hqScopes,
    policyCode: "MODULE_ACCESS.ROLLOUTS",
    routes: ["/enterprise"],
  },
  {
    key: "central-procurement",
    label: "Central Procurement",
    navigationPermission: allOf(permissions.enterpriseView, permissions.enterpriseProcurementView),
    routePermission: allOf(permissions.enterpriseView, permissions.enterpriseProcurementView),
    actionPermissions: actions(
      permissions.enterpriseProcurementView,
      permissions.enterpriseProcurementManage,
      permissions.enterpriseProcurementManage,
      permissions.procurementApprove,
      permissions.enterpriseTransferManage,
    ),
    supportedScopes: hqScopes,
    policyCode: "MODULE_ACCESS.CENTRAL_PROCUREMENT",
    routes: ["/enterprise"],
  },
  {
    key: "compliance",
    label: "Compliance & Readiness",
    navigationPermission: allOf(permissions.enterpriseView, permissions.enterpriseReadinessView),
    routePermission: allOf(permissions.enterpriseView, permissions.enterpriseReadinessView),
    actionPermissions: actions(
      permissions.enterpriseReadinessView,
      null,
      permissions.enterpriseFranchiseManage,
      permissions.enterprisePolicyApprove,
    ),
    supportedScopes: hqScopes,
    policyCode: "MODULE_ACCESS.COMPLIANCE",
    routes: ["/enterprise"],
  },
  {
    key: "enterprise-finance",
    label: "Enterprise Finance",
    navigationPermission: allOf(permissions.enterpriseView, permissions.enterpriseFinanceView),
    routePermission: allOf(permissions.enterpriseView, permissions.enterpriseFinanceView),
    actionPermissions: actions(
      permissions.enterpriseFinanceView,
      null,
      null,
      permissions.financeJournalPost,
      permissions.enterpriseExport,
    ),
    supportedScopes: ["GROUP", "LEGAL_ENTITY", "BRAND", "REGION"],
    policyCode: "MODULE_ACCESS.ENTERPRISE_FINANCE",
    routes: ["/enterprise"],
  },
  {
    key: "enterprise-audit",
    label: "Enterprise Audit",
    navigationPermission: allOf(permissions.enterpriseView, permissions.enterpriseAuditView),
    routePermission: allOf(permissions.enterpriseView, permissions.enterpriseAuditView),
    actionPermissions: actions(
      permissions.enterpriseAuditView,
      null,
      null,
      null,
      permissions.enterpriseExport,
    ),
    supportedScopes: hqScopes,
    policyCode: "MODULE_ACCESS.ENTERPRISE_AUDIT",
    routes: ["/enterprise"],
  },
] as const;

export function evaluateModuleAccess(
  definition: ModuleAccessDefinition,
  context: ModuleAccessContext,
): ModuleAccessDecision {
  const authorizedScopes = definition.supportedScopes.filter((scope) =>
    context.organizationalScopes.includes(scope),
  );
  const scopeAllowed = authorizedScopes.length > 0;
  const entitlementAllowed =
    !definition.entitlement ||
    !context.entitlementsEnforced ||
    context.entitlements.includes(definition.entitlement);
  const featureAllowed =
    !definition.featureFlag || context.featureFlags?.[definition.featureFlag] !== false;
  const policy = context.policies?.[definition.key] ?? "ALLOW";
  const baseAllowed = scopeAllowed && entitlementAllowed && featureAllowed && policy === "ALLOW";
  const route = baseAllowed && hasPermission(context.permissions, definition.routePermission);
  const reasons: string[] = [];
  if (!scopeAllowed) reasons.push("ORGANIZATIONAL_SCOPE_DENIED");
  if (!entitlementAllowed) reasons.push("ENTITLEMENT_REQUIRED");
  if (!featureAllowed) reasons.push("FEATURE_DISABLED");
  if (policy === "DENY") reasons.push("POLICY_DENIED");
  if (!hasPermission(context.permissions, definition.routePermission))
    reasons.push("ROUTE_PERMISSION_REQUIRED");
  return {
    moduleKey: definition.key,
    navigation: baseAllowed && hasPermission(context.permissions, definition.navigationPermission),
    route,
    actions: Object.fromEntries(
      (Object.keys(definition.actionPermissions) as ModuleAction[]).map((action) => [
        action,
        route && hasPermission(context.permissions, definition.actionPermissions[action]),
      ]),
    ) as Record<ModuleAction, boolean>,
    authorizedScopes: [...authorizedScopes],
    entitlement: definition.entitlement ?? null,
    policy,
    reasons,
  };
}

export function buildModuleAccessProfile(
  context: ModuleAccessContext,
  accessRevision = 0,
  generatedAt = new Date().toISOString(),
): ModuleAccessProfile {
  return {
    registryVersion: 1,
    accessRevision,
    generatedAt,
    decisions: moduleAccessRegistry.map((definition) => evaluateModuleAccess(definition, context)),
  };
}

export function moduleDefinitionsForPath(path: string) {
  return moduleAccessRegistry.filter(
    (definition) =>
      definition.routes.includes(path) ||
      definition.routePrefixes?.some((prefix) => path.startsWith(prefix)),
  );
}

export function moduleDecisionsForPath(profile: ModuleAccessProfile, path: string) {
  const keys = new Set(moduleDefinitionsForPath(path).map((definition) => definition.key));
  return profile.decisions.filter((decision) => keys.has(decision.moduleKey));
}

export function canAccessPath(profile: ModuleAccessProfile, path: string) {
  const definitions = moduleDefinitionsForPath(path);
  if (!definitions.length) return true;
  return moduleDecisionsForPath(profile, path).some((decision) => decision.route);
}

export function canNavigateToPath(profile: ModuleAccessProfile, path: string) {
  const definitions = moduleDefinitionsForPath(path);
  if (!definitions.length) return false;
  return moduleDecisionsForPath(profile, path).some((decision) => decision.navigation);
}

export function moduleDecision(profile: ModuleAccessProfile, moduleKey: ModuleKey) {
  return profile.decisions.find((decision) => decision.moduleKey === moduleKey);
}

export function moduleDefinition(moduleKey: ModuleKey) {
  const definition = moduleAccessRegistry.find((candidate) => candidate.key === moduleKey);
  if (!definition) throw new Error(`Unknown module: ${moduleKey}`);
  return definition;
}

export function permissionCodes(requirement: PermissionRequirement): PermissionCode[] {
  if (!requirement) return [];
  if (typeof requirement === "string") return [requirement];
  return [...("allOf" in requirement ? requirement.allOf : requirement.anyOf)];
}

function hasPermission(
  actorPermissions: readonly PermissionCode[],
  requirement: PermissionRequirement,
) {
  if (!requirement) return false;
  if (typeof requirement === "string") return actorPermissions.includes(requirement);
  if ("allOf" in requirement)
    return requirement.allOf.every((permission) => actorPermissions.includes(permission));
  return requirement.anyOf.some((permission) => actorPermissions.includes(permission));
}
