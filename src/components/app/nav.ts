import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  Boxes,
  Truck,
  Users,
  IdCard,
  Wallet,
  Gauge,
  Sparkles,
  BarChart3,
  Settings,
  Component,
  Martini,
  Wifi,
  ClipboardList,
  ReceiptText,
  CalendarDays,
  RotateCcw,
  PackageCheck,
  Warehouse,
  ClipboardCheck,
  Scale,
  UserRound,
  HandCoins,
  FileText,
  Building2,
  Calculator,
  GitBranch,
  Tags,
  Landmark,
  ListTodo,
  BadgeDollarSign,
  Store,
  Printer,
  Settings2,
  FileSpreadsheet,
  Repeat2,
  Globe2,
  Bike,
  Megaphone,
  Layers,
  Bell,
  Plug,
  Award,
  UserPlus,
  CalendarX,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/app-context";
import { branchHasCapability, type BranchCapability } from "@/lib/seramet-print-service";

export type NavItem = {
  label: string;
  to?: string;
  icon?: LucideIcon;
  roles?: AppRole[];
  capability?: BranchCapability;
};
export type NavGroup = { group: string; items: NavItem[]; roles?: AppRole[] };

const opsRoles: AppRole[] = ["General Manager", "Branch Manager"];
const sellRoles: AppRole[] = ["General Manager", "Branch Manager", "Cashier"];
const inventoryRoles: AppRole[] = ["General Manager", "Branch Manager", "Storekeeper", "Chef"];
const procurementRoles: AppRole[] = [
  "General Manager",
  "Branch Manager",
  "Storekeeper",
  "Accountant",
  "Chef",
];
const customerRoles: AppRole[] = ["General Manager", "Branch Manager", "Cashier"];
const peopleRoles: AppRole[] = ["General Manager", "Branch Manager", "Accountant"];
const financeRoles: AppRole[] = ["General Manager", "Accountant", "Branch Manager"];
const managementRoles: AppRole[] = [
  "General Manager",
  "Branch Manager",
  "Accountant",
  "Storekeeper",
  "Chef",
  "Cashier",
];
const dashboardRoles: AppRole[] = ["General Manager", "Branch Manager"];
const marketingRoles: AppRole[] = ["General Manager", "Branch Manager", "Website and Marketing"];
const allRoles: AppRole[] = [
  "General Manager",
  "Branch Manager",
  "Accountant",
  "Storekeeper",
  "Chef",
  "Cashier",
  "Website and Marketing",
];
export const routePermissionStorageKey = "seramet.route-permissions.v1";

