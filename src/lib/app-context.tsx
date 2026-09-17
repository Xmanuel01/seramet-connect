import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LOCAL_PILOT_TENANT_ID, LOCAL_PILOT_USER_ID } from "@/platform/pilot-defaults";
import { permissions } from "@/platform/permissions";
import {
  getConfigurationRepository,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import { getSerametAccessToken } from "@/lib/access-token";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import {
  buildModuleAccessProfile,
  moduleDecision,
  type ModuleAccessProfile,
  type ModuleAction,
  type ModuleKey,
} from "@/platform/module-access-registry";
import type {
  Branch,
  BranchId,
  BranchScope,
  CurrentUserSession,
  PermissionCode,
  PlatformState,
  RoleDefinition,
  TenantId,
} from "@/platform/types";

export type AppRole = string;
export type AppTheme = "light" | "dark";
export type { BranchScope } from "@/platform/types";

export type CurrentUser = CurrentUserSession & {
  role: AppRole;
  branch: string;
  branchId: BranchId;
};

const defaultTheme: AppTheme = "light";
const sessionTenantStorageKey = "seramet.session.tenant-id";
const sessionUserStorageKey = "seramet.session.user-id";
const branchScopeStorageKey = "seramet.session.branch-scope.v2";

const applyTheme = (next: AppTheme) => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.style.colorScheme = next;
};

const store = (key: string, value: string) => {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
};

const readSessionValue = (key: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key)?.trim() || fallback;
};

