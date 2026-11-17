import { permissions as p } from "@/platform/permissions";
import type { PermissionCode } from "@/platform/types";

/**
 * The simple role editor: every permission belongs to exactly one place, either a level of one
 * area (View, then Use, then Manage, each including the one before) or one risky-action switch.
 * A test checks nothing is missing or listed twice, so the simple editor can never silently
 * drop a permission. Server checks are unchanged: these only build the role's permission list.
 */
export type AccessLevel = "NONE" | "VIEW" | "USE" | "MANAGE";
export const accessLevels: readonly AccessLevel[] = ["NONE", "VIEW", "USE", "MANAGE"];
export const accessLevelLabels: Record<AccessLevel, string> = {
  NONE: "No access",
  VIEW: "View",
  USE: "Use",
  MANAGE: "Manage",
};

export type AccessArea = {
  key: string;
  label: string;
  /** What each level lets someone do, in plain words. */
  hint: string;
  view?: readonly PermissionCode[];
  use?: readonly PermissionCode[];
  manage?: readonly PermissionCode[];
};

export type RiskyAction = {
  key: string;
  label: string;
  permissions: readonly PermissionCode[];
};

export type AccessSection = {
  key: string;
  label: string;
  /** Head-office sections are shown only to businesses with more than one branch. */
  headOffice?: boolean;
  areas: readonly AccessArea[];
  risky?: readonly RiskyAction[];
};

