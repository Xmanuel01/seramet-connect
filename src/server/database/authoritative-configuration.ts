import { createDefaultProviderRegistry } from "@/integrations/provider-registry";
import type { SerametEnv } from "@/lib/seramet-auth";
import {
  ConfigurationRepository,
  setConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import type {
  Branch,
  BusinessDocumentIdentity,
  Department,
  DocumentTemplateConfiguration,
  HardwareDevice,
  IntegrationConnection,
  OrderChannelDefinition,
  PaymentMethodDefinition,
  PlatformState,
  PrintRoute,
  RestaurantTable,
  RoleDefinition,
  ServiceArea,
  Station,
  Tenant,
  UserDefinition,
  Warehouse,
} from "@/platform/types";
import type { D1Database } from "@/server/database/d1";

type Row = Record<string, unknown>;

const cache = new WeakMap<object, { repository: ConfigurationRepository; loadedAt: number }>();
const cacheLifetimeMs = 15_000;

export async function hydrateAuthoritativeConfiguration(
  db: D1Database,
  env: SerametEnv = {},
  force = false,
) {
  const cached = cache.get(db as object);
  if (!force && cached && Date.now() - cached.loadedAt < cacheLifetimeMs) {
    setConfigurationRepository(cached.repository);
    return cached.repository;
  }
  const state = await loadAuthoritativePlatformState(db, env);
  const repository = new ConfigurationRepository(state, { persistBrowser: false });
  cache.set(db as object, { repository, loadedAt: Date.now() });
  setConfigurationRepository(repository);
  return repository;
}

export function invalidateAuthoritativeConfiguration(db: D1Database) {
  cache.delete(db as object);
}

export async function loadAuthoritativePlatformState(
  db: D1Database,
  env: SerametEnv = {},
): Promise<PlatformState> {
  const [
    tenants,
    brands,
    branches,
    warehouses,
    departments,
    stations,
    serviceAreas,
    tables,
    paymentMethods,
    orderChannels,
    connections,
    devices,
    printRoutes,
    identities,
    templates,
    roles,
    rolePermissions,
    users,
    userRoles,
    userBranches,
  ] = await Promise.all([
    all(
      db,
      `SELECT t.*,p.country_code FROM tenants t
       LEFT JOIN tenant_onboarding_profiles p ON p.tenant_id=t.id WHERE t.active = 1`,
    ),
    all(db, "SELECT * FROM brands WHERE active = 1"),
    all(db, "SELECT * FROM branches WHERE active = 1"),
    all(db, "SELECT * FROM warehouses WHERE active = 1"),
    all(db, "SELECT * FROM departments WHERE active = 1"),
    all(db, "SELECT * FROM stations WHERE active = 1"),
    all(db, "SELECT * FROM service_areas WHERE active = 1"),
    all(db, "SELECT * FROM restaurant_tables WHERE active = 1"),
    all(db, "SELECT * FROM payment_methods WHERE active = 1"),
    all(db, "SELECT * FROM order_channels WHERE active = 1"),
    all(db, "SELECT * FROM provider_connections"),
    all(db, "SELECT * FROM hardware_devices WHERE trust_status != 'REVOKED'"),
    all(db, "SELECT * FROM print_routes"),
    all(db, "SELECT * FROM document_identities"),
    all(db, "SELECT * FROM document_templates WHERE active = 1"),
    all(db, "SELECT * FROM roles WHERE active = 1"),
    all(db, "SELECT * FROM role_permissions"),
    all(db, "SELECT * FROM users WHERE active = 1"),
    all(db, "SELECT * FROM user_roles"),
    all(
      db,
      `SELECT ub.*,
              CASE WHEN pb.branch_id=ub.branch_id THEN 1 ELSE 0 END AS is_primary
       FROM user_branches ub
       LEFT JOIN user_primary_branches pb
         ON pb.tenant_id=ub.tenant_id AND pb.user_id=ub.user_id
       ORDER BY is_primary DESC,ub.branch_id`,
    ),
  ]);

  const permissionsByRole = groupValues(rolePermissions, "role_id", "permission_code");
  const rolesByUser = groupValues(userRoles, "user_id", "role_id");
  const branchesByUser = groupValues(userBranches, "user_id", "branch_id");
  const primaryBranchByUser = new Map(
    userBranches
      .filter((row) => Number(row["is_primary"]) === 1)
      .map((row) => [string(row, "user_id"), string(row, "branch_id")]),
  );
  return {
    schemaVersion: 2,
    tenants: tenants.map((row) =>
      mergePayload<Tenant>(row, {
        id: string(row, "id"),
        slug: string(row, "slug"),
        legalName: string(row, "legal_name"),
        tradingName: string(row, "trading_name"),
        active: boolean(row, "active"),
        defaultCurrency: string(row, "default_currency"),
        timezone: string(row, "timezone"),
        locale: string(row, "locale"),
        countryCode: string(row, "country_code"),
        createdAt: string(row, "created_at"),
        updatedAt: string(row, "updated_at"),
      }),
    ),
    brands: brands.map((row) =>
      mergePayload(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        code: string(row, "code"),
        name: string(row, "name"),
        active: boolean(row, "active"),
      }),
    ),
    branches: branches.map((row) =>
      mergePayload<Branch>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        ...(optionalString(row, "brand_id") ? { brandId: optionalString(row, "brand_id") } : {}),
        code: string(row, "code"),
        name: string(row, "name"),
        address: "",
        phone: "",
        email: "",
        timezone: string(row, "timezone"),
        active: boolean(row, "active"),
        metadata: {},
      }),
    ),
    warehouses: warehouses.map((row) =>
      mergePayload<Warehouse>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        branchId: string(row, "branch_id"),
        code: string(row, "code"),
        name: string(row, "name"),
        type: "OTHER",
        active: boolean(row, "active"),
      }),
    ),
    departments: departments.map((row) =>
      mergePayload<Department>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        ...(optionalString(row, "branch_id") ? { branchId: optionalString(row, "branch_id") } : {}),
        code: string(row, "code"),
        name: string(row, "name"),
        active: boolean(row, "active"),
      }),
    ),
    stations: stations.map((row) =>
      mergePayload<Station>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        branchId: string(row, "branch_id"),
        code: string(row, "code"),
        name: string(row, "name"),
        stationType: string(row, "station_type") as Station["stationType"],
        active: boolean(row, "active"),
      }),
    ),
    serviceAreas: serviceAreas.map((row) =>
      mergePayload<ServiceArea>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        branchId: string(row, "branch_id"),
        name: string(row, "name"),
        active: boolean(row, "active"),
      }),
    ),
    tables: tables.map((row) =>
      mergePayload<RestaurantTable>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        branchId: string(row, "branch_id"),
        ...(optionalString(row, "service_area_id")
          ? { serviceAreaId: optionalString(row, "service_area_id") }
          : {}),
        code: string(row, "code"),
        seats: number(row, "seats"),
        active: boolean(row, "active"),
      }),
    ),
    paymentMethods: paymentMethods.map((row) =>
      mergePayload<PaymentMethodDefinition>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        code: string(row, "code"),
        displayName: string(row, "code"),
        category: string(row, "category") as PaymentMethodDefinition["category"],
        enabled: boolean(row, "active"),
        sortOrder: 0,
        requiresReference: false,
        requiresCustomer: false,
        supportsRefund: false,
        supportsSplit: false,
        ...(optionalString(row, "provider_connection_id")
          ? { providerConnectionId: optionalString(row, "provider_connection_id") }
          : {}),
        ...(optionalString(row, "settlement_account_id")
          ? { settlementAccountId: optionalString(row, "settlement_account_id") }
          : {}),
        ...(optionalString(row, "clearing_account_id")
          ? { clearingAccountId: optionalString(row, "clearing_account_id") }
          : {}),
        ...(optionalString(row, "receivable_account_id")
          ? { receivableAccountId: optionalString(row, "receivable_account_id") }
          : {}),
        ...(optionalString(row, "cash_account_id")
          ? { cashAccountId: optionalString(row, "cash_account_id") }
          : {}),
        metadata: {},
      }),
    ),
    orderChannels: orderChannels.map((row) =>
      mergePayload<OrderChannelDefinition>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        code: string(row, "code"),
        displayName: string(row, "code"),
        channelType: string(row, "channel_type") as OrderChannelDefinition["channelType"],
        enabled: boolean(row, "active"),
        requiresCustomer: false,
        requiresTable: false,
        requiresAddress: false,
        isExternallyPaid: false,
        sortOrder: 0,
        metadata: {},
      }),
    ),
    providers: createDefaultProviderRegistry(env)
      .list()
      .map((adapter) => adapter.definition),
    connections: connections.map((row) =>
      mergePayload<IntegrationConnection>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        ...(optionalString(row, "branch_id") ? { branchId: optionalString(row, "branch_id") } : {}),
        providerId: string(row, "provider_id"),
        environment: string(row, "environment") as IntegrationConnection["environment"],
        status: string(row, "status") as IntegrationConnection["status"],
        displayName: string(row, "provider_id"),
        configuration: {},
        ...(optionalString(row, "secret_reference")
          ? { secretReference: optionalString(row, "secret_reference") }
          : {}),
        metadata: {},
        consecutiveFailures: 0,
        createdAt: string(row, "created_at"),
        updatedAt: string(row, "updated_at"),
      }),
    ),
    devices: devices.map((row) =>
      mergePayload<HardwareDevice>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        branchId: string(row, "branch_id"),
        name: string(row, "name"),
        deviceType: string(row, "device_type") as HardwareDevice["deviceType"],
        connectionType: "OTHER",
        driver: "",
        address: "",
        enabled: string(row, "trust_status") === "ACTIVE",
        healthStatus: "UNKNOWN",
        outputRoles: [],
        metadata: {},
      }),
    ),
    printRoutes: printRoutes.map((row) =>
      mergePayload<PrintRoute>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        branchId: string(row, "branch_id"),
        documentType: string(row, "document_type"),
        primaryDeviceId: string(row, "primary_device_id"),
        ...(optionalString(row, "fallback_device_id")
          ? { fallbackDeviceId: optionalString(row, "fallback_device_id") }
          : {}),
        copies: 1,
        enabled: true,
      }),
    ),
    documentIdentities: identities.map((row) =>
      mergePayload<BusinessDocumentIdentity>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        ...(optionalString(row, "branch_id") ? { branchId: optionalString(row, "branch_id") } : {}),
        businessName: "",
        address: "",
        phone: "",
        email: "",
        taxNumber: "",
        currency: "",
        paymentInstructions: [],
        footerMessage: "",
        metadata: {},
      }),
    ),
    documentTemplates: templates.map((row) =>
      mergePayload<DocumentTemplateConfiguration>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        ...(optionalString(row, "branch_id") ? { branchId: optionalString(row, "branch_id") } : {}),
        documentType: string(row, "document_type"),
        width: "80mm",
        copies: 1,
        showLogo: true,
        showBranch: true,
        showCashier: true,
        showCustomer: true,
        showTax: true,
        showPayment: true,
        showQrCode: false,
        footerMessage: "",
        layoutVersion: string(row, "layout_version"),
        active: boolean(row, "active"),
      }),
    ),
    roles: roles.map((row) => ({
      ...mergePayload<RoleDefinition>(row, {
        id: string(row, "id"),
        tenantId: string(row, "tenant_id"),
        code: string(row, "code"),
        name: string(row, "name"),
        active: boolean(row, "active"),
        permissions: [],
      }),
      permissions: permissionsByRole.get(string(row, "id")) ?? [],
    })),
    users: users.map((row) => {
      const primaryBranchId = primaryBranchByUser.get(string(row, "id"));
      return {
        ...mergePayload<UserDefinition>(row, {
          id: string(row, "id"),
          tenantId: string(row, "tenant_id"),
          name: string(row, "name"),
          ...(optionalString(row, "email") ? { email: optionalString(row, "email") } : {}),
          active: boolean(row, "active"),
          roleIds: [],
          assignedBranchIds: [],
        }),
        roleIds: rolesByUser.get(string(row, "id")) ?? [],
        assignedBranchIds: branchesByUser.get(string(row, "id")) ?? [],
        ...(primaryBranchId ? { primaryBranchId } : {}),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

async function all(db: D1Database, query: string) {
  return (await db.prepare(query).all<Row>()).results ?? [];
}

function mergePayload<T>(row: Row, defaults: Record<string, unknown>): T {
  const raw = row["payload_json"];
  if (typeof raw !== "string" || !raw.trim()) return defaults as T;
  try {
    return { ...defaults, ...(JSON.parse(raw) as Partial<T>) } as T;
  } catch {
    return defaults as T;
  }
}

function groupValues(rows: Row[], key: string, value: string) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const group = string(row, key);
    grouped.set(group, [...(grouped.get(group) ?? []), string(row, value)]);
  }
  return grouped;
}

function string(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function optionalString(row: Row, key: string) {
  const value = string(row, key);
  return value || undefined;
}

function number(row: Row, key: string) {
  return Number(row[key] ?? 0);
}

function boolean(row: Row, key: string) {
  return Number(row[key]) === 1;
}