const makeId = (prefix: string, name: string) =>
  `${prefix}-${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;

const readBranchScope = (allowedBranchIds: BranchId[], canSeeAllBranches: boolean): BranchScope => {
  const fallback: BranchScope = { type: "BRANCH", branchId: allowedBranchIds[0] ?? "" };
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(branchScopeStorageKey) ?? "null",
    ) as BranchScope | null;
    if (parsed?.type === "ALL" && canSeeAllBranches) return parsed;
    if (parsed?.type === "BRANCH" && allowedBranchIds.includes(parsed.branchId)) return parsed;
  } catch {
    window.localStorage.removeItem(branchScopeStorageKey);
  }
  return fallback;
};

type AppContextValue = {
  activeTenantId: TenantId;
  activeBrandId: string | undefined;
  branchScope: BranchScope;
  branchId: BranchId;
  branch: string;
  branches: string[];
  branchRecords: Branch[];
  switchableBranchRecords: Branch[];
  role: AppRole;
  roles: AppRole[];
  roleRecords: RoleDefinition[];
  permissions: PermissionCode[];
  moduleAccess: ModuleAccessProfile;
  platformState: PlatformState;
  currency: string;
  locale: string;
  timeZone: string;
  theme: AppTheme;
  branchLabel: string;
  isAllBranches: boolean;
  currentUser: CurrentUser;
  canSwitchBranch: boolean;
  canUseAllBranchScope: boolean;
  hasPermission: (permission: PermissionCode) => boolean;
  canAccessModule: (moduleKey: ModuleKey, action?: ModuleAction) => boolean;
  setBranch: (branchIdOrName: string) => void;
  setBranchScope: (scope: BranchScope) => void;
  addBranch: (branchName: string) => void;
  removeBranch: (branchIdOrName: string) => void;
  addRole: (roleName: string) => void;
  removeRole: (roleIdOrName: string) => void;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  matchesBranch: (branchIdOrName?: string) => boolean;
  refreshConfiguration: () => void;
  refreshAccess: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const repository = useMemo(() => getConfigurationRepository(), []);
  const [bootstrap, setBootstrap] = useState<
    | { status: "LOADING" }
    | { status: "DEVELOPMENT" }
    | { status: "AUTHENTICATED"; actor: AuthoritativeActor }
    | { status: "ERROR"; message: string }
  >({ status: "LOADING" });

  useEffect(() => {
    let active = true;
    void bootstrapAuthoritativeSession(repository)
      .then((result) => {
        if (active) setBootstrap(result);
      })
      .catch((error) => {
        if (!active) return;
        void fetch("/api/seramet/public/device/startup", { credentials: "same-origin" })
          .then((response) => response.json() as Promise<{ state?: string }>)
          .then((device) => {
            if (device.state === "ACTIVE") {
              window.location.assign("/pos-login");
              return;
            }
            setBootstrap({
              status: "ERROR",
              message:
                error instanceof Error ? error.message : "Secure session initialization failed",
            });
          })
          .catch(() =>
            setBootstrap({
              status: "ERROR",
              message:
                error instanceof Error ? error.message : "Secure session initialization failed",
            }),
          );
      });
    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    if (bootstrap.status !== "AUTHENTICATED") return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await bootstrapAuthoritativeSession(repository);
        if (
          active &&
          result.status === "AUTHENTICATED" &&
          result.actor.moduleAccess.accessRevision !== bootstrap.actor.moduleAccess.accessRevision
        ) {
          setBootstrap(result);
        }
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [bootstrap, repository]);

  if (bootstrap.status === "LOADING") {
    return (
      <SessionGate title="Connecting securely" detail="Validating this device and session..." />
    );
  }
  if (bootstrap.status === "ERROR") {
    return <SessionGate title="Authentication required" detail={bootstrap.message} />;
  }
  return (
    <ConfiguredAppProvider
      repository={repository}
      refreshAccess={async () => {
        setBootstrap(await bootstrapAuthoritativeSession(repository));
      }}
      {...(bootstrap.status === "AUTHENTICATED" ? { actor: bootstrap.actor } : {})}
    >
      {children}
    </ConfiguredAppProvider>
  );
}

function ConfiguredAppProvider({
  children,
  repository,
  actor,
  refreshAccess,
}: {
  children: ReactNode;
  repository: ConfigurationRepository;
  actor?: AuthoritativeActor;
  refreshAccess: () => Promise<void>;
}) {
  const [, setRevision] = useState(0);
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const stored = readSessionValue("seramet.theme", defaultTheme);
    return stored === "dark" ? "dark" : "light";
  });
  const platformState = repository.snapshot();
  const developmentTenantId = platformState.tenants.find((tenant) => tenant.active)?.id;
  const activeTenantId =
    actor?.tenantId ??
    readSessionValue(sessionTenantStorageKey, developmentTenantId ?? LOCAL_PILOT_TENANT_ID);
  const developmentUserId = platformState.users.find(
    (user) => user.tenantId === activeTenantId && user.active,
  )?.id;
  const userId =
    actor?.id ?? readSessionValue(sessionUserStorageKey, developmentUserId ?? LOCAL_PILOT_USER_ID);
  const activeTenant = platformState.tenants.find((tenant) => tenant.id === activeTenantId);
  const [formattedTenantId, setFormattedTenantId] = useState("");
  useLayoutEffect(() => {
    if (!activeTenant || typeof document === "undefined") return;
    document.documentElement.lang = activeTenant.locale;
    document.documentElement.dataset["currency"] = activeTenant.defaultCurrency;
    document.documentElement.dataset["timeZone"] = activeTenant.timezone;
    setFormattedTenantId(activeTenant.id);
  }, [activeTenant]);
  const session = actor
    ? authoritativeSession(actor, repository)
    : repository.getUserSession(activeTenantId, userId);
  const branchRecords = repository.listBranches(activeTenantId);
  const assignedBranchIds = useMemo(() => {
    const valid = session.assignedBranchIds.filter((branchId) =>
      branchRecords.some((branch) => branch.id === branchId),
    );
    const primaryBranchId =
      session.primaryBranchId && valid.includes(session.primaryBranchId)
        ? session.primaryBranchId
        : valid[0];
    return primaryBranchId
      ? [primaryBranchId, ...valid.filter((branchId) => branchId !== primaryBranchId)]
      : valid;
  }, [branchRecords, session.assignedBranchIds, session.primaryBranchId]);
  const primaryBranchId = assignedBranchIds[0] ?? "";
  const hasBranchSwitchPermission = session.permissions.includes(permissions.branchSwitch);
  const canUseAllBranchScope =
    hasBranchSwitchPermission && session.permissions.includes(permissions.tenantScopeAllBranches);
  const switchableBranchRecords = useMemo(
    () => branchRecords.filter((branch) => assignedBranchIds.includes(branch.id)),
    [assignedBranchIds, branchRecords],
  );
  const canSwitchBranch =
    hasBranchSwitchPermission && (switchableBranchRecords.length > 1 || canUseAllBranchScope);
  const [branchScope, setBranchScopeState] = useState<BranchScope>(() =>
    readBranchScope(
      canSwitchBranch ? assignedBranchIds : primaryBranchId ? [primaryBranchId] : [],
      canUseAllBranchScope,
    ),
  );

  useEffect(() => repository.subscribe(() => setRevision((value) => value + 1)), [repository]);

  useEffect(() => {
    applyTheme(theme);
    store("seramet.theme", theme);
  }, [theme]);

  useEffect(() => {
    if (
      (branchScope.type === "ALL" && !canUseAllBranchScope) ||
      (branchScope.type === "BRANCH" &&
        !canSwitchBranch &&
        branchScope.branchId !== primaryBranchId)
    ) {
      const next: BranchScope = { type: "BRANCH", branchId: primaryBranchId };
      setBranchScopeState(next);
      store(branchScopeStorageKey, JSON.stringify(next));
      return;
    }
    if (
      branchScope.type === "BRANCH" &&
      (!branchScope.branchId || !assignedBranchIds.includes(branchScope.branchId))
    ) {
      const next: BranchScope = { type: "BRANCH", branchId: primaryBranchId };
      setBranchScopeState(next);
      store(branchScopeStorageKey, JSON.stringify(next));
    }
  }, [assignedBranchIds, branchScope, canSwitchBranch, canUseAllBranchScope, primaryBranchId]);

  const value = useMemo<AppContextValue>(() => {
    const selectedBranch =
      branchScope.type === "BRANCH"
        ? branchRecords.find((item) => item.id === branchScope.branchId)
        : undefined;
    const fallbackBranch =
      selectedBranch ?? branchRecords.find((item) => assignedBranchIds.includes(item.id));
    if (!fallbackBranch) throw new Error("No active branch");
    const isAllBranches = branchScope.type === "ALL";
    const roleRecords = repository.listRoles(activeTenantId);
    const role = session.roleNames[0] ?? "Configured user";
    const currentUser: CurrentUser = {
      ...session,
      role,
      branch: fallbackBranch.name,
      branchId: fallbackBranch.id,
    };
    const moduleAccess =
      actor?.moduleAccess ??
      buildModuleAccessProfile({
        permissions: session.permissions,
        organizationalScopes: session.permissions.includes(permissions.tenantScopeAllBranches)
          ? [
              "GROUP",
              "LEGAL_ENTITY",
              "BRAND",
              "REGION",
              "AREA",
              "BRANCH",
              "WAREHOUSE",
              "COMMISSARY",
            ]
          : ["BRANCH"],
        entitlements: [],
        entitlementsEnforced: false,
      });

    const changeBranchScope = (next: BranchScope) => {
      if (next.type === "ALL" && !canUseAllBranchScope) return;
      if (
        next.type === "BRANCH" &&
        (!assignedBranchIds.includes(next.branchId) ||
          (!canSwitchBranch && next.branchId !== primaryBranchId))
      ) {
        return;
      }
      setBranchScopeState(next);
      store(branchScopeStorageKey, JSON.stringify(next));
    };

    return {
      activeTenantId,
      activeBrandId: platformState.brands.find((brand) => brand.tenantId === activeTenantId)?.id,
      branchScope,
      branchId: fallbackBranch.id,
      branch: isAllBranches ? "All Branches" : fallbackBranch.name,
      branches: branchRecords.map((item) => item.name),
      branchRecords,
      switchableBranchRecords,
      role,
      roles: roleRecords.map((item) => item.name),
      roleRecords,
      permissions: session.permissions,
      moduleAccess,
      platformState,
      currency: activeTenant?.defaultCurrency ?? "XXX",
      locale: activeTenant?.locale ?? "en",
      timeZone: activeTenant?.timezone ?? "UTC",
      theme,
      branchLabel: isAllBranches ? "All branches" : `${fallbackBranch.name} Branch`,
      isAllBranches,
      currentUser,
      canSwitchBranch,
      canUseAllBranchScope,
      hasPermission: (permission) => session.permissions.includes(permission),
      canAccessModule: (moduleKey, action = "READ") => {
        const decision = moduleDecision(moduleAccess, moduleKey);
        return action === "READ" ? Boolean(decision?.route) : Boolean(decision?.actions[action]);
      },
      setBranch: (branchIdOrName) => {
        if (/^all(?:\s+branches)?$/i.test(branchIdOrName.trim())) {
          changeBranchScope({ type: "ALL" });
          return;
        }
        const target = switchableBranchRecords.find(
          (item) => item.id === branchIdOrName || item.name === branchIdOrName,
        );
        if (target) changeBranchScope({ type: "BRANCH", branchId: target.id });
      },
      setBranchScope: changeBranchScope,
      addBranch: (branchName) => {
        if (!session.permissions.includes(permissions.settingsBranchManage)) return;
        const clean = branchName.trim();
        if (!clean || branchRecords.some((item) => item.name.toLowerCase() === clean.toLowerCase()))
          return;
        repository.upsertBranch(activeTenantId, {
          id: makeId("branch", clean),
          tenantId: activeTenantId,
          code: clean
            .replace(/[^a-z0-9]/gi, "")
            .slice(0, 6)
            .toUpperCase(),
          name: clean,
          address: "",
          phone: "",
          email: "",
          active: true,
          metadata: {},
        });
      },
      removeBranch: (branchIdOrName) => {
        if (!session.permissions.includes(permissions.settingsBranchManage)) return;
        const target = branchRecords.find(
          (item) => item.id === branchIdOrName || item.name === branchIdOrName,
        );
        if (target) repository.archiveBranch(activeTenantId, target.id);
      },
      addRole: (roleName) => {
        if (!session.permissions.includes(permissions.settingsRoleManage)) return;
        const clean = roleName.trim();
        if (!clean || roleRecords.some((item) => item.name.toLowerCase() === clean.toLowerCase()))
          return;
        repository.upsertRole(activeTenantId, {
          id: makeId("role", clean),
          tenantId: activeTenantId,
          code: clean.replace(/[^a-z0-9]/gi, "_").toUpperCase(),
          name: clean,
          active: true,
          permissions: [],
        });
      },
      removeRole: (roleIdOrName) => {
        if (!session.permissions.includes(permissions.settingsRoleManage)) return;
        const target = roleRecords.find(
          (item) => item.id === roleIdOrName || item.name === roleIdOrName,
        );
        if (target && !session.roleIds.includes(target.id)) {
          repository.archiveRole(activeTenantId, target.id);
        }
      },
      setTheme: (next) => setThemeState(next),
      toggleTheme: () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
      matchesBranch: (candidate) => {
        if (!candidate || candidate === "All") return true;
        if (isAllBranches) return true;
        return candidate === fallbackBranch.id || candidate === fallbackBranch.name;
      },
      refreshConfiguration: () => setRevision((current) => current + 1),
      refreshAccess,
    };
  }, [
    activeTenantId,
    activeTenant?.defaultCurrency,
    activeTenant?.locale,
    activeTenant?.timezone,
    actor?.moduleAccess,
    assignedBranchIds,
    branchRecords,
    branchScope,
    canSwitchBranch,
    canUseAllBranchScope,
    platformState,
    primaryBranchId,
    repository,
    refreshAccess,
    session,
    switchableBranchRecords,
    theme,
  ]);

  if (activeTenant && formattedTenantId !== activeTenant.id) {
    return <SessionGate title="Preparing restaurant" detail="Applying restaurant settings..." />;
  }

  return (
    <AppContext.Provider value={value}>
      {actor && primaryBranchId ? (
        <RealtimeBridge
          tenantId={activeTenantId}
          branchId={branchScope.type === "BRANCH" ? branchScope.branchId : primaryBranchId}
        />
      ) : null}
      {children}
    </AppContext.Provider>
  );
}

function RealtimeBridge({ tenantId, branchId }: { tenantId: string; branchId: string }) {
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const endpoint = `/api/seramet/realtime/events?tenant=${encodeURIComponent(tenantId)}&branchId=${encodeURIComponent(branchId)}`;
    const stream = new EventSource(endpoint, { withCredentials: true });
    const message = (event: MessageEvent<string>) => {
      try {
        const detail = JSON.parse(event.data) as Record<string, unknown>;
        window.dispatchEvent(new CustomEvent("seramet:realtime", { detail }));
      } catch {
        // Ignore malformed transport data; authoritative refresh remains available.
      }
    };
    stream.addEventListener("seramet", message as EventListener);
    return () => stream.close();
  }, [branchId, tenantId]);
  return null;
}

type AuthoritativeActor = {
  id: string;
  name: string;
  tenantId: string;
  branchId: string;
  branch: string;
  roles: string[];
  permissions: string[];
  assignedBranches: Array<{ id: string; name: string; isPrimary?: boolean }>;
  primaryBranchId?: string;
  sessionId?: string;
  deviceId?: string;
  moduleAccess: ModuleAccessProfile;
};

async function bootstrapAuthoritativeSession(
  repository: ConfigurationRepository,
): Promise<{ status: "DEVELOPMENT" } | { status: "AUTHENTICATED"; actor: AuthoritativeActor }> {
  const healthResponse = await fetch("/api/seramet/health");
  if (!healthResponse.ok) throw new Error("Seramet server is not ready");
  const health = (await healthResponse.json()) as { database?: string; environment?: string };
  if (health.database !== "authoritative") return { status: "DEVELOPMENT" };
  const token = getSerametAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const selectedTenant =
    typeof window === "undefined"
      ? undefined
      : window.localStorage.getItem(sessionTenantStorageKey)?.trim();
  if (selectedTenant) headers["x-seramet-tenant-id"] = selectedTenant;
  const sessionResponse = await authenticatedFetch("/api/seramet/auth/session", { headers });
  if (!sessionResponse.ok) throw new Error("A valid, non-revoked Seramet session is required");
  const session = (await sessionResponse.json()) as { actor?: AuthoritativeActor };
  if (!session.actor) throw new Error("Authenticated session did not resolve an actor");
  const configurationResponse = await authenticatedFetch("/api/seramet/configuration", { headers });
  if (!configurationResponse.ok) throw new Error("Tenant configuration could not be loaded");
  const configuration = (await configurationResponse.json()) as { configuration?: PlatformState };
  if (!configuration.configuration) throw new Error("Tenant configuration response was incomplete");
  repository.configurePersistence({
    persistBrowser: false,
    onCommit: (state) => {
      void authenticatedFetch("/api/seramet/configuration/import", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ mode: "APPLY", configuration: { ...state, users: [] } }),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Configuration save failed: ${response.status}`);
        })
        .catch((error) => console.error(error));
    },
  });
  repository.replaceState(configuration.configuration);
  return { status: "AUTHENTICATED", actor: session.actor };
}