export const accessSections: readonly AccessSection[] = [
  {
    key: "sales",
    label: "Sales & front of house",
    areas: [
      {
        key: "pos",
        label: "POS",
        hint: "Use: take orders, send them to the kitchen and mark them served",
        view: [p.posAccess],
        use: [p.ordersCreate, p.ordersUpdate, p.ordersServe],
      },
      {
        key: "orders",
        label: "Orders list",
        hint: "View past and open orders",
        view: [p.ordersView],
      },
      {
        key: "invoices",
        label: "Invoices",
        hint: "Use: create bills and invoices",
        view: [p.invoicesView],
        use: [p.invoicesCreate, p.invoicesManage],
      },
      { key: "receipts", label: "Receipts", hint: "View receipts", view: [p.receiptsView] },
      {
        key: "payments",
        label: "Payments & cash drawer",
        hint: "Use: take payments and open or close the drawer. Manage: match and confirm payments, request refunds",
        view: [p.paymentsView],
        use: [p.paymentsRecord, p.paymentsCollect, p.cashOpen, p.cashClose],
        manage: [
          p.paymentsMatch,
          p.paymentsManualConfirm,
          p.paymentsConfirm,
          p.paymentsRefundRequest,
        ],
      },
      {
        key: "guests",
        label: "Reservations, tables & QR orders",
        hint: "Use: book, seat and take guest orders. Manage: tables, deposits, digital menu and QR codes",
        view: [p.reservationView, p.waitlistView, p.guestOrderView],
        use: [
          p.reservationCreate,
          p.reservationModify,
          p.reservationCancel,
          p.reservationSeat,
          p.reservationNoShow,
          p.waitlistManage,
          p.guestOrderReview,
          p.guestOrderAccept,
          p.guestOrderCancel,
        ],
        manage: [
          p.tableManage,
          p.guestServiceManage,
          p.reservationDepositManage,
          p.digitalMenuManage,
          p.qrManage,
        ],
      },
      {
        key: "delivery",
        label: "Delivery & riders",
        hint: "Use: dispatch deliveries. Manage: riders",
        use: [p.deliveryDispatch],
        manage: [p.ridersManage],
      },
    ],
    risky: [
      { key: "cancel-orders", label: "Cancel orders", permissions: [p.ordersCancel] },
      { key: "cancel-invoices", label: "Cancel invoices", permissions: [p.invoicesCancel] },
      {
        key: "reprint",
        label: "Reprint invoices and receipts",
        permissions: [p.invoicesReprint, p.receiptsReprint],
      },
      { key: "refunds", label: "Approve refunds", permissions: [p.paymentsRefundApprove] },
      { key: "cash-adjust", label: "Adjust cash in the drawer", permissions: [p.cashAdjust] },
    ],
  },
  {
    key: "kitchen",
    label: "Kitchen",
    areas: [
      {
        key: "kitchen-screen",
        label: "Kitchen screen",
        hint: "Use: work tickets on the kitchen screen",
        view: [p.kitchenView],
        use: [p.kitchenOperate],
      },
      {
        key: "recipes",
        label: "Recipes & cookbook",
        hint: "Use: edit recipes. Manage: publish them",
        view: [p.cookbookView],
        use: [p.cookbookManage],
        manage: [p.cookbookPublish],
      },
      {
        key: "production",
        label: "Production",
        hint: "Use: plan, start and finish batches. Manage: correct them",
        view: [p.productionView],
        use: [p.productionPlan, p.productionStart, p.productionComplete],
        manage: [p.productionAdjust],
      },
    ],
  },
  {
    key: "stock",
    label: "Stock & purchasing",
    areas: [
      {
        key: "stock",
        label: "Stock",
        hint: "Use: count, transfer and record waste. Manage: approve counts and waste, adjust stock, set up stores",
        view: [p.inventoryView, p.settingsWarehouseView],
        use: [p.inventoryCount, p.inventoryTransfer, p.inventoryWastageRecord, p.wasteRecord],
        manage: [
          p.inventoryCountApprove,
          p.inventoryWastageApprove,
          p.wasteApprove,
          p.inventoryAdjust,
          p.settingsWarehouseManage,
        ],
      },
      {
        key: "store-issues",
        label: "Store issues",
        hint: "Use: ask the store for items. Manage: see and approve all requests",
        use: [p.inventoryIssueRequest],
        manage: [p.inventoryIssueView, p.inventoryIssueApprove],
      },
      {
        key: "stock-requests",
        label: "Purchase requests",
        hint: "Use: ask for items to be bought. Manage: approve requests",
        use: [p.procurementRequisitionCreate],
        manage: [p.procurementRequisitionApprove],
      },
      {
        key: "purchase-orders",
        label: "Purchase orders",
        hint: "Use: raise orders and receive deliveries. Manage: approve and cancel orders",
        view: [p.procurementView],
        use: [p.procurementCreate, p.procurementReceive],
        manage: [p.procurementApprove, p.procurementCancel],
      },
      {
        key: "cost-control",
        label: "Cost control",
        hint: "Use: set cost targets",
        view: [p.inventoryCostControlView],
        use: [p.inventoryCostControlManage],
      },
    ],
    risky: [
      {
        key: "approve-adjustments",
        label: "Approve stock adjustments",
        permissions: [p.inventoryAdjustApprove],
      },
      {
        key: "supplier-invoices",
        label: "Approve supplier invoices",
        permissions: [p.procurementInvoiceApprove],
      },
    ],
  },
  {
    key: "money",
    label: "Money",
    areas: [
      {
        key: "finance",
        label: "Finance & accounting",
        hint: "Use: manage the books and exchange rates. Manage: post journals",
        view: [
          p.financeView,
          p.accountingView,
          p.financeJournalView,
          p.managementFinanceView,
          p.paymentsFxView,
        ],
        use: [p.financeManage, p.paymentsFxManage],
        manage: [p.financeJournalPost],
      },
      {
        key: "reconciliation",
        label: "Reconciliation & payouts",
        hint: "Use: match bank, M-Pesa and app payouts. Manage: approve and post them",
        view: [p.reconciliationView],
        use: [
          p.reconciliationManage,
          p.paymentsReconcile,
          p.settlementsImport,
          p.branchesReconcile,
        ],
        manage: [p.reconciliationApprove, p.settlementsPost],
      },
    ],
    risky: [{ key: "reopen-day", label: "Reopen a closed day", permissions: [p.dayCloseReopen] }],
  },
  {
    key: "insights",
    label: "Reports & insights",
    areas: [
      { key: "dashboard", label: "Dashboard", hint: "View the dashboard", view: [p.dashboardView] },
      { key: "reports", label: "Reports", hint: "View reports", view: [p.reportsView] },
      {
        key: "management",
        label: "Management actions & targets",
        hint: "Use: manage actions. Manage: set targets",
        view: [p.managementView],
        use: [p.managementActionsManage],
        manage: [p.managementTargetsManage],
      },
      {
        key: "ask-seramet",
        label: "Ask Seramet",
        hint: "Use: ask about operations, stock and staff. Manage: finance and owner questions, usage and settings",
        view: [p.intelligenceAsk, p.intelligenceBriefsView],
        use: [
          p.intelligenceManagement,
          p.intelligenceInventory,
          p.intelligenceStaff,
          p.intelligenceActionsSuggest,
          p.intelligenceBriefsManage,
        ],
        manage: [
          p.intelligenceFinance,
          p.intelligenceOwner,
          p.intelligenceUsageView,
          p.intelligenceAdmin,
        ],
      },
      { key: "audit", label: "Audit log", hint: "View who changed what", view: [p.auditView] },
    ],
  },
  {
    key: "people",
    label: "Staff",
    areas: [
      {
        key: "clock-in",
        label: "Clock in and out",
        hint: "Use: clock in and out",
        use: [p.attendanceUse],
      },
      {
        key: "staff",
        label: "Staff & attendance",
        hint: "Use: manage shifts and attendance",
        view: [p.staffView],
        use: [p.staffManage],
      },
      { key: "payroll", label: "Payroll", hint: "Manage: run payroll", manage: [p.payrollManage] },
      {
        key: "users",
        label: "Users & roles",
        hint: "Use: add and edit staff accounts. Manage: change what roles can do",
        view: [p.usersView],
        use: [p.usersManage],
        manage: [p.settingsRoleManage],
      },
    ],
    risky: [
      {
        key: "credentials",
        label: "Reset staff PINs and passwords",
        permissions: [p.employeeCredentialsManage],
      },
    ],
  },
  {
    key: "customers",
    label: "Customers & marketing",
    areas: [
      {
        key: "customers",
        label: "Customers",
        hint: "Use: edit customers and see contacts and spend. Manage: merge duplicates",
        view: [p.crmView, p.crmCustomerView],
        use: [p.crmCustomerManage, p.crmCustomerContactView, p.crmCustomerValueView],
        manage: [p.crmCustomerMerge],
      },
      {
        key: "loyalty",
        label: "Loyalty, vouchers & gift cards",
        hint: "Use: redeem them. Manage: set up programmes",
        view: [p.loyaltyView, p.voucherView, p.giftCardView],
        use: [p.loyaltyRedeem],
        manage: [p.loyaltyManage, p.voucherManage, p.giftCardManage],
      },
      {
        key: "marketing",
        label: "Marketing & feedback",
        hint: "Use: draft campaigns and answer feedback. Manage: approve campaigns",
        view: [p.marketingView, p.campaignView, p.feedbackView],
        use: [p.marketingManage, p.campaignManage, p.feedbackManage],
        manage: [p.campaignApprove],
      },
    ],
    risky: [
      {
        key: "export-customers",
        label: "Export customer data",
        permissions: [p.crmCustomerExport],
      },
      { key: "privacy", label: "Handle privacy requests", permissions: [p.crmPrivacyManage] },
      {
        key: "balances",
        label: "Adjust points and gift-card balances",
        permissions: [p.loyaltyAdjust, p.giftCardAdjust],
      },
      {
        key: "send-campaigns",
        label: "Send campaigns to customers",
        permissions: [p.campaignSend],
      },
    ],
  },
  {
    key: "setup",
    label: "Setup",
    areas: [
      {
        key: "business-setup",
        label: "Business setup",
        hint: "Use: change company, branch, channel and payment settings, import data. Manage: approve opening stock and go-live",
        view: [
          p.settingsView,
          p.settingsOrganisationView,
          p.settingsBranchView,
          p.setupView,
          p.setupDiagnosticsView,
        ],
        use: [
          p.setupManage,
          p.settingsOrganisationManage,
          p.settingsBranchManage,
          p.settingsChannelManage,
          p.settingsPaymentManage,
          p.setupImport,
          p.setupHistoricalSalesImport,
          p.setupOpeningStock,
          p.setupAccountingManage,
          p.setupExport,
        ],
        manage: [p.setupOpeningStockApprove, p.setupGoLiveApprove],
      },
      {
        key: "devices",
        label: "Printers & devices",
        hint: "Use: set up printers and activate POS devices",
        view: [p.settingsHardwareView],
        use: [p.settingsHardwareManage, p.deviceActivate],
      },
      {
        key: "integrations",
        label: "Delivery apps & integrations",
        hint: "Use: handle app orders, menus and stores. Manage: connect and disconnect apps",
        view: [p.integrationsView, p.integrationsOrdersView],
        use: [
          p.integrationsOrdersManage,
          p.integrationsMenuSync,
          p.integrationsMappingManage,
          p.integrationsStoreManage,
        ],
        manage: [p.integrationsConnectionManage, p.settingsIntegrationManage],
      },
      {
        key: "branches",
        label: "Branches",
        hint: "Use: switch between assigned branches. Manage: see every branch",
        use: [p.branchSwitch],
        manage: [p.tenantScopeAllBranches],
      },
    ],
    risky: [
      {
        key: "go-live-override",
        label: "Go live despite open setup checks",
        permissions: [p.setupGoLiveOverride],
      },
      { key: "demo-reset", label: "Reset demo data", permissions: [p.setupDemoReset] },
    ],
  },
  {
    key: "head-office",
    label: "Head office",
    headOffice: true,
    areas: [
      {
        key: "head-office",
        label: "Head office",
        hint: "Use: manage brands, policies, rollouts, central buying and franchises. Manage: approve them and delegate access",
        view: [
          p.enterpriseView,
          p.enterprisePolicyView,
          p.enterpriseRolloutView,
          p.enterpriseProcurementView,
          p.enterpriseFranchiseView,
          p.enterpriseFinanceView,
          p.enterpriseAuditView,
          p.enterpriseReadinessView,
        ],
        use: [
          p.enterpriseOrganisationManage,
          p.enterprisePolicyManage,
          p.enterpriseRolloutManage,
          p.enterpriseProcurementManage,
          p.enterpriseTransferManage,
          p.enterpriseFranchiseManage,
        ],
        manage: [
          p.enterprisePolicyApprove,
          p.enterpriseRolloutApprove,
          p.enterpriseAccessManage,
          p.enterpriseAccessDelegate,
        ],
      },
    ],
    risky: [
      {
        key: "head-office-export",
        label: "Export head-office data",
        permissions: [p.enterpriseExport],
      },
    ],
  },
];

