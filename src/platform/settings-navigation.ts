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
        description: "Trading identity, locale, timezone and controlled base currency.",
        kind: "route",
        to: "/seramet-setup",
      },
      {
        label: "Branches",
        description: "Review locations and continue to the controlled branch setup workflow.",
        kind: "route",
        to: "/branches",
      },
      {
        label: "Operating hours",
        description: "Configure the operating context used by restaurant setup and devices.",
        kind: "route",
        to: "/seramet-setup",
      },
      {
        label: "Currencies",
        description: "Manage the base currency and accepted operational exchange rates.",
        kind: "route",
        to: "/seramet-setup",
      },
    ],
  },
  {
    label: "Users and access",
    items: [
      {
        label: "Users",
        description: "Assign staff to their permitted branches and primary location.",
        kind: "inline",
      },
      {
        label: "Roles",
        description: "Create configured roles without relying on hard-coded role names.",
        kind: "inline",
      },
      {
        label: "Permissions",
        description: "Grant module and action permissions through the access matrix below.",
        kind: "inline",
      },
      {
        label: "Approval limits",
        description: "Review operational decisions that require authorized approval.",
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
        description: "Configure branch devices and controlled register activation.",
        kind: "route",
        to: "/seramet-setup",
      },
      {
        label: "Tables",
        description: "Manage the authoritative restaurant table inventory.",
        kind: "route",
        to: "/tables",
      },
      {
        label: "Order types",
        description: "Manage the configured channels available to the POS.",
        kind: "inline",
      },
      {
        label: "Receipt templates",
        description: "Configure receipt identity, print templates and routing.",
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
        description: "Configure inventory units and conversion foundations.",
        kind: "route",
        to: "/seramet-setup",
      },
      {
        label: "Categories",
        description: "Organize the inventory item catalogue.",
        kind: "route",
        to: "/categories",
      },
      {
        label: "Warehouses",
        description: "Manage branch stores and inventory locations.",
        kind: "route",
        to: "/warehouses",
      },
      {
        label: "PAR rules",
        description: "Maintain reorder points, safety stock and target levels.",
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
        description: "Review purchase orders and their authoritative document identities.",
        kind: "route",
        to: "/purchase-orders",
      },
      {
        label: "Supplier terms",
        description: "Maintain supplier records, lead times and commercial terms.",
        kind: "route",
        to: "/suppliers",
      },
      {
        label: "Receiving rules",
        description: "Use the controlled goods-receipt and variance workflow.",
        kind: "route",
        to: "/receiving",
      },
      {
        label: "Approval routing",
        description: "Review procurement and operational approval decisions.",
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
        description: "Open the accounting workspace and configured ledger structure.",
        kind: "route",
        to: "/accounting",
      },
      {
        label: "Taxes",
        description: "Manage tax rules and tax reporting from the Tax Centre.",
        kind: "route",
        to: "/tax-centre",
      },
      {
        label: "Payment methods",
        description: "Manage the configured tenders available during settlement.",
        kind: "inline",
      },
      {
        label: "Payroll",
        description: "Open payroll controls for authorized staff.",
        kind: "route",
        to: "/payroll",
      },
    ],
  },
  {
    label: "CRM",
    items: [
      {
        label: "Segments",
        description: "Manage evidence-based customer segments.",
        kind: "route",
        to: "/segments",
      },
      {
        label: "Loyalty tiers",
        description: "Configure the loyalty programme and tier rules.",
        kind: "route",
        to: "/loyalty",
      },
      {
        label: "Coupons",
        description: "Manage vouchers and their redemption controls.",
        kind: "route",
        to: "/vouchers",
      },
      {
        label: "Complaint SLAs",
        description: "Review complaints and customer-service handling.",
        kind: "route",
        to: "/complaints",
      },
    ],
  },
  {
    label: "Website and marketing",
    items: [
      {
        label: "Website",
        description: "Manage direct-channel presentation and publishing controls.",
        kind: "route",
        to: "/marketing",
      },
      {
        label: "Social pages",
        description: "Open the marketing workspace for configured social channels.",
        kind: "route",
        to: "/marketing",
      },
      {
        label: "WhatsApp",
        description: "Configure messaging through the provider integration boundary.",
        kind: "route",
        to: "/integrations",
      },
      {
        label: "Campaigns",
        description: "Create and review permission-controlled customer campaigns.",
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
        description: "Manage provider adapters and tenant connection references.",
        kind: "route",
        to: "/integrations",
      },
      {
        label: "Notifications",
        description: "Review operational notifications and delivery outcomes.",
        kind: "route",
        to: "/notifications",
      },
      {
        label: "AI",
        description: "Open the permission-controlled intelligence workspace.",
        kind: "route",
        to: "/ai",
      },
      {
        label: "Appearance",
        description: "Review the shared application design system and theme tokens.",
        kind: "route",
        to: "/design-system",
      },
      {
        label: "Audit",
        description: "Inspect immutable configuration and operational audit events.",
        kind: "route",
        to: "/audit-trail",
      },
      {
        label: "System",
        description: "Inspect service readiness and system-health evidence.",
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