function authoritativeSession(
  actor: AuthoritativeActor,
  repository: ConfigurationRepository,
): CurrentUserSession {
  const roleRecords = repository.listRoles(actor.tenantId);
  const primaryBranchId =
    actor.primaryBranchId ?? actor.assignedBranches.find((branch) => branch.isPrimary)?.id;
  return {
    id: actor.id,
    tenantId: actor.tenantId,
    name: actor.name,
    active: true,
    roleIds: actor.roles,
    assignedBranchIds: actor.assignedBranches.map((branch) => branch.id),
    ...(primaryBranchId ? { primaryBranchId } : {}),
    roleNames: actor.roles.map(
      (roleId) => roleRecords.find((role) => role.id === roleId)?.name ?? "Configured user",
    ),
    permissions: actor.permissions,
  };
}

function SessionGate({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-sm">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        {title === "Authentication required" && (
          <div className="mt-4 flex gap-2">
            <a
              href="/login"
              className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Sign in
            </a>
            <a
              href="/register"
              className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-semibold"
            >
              Create restaurant
            </a>
          </div>
        )}
      </div>
    </main>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used inside AppProvider");
  return context;
}

export function useBranchRows<T extends { branchId?: string; branch?: string }>(rows: T[]) {
  const { matchesBranch } = useAppContext();
  return useMemo(
    () => rows.filter((row) => matchesBranch(row.branchId ?? row.branch)),
    [matchesBranch, rows],
  );
}

export function useBranchStores<
  T extends { store?: string; warehouse?: string; from?: string; to?: string; branchId?: string },
>(rows: T[]) {
  const { activeTenantId, branchId, isAllBranches } = useAppContext();
  const repository = getConfigurationRepository();
  return useMemo(() => {
    if (isAllBranches) return rows;
    const warehouseNames = new Set(
      repository.listWarehouses(activeTenantId, branchId).map((warehouse) => warehouse.name),
    );
    return rows.filter((row) => {
      if (row.branchId) return row.branchId === branchId;
      return [row.store, row.warehouse, row.from, row.to].some(
        (value) => value !== undefined && warehouseNames.has(value),
      );
    });
  }, [activeTenantId, branchId, isAllBranches, repository, rows]);
}

export function branchMetric(value: number, _branch?: string) {
  return value;
}
