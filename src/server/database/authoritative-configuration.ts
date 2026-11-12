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
import { createEmptyPlatformState } from "@/platform/empty-platform-state";
import type { D1Database } from "@/server/database/d1";

type Row = Record<string, unknown>;

/** One restaurant's configuration, as loaded from its own rows. */
type TenantSlice = {
  state: PlatformState;
  loadedAt: number;
  /** The shared configuration revision read just before this copy was loaded. */
  revision: number | undefined;
};

/**
 * What one server holds for one database: a slice per restaurant it has served, loaded on
 * demand, and the repository built from them. Restaurants this server never serves are never
 * read, so a load costs one restaurant's rows rather than every restaurant's.
 */
type DatabaseCache = {
  slices: Map<string, TenantSlice>;
  /** Bumped per restaurant on a forced refresh, so an older load cannot replace a newer one. */
  generations: Map<string, number>;
  /** Bumped on every invalidation, which discards every restaurant's slice. */
  epoch: number;
  repository: ConfigurationRepository | undefined;
  /** Provider definitions are platform-wide; they come from the server environment. */
  providers: PlatformState["providers"] | undefined;
  providersFromEnvironment: boolean;
};

const cache = new WeakMap<object, DatabaseCache>();
// Production opens a new database pool per request, so the configuration (plain data) is cached
// by the database it came from; otherwise every request reloaded it.
const sharedCache = new Map<string, DatabaseCache>();
// Without a shared revision a cached copy is trusted for 15 seconds. With one, a copy stays
// valid until any server records a configuration change, refreshed at least every 5 minutes
// in case something changed configuration outside the API.
const cacheLifetimeMs = 15_000;
const revisionedLifetimeMs = 5 * 60_000;

/** The shared configuration revision, or undefined where the table doesn't exist yet. */
async function configurationRevision(db: D1Database) {
  try {
    const row = await db
      .prepare("SELECT revision FROM configuration_revisions WHERE scope='platform'")
      .first<{ revision: number }>();
    return row ? Number(row.revision) : undefined;
  } catch {
    return undefined;
  }
}

function cacheIdentity(db: D1Database) {
  const identity = (db as { cacheIdentity?: unknown }).cacheIdentity;
  return typeof identity === "string" ? identity : undefined;
}

function databaseCache(db: D1Database) {
  const identity = cacheIdentity(db);
  const existing = identity ? sharedCache.get(identity) : cache.get(db as object);
  if (existing) return existing;
  const created: DatabaseCache = {
    slices: new Map(),
    generations: new Map(),
    epoch: 0,
    repository: undefined,
    providers: undefined,
    providersFromEnvironment: false,
  };
  if (identity) sharedCache.set(identity, created);
  else cache.set(db as object, created);
  return created;
}

function isCurrent(slice: TenantSlice | undefined, revision: number | undefined) {
  if (!slice) return false;
  const age = Date.now() - slice.loadedAt;
  return revision !== undefined
    ? slice.revision === revision && age < revisionedLifetimeMs
    : age < cacheLifetimeMs;
}

/** Drops slices the shared revision (or their age) says are out of date. */
function dropStaleSlices(entry: DatabaseCache, revision: number | undefined) {
  let dropped = false;
  for (const [tenantId, slice] of entry.slices) {
    if (isCurrent(slice, revision)) continue;
    entry.slices.delete(tenantId);
    dropped = true;
  }
  if (dropped) entry.repository = undefined;
}

function combine(
  slices: Iterable<PlatformState>,
  providers: PlatformState["providers"],
): PlatformState {
  const state = createEmptyPlatformState();
  for (const slice of slices) {
    for (const key of tenantCollections) {
      (state[key] as unknown[]).push(...(slice[key] as unknown[]));
    }
  }
  state.providers = providers;
  state.updatedAt = new Date().toISOString();
  return state;
}

function providerDefinitions(env: SerametEnv) {
  return createDefaultProviderRegistry(env)
    .list()
    .map((adapter) => adapter.definition);
}

