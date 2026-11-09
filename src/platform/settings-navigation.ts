export type SettingsRoute =
  | "/accounting"
  | "/ai"
  | "/approvals"
  | "/audit-trail"
  | "/branches"
  | "/campaigns"
  | "/categories"
  | "/complaints"
  | "/design-system"
  | "/integrations"
  | "/loyalty"
  | "/marketing"
  | "/notifications"
  | "/par"
  | "/payroll"
  | "/purchase-orders"
  | "/receiving"
  | "/segments"
  | "/seramet-printers"
  | "/seramet-setup"
  | "/suppliers"
  | "/system-health"
  | "/tables"
  | "/tax-centre"
  | "/vouchers"
  | "/warehouses";

export type SettingsItem = {
  label: string;
  description: string;
} & (
  | { kind: "inline" }
  | {
      kind: "route";
      to: SettingsRoute;
      section?: SetupSection;
    }
);

export type SettingsGroup = {
  label: string;
  items: readonly SettingsItem[];
};

export const settingsGroups: readonly SettingsGroup[] = [
  {
    label: "Company",
    items: [
      {
        label: "Profile",
        description: "Your business name, country, timezone and currency.",
        kind: "route",
        to: "/seramet-setup",
        section: "BUSINESS_PROFILE",
      },
      {
        label: "Branches",
        description: "Your locations, and adding a new one.",
        kind: "route",
        to: "/branches",
      },
      {
        label: "Operating hours",
        description: "When each branch opens and closes.",
        kind: "route",
        to: "/seramet-setup",
        section: "BRANCHES",
      },
      {
        label: "Currencies",
        description: "Your main currency and the exchange rates you accept.",
        kind: "route",
        to: "/seramet-setup",
        section: "BUSINESS_PROFILE",
      },
    ],
  },
  {
    label: "Users and access",
    items: [
      {
        label: "Users",
        description: "Which branches each person works at.",
        kind: "inline",
      },
      {
        label: "Roles",
        description: "Add or remove roles like Cashier or Chef.",
        kind: "inline",
      },
      {
        label: "Permissions",
        description: "Choose what each role can see and do.",
        kind: "inline",
      },
      {
        label: "Approval limits",
        description: "Requests waiting for a manager's OK.",
        kind: "route",
        to: "/approvals",
      },
    ],
  },
  {
    label: "POS and restaurant",
    items: [
      {
        label: "Registers",
        description: "Tills and devices at each branch.",
        kind: "route",
        to: "/seramet-setup",
        section: "PRINTERS_DEVICES",
      },
      {
        label: "Tables",
        description: "Your tables and seating areas.",
        kind: "route",
        to: "/tables",
      },
      {
        label: "Order types",
        description: "Dine-in, takeaway, delivery and other order types.",
        kind: "inline",
      },
      {
        label: "Receipt templates",
        description: "How receipts and bills look, and which printer they use.",
        kind: "route",
        to: "/seramet-printers",
      },
    ],
  },
  {
    label: "Inventory",
    items: [
      {
        label: "Units",
        description: "Units like kg, litre or piece, and how they convert.",
        kind: "route",
        to: "/seramet-setup",
        section: "RECIPES_UOM",
      },
      {
        label: "Categories",
        description: "Groups for your stock items.",
        kind: "route",
        to: "/categories",
      },
      {
        label: "Warehouses",
        description: "Stores and stock rooms.",
        kind: "route",
        to: "/warehouses",
      },
      {
        label: "PAR rules",
        description: "When to reorder each item, and how much.",
        kind: "route",
        to: "/par",
      },
    ],
  },
  {
    label: "Procurement",
    items: [
      {
        label: "PO numbering",
        description: "Purchase orders and their numbers.",
        kind: "route",
        to: "/purchase-orders",
      },
      {
        label: "Supplier terms",
        description: "Suppliers, delivery times and payment terms.",
        kind: "route",
        to: "/suppliers",
      },
      {
        label: "Receiving rules",
        description: "Checking deliveries in against the order.",
        kind: "route",
        to: "/receiving",
      },
      {
        label: "Approval routing",
        description: "Who approves purchases.",
        kind: "route",
        to: "/approvals",
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        label: "Chart of accounts",
        description: "Your accounts for bookkeeping.",
        kind: "route",
        to: "/accounting",
      },
      {
        label: "Taxes",
        description: "VAT and other taxes, and tax reports.",
        kind: "route",
        to: "/tax-centre",
      },
      {
        label: "Payment methods",
        description: "Cash, M-Pesa, card and other ways customers pay.",
        kind: "inline",
      },
      {
        label: "Payroll",
        description: "Staff pay and deductions.",
        kind: "route",
        to: "/payroll",
      },
    ],
  },
  {
    label: "CRM",
    items: [
      {
        label: "Loyalty tiers",
        description: "Your loyalty programme and its levels.",
        kind: "route",
        to: "/loyalty",
      },
      {
        label: "Coupons",
        description: "Vouchers and discount codes.",
        kind: "route",
        to: "/vouchers",
      },
      {
        label: "Complaint SLAs",
        description: "Customer complaints and how fast you respond.",
        kind: "route",
        to: "/complaints",
      },
    ],
  },
  {
    label: "Marketing",
    items: [
      {
        label: "Customer groups",
        description: "Groups of customers, like regulars.",
        kind: "route",
        to: "/segments",
      },
      {
        label: "WhatsApp",
        description: "Sending customers WhatsApp messages.",
        kind: "route",
        to: "/integrations",
      },
      {
        label: "Campaigns",
        description: "Offers and messages to your customers.",
        kind: "route",
        to: "/campaigns",
      },
    ],
  },
  {
    label: "Platform",
    items: [
      {
        label: "Integrations",
        description: "M-Pesa, delivery apps and other connections.",
        kind: "route",
        to: "/integrations",
      },
      {
        label: "Notifications",
        description: "Messages Seramet has sent, and whether they arrived.",
        kind: "route",
        to: "/notifications",
      },
      {
        label: "AI",
        description: "Ask Seramet questions about your business.",
        kind: "route",
        to: "/ai",
      },
      {
        label: "Appearance",
        description: "Colours and display.",
        kind: "route",
        to: "/design-system",
      },
      {
        label: "Audit",
        description: "A record of every change made.",
        kind: "route",
        to: "/audit-trail",
      },
      {
        label: "System",
        description: "Whether Seramet is working normally.",
        kind: "route",
        to: "/system-health",
      },
    ],
  },
] as const;

export const settingsRouteItems = settingsGroups.flatMap((group) =>
  group.items.filter(
    (item): item is Extract<SettingsItem, { kind: "route" }> => item.kind === "route",
  ),
);
import type { SetupSection } from "@/onboarding/types";
