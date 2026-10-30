import {
  Award,
  Activity,
  BadgeDollarSign,
  BarChart3,
  Bike,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  CalendarDays,
  CalendarX,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  HandCoins,
  IdCard,
  Landmark,
  Layers,
  LayoutDashboard,
  ListTodo,
  Martini,
  Megaphone,
  PackageCheck,
  Plug,
  Printer,
  ReceiptText,
  QrCode,
  Repeat2,
  RotateCcw,
  Scale,
  Settings,
  ShoppingCart,
  Sparkles,
  Store,
  Tags,
  Truck,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/app-context";
import { pilotUnavailable } from "@/lib/pilot-unavailable";
import { LOCAL_PILOT_TENANT_ID } from "@/platform/pilot-defaults";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { PermissionCode } from "@/platform/types";
import {
  buildModuleAccessProfile,
  canNavigateToPath,
  moduleDefinitionsForPath,
  type ModuleAccessProfile,
} from "@/platform/module-access-registry";

export type NavItem = {
  label: string;
  to?: string;
  icon?: LucideIcon;
  permission?: PermissionCode;
  activePaths?: readonly string[];
};

export function navItemMatchesPath(item: NavItem, path: string) {
  return item.to === path || Boolean(item.activePaths?.includes(path));
}

export type NavGroup = {
  group: string;
  items: NavItem[];
  permission?: PermissionCode;
};

export const navGroups: NavGroup[] = [
  {
    group: "",
    items: [
      { label: "Dashboard", to: "/", icon: LayoutDashboard, permission: permissions.dashboardView },
    ],
  },
  {
    group: "Sales",
    items: [
      { label: "POS", to: "/pos", icon: ShoppingCart, permission: permissions.posAccess },
      { label: "Orders", to: "/orders", icon: ShoppingCart, permission: permissions.ordersView },
      {
        label: "Online Orders",
        to: "/online-orders",
        icon: Wifi,
        permission: permissions.guestOrderView,
      },
      {
        label: "Marketplace",
        to: "/marketplace",
        icon: Globe2,
        permission: permissions.integrationsView,
      },
      { label: "Invoices", to: "/invoices", icon: FileText, permission: permissions.invoicesView },
      { label: "Pending", to: "/pending", icon: ReceiptText, permission: permissions.invoicesView },
      {
        label: "Receipts",
        to: "/receipts",
        icon: ReceiptText,
        permission: permissions.receiptsView,
      },
      // Guest operations share one workspace; existing tab URLs remain valid.
      {
        label: "Front of House",
        to: "/tables",
        activePaths: ["/host", "/reservations", "/waitlist", "/guest-service"],
        icon: Users,
        permission: permissions.reservationView,
      },
      {
        label: "QR Management",
        to: "/qr-management",
        icon: QrCode,
        permission: permissions.qrManage,
      },
      {
        label: "Returns",
        to: "/returns",
        icon: RotateCcw,
        permission: permissions.paymentsRefundRequest,
      },
      {
        label: "Refunds",
        to: "/refunds",
        icon: RotateCcw,
        permission: permissions.paymentsRefundRequest,
      },
      { label: "Delivery", to: "/delivery", icon: Bike, permission: permissions.deliveryDispatch },
      { label: "Riders", to: "/riders", icon: Bike, permission: permissions.ridersManage },
    ],
  },
  {
    group: "Kitchen",
    permission: permissions.kitchenView,
    items: [
      { label: "Kitchen Display", to: "/kitchen", icon: ChefHat },
      { label: "Production", to: "/production", icon: ChefHat },
      { label: "Bar", to: "/bar", icon: Martini },
      {
        label: "Cost Control",
        to: "/cost-control",
        icon: Calculator,
        permission: permissions.inventoryCostControlView,
      },
      {
        label: "Menu Import",
        to: "/menu-import",
        icon: FileSpreadsheet,
        permission: permissions.settingsOrganisationManage,
      },
      { label: "Recipes", to: "/recipes", icon: ChefHat, permission: permissions.productionView },
      { label: "Cookbook", to: "/cookbook", icon: BookOpen, permission: permissions.cookbookView },
      {
        label: "Stock Requests",
        to: "/requisitions",
        icon: ClipboardList,
        permission: permissions.procurementRequisitionCreate,
      },
      { label: "Prep", to: "/prep", icon: ChefHat, permission: permissions.productionView },
      { label: "Kitchen Analytics", to: "/kitchen-analytics", icon: ChefHat },
    ],
  },
  {
    group: "Inventory",
    permission: permissions.inventoryView,
    items: [
      { label: "Overview", to: "/inventory", icon: Boxes },
      { label: "Items", to: "/inventory-items", icon: Boxes },
      { label: "Categories", to: "/categories", icon: Tags },
      { label: "Stock Detail", to: "/stock-detail", icon: Boxes },
      { label: "Warehouses", to: "/warehouses", icon: Warehouse },
      { label: "Stock Counts", to: "/stock-count", icon: ClipboardCheck },
      {
        label: "Transfers",
        to: "/transfers",
        icon: PackageCheck,
        permission: permissions.inventoryAdjust,
      },
      {
        label: "Adjustments",
        to: "/adjustments",
        icon: Scale,
        permission: permissions.inventoryAdjust,
      },
      {
        label: "Wastage",
        to: "/wastage",
        icon: ClipboardList,
        permission: permissions.wasteRecord,
      },
      {
        label: "Breakages",
        to: "/breakages",
        icon: ClipboardList,
        permission: permissions.wasteRecord,
      },
      { label: "PAR Levels", to: "/par", icon: ClipboardList },
    ],
  },
  {
    group: "Procurement",
    permission: permissions.procurementView,
    items: [
      { label: "Overview", to: "/procurement", icon: Truck },
      { label: "Requisitions", to: "/requisitions", icon: ClipboardList },
      { label: "Purchase Orders", to: "/purchase-orders", icon: Truck },
      {
        label: "Receiving",
        to: "/receiving",
        icon: PackageCheck,
        permission: permissions.procurementReceive,
      },
      { label: "Suppliers", to: "/suppliers", icon: Building2 },
      { label: "Supplier Bills", to: "/supplier-bills", icon: ReceiptText },
      { label: "Supplier Performance", to: "/supplier-performance", icon: BarChart3 },
    ],
  },
  {
    group: "Customers",
    items: [
      { label: "Customer 360", to: "/customers", icon: Users, permission: permissions.crmView },
      { label: "CRM Overview", to: "/crm", icon: Users, permission: permissions.crmView },
      {
        label: "CRM Pipeline",
        to: "/crm-pipeline",
        icon: GitBranch,
        permission: permissions.crmView,
      },
      { label: "Loyalty", to: "/loyalty", icon: HandCoins, permission: permissions.loyaltyView },
      {
        label: "Complaints",
        to: "/complaints",
        icon: ClipboardList,
        permission: permissions.crmView,
      },
      {
        label: "Campaigns",
        to: "/campaigns",
        icon: Megaphone,
        permission: permissions.marketingManage,
      },
      { label: "Segments", to: "/segments", icon: Layers, permission: permissions.marketingManage },
    ],
  },
  {
    group: "People",
    permission: permissions.staffView,
    items: [
      { label: "Overview", to: "/people", icon: IdCard },
      { label: "Employees", to: "/employees", icon: UserRound },
      { label: "Attendance", to: "/attendance", icon: ClipboardCheck },
      { label: "Schedule", to: "/schedule", icon: CalendarDays },
      { label: "Payroll", to: "/payroll", icon: Wallet, permission: permissions.payrollManage },
      { label: "Leave", to: "/leave", icon: CalendarX },
      { label: "Performance", to: "/performance", icon: Award },
      { label: "Recruitment", to: "/recruitment", icon: UserPlus },
    ],
  },
  {
    group: "Finance",
    permission: permissions.financeView,
    items: [
      { label: "Overview", to: "/finance", icon: Wallet },
      { label: "Profit & Loss", to: "/profit-loss", icon: FileText },
      { label: "Balance Sheet", to: "/balance-sheet", icon: Landmark },
      { label: "Cash Flow", to: "/cash-flow", icon: BarChart3 },
      { label: "Expenses", to: "/expenses", icon: ReceiptText },
      {
        label: "Payment Control",
        to: "/payment-control",
        icon: HandCoins,
        permission: permissions.paymentsView,
      },
      {
        label: "Reconciliation",
        to: "/reconciliation",
        icon: Repeat2,
        permission: permissions.paymentsReconcile,
      },
      { label: "Payables", to: "/payables", icon: Wallet },
      { label: "Receivables", to: "/receivables", icon: BadgeDollarSign },
      { label: "Assets", to: "/assets", icon: Boxes },
      { label: "General Ledger", to: "/general-ledger", icon: Landmark },
    ],
  },
  {
    group: "Accounting",
    permission: permissions.accountingView,
    items: [
      { label: "Accounting Hub", to: "/accounting", icon: Calculator },
      { label: "Daily Sales Journal", to: "/daily-sales-journal", icon: ReceiptText },
      { label: "Trial Balance", to: "/trial-balance", icon: Scale },
      { label: "Prime Cost", to: "/prime-cost", icon: Calculator },
      { label: "Tax Centre", to: "/tax-centre", icon: Landmark },
      { label: "Period Close", to: "/period-close", icon: ClipboardCheck },
    ],
  },
  {
    group: "Management",
    items: [
      {
        label: "Command Centre",
        to: "/command-centre",
        icon: Gauge,
        permission: permissions.dashboardView,
      },
      {
        label: "Enterprise",
        to: "/enterprise",
        icon: Building2,
        permission: permissions.enterpriseView,
      },
      {
        label: "Pending Decisions",
        to: "/decisions",
        icon: Gauge,
        permission: permissions.dashboardView,
      },
      {
        label: "Branches",
        to: "/branches",
        icon: Store,
        permission: permissions.settingsBranchManage,
      },
      {
        label: "Approvals",
        to: "/approvals",
        icon: Gauge,
        permission: permissions.procurementApprove,
      },
      { label: "Tasks", to: "/tasks", icon: ListTodo, permission: permissions.ordersUpdate },
      {
        label: "Audit Trail",
        to: "/audit-trail",
        icon: ClipboardList,
        permission: permissions.auditView,
      },
      {
        label: "Notifications",
        to: "/notifications",
        icon: Bell,
        permission: permissions.auditView,
      },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { label: "Ask Seramet", to: "/ai", icon: Sparkles, permission: permissions.intelligenceAsk },
      { label: "Reports", to: "/reports", icon: BarChart3, permission: permissions.reportsView },
    ],
  },
  {
    group: "Marketing",
    permission: permissions.marketingView,
    items: [{ label: "Website & Channels", to: "/marketing", icon: Globe2 }],
  },
  {
    group: "System",
    // Restaurant-facing administration, most used first. The UI kit is reached from Settings.
    items: [
      { label: "Settings", to: "/settings", icon: Settings, permission: permissions.settingsView },
      {
        label: "Setup Centre",
        to: "/seramet-setup",
        icon: ClipboardCheck,
        permission: permissions.setupView,
      },
      {
        label: "Printers & Devices",
        to: "/seramet-printers",
        icon: Printer,
        permission: permissions.settingsHardwareView,
      },
      {
        label: "Integrations",
        to: "/integrations",
        icon: Plug,
        permission: permissions.integrationsView,
      },
      {
        label: "System Health",
        to: "/system-health",
        icon: Activity,
        permission: permissions.auditView,
      },
    ],
  },
];

export function getVisibleNavGroups(
  role: AppRole,
  _branch?: string,
  grantedPermissions?: PermissionCode[],
  tenantId = LOCAL_PILOT_TENANT_ID,
  moduleAccess?: ModuleAccessProfile,
) {
  const allowed = new Set(grantedPermissions ?? permissionsForRole(role, tenantId));
  const access =
    moduleAccess ??
    buildModuleAccessProfile({
      permissions: [...allowed],
      organizationalScopes: allowed.has(permissions.tenantScopeAllBranches)
        ? ["GROUP", "LEGAL_ENTITY", "BRAND", "REGION", "AREA", "BRANCH", "WAREHOUSE", "COMMISSARY"]
        : ["BRANCH"],
      entitlements: [],
      entitlementsEnforced: false,
    });
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.to && pilotUnavailable[item.to]) return false;
        const registered = item.to ? moduleDefinitionsForPath(item.to).length > 0 : false;
        if (item.to && registered && !canNavigateToPath(access, item.to)) return false;
        if (!registered) {
          const permission = item.permission ?? group.permission;
          if (permission && !allowed.has(permission)) return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function roleCanAccessPath(
  role: AppRole,
  path: string,
  branch?: string,
  grantedPermissions?: PermissionCode[],
  tenantId = LOCAL_PILOT_TENANT_ID,
  moduleAccess?: ModuleAccessProfile,
) {
  return getVisibleNavGroups(role, branch, grantedPermissions, tenantId, moduleAccess).some(
    (group) => group.items.some((item) => item.to === path),
  );
}

export function getDefaultRoutePermissions(tenantId = LOCAL_PILOT_TENANT_ID) {
  return Object.fromEntries(
    navGroups.flatMap((group) =>
      group.items
        .filter((item): item is NavItem & { to: string } => Boolean(item.to))
        .map((item) => [
          item.to,
          roleNamesWithPermission(item.permission ?? group.permission, tenantId),
        ]),
    ),
  ) as Record<string, AppRole[]>;
}

export function getRoutePermissionRoles(path: string, tenantId = LOCAL_PILOT_TENANT_ID) {
  return getDefaultRoutePermissions(tenantId)[path] ?? [];
}

export function setRoutePermissionRoles(
  path: string,
  roleNames: AppRole[],
  tenantId = LOCAL_PILOT_TENANT_ID,
) {
  const permission = permissionForPath(path);
  if (!permission) return;
  const repository = getConfigurationRepository();
  repository.listRoles(tenantId).forEach((role) => {
    const shouldHavePermission = roleNames.includes(role.name);
    const hasPermission = role.permissions.includes(permission);
    if (shouldHavePermission === hasPermission) return;
    repository.upsertRole(tenantId, {
      ...role,
      permissions: shouldHavePermission
        ? [...role.permissions, permission]
        : role.permissions.filter((item) => item !== permission),
    });
  });
}

function permissionForPath(path: string) {
  for (const group of navGroups) {
    const item = group.items.find((candidate) => candidate.to === path);
    if (item) return item.permission ?? group.permission;
  }
  return undefined;
}

function permissionsForRole(roleName: string, tenantId: string) {
  return getConfigurationRepository()
    .listRoles(tenantId)
    .filter(
      (role) =>
        role.name.toLowerCase() === roleName.toLowerCase() ||
        role.code.toLowerCase() === roleName.toLowerCase(),
    )
    .flatMap((role) => role.permissions);
}

function roleNamesWithPermission(permission: PermissionCode | undefined, tenantId: string) {
  if (!permission) return [];
  return getConfigurationRepository()
    .listRoles(tenantId)
    .filter((role) => role.permissions.includes(permission))
    .map((role) => role.name);
}