/**
 * Takes provider definitions from the first caller that passes the server environment (it is
 * the same for every request); callers without one get defaults until then.
 */
function rememberProviders(entry: DatabaseCache, env: SerametEnv) {
  const fromEnvironment = Object.keys(env).length > 0;
  if (entry.providers && (entry.providersFromEnvironment || !fromEnvironment)) return;
  entry.providers = providerDefinitions(env);
  entry.providersFromEnvironment = fromEnvironment;
  entry.repository = undefined;
}

const tenantCollections = [
  "tenants",
  "brands",
  "branches",
  "warehouses",
  "departments",
  "stations",
  "serviceAreas",
  "tables",
  "paymentMethods",
  "orderChannels",
  "connections",
  "devices",
  "printRoutes",
  "documentIdentities",
  "documentTemplates",
  "roles",
  "users",
] as const satisfies ReadonlyArray<keyof PlatformState>;

/** Publishes the configuration of every restaurant this server currently holds. */
function publish(entry: DatabaseCache, override?: { tenantId: string; state: PlatformState }) {
  if (!override && entry.repository) {
    setConfigurationRepository(entry.repository);
    return entry.repository;
  }
  const slices = new Map([...entry.slices].map(([tenantId, slice]) => [tenantId, slice.state]));
  if (override) slices.set(override.tenantId, override.state);
  const repository = new ConfigurationRepository(
    combine(slices.values(), entry.providers ?? providerDefinitions({})),
    {
      persistBrowser: false,
    },
  );
  if (!override) entry.repository = repository;
  setConfigurationRepository(repository);
  return repository;
}

/**
 * Makes one restaurant's configuration available to this request. It is read from that
 * restaurant's rows only, and cached until the shared revision says configuration changed.
 * Call it wherever a request first learns which restaurant it acts for (authentication, a
 * public restaurant link, a webhook connection, a queued job).
 */
export async function hydrateTenantConfiguration(
  db: D1Database,
  env: SerametEnv,
  tenantId: string,
  force = false,
) {
  const entry = databaseCache(db);
  rememberProviders(entry, env);
  // Read before loading, so a change that lands during the load makes the next request reload.
  const revision = await configurationRevision(db);
  dropStaleSlices(entry, revision);
  if (!force && entry.slices.has(tenantId)) return publish(entry);
  if (force) entry.generations.set(tenantId, (entry.generations.get(tenantId) ?? 0) + 1);
  const generation = entry.generations.get(tenantId) ?? 0;
  const epoch = entry.epoch;
  const state = await loadTenantConfigurationState(db, env, tenantId);
  if (entry.epoch !== epoch || (entry.generations.get(tenantId) ?? 0) !== generation) {
    // A change was recorded while this was loading: serve it to this request only.
    return publish(entry, { tenantId, state });
  }
  entry.slices.set(tenantId, { state, loadedAt: Date.now(), revision });
  entry.repository = undefined;
  return publish(entry);
}

/**
 * Revalidates the restaurants this server already holds: slices the shared revision says
 * changed are dropped (and reloaded on demand), and `force` reloads every held restaurant from
 * its own rows. It never loads a restaurant this server has not served.
 */
export async function hydrateAuthoritativeConfiguration(
  db: D1Database,
  env: SerametEnv = {},
  force = false,
) {
  const entry = databaseCache(db);
  rememberProviders(entry, env);
  if (!force) {
    dropStaleSlices(entry, await configurationRevision(db));
    return publish(entry);
  }
  let repository = publish(entry);
  for (const tenantId of [...entry.slices.keys()]) {
    repository = await hydrateTenantConfiguration(db, env, tenantId, true);
  }
  return repository;
}

/**
 * Records a configuration change: drops this server's copies and bumps the shared revision so
 * every other server reloads on its next request. A failed bump only delays other servers
 * until their copy expires; it never fails the change itself.
 */
