import { createEmptyPlatformState } from "@/platform/empty-platform-state";
import {
  branchSchema,
  integrationConnectionSchema,
  orderChannelSchema,
  paymentMethodSchema,
  roleSchema,
  tenantSchema,
} from "@/platform/schemas";
import type {
  Branch,
  BranchId,
  BusinessDocumentIdentity,
  CurrentUserSession,
  DocumentTemplateConfiguration,
  HardwareDevice,
  IntegrationConnection,
  OrderChannelDefinition,
  PaymentMethodDefinition,
  PlatformState,
  PrintRoute,
  ProviderDefinition,
  RoleDefinition,
  Tenant,
  TenantId,
  UserDefinition,
  Warehouse,
} from "@/platform/types";

const storageKey = "seramet.platform.v2";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ensureTenant = <T extends { tenantId: TenantId }>(tenantId: TenantId, record: T) => {
  if (record.tenantId !== tenantId) throw new Error("Cross-tenant configuration access denied");
  return record;
};

const replace = <T extends { id: string }>(rows: T[], record: T) => {
  const index = rows.findIndex((row) => row.id === record.id);
  if (index >= 0) rows[index] = record;
  else rows.push(record);
};

export class PlatformConfigurationError extends Error {}

export class ConfigurationRepository {
  private state: PlatformState;
  private listeners = new Set<() => void>();
  private persistBrowser: boolean;
  private onCommit: ((state: PlatformState) => void) | undefined;

  constructor(
    initialState: PlatformState = createEmptyPlatformState(),
    options: { persistBrowser?: boolean; onCommit?: (state: PlatformState) => void } = {},
  ) {
    this.state = normalizeLegacyConnections(clone(initialState));
    this.persistBrowser = options.persistBrowser ?? false;
    this.onCommit = options.onCommit;
    this.assertValidState();
  }

