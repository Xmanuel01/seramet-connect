import { allPermissionCodes, permissions as p } from "@/platform/permissions";
import { accountOwnerPermissions } from "@/platform/standard-roles";
import type { PermissionCode } from "@/platform/types";

/**
 * Plain-language access for the role editor: every permission code belongs to one area of the
 * business, and each area offers a few levels that stand for a fixed bundle of codes. Only the
 * codes are stored (role_permissions) and enforced; areas and levels are a way of choosing them.
 */

type KnownPermissionCode = (typeof p)[keyof typeof p];

export type AccessLevel = {
  id: string;
  label: string;
  /** One line on what a person at this level can do. */
  description: string;
  /** Every code the level grants: its own plus those of the levels before it. */
  codes: readonly PermissionCode[];
};

export type AccessArea = {
  id: string;
  label: string;
  /** What part of the business the area covers. */
  summary: string;
  /** Shown under the levels when another area is needed for this one to be useful. */
  note?: string;
  /** Lowest to highest; the last level grants every code in the area. */
  levels: readonly AccessLevel[];
  /** Every code in the area. */
  codes: readonly PermissionCode[];
};

export const NO_ACCESS = "none";
export const CUSTOM_ACCESS = "custom";

type LevelSpec = { id: string; label: string; description: string; adds: KnownPermissionCode[] };

function area(input: {
  id: string;
  label: string;
  summary: string;
  note?: string;
  levels: LevelSpec[];
}): AccessArea {
  const codes: PermissionCode[] = [];
  const levels = input.levels.map((level) => {
    codes.push(...level.adds);
    return {
      id: level.id,
      label: level.label,
      description: level.description,
      codes: [...codes],
    };
  });
  return {
    id: input.id,
    label: input.label,
    summary: input.summary,
    note: input.note,
    levels,
    codes,
  };
}