export async function invalidateAuthoritativeConfiguration(db: D1Database) {
  const entry = databaseCache(db);
  entry.slices.clear();
  entry.repository = undefined;
  entry.epoch += 1;
  await db
    .prepare(
      "UPDATE configuration_revisions SET revision=revision+1,updated_at=? WHERE scope='platform'",
    )
    .bind(new Date().toISOString())
    .run()
    .catch(() => undefined);
}

/** One restaurant's configuration: every query is filtered by its tenant. */
export async function loadTenantConfigurationState(
  db: D1Database,
  env: SerametEnv,
  tenantId: string,
): Promise<PlatformState> {
  const rows = (query: string) => all(db, query, tenantId);
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
    accountMappings,
  ] = await Promise.all([
    rows(
      `SELECT t.*,p.country_code FROM tenants t
       LEFT JOIN tenant_onboarding_profiles p ON p.tenant_id=t.id WHERE t.id=? AND t.active = 1`,
    ),
    rows("SELECT * FROM brands WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM branches WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM warehouses WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM departments WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM stations WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM service_areas WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM restaurant_tables WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM payment_methods WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM order_channels WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM provider_connections WHERE tenant_id=?"),
    rows("SELECT * FROM hardware_devices WHERE tenant_id=? AND trust_status != 'REVOKED'"),
    rows("SELECT * FROM print_routes WHERE tenant_id=?"),
    rows("SELECT * FROM document_identities WHERE tenant_id=?"),
    rows("SELECT * FROM document_templates WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM roles WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM role_permissions WHERE tenant_id=?"),
    rows("SELECT * FROM users WHERE tenant_id=? AND active = 1"),
    rows("SELECT * FROM user_roles WHERE tenant_id=?"),
    rows(
      `SELECT ub.*,
              CASE WHEN pb.branch_id=ub.branch_id THEN 1 ELSE 0 END AS is_primary
       FROM user_branches ub
       LEFT JOIN user_primary_branches pb
         ON pb.tenant_id=ub.tenant_id AND pb.user_id=ub.user_id
       WHERE ub.tenant_id=?
       ORDER BY is_primary DESC,ub.branch_id`,
    ),
    rows(
      `SELECT tenant_id,mapping_key,account_id FROM setup_account_mappings
       WHERE tenant_id=? AND branch_id IS NULL AND status='CONFIGURED' AND account_id IS NOT NULL
         AND mapping_key IN ('CUSTOMER_RECEIVABLE','CASH','PAYMENT_CLEARING')`,
    ),
  ]);
  // Methods created in onboarding or Settings carry no accounts of their own. They post to
  // the tenant-wide Setup Centre mappings, the same receivable every POS invoice debits.
  const mappedAccount = (tenantId: string, key: string) =>
    optionalString(
      accountMappings.find((row) => row["tenant_id"] === tenantId && row["mapping_key"] === key) ??
        {},
      "account_id",
    );
  const withDefaultAccounts = (method: PaymentMethodDefinition): PaymentMethodDefinition => {
    const receivable =
      method.receivableAccountId ?? mappedAccount(method.tenantId, "CUSTOMER_RECEIVABLE");
    const settlement =
      method.settlementAccountId ??
      (method.category === "CASH"
        ? (method.cashAccountId ?? mappedAccount(method.tenantId, "CASH"))
        : mappedAccount(method.tenantId, "PAYMENT_CLEARING"));
    return {
      ...method,
      ...(receivable ? { receivableAccountId: receivable } : {}),
      ...(settlement ? { settlementAccountId: settlement } : {}),
    };
  };

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
    branches: branches.map((row) => {
      const branch = mergePayload<Branch>(row, {
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
      });
      return {
        ...branch,
        metadata: {
          ...branch.metadata,
          businessDayCutoffMinutes: number(row, "business_day_cutoff_minutes"),
        },
      };
    }),
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
      withDefaultAccounts(
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
    providers: providerDefinitions(env),
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

async function all(db: D1Database, query: string, tenantId: string) {
  return (await db.prepare(query).bind(tenantId).all<Row>()).results ?? [];
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