  snapshot() {
    return clone(this.state);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  configurePersistence(options: {
    persistBrowser: boolean;
    onCommit?: (state: PlatformState) => void;
  }) {
    this.persistBrowser = options.persistBrowser;
    this.onCommit = options.onCommit;
  }

  replaceState(next: PlatformState) {
    this.state = clone(next);
    this.assertValidState();
    this.persist();
  }

  listTenants() {
    return clone(this.state.tenants.filter((tenant) => tenant.active));
  }

  getTenant(tenantId: TenantId) {
    const tenant = this.state.tenants.find((item) => item.id === tenantId && item.active);
    if (!tenant) throw new PlatformConfigurationError("Business profile not configured");
    return clone(tenant);
  }

  upsertTenant(tenant: Tenant) {
    tenantSchema.parse(tenant);
    replace(this.state.tenants, clone(tenant));
    this.commit();
  }

  listBranches(tenantId: TenantId, includeInactive = false) {
    return clone(
      this.state.branches.filter(
        (branch) => branch.tenantId === tenantId && (includeInactive || branch.active),
      ),
    );
  }

  getBranch(tenantId: TenantId, branchId: BranchId) {
    const branch = this.state.branches.find(
      (item) => item.tenantId === tenantId && item.id === branchId,
    );
    if (!branch) throw new PlatformConfigurationError("No active branch");
    return clone(branch);
  }

  resolveBranch(tenantId: TenantId, branchIdOrName: string) {
    const value = branchIdOrName.trim().toLowerCase();
    const branch = this.state.branches.find(
      (item) =>
        item.tenantId === tenantId &&
        item.active &&
        (item.id.toLowerCase() === value || item.name.toLowerCase() === value),
    );
    if (!branch) throw new PlatformConfigurationError("No active branch");
    return clone(branch);
  }

  upsertBranch(tenantId: TenantId, branch: Branch) {
    ensureTenant(tenantId, branchSchema.parse(branch));
    replace(this.state.branches, clone(branch));
    this.commit();
  }

  archiveBranch(tenantId: TenantId, branchId: BranchId) {
    const branch = this.state.branches.find(
      (item) => item.id === branchId && item.tenantId === tenantId,
    );
    if (!branch) return;
    branch.active = false;
    this.commit();
  }

  listWarehouses(tenantId: TenantId, branchId?: BranchId) {
    return clone(
      this.state.warehouses.filter(
        (warehouse) =>
          warehouse.tenantId === tenantId && (!branchId || warehouse.branchId === branchId),
      ),
    );
  }

  upsertWarehouse(tenantId: TenantId, warehouse: Warehouse) {
    ensureTenant(tenantId, warehouse);
    this.getBranch(tenantId, warehouse.branchId);
    replace(this.state.warehouses, clone(warehouse));
    this.commit();
  }

  archiveWarehouse(tenantId: TenantId, warehouseId: string) {
    const warehouse = this.state.warehouses.find(
      (item) => item.id === warehouseId && item.tenantId === tenantId,
    );
    if (!warehouse) return;
    warehouse.active = false;
    this.commit();
  }

  listPaymentMethods(tenantId: TenantId, enabledOnly = true) {
    return clone(
      this.state.paymentMethods
        .filter((method) => method.tenantId === tenantId && (!enabledOnly || method.enabled))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    );
  }

  upsertPaymentMethod(tenantId: TenantId, method: PaymentMethodDefinition) {
    ensureTenant(tenantId, paymentMethodSchema.parse(method));
    replace(this.state.paymentMethods, clone(method));
    this.commit();
  }

  archivePaymentMethod(tenantId: TenantId, paymentMethodId: string) {
    const method = this.state.paymentMethods.find(
      (item) => item.id === paymentMethodId && item.tenantId === tenantId,
    );
    if (!method) return;
    method.enabled = false;
    this.commit();
  }

  listOrderChannels(tenantId: TenantId, enabledOnly = true) {
    return clone(
      this.state.orderChannels
        .filter((channel) => channel.tenantId === tenantId && (!enabledOnly || channel.enabled))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    );
  }

  upsertOrderChannel(tenantId: TenantId, channel: OrderChannelDefinition) {
    ensureTenant(tenantId, orderChannelSchema.parse(channel));
    replace(this.state.orderChannels, clone(channel));
    this.commit();
  }

  archiveOrderChannel(tenantId: TenantId, orderChannelId: string) {
    const channel = this.state.orderChannels.find(
      (item) => item.id === orderChannelId && item.tenantId === tenantId,
    );
    if (!channel) return;
    channel.enabled = false;
    this.commit();
  }

  listProviders() {
    return clone(this.state.providers.filter((provider) => provider.enabled));
  }

  upsertProvider(provider: ProviderDefinition) {
    replace(this.state.providers, clone(provider));
    this.commit();
  }

  listConnections(tenantId: TenantId, branchId?: BranchId) {
    return clone(
      this.state.connections.filter(
        (connection) =>
          connection.tenantId === tenantId &&
          (!branchId || !connection.branchId || connection.branchId === branchId),
      ),
    );
  }

  upsertConnection(tenantId: TenantId, connection: IntegrationConnection) {
    const provider = this.state.providers.find((item) => item.id === connection.providerId);
    if (!provider) throw new PlatformConfigurationError("Provider is not registered");
    const sanitized = clone(connection);
    provider.secretFields.forEach((field) => delete sanitized.configuration[field]);
    sanitized.configuration = sanitizeFrontendConfiguration(sanitized.configuration);
    ensureTenant(tenantId, integrationConnectionSchema.parse(sanitized));
    replace(this.state.connections, sanitized);
    this.commit();
  }

  listDevices(tenantId: TenantId, branchId?: BranchId) {
    return clone(
      this.state.devices.filter(
        (device) => device.tenantId === tenantId && (!branchId || device.branchId === branchId),
      ),
    );
  }

  upsertDevice(tenantId: TenantId, device: HardwareDevice) {
    ensureTenant(tenantId, device);
    this.getBranch(tenantId, device.branchId);
    replace(this.state.devices, clone(device));
    this.commit();
  }

  listPrintRoutes(tenantId: TenantId, branchId: BranchId) {
    return clone(
      this.state.printRoutes.filter(
        (route) => route.tenantId === tenantId && route.branchId === branchId && route.enabled,
      ),
    );
  }

  upsertPrintRoute(tenantId: TenantId, route: PrintRoute) {
    ensureTenant(tenantId, route);
    this.getBranch(tenantId, route.branchId);
    if (!this.state.devices.some((device) => device.id === route.primaryDeviceId)) {
      throw new PlatformConfigurationError("No printer route configured");
    }
    replace(this.state.printRoutes, clone(route));
    this.commit();
  }

  getDocumentIdentity(tenantId: TenantId, branchId?: BranchId) {
    const identity =
      this.state.documentIdentities.find(
        (item) => item.tenantId === tenantId && item.branchId === branchId,
      ) ??
      this.state.documentIdentities.find(
        (item) => item.tenantId === tenantId && item.branchId === undefined,
      );
    if (!identity) throw new PlatformConfigurationError("Business profile not configured");
    return clone(identity);
  }

  upsertDocumentIdentity(tenantId: TenantId, identity: BusinessDocumentIdentity) {
    ensureTenant(tenantId, identity);
    replace(this.state.documentIdentities, clone(identity));
    this.commit();
  }

  listDocumentTemplates(tenantId: TenantId, branchId?: BranchId) {
    const templates = this.state.documentTemplates.filter(
      (item) => item.tenantId === tenantId && item.active,
    );
    const resolved = new Map<string, DocumentTemplateConfiguration>();
    templates
      .filter((item) => item.branchId === undefined)
      .forEach((item) => resolved.set(item.documentType, item));
    templates
      .filter((item) => item.branchId === branchId)
      .forEach((item) => resolved.set(item.documentType, item));
    return clone(Array.from(resolved.values()));
  }

  upsertDocumentTemplate(tenantId: TenantId, template: DocumentTemplateConfiguration) {
    ensureTenant(tenantId, template);
    replace(this.state.documentTemplates, clone(template));
    this.commit();
  }

  listRoles(tenantId: TenantId) {
    return clone(this.state.roles.filter((role) => role.tenantId === tenantId && role.active));
  }

  upsertRole(tenantId: TenantId, role: RoleDefinition) {
    ensureTenant(tenantId, roleSchema.parse(role));
    replace(this.state.roles, clone(role));
    this.commit();
  }

  archiveRole(tenantId: TenantId, roleId: string) {
    const role = this.state.roles.find((item) => item.id === roleId && item.tenantId === tenantId);
    if (!role) return;
    role.active = false;
    this.commit();
  }

  getUserSession(tenantId: TenantId, userId: string): CurrentUserSession {
    const user = this.state.users.find(
      (item) => item.id === userId && item.tenantId === tenantId && item.active,
    );
    if (!user) throw new PlatformConfigurationError("User session is not configured");
    const roles = this.state.roles.filter(
      (role) => role.tenantId === tenantId && role.active && user.roleIds.includes(role.id),
    );
    return {
      ...clone(user),
      roleNames: roles.map((role) => role.name),
      permissions: Array.from(new Set(roles.flatMap((role) => role.permissions))),
    };
  }

  upsertUser(tenantId: TenantId, user: UserDefinition) {
    ensureTenant(tenantId, user);
    replace(this.state.users, clone(user));
    this.commit();
  }

  private assertValidState() {
    if (this.state.schemaVersion !== 2) throw new Error("Unsupported platform schema version");
    this.state.tenants.forEach((tenant) => tenantSchema.parse(tenant));
    const tenantIds = new Set(this.state.tenants.map((tenant) => tenant.id));
    const scopedCollections = [
      this.state.branches,
      this.state.warehouses,
      this.state.departments,
      this.state.stations,
      this.state.serviceAreas,
      this.state.tables,
      this.state.paymentMethods,
      this.state.orderChannels,
      this.state.connections,
      this.state.devices,
      this.state.printRoutes,
      this.state.documentIdentities,
      this.state.documentTemplates,
      this.state.roles,
      this.state.users,
    ];
    scopedCollections.forEach((rows) =>
      rows.forEach((row) => {
        if (!tenantIds.has(row.tenantId))
          throw new Error("Configuration references an unknown tenant");
      }),
    );
  }

  private commit() {
    this.state.updatedAt = new Date().toISOString();
    this.assertValidState();
    this.persist();
    this.onCommit?.(this.snapshot());
  }

  private persist() {
    if (this.persistBrowser && typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(this.state));
    }
    this.listeners.forEach((listener) => listener());
  }
}