/** Kept out of the simple editor: platform administration and ownership hand-over. */
export const advancedOnlyPermissions: readonly PermissionCode[] = [
  p.platformTenantsProvision,
  p.platformEmailView,
  p.ownershipTransfer,
  p.setupEntitlementsManage,
];

export const allAccessAreas = accessSections.flatMap((section) => section.areas);
export const allRiskyActions = accessSections.flatMap((section) => section.risky ?? []);

/** Every permission the simple editor sets; anything else on a role is left untouched. */
export const simpleEditorPermissions: ReadonlySet<PermissionCode> = new Set([
  ...allAccessAreas.flatMap((area) => [
    ...(area.view ?? []),
    ...(area.use ?? []),
    ...(area.manage ?? []),
  ]),
  ...allRiskyActions.flatMap((action) => action.permissions),
]);

/** The levels this area offers: No access plus each level that adds something. */
export function areaLevels(area: AccessArea): AccessLevel[] {
  return [
    "NONE",
    ...(area.view?.length ? (["VIEW"] as const) : []),
    ...(area.use?.length ? (["USE"] as const) : []),
    ...(area.manage?.length ? (["MANAGE"] as const) : []),
  ];
}

/** What the area's level grants, each level including those before it. */
export function areaPermissions(area: AccessArea, level: AccessLevel): PermissionCode[] {
  const rank = accessLevels.indexOf(level);
  return [
    ...(rank >= 1 ? (area.view ?? []) : []),
    ...(rank >= 2 ? (area.use ?? []) : []),
    ...(rank >= 3 ? (area.manage ?? []) : []),
  ];
}