export const accessAreas: readonly AccessArea[] = [
  area({
    id: "sales",
    label: "Sales & POS",
    summary: "Taking orders, bills, payments and the cash drawer.",
    levels: [
      {
        id: "view",
        label: "View",
        description: "See orders, bills and payments. Cannot change anything.",
        adds: [p.ordersView, p.invoicesView, p.paymentsView],
      },
      {
        id: "work",
        label: "Sell",
        description:
          "Use the POS: take and serve orders, make bills, take payments, open and close their cash drawer.",
        adds: [
          p.posAccess,
          p.ordersCreate,
          p.ordersUpdate,
          p.ordersServe,
          p.invoicesCreate,
          p.invoicesManage,
          p.paymentsRecord,
          p.paymentsCollect,
          p.cashOpen,
          p.cashClose,
        ],
      },
      {
        id: "manage",
        label: "Supervise",
        description:
          "Everything in Sell, plus cancel orders, see and reprint bills and receipts, and ask for a refund.",
        adds: [
          p.ordersCancel,
          p.invoicesReprint,
          p.receiptsView,
          p.receiptsReprint,
          p.paymentsRefundRequest,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Supervise, plus cancel bills, approve refunds, confirm payments by hand and approve cash drawer differences.",
        adds: [
          p.invoicesCancel,
          p.paymentsRefundApprove,
          p.paymentsManualConfirm,
          p.paymentsConfirm,
          p.cashAdjust,
        ],
      },
    ],
  }),
  area({
    id: "guests",
    label: "Tables, bookings & delivery",
    summary: "Reservations, the waiting list, online orders, tables and riders.",
    levels: [
      {
        id: "view",
        label: "View",
        description: "See reservations, the waiting list and online orders.",
        adds: [p.reservationView, p.waitlistView, p.guestOrderView],
      },
      {
        id: "work",
        label: "Host",
        description:
          "Take and change bookings, seat guests, run the waiting list, accept online orders and send out deliveries.",
        adds: [
          p.reservationCreate,
          p.reservationModify,
          p.reservationSeat,
          p.reservationNoShow,
          p.waitlistManage,
          p.guestOrderReview,
          p.guestOrderAccept,
          p.guestServiceManage,
          p.deliveryDispatch,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Host, plus cancel bookings and online orders, handle deposits, and set up tables, QR codes, the online menu and riders.",
        adds: [
          p.reservationCancel,
          p.reservationDepositManage,
          p.guestOrderCancel,
          p.tableManage,
          p.digitalMenuManage,
          p.qrManage,
          p.ridersManage,
        ],
      },
    ],
  }),
  area({
    id: "kitchen",
    label: "Kitchen & recipes",
    summary: "Kitchen and bar screens, the cookbook and batch preparation.",
    levels: [
      {
        id: "view",
        label: "View",
        description: "See the kitchen screen and read recipes.",
        adds: [p.kitchenView, p.cookbookView],
      },
      {
        id: "work",
        label: "Cook",
        description: "Work the kitchen or bar screen: start orders and mark them ready.",
        adds: [p.kitchenOperate],
      },
      {
        id: "manage",
        label: "Run the kitchen",
        description:
          "Everything in Cook, plus write and publish recipes, and plan and carry out batch preparation.",
        adds: [
          p.cookbookManage,
          p.cookbookPublish,
          p.productionView,
          p.productionPlan,
          p.productionStart,
          p.productionComplete,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Run the kitchen, plus bring back an order that was marked ready by mistake.",
        adds: [p.productionAdjust],
      },
    ],
  }),
  area({
    id: "inventory",
    label: "Inventory",
    summary: "Stock levels, counts, wastage, transfers and items issued from the store.",
    levels: [
      {
        id: "request",
        label: "Request items",
        description: "Ask the store for items. Cannot see stock levels.",
        adds: [p.inventoryIssueRequest],
      },
      {
        id: "view",
        label: "View",
        description: "See stock levels, costs and what the store has issued, and ask for items.",
        adds: [p.inventoryView, p.inventoryIssueView, p.inventoryCostControlView],
      },
      {
        id: "work",
        label: "Keep stock",
        description:
          "Everything in View, plus count stock, record wastage and breakages, correct quantities and move stock between stores.",
        adds: [
          p.inventoryCount,
          p.inventoryAdjust,
          p.inventoryTransfer,
          p.inventoryWastageRecord,
          p.wasteRecord,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Keep stock, plus approve counts, corrections, wastage and store issues, and set cost targets.",
        adds: [
          p.inventoryCountApprove,
          p.inventoryAdjustApprove,
          p.inventoryWastageApprove,
          p.wasteApprove,
          p.inventoryIssueApprove,
          p.inventoryCostControlManage,
        ],
      },
    ],
  }),
  area({
    id: "purchasing",
    label: "Purchasing",
    summary: "Stock requests, purchase orders, deliveries and supplier bills.",
    levels: [
      {
        id: "request",
        label: "Request stock",
        description: "Ask for stock to be bought. Cannot see suppliers or orders.",
        adds: [p.procurementRequisitionCreate],
      },
      {
        id: "view",
        label: "View",
        description: "See suppliers, purchase orders and deliveries, and ask for stock.",
        adds: [p.procurementView],
      },
      {
        id: "work",
        label: "Buy",
        description: "Everything in View, plus make purchase orders and receive deliveries.",
        adds: [p.procurementCreate, p.procurementReceive],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Buy, plus approve stock requests, purchase orders and supplier bills, and cancel purchase orders.",
        adds: [
          p.procurementRequisitionApprove,
          p.procurementApprove,
          p.procurementInvoiceApprove,
          p.procurementCancel,
        ],
      },
    ],
  }),
  area({
    id: "finance",
    label: "Finance",
    summary: "Reconciliation, closing the day, accounts and financial statements.",
    note: "To open the Payments page, also give at least View in Sales & POS.",
    levels: [
      {
        id: "view",
        label: "View",
        description:
          "See financial statements, the accounts, exchange rates and the day's reconciliation.",
        adds: [
          p.financeView,
          p.accountingView,
          p.financeJournalView,
          p.reconciliationView,
          p.paymentsFxView,
        ],
      },
      {
        id: "work",
        label: "Bookkeeping",
        description:
          "Everything in View, plus match payments, reconcile bank and mobile money, bring in settlement statements and record expenses.",
        adds: [
          p.paymentsMatch,
          p.paymentsReconcile,
          p.reconciliationManage,
          p.settlementsImport,
          p.financeManage,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Bookkeeping, plus close the day, reopen a closed day, post journals and settlements, and set exchange rates.",
        adds: [
          p.reconciliationApprove,
          p.dayCloseReopen,
          p.settlementsPost,
          p.financeJournalPost,
          p.paymentsFxManage,
        ],
      },
    ],
  }),
  area({
    id: "staff",
    label: "Staff",
    summary: "Attendance, schedules, payroll, employees and their sign-in.",
    levels: [
      {
        id: "self",
        label: "Own attendance",
        description: "Clock in and out for their own shifts. Cannot see other staff.",
        adds: [p.attendanceUse],
      },
      {
        id: "work",
        label: "Supervise",
        description: "See the team, correct attendance and manage schedules.",
        adds: [p.staffView, p.staffManage],
      },
      {
        id: "manage",
        label: "Manage staff",
        description:
          "Everything in Supervise, plus add and edit employees and reset their sign-in codes.",
        adds: [p.usersView, p.usersManage, p.employeeCredentialsManage],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Manage staff, plus run payroll and change what each role can do.",
        adds: [p.payrollManage, p.settingsRoleManage],
      },
    ],
  }),
  area({
    id: "customers",
    label: "Customers & marketing",
    summary: "Customer records, loyalty, vouchers, gift cards, feedback and campaigns.",
    levels: [
      {
        id: "view",
        label: "View",
        description:
          "See customers, loyalty, vouchers, gift cards, feedback and campaigns. Phone numbers and spending stay hidden.",
        adds: [
          p.crmView,
          p.crmCustomerView,
          p.loyaltyView,
          p.voucherView,
          p.giftCardView,
          p.campaignView,
          p.feedbackView,
          p.marketingView,
        ],
      },
      {
        id: "work",
        label: "Serve customers",
        description:
          "Everything in View, plus add and edit customers, see their contact details, redeem points and reply to feedback.",
        adds: [p.crmCustomerContactView, p.crmCustomerManage, p.loyaltyRedeem, p.feedbackManage],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Serve customers, plus see customer spending, run campaigns, set up loyalty, vouchers and gift cards, and merge, export or erase customer records.",
        adds: [
          p.crmCustomerValueView,
          p.crmCustomerMerge,
          p.crmCustomerExport,
          p.crmPrivacyManage,
          p.loyaltyManage,
          p.loyaltyAdjust,
          p.voucherManage,
          p.giftCardManage,
          p.giftCardAdjust,
          p.campaignManage,
          p.campaignApprove,
          p.campaignSend,
          p.marketingManage,
        ],
      },
    ],
  }),
  area({
    id: "reports",
    label: "Reports & insights",
    summary: "The dashboard, reports, tasks, Ask Seramet and the audit log.",
    levels: [
      {
        id: "view",
        label: "View",
        description: "See the dashboard and reports.",
        adds: [p.dashboardView, p.reportsView],
      },
      {
        id: "work",
        label: "Follow up",
        description:
          "Everything in View, plus manage tasks and ask Seramet questions about sales, operations and stock.",
        adds: [
          p.managementView,
          p.managementActionsManage,
          p.intelligenceAsk,
          p.intelligenceManagement,
          p.intelligenceInventory,
          p.intelligenceBriefsView,
          p.intelligenceActionsSuggest,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Follow up, plus money and staff insights, targets, the audit log and Ask Seramet settings.",
        adds: [
          p.managementTargetsManage,
          p.managementFinanceView,
          p.intelligenceFinance,
          p.intelligenceStaff,
          p.intelligenceOwner,
          p.intelligenceBriefsManage,
          p.intelligenceUsageView,
          p.intelligenceAdmin,
          p.auditView,
        ],
      },
    ],
  }),
  area({
    id: "settings",
    label: "Settings & setup",
    summary:
      "Business details, branches, printers, payment methods, order channels and connections.",
    levels: [
      {
        id: "view",
        label: "View",
        description: "See settings and setup progress. Cannot change anything.",
        adds: [
          p.settingsView,
          p.settingsOrganisationView,
          p.settingsBranchView,
          p.settingsWarehouseView,
          p.settingsHardwareView,
          p.setupView,
          p.integrationsView,
          p.integrationsOrdersView,
        ],
      },
      {
        id: "work",
        label: "Set up",
        description:
          "Everything in View, plus change branch settings, stores, printers, tills, payment methods and order channels, import menus and opening stock, and handle orders from delivery apps.",
        adds: [
          p.settingsBranchManage,
          p.settingsWarehouseManage,
          p.settingsHardwareManage,
          p.settingsPaymentManage,
          p.settingsChannelManage,
          p.deviceActivate,
          p.setupManage,
          p.setupImport,
          p.setupOpeningStock,
          p.integrationsOrdersManage,
          p.integrationsMenuSync,
          p.integrationsMappingManage,
          p.integrationsStoreManage,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Set up, plus business details, connections to other systems, accounting setup, go-live approval and handing the business to a new owner. Give this only to an owner.",
        adds: [
          p.settingsOrganisationManage,
          p.settingsIntegrationManage,
          p.integrationsConnectionManage,
          p.setupHistoricalSalesImport,
          p.setupOpeningStockApprove,
          p.setupAccountingManage,
          p.setupGoLiveApprove,
          p.setupGoLiveOverride,
          p.setupExport,
          p.setupEntitlementsManage,
          p.setupDiagnosticsView,
          p.ownershipTransfer,
        ],
      },
    ],
  }),
  area({
    id: "branches",
    label: "Branches & head office",
    summary: "Working across branches, and head-office tools for groups and franchises.",
    levels: [
      {
        id: "switch",
        label: "Switch branch",
        description: "Move between the branches they are assigned to.",
        adds: [p.branchSwitch],
      },
      {
        id: "all",
        label: "All branches",
        description: "See and work in every branch of the business.",
        adds: [p.tenantScopeAllBranches],
      },
      {
        id: "view",
        label: "Head office view",
        description:
          "Everything in All branches, plus see head-office pages: group structure, policies, rollouts, central buying, franchises and group finance.",
        adds: [
          p.enterpriseView,
          p.enterprisePolicyView,
          p.enterpriseRolloutView,
          p.enterpriseProcurementView,
          p.enterpriseFranchiseView,
          p.enterpriseFinanceView,
          p.enterpriseAuditView,
          p.enterpriseReadinessView,
        ],
      },
      {
        id: "full",
        label: "Full control",
        description:
          "Everything in Head office view, plus change the group structure, policies, rollouts, central buying and franchises, and set access for the whole group.",
        adds: [
          p.branchesReconcile,
          p.enterpriseOrganisationManage,
          p.enterpriseAccessManage,
          p.enterpriseAccessDelegate,
          p.enterprisePolicyManage,
          p.enterprisePolicyApprove,
          p.enterpriseRolloutManage,
          p.enterpriseRolloutApprove,
          p.enterpriseProcurementManage,
          p.enterpriseTransferManage,
          p.enterpriseFranchiseManage,
          p.enterpriseExport,
        ],
      },
    ],
  }),
];

/**
 * Codes for running the Seramet platform itself. They are never offered for a restaurant's
 * roles; a role that already holds one keeps it untouched.
 */
export const platformOnlyPermissions: readonly PermissionCode[] = allPermissionCodes.filter(
  (code) => !accountOwnerPermissions.includes(code),
);

const areaByCode = new Map<PermissionCode, AccessArea>(
  accessAreas.flatMap((item) => item.codes.map((code) => [code, item] as const)),
);

export const areaForPermission = (code: PermissionCode) => areaByCode.get(code);

/** The level an area's permissions add up to, "none", or "custom" when they match no level. */
export function areaLevelId(item: AccessArea, rolePermissions: readonly PermissionCode[]) {
  const held = new Set(rolePermissions);
  const heldInArea = item.codes.filter((code) => held.has(code));
  if (!heldInArea.length) return NO_ACCESS;
  const match = item.levels.find(
    (level) =>
      level.codes.length === heldInArea.length && level.codes.every((code) => held.has(code)),
  );
  return match?.id ?? CUSTOM_ACCESS;
}

/**
 * The role's permissions with one area set to a level. Permissions outside the area are kept
 * exactly as they are, including platform-only codes and any code this catalogue does not know.
 */
export function withAreaLevel(
  rolePermissions: readonly PermissionCode[],
  item: AccessArea,
  levelId: string,
): PermissionCode[] {
  const level = item.levels.find((candidate) => candidate.id === levelId);
  if (!level && levelId !== NO_ACCESS) return [...rolePermissions];
  const inArea = new Set(item.codes);
  const wanted = level?.codes ?? [];
  const kept = rolePermissions.filter((code) => !inArea.has(code) || wanted.includes(code));
  return [...kept, ...wanted.filter((code) => !kept.includes(code))];
}

/** The role's permissions with one permission switched on or off. */
export function withPermission(
  rolePermissions: readonly PermissionCode[],
  code: PermissionCode,
  granted: boolean,
): PermissionCode[] {
  const without = rolePermissions.filter((item) => item !== code);
  if (!granted) return without;
  return rolePermissions.includes(code) ? [...rolePermissions] : [...without, code];
}

/**
 * The role's permissions replaced by a template, the way a new role would get them. Only what
 * the editor offers is replaced: platform-only and unknown codes stay.
 */
export function withTemplate(
  rolePermissions: readonly PermissionCode[],
  templatePermissions: readonly PermissionCode[],
): PermissionCode[] {
  const kept = rolePermissions.filter((code) => !areaByCode.has(code));
  return [...kept, ...templatePermissions.filter((code) => areaByCode.has(code))];
}

/** Codes that differ between two permission lists, whichever side they are on. */
export function changedPermissions(
  before: readonly PermissionCode[],
  after: readonly PermissionCode[],
): PermissionCode[] {
  const a = new Set(before);
  const b = new Set(after);
  return [...[...a].filter((code) => !b.has(code)), ...[...b].filter((code) => !a.has(code))];
}

/** What each permission lets a person do, in everyday words, for the Advanced lists. */
export const permissionLabels: Record<KnownPermissionCode, string> = {
  [p.dashboardView]: "See the dashboard",
  [p.posAccess]: "Open the POS",
  [p.ordersView]: "See orders",
  [p.ordersCreate]: "Take new orders",
  [p.ordersUpdate]: "Change orders and send them to the kitchen",
  [p.ordersCancel]: "Cancel orders",
  [p.ordersServe]: "Mark orders as served",
  [p.kitchenOperate]: "Start orders and mark them ready on the kitchen screen",
  [p.inventoryView]: "See stock levels",
  [p.inventoryCount]: "Count stock",
  [p.inventoryCountApprove]: "Approve stock counts",
  [p.inventoryAdjust]: "Correct stock quantities",
  [p.inventoryAdjustApprove]: "Approve stock corrections",
  [p.inventoryTransfer]: "Move stock between stores",
  [p.inventoryWastageRecord]: "Record wastage in stock control",
  [p.inventoryWastageApprove]: "Approve wastage in stock control",
  [p.inventoryIssueRequest]: "Ask the store for items",
  [p.inventoryIssueApprove]: "Approve and give out items from the store",
  [p.inventoryIssueView]: "See what the store has issued",
  [p.inventoryCostControlView]: "See food and drink costs",
  [p.inventoryCostControlManage]: "Set cost targets",
  [p.cookbookView]: "Read recipes",
  [p.cookbookManage]: "Write and edit recipes",
  [p.cookbookPublish]: "Publish recipes",
  [p.procurementRequisitionCreate]: "Ask for stock to be bought",
  [p.procurementRequisitionApprove]: "Approve stock requests",
  [p.procurementCreate]: "Make purchase orders",
  [p.procurementApprove]: "Approve purchase orders",
  [p.procurementCancel]: "Cancel purchase orders",
  [p.procurementReceive]: "Receive deliveries",
  [p.procurementInvoiceApprove]: "Approve supplier bills",
  [p.productionPlan]: "Plan batch preparation",
  [p.productionStart]: "Start batch preparation",
  [p.productionComplete]: "Finish batch preparation",
  [p.productionAdjust]: "Bring back an order marked ready by mistake",
  [p.wasteRecord]: "Record wastage and breakages",
  [p.wasteApprove]: "Approve wastage and breakages",
  [p.attendanceUse]: "Clock in and out",
  [p.payrollManage]: "Run payroll and set pay",
  [p.ridersManage]: "Add and manage riders",
  [p.deliveryDispatch]: "Send out deliveries and update their progress",
  [p.paymentsRecord]: "Record payments at the till",
  [p.paymentsView]: "See payments",
  [p.paymentsCollect]: "Take payment for a bill",
  [p.paymentsManualConfirm]: "Confirm a payment by hand when it cannot be checked automatically",
  [p.paymentsMatch]: "Match payments received to bills",
  [p.paymentsConfirm]: "Confirm payments that are waiting",
  [p.paymentsRefundRequest]: "Ask for a refund",
  [p.paymentsRefundApprove]: "Approve or reject refunds",
  [p.paymentsReconcile]: "Reconcile payments with bank and mobile money",
  [p.paymentsFxView]: "See exchange rates",
  [p.paymentsFxManage]: "Set exchange rates",
  [p.invoicesView]: "See bills",
  [p.invoicesCreate]: "Make bills",
  [p.invoicesReprint]: "Reprint bills",
  [p.invoicesCancel]: "Cancel bills",
  [p.receiptsView]: "See receipts",
  [p.receiptsReprint]: "Reprint receipts",
  [p.invoicesManage]: "Split, merge and send bills for payment",
  [p.cashClose]: "Close a cash drawer or shift",
  [p.cashOpen]: "Open a cash drawer",
  [p.cashAdjust]: "Approve cash drawer differences",
  [p.reconciliationView]: "See the day's reconciliation",
  [p.reconciliationManage]: "Prepare the day's reconciliation",
  [p.reconciliationApprove]: "Close the day",
  [p.dayCloseReopen]: "Reopen a closed day",
  [p.settlementsImport]: "Bring in settlement statements",
  [p.settlementsPost]: "Post settlements to the accounts",
  [p.financeJournalView]: "See journal entries",
  [p.financeJournalPost]: "Post journal entries",
  [p.reportsView]: "See reports",
  [p.financeView]: "See financial statements",
  [p.financeManage]: "Record expenses and other finance entries",
  [p.accountingView]: "See the accounts",
  [p.managementView]: "See tasks, approvals and decisions",
  [p.managementActionsManage]: "Create and manage tasks",
  [p.managementTargetsManage]: "Set targets",
  [p.managementFinanceView]: "See money figures in management pages",
  [p.intelligenceAsk]: "Ask Seramet questions",
  [p.intelligenceManagement]: "Ask Seramet about sales and operations",
  [p.intelligenceFinance]: "Ask Seramet about money",
  [p.intelligenceInventory]: "Ask Seramet about stock",
  [p.intelligenceStaff]: "Ask Seramet about staff",
  [p.intelligenceOwner]: "Ask Seramet owner-level questions",
  [p.intelligenceBriefsView]: "Read Seramet's daily summaries",
  [p.intelligenceBriefsManage]: "Set up Seramet's daily summaries",
  [p.intelligenceActionsSuggest]: "Turn Seramet's suggestions into tasks",
  [p.intelligenceUsageView]: "See how much Ask Seramet is used",
  [p.intelligenceAdmin]: "Change Ask Seramet settings",
  [p.crmView]: "Open the customers pages",
  [p.crmCustomerView]: "See customer records",
  [p.crmCustomerContactView]: "See customers' phone numbers and email",
  [p.crmCustomerValueView]: "See how much customers spend",
  [p.crmCustomerManage]: "Add and edit customers",
  [p.crmCustomerMerge]: "Merge duplicate customers",
  [p.crmCustomerExport]: "Download the customer list",
  [p.crmPrivacyManage]: "Handle requests to erase or share a customer's data",
  [p.loyaltyView]: "See loyalty points",
  [p.loyaltyManage]: "Set up the loyalty programme",
  [p.loyaltyAdjust]: "Add or remove loyalty points by hand",
  [p.loyaltyRedeem]: "Redeem loyalty points",
  [p.voucherView]: "See vouchers",
  [p.voucherManage]: "Create and manage vouchers",
  [p.giftCardView]: "See gift cards",
  [p.giftCardManage]: "Create and manage gift cards",
  [p.giftCardAdjust]: "Change a gift card balance by hand",
  [p.campaignView]: "See campaigns",
  [p.campaignManage]: "Create and edit campaigns",
  [p.campaignApprove]: "Approve campaigns",
  [p.campaignSend]: "Send campaigns to customers",
  [p.feedbackView]: "See customer feedback",
  [p.feedbackManage]: "Reply to and resolve feedback",
  [p.reservationView]: "See reservations",
  [p.reservationCreate]: "Take reservations",
  [p.reservationModify]: "Change reservations",
  [p.reservationCancel]: "Cancel reservations",
  [p.reservationSeat]: "Seat guests",
  [p.reservationNoShow]: "Mark a booking as a no-show",
  [p.reservationDepositManage]: "Take and refund booking deposits",
  [p.waitlistView]: "See the waiting list",
  [p.waitlistManage]: "Run the waiting list",
  [p.guestOrderView]: "See online and QR orders",
  [p.guestOrderReview]: "Review online and QR orders",
  [p.guestOrderAccept]: "Accept online and QR orders",
  [p.guestOrderCancel]: "Cancel online and QR orders",
  [p.guestServiceManage]: "Handle guest requests from tables",
  [p.tableManage]: "Set up tables and dining areas",
  [p.digitalMenuManage]: "Manage the online menu",
  [p.qrManage]: "Create table QR codes",
  [p.kitchenView]: "See the kitchen screen",
  [p.procurementView]: "See suppliers, purchase orders and deliveries",
  [p.productionView]: "See batch preparation and recipes",
  [p.staffView]: "See the team",
  [p.usersView]: "See employees and their roles",
  [p.usersManage]: "Add and edit employees",
  [p.settingsView]: "Open Settings",
  [p.settingsOrganisationView]: "See business details",
  [p.settingsBranchView]: "See branch settings",
  [p.settingsWarehouseView]: "See stores and warehouses",
  [p.settingsHardwareView]: "See printers and devices",
  [p.integrationsView]: "See connections to other systems",
  [p.marketingView]: "Open the marketing pages",
  [p.enterpriseView]: "Open head office",
  [p.enterpriseOrganisationManage]: "Change the group structure",
  [p.enterpriseAccessManage]: "Set access for the whole group",
  [p.enterpriseAccessDelegate]: "Pass on their own access to others in the group",
  [p.enterprisePolicyView]: "See group policies",
  [p.enterprisePolicyManage]: "Write group policies",
  [p.enterprisePolicyApprove]: "Approve group policies",
  [p.enterpriseRolloutView]: "See rollouts to branches",
  [p.enterpriseRolloutManage]: "Plan rollouts to branches",
  [p.enterpriseRolloutApprove]: "Approve rollouts to branches",
  [p.enterpriseProcurementView]: "See central buying",
  [p.enterpriseProcurementManage]: "Manage central buying",
  [p.enterpriseTransferManage]: "Approve stock transfers between branches",
  [p.enterpriseFranchiseView]: "See franchises",
  [p.enterpriseFranchiseManage]: "Manage franchises",
  [p.enterpriseFinanceView]: "See group finance",
  [p.enterpriseAuditView]: "See the group audit log",
  [p.enterpriseExport]: "Download head-office data",
  [p.enterpriseReadinessView]: "See branch readiness checks",
  [p.setupView]: "See setup progress",
  [p.setupManage]: "Work through setup",
  [p.setupImport]: "Import menus, items and other lists",
  [p.setupHistoricalSalesImport]: "Import past sales",
  [p.setupOpeningStock]: "Enter opening stock",
  [p.setupOpeningStockApprove]: "Approve opening stock",
  [p.setupAccountingManage]: "Set up the accounts",
  [p.setupGoLiveApprove]: "Approve going live",
  [p.setupGoLiveOverride]: "Go live with setup checks still open",
  [p.setupExport]: "Download setup data",
  [p.setupEntitlementsManage]: "Change which features are switched on",
  [p.setupDemoReset]: "Reset demo data",
  [p.setupDiagnosticsView]: "See setup health checks",
  [p.platformTenantsProvision]: "Create restaurants on the platform",
  [p.platformEmailView]: "See platform email",
  [p.marketingManage]: "Manage marketing",
  [p.staffManage]: "Correct attendance and manage schedules",
  [p.auditView]: "See the audit log",
  [p.settingsOrganisationManage]: "Change business details",
  [p.settingsBranchManage]: "Change branch settings",
  [p.settingsWarehouseManage]: "Add and change stores and warehouses",
  [p.settingsIntegrationManage]: "Approve connections to other systems",
  [p.integrationsOrdersView]: "See orders from delivery apps",
  [p.integrationsOrdersManage]: "Handle orders from delivery apps",
  [p.integrationsMenuSync]: "Send the menu to delivery apps",
  [p.integrationsMappingManage]: "Match menu items with delivery apps",
  [p.integrationsStoreManage]: "Open or pause the store on delivery apps",
  [p.integrationsConnectionManage]: "Connect and disconnect other systems",
  [p.settingsPaymentManage]: "Add and change payment methods",
  [p.settingsHardwareManage]: "Set up printers and devices",
  [p.settingsRoleManage]: "Change what each role can do",
  [p.settingsChannelManage]: "Add and change order channels",
  [p.branchSwitch]: "Switch between their branches",
  [p.tenantScopeAllBranches]: "See and work in every branch",
  [p.ownershipTransfer]: "Hand the business to a new owner",
  [p.deviceActivate]: "Set up a new till or tablet",
  [p.employeeCredentialsManage]: "Reset employees' sign-in codes",
  [p.branchesReconcile]: "Repair branch records",
};

/** Everyday wording for a permission; a code this catalogue does not know is shown as it is. */
export const permissionLabel = (code: PermissionCode) =>
  (permissionLabels as Record<string, string>)[code] ?? code;
