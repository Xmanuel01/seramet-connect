import {
  LayoutDashboard, ShoppingCart, ChefHat, Boxes, Truck, Users, IdCard,
  Wallet, Gauge, Sparkles, BarChart3, Settings, Component,
} from "lucide-react";

export type NavItem = { label: string; to?: string; icon?: any };
export type NavGroup = { group: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  { group: "", items: [{ label: "Home", to: "/", icon: LayoutDashboard }] },
  {
    group: "Sell",
    items: [
      { label: "POS", to: "/pos", icon: ShoppingCart },
      { label: "Orders", to: "/orders", icon: ShoppingCart },
      { label: "Tables", to: "/tables", icon: ShoppingCart },
      { label: "Invoices", to: "/invoices", icon: ShoppingCart },
      { label: "Receipts", to: "/receipts", icon: ShoppingCart },
      { label: "Reservations", to: "/reservations", icon: ShoppingCart },
      { label: "Returns", to: "/returns", icon: ShoppingCart },
      { label: "Refunds", to: "/refunds", icon: ShoppingCart },
    ],
  },
  {
    group: "Kitchen",
    items: [
      { label: "Kitchen Display", to: "/kitchen", icon: ChefHat },
      { label: "Production", to: "/production", icon: ChefHat },
      { label: "Recipes", to: "/recipes", icon: ChefHat },
      { label: "Prep", to: "/prep", icon: ChefHat },
      { label: "Kitchen Analytics", to: "/kitchen-analytics", icon: ChefHat },
    ],
  },
  {
    group: "Inventory",
    items: [
      { label: "Overview", to: "/inventory", icon: Boxes },
      { label: "Items", to: "/inventory", icon: Boxes },
      { label: "Warehouses", to: "/warehouses", icon: Boxes },
      { label: "Stock Counts", to: "/stock-count", icon: Boxes },
      { label: "Transfers", to: "/transfers", icon: Boxes },
      { label: "Adjustments", to: "/adjustments", icon: Boxes },
      { label: "Wastage", to: "/wastage", icon: Boxes },
      { label: "PAR Levels", to: "/par", icon: Boxes },
    ],
  },
  {
    group: "Procurement",
    items: [
      { label: "Purchase Orders", to: "/procurement", icon: Truck },
      { label: "Suppliers", to: "/procurement", icon: Truck },
      { label: "Receiving", icon: Truck },
    ],
  },
  {
    group: "Customers",
    items: [
      { label: "Customer 360", to: "/customers", icon: Users },
      { label: "Loyalty", icon: Users },
      { label: "Complaints", icon: Users },
    ],
  },
  {
    group: "People",
    items: [
      { label: "Overview", to: "/people", icon: IdCard },
      { label: "Attendance", icon: IdCard },
      { label: "Schedule", to: "/people", icon: IdCard },
      { label: "Payroll", icon: IdCard },
    ],
  },
  {
    group: "Finance",
    items: [
      { label: "Overview", to: "/finance", icon: Wallet },
      { label: "Profit & Loss", to: "/finance", icon: Wallet },
      { label: "Expenses", icon: Wallet },
      { label: "Payables", icon: Wallet },
    ],
  },
  {
    group: "Management",
    items: [
      { label: "Command Centre", to: "/command-centre", icon: Gauge },
      { label: "Approvals", to: "/approvals", icon: Gauge },
      { label: "Audit Trail", icon: Gauge },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { label: "Seramet AI", to: "/ai", icon: Sparkles },
      { label: "Reports", to: "/reports", icon: BarChart3 },
    ],
  },
  {
    group: "System",
    items: [
      { label: "Design System", to: "/design-system", icon: Component },
      { label: "Settings", to: "/settings", icon: Settings },
    ],
  },
];