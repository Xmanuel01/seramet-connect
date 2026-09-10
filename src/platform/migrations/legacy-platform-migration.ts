import { permissions } from "@/platform/permissions";
import type {
  Branch,
  OrderChannelDefinition,
  PaymentMethodCategory,
  PaymentMethodDefinition,
  PlatformState,
  RoleDefinition,
  Warehouse,
} from "@/platform/types";

export type LegacyPlatformInput = {
  companyName?: string;
  branches?: string[];
  warehouses?: { name: string; branch: string; type?: string }[];
  paymentMethods?: string[];
  orderChannels?: string[];
  roles?: { name: string; permissions?: string[] }[];
};

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";

const unique = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const isLegacyAllScope = (value: string) => /^all(?:\s+branches)?$/i.test(value.trim());

const paymentCategory = (name: string): PaymentMethodCategory => {
  const value = name.toLowerCase();
  if (value.includes("cash")) return "CASH";
  if (value.includes("card")) return "CARD";
  if (value.includes("bank")) return "BANK_TRANSFER";
  if (value.includes("credit") || value.includes("account")) return "CREDIT";
  if (value.includes("wallet") || value.includes("pay") || value.includes("pesa"))
    return "DIGITAL_WALLET";
  return "CUSTOM";
};

export function migrateLegacyPlatformState(input: LegacyPlatformInput): PlatformState {
  const timestamp = new Date().toISOString();
  const tradingName = input.companyName?.trim() || "Imported restaurant";
  const tenantId = `tenant-${slug(tradingName)}`;
  const branchNames = unique(input.branches ?? []).filter((name) => !isLegacyAllScope(name));
  const branches: Branch[] = branchNames.map((name, index) => ({
    id: `branch-${slug(name)}`,
    tenantId,
    code: `${slug(name).replaceAll("-", "").slice(0, 6).toUpperCase()}${index + 1}`,
    name,
    address: "",
    phone: "",
    email: "",
    active: true,
    metadata: { migratedFromLegacyName: name },
  }));
  const branchByName = new Map(branches.map((branch) => [branch.name.toLowerCase(), branch]));
  const warehouses: Warehouse[] = (input.warehouses ?? []).flatMap((warehouse) => {
    const branch = branchByName.get(warehouse.branch.trim().toLowerCase());
    if (!branch) return [];
    const normalizedType = warehouse.type?.toUpperCase();
    const type: Warehouse["type"] = ["MAIN", "KITCHEN", "BAR", "COLD", "TRANSIT"].includes(
      normalizedType ?? "",
    )
      ? (normalizedType as Warehouse["type"])
      : "OTHER";
    return [
      {
        id: `warehouse-${slug(branch.name)}-${slug(warehouse.name)}`,
        tenantId,
        branchId: branch.id,
        code: slug(warehouse.name).toUpperCase(),
        name: warehouse.name,
        type,
        active: true,
      },
    ];
  });
  const paymentMethods: PaymentMethodDefinition[] = unique(input.paymentMethods ?? []).map(
    (name, index) => ({
      id: `payment-${slug(name)}`,
      tenantId,
      code: slug(name).replaceAll("-", "_").toUpperCase(),
      displayName: name,
      category: paymentCategory(name),
      enabled: true,
      sortOrder: (index + 1) * 10,
      requiresReference: paymentCategory(name) !== "CASH",
      requiresCustomer: paymentCategory(name) === "CREDIT",
      supportsRefund: true,
      supportsSplit: true,
      metadata: { migrated: true },
    }),
  );
  const orderChannels: OrderChannelDefinition[] = unique(input.orderChannels ?? []).map(
    (name, index) => ({
      id: `channel-${slug(name)}`,
      tenantId,
      code: slug(name).replaceAll("-", "_").toUpperCase(),
      displayName: name,
      channelType: "OTHER",
      enabled: true,
      requiresCustomer: false,
      requiresTable: false,
      requiresAddress: false,
      isExternallyPaid: false,
      sortOrder: (index + 1) * 10,
      metadata: { migrated: true },
    }),
  );
  const roles: RoleDefinition[] = (input.roles ?? []).map((legacyRole) => ({
    id: `role-${slug(legacyRole.name)}`,
    tenantId,
    code: slug(legacyRole.name).replaceAll("-", "_").toUpperCase(),
    name: legacyRole.name,
    active: true,
    permissions: legacyRole.permissions ?? [permissions.dashboardView],
  }));

  return {
    schemaVersion: 2,
    tenants: [
      {
        id: tenantId,
        slug: slug(tradingName),
        legalName: tradingName,
        tradingName,
        active: true,
        defaultCurrency: "XXX",
        timezone: "UTC",
        locale: "en",
        countryCode: "KE",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    brands: [],
    branches,
    warehouses,
    departments: [],
    stations: [],
    serviceAreas: [],
    tables: [],
    paymentMethods,
    orderChannels,
    providers: [],
    connections: [],
    devices: [],
    printRoutes: [],
    documentIdentities: [],
    documentTemplates: [],
    roles,
    users: [],
    updatedAt: timestamp,
  };
}