/** The area's level on this role, or CUSTOM when its permissions fit no single level. */
export function areaLevel(
  area: AccessArea,
  held: ReadonlySet<PermissionCode> | readonly PermissionCode[],
): AccessLevel | "CUSTOM" {
  const has = held instanceof Set ? held : new Set(held as readonly PermissionCode[]);
  const all = areaPermissions(area, "MANAGE");
  for (const level of [...areaLevels(area)].reverse()) {
    const granted = new Set(areaPermissions(area, level));
    if (all.every((code) => has.has(code) === granted.has(code))) return level;
  }
  return "CUSTOM";
}

/** The role's permissions with one area set to a level; nothing outside the area changes. */
export function withAreaLevel(
  held: readonly PermissionCode[],
  area: AccessArea,
  level: AccessLevel,
): PermissionCode[] {
  const all = new Set(areaPermissions(area, "MANAGE"));
  return [...held.filter((code) => !all.has(code)), ...areaPermissions(area, level)];
}

export function withRiskyAction(
  held: readonly PermissionCode[],
  action: RiskyAction,
  allowed: boolean,
): PermissionCode[] {
  const codes = new Set(action.permissions);
  const rest = held.filter((code) => !codes.has(code));
  return allowed ? [...rest, ...action.permissions] : rest;
}

/** Permissions added or removed between two lists. */
export function permissionChanges(
  before: readonly PermissionCode[],
  after: readonly PermissionCode[],
) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: [...now].filter((code) => !was.has(code)),
    removed: [...was].filter((code) => !now.has(code)),
  };
}

/** A plain sentence of what the role can do, for the top of the editor. */
export function roleAccessSummary(held: readonly PermissionCode[]) {
  const has = new Set(held);
  const can = allAccessAreas
    .map((area) => ({ area, level: areaLevel(area, has) }))
    .filter(({ level }) => level !== "NONE")
    .map(({ area, level }) =>
      level === "CUSTOM"
        ? `${area.label} (custom)`
        : `${area.label} (${accessLevelLabels[level].toLowerCase()})`,
    );
  const risky = allRiskyActions
    .filter((action) => action.permissions.every((code) => has.has(code)))
    .map((action) => action.label.toLowerCase());
  return { can, risky };
}