export const navGroups: NavGroup[] = [
  {
    group: "",
    items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard, roles: dashboardRoles }],
  },
  {
    group: "Sell",
    roles: sellRoles,
    items: [
      { label: "POS", to: "/pos", icon: ShoppingCart, capability: "POS_ENABLED" },
      { label: "Orders", to: "/orders", icon: ShoppingCart, capability: "POS_ENABLED" },
      { label: "Online Orders", to: "/online-orders", icon: Wifi, capability: "ONLINE_ORDERS" },
      { label: "Tables", to: "/tables", icon: ShoppingCart, capability: "TABLE_SERVICE" },
      { label: "Invoices", to: "/invoices", icon: FileText, capability: "INVOICE_PRINTING" },
      { label: "Pending", to: "/pending", icon: ReceiptText, capability: "INVOICE_PRINTING" },
      { label: "Receipts", to: "/receipts", icon: ReceiptText, capability: "RECEIPT_PRINTING" },
      {
        label: "Reservations",
        to: "/reservations",
        icon: CalendarDays,
        capability: "RESERVATIONS",
      },
      { label: "Returns", to: "/returns", icon: RotateCcw },
      { label: "Refunds", to: "/refunds", icon: RotateCcw },
      { label: "Delivery", to: "/delivery", icon: Bike },
      { label: "Riders", to: "/riders", icon: Bike },
    ],
  },
  {
    group: "Kitchen",
    roles: ["General Manager", "Branch Manager", "Chef"],
    items: [
      { label: "Kitchen Display", to: "/kitchen", icon: ChefHat, capability: "KDS_ENABLED" },
      { label: "Production", to: "/production", icon: ChefHat, capability: "KITCHEN_PRINTING" },
      { label: "Bar", to: "/bar", icon: Martini, capability: "BAR_MODULE" },
      { label: "Cost Control", to: "/cost-control", icon: Calculator },
      { label: "Menu Import", to: "/menu-import", icon: FileSpreadsheet, roles: opsRoles },
      { label: "Recipes", to: "/recipes", icon: ChefHat },
      { label: "Prep", to: "/prep", icon: ChefHat },
      {
        label: "Kitchen Analytics",
        to: "/kitchen-analytics",
        icon: ChefHat,
        capability: "KDS_ENABLED",
      },
    ],
  },
  {
    group: "Inventory",
    roles: inventoryRoles,
    items: [
      { label: "Overview", to: "/inventory", icon: Boxes },
      { label: "Items", to: "/inventory", icon: Boxes },
      { label: "Categories", to: "/categories", icon: Tags },
      { label: "Stock Detail", to: "/stock-detail", icon: Boxes },
      { label: "Warehouses", to: "/warehouses", icon: Warehouse },
      { label: "Stock Counts", to: "/stock-count", icon: ClipboardCheck },
      { label: "Transfers", to: "/transfers", icon: PackageCheck },
      { label: "Adjustments", to: "/adjustments", icon: Scale },
      { label: "Wastage", to: "/wastage", icon: ClipboardList },
      { label: "Breakages", to: "/breakages", icon: ClipboardList },
      { label: "PAR Levels", to: "/par", icon: ClipboardList },
    ],
  },
  {
    group: "Procurement",
    roles: procurementRoles,
    items: [
      { label: "Overview", to: "/procurement", icon: Truck },
      { label: "Requisitions", to: "/requisitions", icon: ClipboardList },
      { label: "Purchase Orders", to: "/purchase-orders", icon: Truck },
      { label: "Receiving", to: "/receiving", icon: PackageCheck },
      { label: "Suppliers", to: "/suppliers", icon: Building2 },
      { label: "Supplier Bills", to: "/supplier-bills", icon: ReceiptText },
      { label: "Supplier Performance", to: "/supplier-performance", icon: BarChart3 },
    ],
  },
  {
    group: "Customers",
    roles: customerRoles,
    items: [
      { label: "Customer 360", to: "/customers", icon: Users },
      { label: "CRM Overview", to: "/crm", icon: Users },
      { label: "CRM Pipeline", to: "/crm-pipeline", icon: GitBranch },
      { label: "Loyalty", to: "/loyalty", icon: HandCoins, capability: "LOYALTY" },
      { label: "Complaints", to: "/complaints", icon: ClipboardList },
      { label: "Campaigns", to: "/campaigns", icon: Megaphone },
      { label: "Segments", to: "/segments", icon: Layers },
    ],
  },
  {
    group: "People",
    roles: peopleRoles,
    items: [
      { label: "Overview", to: "/people", icon: IdCard },
      { label: "Employees", to: "/employees", icon: UserRound },
      { label: "Attendance", to: "/attendance", icon: ClipboardCheck },
      { label: "Schedule", to: "/schedule", icon: CalendarDays },
      { label: "Payroll", to: "/payroll", icon: Wallet },
      { label: "Leave", to: "/leave", icon: CalendarX },
      { label: "Performance", to: "/performance", icon: Award },
      { label: "Recruitment", to: "/recruitment", icon: UserPlus },
    ],
  },
  {
    group: "Finance",
    roles: financeRoles,
    items: [
      { label: "Overview", to: "/finance", icon: Wallet },
      { label: "Profit & Loss", to: "/profit-loss", icon: FileText },
      { label: "Balance Sheet", to: "/balance-sheet", icon: Landmark },
      { label: "Cash Flow", to: "/cash-flow", icon: BarChart3 },
      { label: "Expenses", to: "/expenses", icon: ReceiptText },
      { label: "Reconciliation", to: "/reconciliation", icon: Repeat2 },
      { label: "Payables", to: "/payables", icon: Wallet },
      { label: "Receivables", to: "/receivables", icon: BadgeDollarSign },
      { label: "Assets", to: "/assets", icon: Boxes },
      { label: "General Ledger", to: "/general-ledger", icon: Landmark },
    ],
  },
  {
    group: "Management",
    roles: managementRoles,
    items: [
      { label: "Command Centre", to: "/command-centre", icon: Gauge, roles: opsRoles },
      { label: "Pending Decisions", to: "/decisions", icon: Gauge, roles: opsRoles },
      { label: "Branches", to: "/branches", icon: Store, roles: opsRoles },
      {
        label: "Approvals",
        to: "/approvals",
        icon: Gauge,
        roles: ["General Manager", "Branch Manager", "Accountant", "Storekeeper", "Chef"],
      },
      {
        label: "Tasks",
        to: "/tasks",
        icon: ListTodo,
        roles: [
          "General Manager",
          "Branch Manager",
          "Accountant",
          "Storekeeper",
          "Chef",
          "Cashier",
        ],
      },
      { label: "Audit Trail", to: "/audit-trail", icon: ClipboardList, roles: opsRoles },
      { label: "Notifications", to: "/notifications", icon: Bell, roles: opsRoles },
    ],
  },
  {
    group: "Intelligence",
    roles: ["General Manager", "Branch Manager", "Accountant", "Storekeeper", "Chef"],
    items: [
      { label: "Seramet AI", to: "/ai", icon: Sparkles },
      { label: "Reports", to: "/reports", icon: BarChart3 },
    ],
  },
  {
    group: "Marketing",
    roles: marketingRoles,
    items: [{ label: "Website & Channels", to: "/marketing", icon: Globe2, roles: marketingRoles }],
  },
  {
    group: "System",
    roles: opsRoles,
    items: [
      { label: "Design System", to: "/design-system", icon: Component },
      { label: "Seramet Printers", to: "/seramet-printers", icon: Printer },
      { label: "Hardware Setup", to: "/seramet-setup", icon: Settings2 },
      { label: "Integrations", to: "/integrations", icon: Plug },
      { label: "Settings", to: "/settings", icon: Settings },
    ],
  },
];