function normalizeLegacyConnections(state: PlatformState) {
  state.connections = state.connections.map((connection) => {
    const legacy = connection as IntegrationConnection & {
      lastHealthCheck?: string;
      consecutiveFailures?: number;
    };
    const legacyStatus = String(connection.status);
    const status =
      legacyStatus === "INCOMPLETE"
        ? legacy.secretReference
          ? "CONFIGURED"
          : "CREDENTIALS_REQUIRED"
        : legacyStatus === "CONNECTED"
          ? legacy.environment === "SANDBOX"
            ? "SANDBOX"
            : "ACTIVE"
          : legacy.status;
    const { lastHealthCheck, ...rest } = legacy;
    return {
      ...rest,
      status,
      consecutiveFailures: legacy.consecutiveFailures ?? 0,
      ...(legacy.lastHealthCheckAt || !lastHealthCheck
        ? {}
        : { lastHealthCheckAt: lastHealthCheck }),
    } as IntegrationConnection;
  });
  return state;
}

function sanitizeFrontendConfiguration(value: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /password|secret|token|private.?key|client.?secret|api.?key|authorization/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitive.test(key))
      .map(([key, entry]) => [
        key,
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? sanitizeFrontendConfiguration(entry as Record<string, unknown>)
          : entry,
      ]),
  );
}

let singleton: ConfigurationRepository | undefined;

export function getConfigurationRepository() {
  if (singleton) return singleton;
  singleton = new ConfigurationRepository(createEmptyPlatformState(), { persistBrowser: false });
  return singleton;
}

export function setConfigurationRepository(repository?: ConfigurationRepository) {
  singleton = repository;
}

export function setConfigurationRepositoryForTests(repository?: ConfigurationRepository) {
  setConfigurationRepository(repository);
}