export function getVisibleNavGroups(role: AppRole, branch?: string) {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          routeAllowsRole(item, role) &&
          (!item.capability || branchHasCapability(branch, item.capability)),
      ),
    }))
    .filter((group) => !group.roles || group.roles.includes(role) || group.items.length > 0)
    .filter((group) => group.items.length > 0);
}

export function roleCanAccessPath(role: AppRole, path: string, branch?: string) {
  const matchedItem = navGroups.flatMap((group) => group.items).find((item) => item.to === path);
  if (matchedItem?.capability && !branchHasCapability(branch, matchedItem.capability)) return false;
  if (role === "General Manager") return true;
  return getVisibleNavGroups(role, branch).some((group) =>
    group.items.some((item) => item.to === path),
  );
}

export function getDefaultRoutePermissions() {
  const permissions: Record<string, AppRole[]> = {};
  navGroups.forEach((group) => {
    group.items.forEach((item) => {
      if (item.to) permissions[item.to] = item.roles ?? group.roles ?? allRoles;
    });
  });
  return permissions;
}

export function getRoutePermissionRoles(path: string) {
  const defaults = getDefaultRoutePermissions();
  if (typeof window === "undefined") return defaults[path] ?? allRoles;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(routePermissionStorageKey) ?? "{}",
    ) as Record<string, AppRole[]>;
    return stored[path] ?? defaults[path] ?? allRoles;
  } catch {
    return defaults[path] ?? allRoles;
  }
}

export function setRoutePermissionRoles(path: string, roles: AppRole[]) {
  if (typeof window === "undefined") return;
  const stored = JSON.parse(
    window.localStorage.getItem(routePermissionStorageKey) ?? "{}",
  ) as Record<string, AppRole[]>;
  window.localStorage.setItem(
    routePermissionStorageKey,
    JSON.stringify({ ...stored, [path]: roles }),
  );
  window.dispatchEvent(new CustomEvent("seramet-permissions-change"));
}

function routeAllowsRole(item: NavItem, role: AppRole) {
  if (!item.to) return !item.roles || item.roles.includes(role);
  return getRoutePermissionRoles(item.to).includes(role);
}
