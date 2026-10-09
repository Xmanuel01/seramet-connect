import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { cn } from "@/lib/utils";
import {
  canNavigateToPath,
  moduleAccessRegistry,
  permissionCodes,
  type PermissionRequirement,
} from "@/platform/module-access-registry";
import { permissions as platformPermissions } from "@/platform/permissions";
import { settingsGroups } from "@/platform/settings-navigation";
import type { OrderChannelType, PaymentMethodCategory } from "@/platform/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings - Seramet" },
      {
        name: "description",
        content: "Company, branches, users, roles, POS, finance and integration configuration.",
      },
      { property: "og:title", content: "Settings - Seramet" },
      { property: "og:description", content: "Configure company, branches, roles and modules." },
    ],
  }),
  component: Settings,
});

const accessColumns = [
  { key: "navigationPermission", label: "Navigation" },
  { key: "routePermission", label: "Route" },
  { key: "READ", label: "View" },
  { key: "CREATE", label: "Create" },
  { key: "EDIT", label: "Edit" },
  { key: "APPROVE", label: "Approve" },
  { key: "SENSITIVE", label: "Sensitive" },
] as const;

function Settings() {
  const {
    activeTenantId,
    branches,
    branchRecords,
    roles,
    roleRecords,
    currentUser,
    moduleAccess,
    platformState,
    refreshConfiguration,
    refreshAccess,
    canAccessModule,
    hasPermission,
  } = useAppContext();
  const tenant = platformState.tenants.find((item) => item.id === activeTenantId);
  const [active, setActive] = useState("Users and access");
  const [newRole, setNewRole] = useState("");
  const [paymentName, setPaymentName] = useState("");
  const [paymentCode, setPaymentCode] = useState("");
  const [paymentCategory, setPaymentCategory] = useState<PaymentMethodCategory>("CUSTOM");
  const [channelName, setChannelName] = useState("");
  const [channelCode, setChannelCode] = useState("");
  const [channelType, setChannelType] = useState<OrderChannelType>("OTHER");
  const [channelUsesOnlinePrice, setChannelUsesOnlinePrice] = useState(false);
  const [configNotice, setConfigNotice] = useState({
    kind: "info" as "info" | "success" | "error",
    message: "Configuration changes apply to the active tenant.",
  });
  const [configSaving, setConfigSaving] = useState("");
  const [selectedAccessRoleId, setSelectedAccessRoleId] = useState(roleRecords[0]?.id ?? "");
  const [accessSaving, setAccessSaving] = useState(false);
  const tenantUsers = platformState.users.filter(
    (user) => user.tenantId === activeTenantId && user.active,
  );
  const [selectedBranchUserId, setSelectedBranchUserId] = useState(
    tenantUsers[0]?.id ?? currentUser.id,
  );
  const selectedBranchUser =
    tenantUsers.find((user) => user.id === selectedBranchUserId) ?? tenantUsers[0];
  const [assignedBranchDraft, setAssignedBranchDraft] = useState<string[]>(
    selectedBranchUser?.assignedBranchIds ?? [],
  );
  const [primaryBranchDraft, setPrimaryBranchDraft] = useState(
    selectedBranchUser?.primaryBranchId ?? selectedBranchUser?.assignedBranchIds[0] ?? "",
  );
  const [branchAssignmentReason, setBranchAssignmentReason] = useState(
    "Operational branch assignment updated",
  );
  const [branchAssignmentSaving, setBranchAssignmentSaving] = useState(false);
  const canViewUserAccess = canAccessModule("users");
  const canManageRoleAccess =
    canAccessModule("users", "EDIT") || canAccessModule("users", "APPROVE");
  const canManageUserBranches =
    canAccessModule("users", "CREATE") ||
    canAccessModule("users", "EDIT") ||
    canAccessModule("users", "APPROVE");
  const canManagePaymentMethods = hasPermission(platformPermissions.settingsPaymentManage);
  const canManageOrderChannels = hasPermission(platformPermissions.settingsChannelManage);
  const visibleGroups = settingsGroups
    .filter((group) => group.label !== "Users and access" || canViewUserAccess)
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.kind === "inline" || canNavigateToPath(moduleAccess, item.to),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const current = visibleGroups.find((group) => group.label === active) ?? visibleGroups[0]!;
  const selectedAccessRole =
    roleRecords.find((role) => role.id === selectedAccessRoleId) ?? roleRecords[0];
  const paymentMethods = platformState.paymentMethods
    .filter((method) => method.tenantId === activeTenantId && method.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const orderChannels = platformState.orderChannels
    .filter((channel) => channel.tenantId === activeTenantId && channel.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    if (!selectedBranchUser) return;
    setAssignedBranchDraft(selectedBranchUser.assignedBranchIds);
    setPrimaryBranchDraft(
      selectedBranchUser.primaryBranchId ?? selectedBranchUser.assignedBranchIds[0] ?? "",
    );
  }, [selectedBranchUser]);

  useEffect(() => {
    if (visibleGroups.some((group) => group.label === active)) return;
    setActive(visibleGroups[0]?.label ?? "");
  }, [active, visibleGroups]);

  const mutateSettings = async (path: string, method: "POST" | "PATCH", body: unknown) => {
    const token = getSerametAccessToken();
    const response = await authenticatedFetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-seramet-tenant-id": activeTenantId,
        "x-seramet-user-id": currentUser.id,
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(
        payload.message ?? payload.error ?? `Configuration update failed (${response.status})`,
      );
    }
    await refreshConfiguration();
  };

  const addPaymentMethod = async () => {
    if (!canManagePaymentMethods) return;
    const displayName = paymentName.trim();
    const code = paymentCode.trim().toUpperCase();
    if (!displayName || !code) {
      setConfigNotice({ kind: "error", message: "Display name and code are required." });
      return;
    }
    setConfigSaving("payment-create");
    try {
      await mutateSettings("/api/seramet/configuration/payment-methods", "POST", {
        displayName,
        code,
        category: paymentCategory,
        reason: "Created from Settings payment methods",
      });
      setPaymentName("");
      setPaymentCode("");
      setConfigNotice({
        kind: "success",
        message: `${displayName} was saved and is now available to POS payment selection.`,
      });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Payment method update failed.",
      });
    } finally {
      setConfigSaving("");
    }
  };

  const addOrderChannel = async () => {
    if (!canManageOrderChannels) return;
    const displayName = channelName.trim();
    const code = channelCode.trim().toUpperCase();
    if (!displayName || !code) {
      setConfigNotice({ kind: "error", message: "Display name and code are required." });
      return;
    }
    setConfigSaving("channel-create");
    try {
      await mutateSettings("/api/seramet/configuration/order-channels", "POST", {
        displayName,
        code,
        channelType,
        useOnlinePrice: channelUsesOnlinePrice,
        reason: "Created from Settings order channels",
      });
      setChannelName("");
      setChannelCode("");
      setChannelUsesOnlinePrice(false);
      setConfigNotice({
        kind: "success",
        message: `${displayName} was saved and is now available in the POS order-source control.`,
      });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Order channel update failed.",
      });
    } finally {
      setConfigSaving("");
    }
  };

  const addConfiguredRole = async () => {
    const name = newRole.trim();
    if (!canManageRoleAccess || !name) return;
    setConfigSaving("role-create");
    try {
      await mutateSettings("/api/seramet/configuration/roles", "POST", {
        name,
        reason: "Created from Settings role management",
      });
      setNewRole("");
      setConfigNotice({ kind: "success", message: `${name} was saved.` });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Role creation failed.",
      });
    } finally {
      setConfigSaving("");
    }
  };

  const disableConfiguredRole = async (roleId: string, name: string) => {
    if (!canManageRoleAccess) return;
    setConfigSaving(`role-disable:${roleId}`);
    try {
      await mutateSettings(
        `/api/seramet/configuration/roles/${encodeURIComponent(roleId)}/disable`,
        "POST",
        { reason: "Disabled from Settings role management" },
      );
      setConfigNotice({ kind: "success", message: `${name} was disabled.` });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Role update failed.",
      });
    } finally {
      setConfigSaving("");
    }
  };

  const updateConfiguredChannel = async (
    channelId: string,
    displayName: string,
    change: { enabled?: boolean; useOnlinePrice?: boolean },
  ) => {
    setConfigSaving(`channel-update:${channelId}`);
    try {
      await mutateSettings(
        `/api/seramet/configuration/order-channels/${encodeURIComponent(channelId)}`,
        "PATCH",
        { ...change, reason: "Updated from Settings order channels" },
      );
      setConfigNotice({ kind: "success", message: `${displayName} was updated.` });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Order channel update failed.",
      });
    } finally {
      setConfigSaving("");
    }
  };

  const updateConfiguredPaymentMethod = async (
    paymentMethodId: string,
    displayName: string,
    enabled: boolean,
  ) => {
    setConfigSaving(`payment-update:${paymentMethodId}`);
    try {
      await mutateSettings(
        `/api/seramet/configuration/payment-methods/${encodeURIComponent(paymentMethodId)}`,
        "PATCH",
        {
          enabled,
          reason: `${enabled ? "Enabled" : "Disabled"} from Settings payment methods`,
        },
      );
      setConfigNotice({ kind: "success", message: `${displayName} was disabled.` });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Payment method update failed.",
      });
    } finally {
      setConfigSaving("");
    }
  };

  const togglePermission = async (roleId: string, permission: string) => {
    const roleRecord = roleRecords.find((role) => role.id === roleId);
    if (!roleRecord || accessSaving) return;
    const nextPermissions = roleRecord.permissions.includes(permission)
      ? roleRecord.permissions.filter((item) => item !== permission)
      : [...roleRecord.permissions, permission];
    const token = getSerametAccessToken();
    setAccessSaving(true);
    try {
      const response = await fetch(
        `/api/seramet/access/roles/${encodeURIComponent(roleId)}/permissions`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "x-seramet-tenant-id": activeTenantId,
            "x-seramet-user-id": currentUser.id,
          },
          body: JSON.stringify({
            permissions: nextPermissions,
            reason: `Module access matrix updated for ${roleRecord.name}`,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok)
        throw new Error(payload.message ?? `Access update failed (${response.status})`);
      await refreshAccess();
      setConfigNotice({
        kind: "success",
        message: `${roleRecord.name} permissions were updated and active access was refreshed.`,
      });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Permission update failed.",
      });
    } finally {
      setAccessSaving(false);
    }
  };

  const saveUserBranchAssignment = async () => {
    if (!selectedBranchUser || branchAssignmentSaving) return;
    const token = getSerametAccessToken();
    setBranchAssignmentSaving(true);
    try {
      const response = await fetch(
        `/api/seramet/access/users/${encodeURIComponent(selectedBranchUser.id)}/branches`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "x-seramet-tenant-id": activeTenantId,
            "x-seramet-user-id": currentUser.id,
          },
          body: JSON.stringify({
            assignedBranchIds: assignedBranchDraft,
            primaryBranchId: primaryBranchDraft,
            reason: branchAssignmentReason,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? `Branch assignment update failed (${response.status})`);
      }
      await refreshAccess();
      setConfigNotice({
        kind: "success",
        message: `${selectedBranchUser.name}'s primary branch and access were updated.`,
      });
    } catch (error) {
      setConfigNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Branch assignment update failed.",
      });
    } finally {
      setBranchAssignmentSaving(false);
    }
  };

  const selectedUserCanSwitch = Boolean(
    selectedBranchUser?.roleIds.some((roleId) =>
      roleRecords
        .find((roleRecord) => roleRecord.id === roleId)
        ?.permissions.includes(platformPermissions.branchSwitch),
    ),
  );

  return (
    <AppShell
      title="Settings"
      subtitle={`${tenant?.tradingName ?? "Business"} - ${branches.length} branches - ${platformState.users.filter((user) => user.tenantId === activeTenantId && user.active).length} users`}
      actions={
        canNavigateToPath(moduleAccess, "/audit-trail") ? (
          <Link
            to="/audit-trail"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-semibold transition-colors hover:bg-secondary"
          >
            Audit log
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : undefined
      }
    >
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="p-2">
          <nav className="space-y-1">
            {visibleGroups.map((group) => (
              <button
                key={group.label}
                onClick={() => setActive(group.label)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] font-semibold",
                  active === group.label
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <span>{group.label}</span>
                <span className="num text-[11px]">{group.items.length}</span>
              </button>
            ))}
          </nav>
        </Panel>

        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHead
              title={current.label}
              sub="Open the authoritative workspace or use the permission-controlled editor below"
            />
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {current.items.map((item) =>
                item.kind === "route" ? (
                  <Link
                    key={`${item.label}:${item.to}`}
                    to={item.to}
                    search={
                      item.to === "/seramet-setup" && item.section
                        ? { section: item.section }
                        : undefined
                    }
                    className="group rounded-lg border border-border p-3 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">{item.label}</span>
                      <ArrowRight
                        className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                  </Link>
                ) : (
                  <div key={item.label} className="rounded-lg border border-border p-3 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">{item.label}</span>
                      <span className="text-[11px] font-semibold text-primary">On this page</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                ),
              )}
            </div>
            {current.label === "POS and restaurant" && (
              <div className="border-t border-border px-4 py-3">
                <Link
                  to="/tables"
                  className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:opacity-90"
                >
                  Open tables · Add table
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            )}
          </Panel>

          {current.label === "Users and access" && (
            <>
              <Panel className="min-w-0">
                <PanelHead
                  title="Module and action access"
                  sub="Configure role defaults; scope, entitlement and policy still constrain effective access"
                />
                <div className="p-4">
                  <div className="mb-4 rounded-lg border border-border p-3">
                    <div className="text-[13px] font-bold">Roles</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {roles.map((role) => (
                        <span
                          key={role}
                          className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-semibold"
                        >
                          {role}
                          {canManageRoleAccess &&
                            !currentUser.roleIds.includes(
                              roleRecords.find((record) => record.name === role)?.id ?? "",
                            ) && (
                              <button
                                disabled={Boolean(configSaving)}
                                onClick={() => {
                                  const record = roleRecords.find(
                                    (candidate) => candidate.name === role,
                                  );
                                  if (record) void disableConfiguredRole(record.id, record.name);
                                }}
                                className="text-muted-foreground hover:text-danger"
                              >
                                Remove
                              </button>
                            )}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={newRole}
                        onChange={(event) => setNewRole(event.target.value)}
                        placeholder="Add role"
                        disabled={!canManageRoleAccess}
                        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
                      />
                      <Btn
                        disabled={!canManageRoleAccess || Boolean(configSaving) || !newRole.trim()}
                        onClick={() => void addConfiguredRole()}
                      >
                        {configSaving === "role-create" ? "Saving..." : "Add role"}
                      </Btn>
                    </div>
                  </div>
                  <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[13px] font-bold">Module access matrix</div>
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        Role permissions are still constrained by scope, entitlement and policy.
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-[12px] font-semibold">
                      <span className="text-muted-foreground">Role</span>
                      <select
                        value={selectedAccessRole?.id ?? ""}
                        onChange={(event) => setSelectedAccessRoleId(event.target.value)}
                        className="h-9 min-w-[180px] rounded-md border border-border bg-card px-3"
                      >
                        {roleRecords.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[1240px]">
                      <thead>
                        <tr>
                          <th className="border-b border-border px-3 py-2 text-left text-[11px] font-bold uppercase text-muted-foreground">
                            Module / authority boundary
                          </th>
                          {accessColumns.map((column) => (
                            <th
                              key={column.key}
                              className="border-b border-border px-2 py-2 text-center text-[11px] font-bold uppercase text-muted-foreground"
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {moduleAccessRegistry.map((module) => (
                          <tr key={module.key}>
                            <td className="border-b border-border px-3 py-3 align-top">
                              <div className="text-[12px] font-semibold">{module.label}</div>
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                {module.supportedScopes.join(" / ")}
                              </div>
                              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                                {module.entitlement ?? "No plan entitlement required"}
                              </div>
                            </td>
                            {accessColumns.map((column) => {
                              const requirement =
                                column.key === "navigationPermission" ||
                                column.key === "routePermission"
                                  ? module[column.key]
                                  : module.actionPermissions[column.key];
                              return (
                                <td
                                  key={column.key}
                                  className="border-b border-border px-2 py-3 align-top"
                                >
                                  <AccessPermissionCell
                                    moduleLabel={module.label}
                                    columnLabel={column.label}
                                    requirement={requirement}
                                    rolePermissions={selectedAccessRole?.permissions ?? []}
                                    disabled={
                                      !selectedAccessRole || accessSaving || !canManageRoleAccess
                                    }
                                    onToggle={(permission) =>
                                      selectedAccessRole
                                        ? void togglePermission(selectedAccessRole.id, permission)
                                        : undefined
                                    }
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 rounded-md bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
                    Role names provide defaults only. Server permission, hierarchy scope, active
                    entitlement and effective policy are evaluated again for routes, APIs and
                    actions.
                  </div>
                </div>
              </Panel>

              <Panel className="min-w-0">
                <PanelHead
                  title="User branch assignments"
                  sub="Set the automatic home branch and any additional branches the user may access"
                />
                <div className="grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      User
                      <select
                        value={selectedBranchUser?.id ?? ""}
                        onChange={(event) => setSelectedBranchUserId(event.target.value)}
                        className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
                      >
                        {tenantUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      Primary branch
                      <select
                        value={primaryBranchDraft}
                        disabled={!canManageUserBranches}
                        onChange={(event) => {
                          const branchId = event.target.value;
                          setPrimaryBranchDraft(branchId);
                          setAssignedBranchDraft((current) =>
                            current.includes(branchId) ? current : [...current, branchId],
                          );
                        }}
                        className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
                      >
                        {branchRecords.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name} ({branch.code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-md bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
                      {selectedUserCanSwitch
                        ? "This user's role permits switching among assigned branches."
                        : "This user is locked to the primary branch. Grant branches.switch in the role matrix to enable switching."}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="text-[12px] font-semibold">Assigned branches</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {branchRecords.map((branch) => {
                          const checked = assignedBranchDraft.includes(branch.id);
                          const isPrimary = primaryBranchDraft === branch.id;
                          return (
                            <label
                              key={branch.id}
                              className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px]"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!canManageUserBranches || isPrimary}
                                onChange={() =>
                                  setAssignedBranchDraft((current) =>
                                    checked
                                      ? current.filter((branchId) => branchId !== branch.id)
                                      : [...current, branch.id],
                                  )
                                }
                                className="h-4 w-4 accent-primary"
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{branch.name}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {branch.code}
                                  {isPrimary ? " - primary" : ""}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      Transfer / access-change reason
                      <input
                        value={branchAssignmentReason}
                        disabled={!canManageUserBranches}
                        onChange={(event) => setBranchAssignmentReason(event.target.value)}
                        className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
                      />
                    </label>
                    <div className="flex justify-end">
                      <Btn
                        variant="primary"
                        disabled={
                          !canManageUserBranches ||
                          branchAssignmentSaving ||
                          !assignedBranchDraft.length ||
                          !primaryBranchDraft
                        }
                        onClick={() => void saveUserBranchAssignment()}
                      >
                        {branchAssignmentSaving ? "Saving..." : "Save branch assignment"}
                      </Btn>
                    </div>
                  </div>
                </div>
              </Panel>
            </>
          )}

          {current.label === "POS and restaurant" && (
            <Panel>
              <PanelHead
                title="Order channels"
                sub="POS source options are sorted from these tenant records"
              />
              <div className="grid gap-3 p-4 md:grid-cols-5">
                <ConfigField
                  label="Display name"
                  value={channelName}
                  onChange={setChannelName}
                  disabled={!canManageOrderChannels}
                />
                <ConfigField
                  label="Code"
                  value={channelCode}
                  onChange={setChannelCode}
                  disabled={!canManageOrderChannels}
                />
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  Channel type
                  <select
                    value={channelType}
                    disabled={!canManageOrderChannels}
                    onChange={(event) => setChannelType(event.target.value as OrderChannelType)}
                    className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
                  >
                    {(
                      [
                        "DINE_IN",
                        "TAKEAWAY",
                        "OWN_DELIVERY",
                        "MARKETPLACE",
                        "WEB",
                        "QR",
                        "PHONE",
                        "WHATSAPP",
                        "KIOSK",
                        "OTHER",
                      ] as const
                    ).map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label className="flex h-9 items-center gap-2 self-end rounded-md border border-border bg-card px-3 text-[12px] font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={channelUsesOnlinePrice}
                    disabled={!canManageOrderChannels}
                    onChange={(event) => setChannelUsesOnlinePrice(event.target.checked)}
                  />
                  Use online price
                </label>
                <Btn
                  className="self-end"
                  disabled={
                    !canManageOrderChannels ||
                    Boolean(configSaving) ||
                    !channelName.trim() ||
                    !channelCode.trim()
                  }
                  onClick={() => void addOrderChannel()}
                >
                  {configSaving === "channel-create" ? "Saving..." : "Add channel"}
                </Btn>
              </div>
              <div className="divide-y divide-border border-t border-border">
                {orderChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="text-[13px] font-semibold">{channel.displayName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {channel.code} - {channel.channelType}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Status>{channel.enabled ? "Active" : "Disabled"}</Status>
                      <Btn
                        disabled={!canManageOrderChannels || Boolean(configSaving)}
                        onClick={() =>
                          void updateConfiguredChannel(channel.id, channel.displayName, {
                            useOnlinePrice: channel.metadata["useOnlinePrice"] !== true,
                          })
                        }
                      >
                        Online price: {channel.metadata["useOnlinePrice"] === true ? "On" : "Off"}
                      </Btn>
                      <Btn
                        disabled={!canManageOrderChannels || Boolean(configSaving)}
                        onClick={() =>
                          void updateConfiguredChannel(channel.id, channel.displayName, {
                            enabled: !channel.enabled,
                          })
                        }
                      >
                        {channel.enabled ? "Disable" : "Enable"}
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {current.label === "Finance" && (
            <Panel>
              <PanelHead
                title="Payment methods"
                sub="Arbitrary payment methods appear in POS without source changes"
              />
              <div className="grid gap-3 p-4 md:grid-cols-4">
                <ConfigField
                  label="Display name"
                  value={paymentName}
                  onChange={setPaymentName}
                  disabled={!canManagePaymentMethods}
                />
                <ConfigField
                  label="Code"
                  value={paymentCode}
                  onChange={setPaymentCode}
                  disabled={!canManagePaymentMethods}
                />
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  Category
                  <select
                    value={paymentCategory}
                    disabled={!canManagePaymentMethods}
                    onChange={(event) =>
                      setPaymentCategory(event.target.value as PaymentMethodCategory)
                    }
                    className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
                  >
                    {(
                      [
                        "CASH",
                        "DIGITAL_WALLET",
                        "CARD",
                        "BANK_TRANSFER",
                        "CREDIT",
                        "VOUCHER",
                        "LOYALTY",
                        "EXTERNAL",
                        "CUSTOM",
                      ] as const
                    ).map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <Btn
                  className="self-end"
                  disabled={
                    !canManagePaymentMethods ||
                    Boolean(configSaving) ||
                    !paymentName.trim() ||
                    !paymentCode.trim()
                  }
                  onClick={() => void addPaymentMethod()}
                >
                  {configSaving === "payment-create" ? "Saving..." : "Add method"}
                </Btn>
              </div>
              <div className="divide-y divide-border border-t border-border">
                {paymentMethods.map((method) => (
                  <div
                    key={method.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="text-[13px] font-semibold">{method.displayName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {method.code} - {method.category}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Status>{method.enabled ? "Active" : "Disabled"}</Status>
                      <Btn
                        disabled={!canManagePaymentMethods || Boolean(configSaving)}
                        onClick={() =>
                          void updateConfiguredPaymentMethod(
                            method.id,
                            method.displayName,
                            !method.enabled,
                          )
                        }
                      >
                        {method.enabled ? "Disable" : "Enable"}
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {(current.label === "Users and access" ||
            current.label === "POS and restaurant" ||
            current.label === "Finance") && (
            <div
              role="status"
              className={cn(
                "rounded-lg border px-4 py-3 text-[12px]",
                configNotice.kind === "error"
                  ? "border-danger/30 bg-danger-soft text-danger"
                  : configNotice.kind === "success"
                    ? "border-success/30 bg-success-soft text-success"
                    : "border-border bg-card text-muted-foreground",
              )}
            >
              {configNotice.message}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function AccessPermissionCell({
  moduleLabel,
  columnLabel,
  requirement,
  rolePermissions,
  disabled,
  onToggle,
}: {
  moduleLabel: string;
  columnLabel: string;
  requirement: PermissionRequirement;
  rolePermissions: string[];
  disabled: boolean;
  onToggle: (permission: string) => void;
}) {
  const codes = permissionCodes(requirement);
  if (!codes.length) {
    return <div className="py-1 text-center text-[11px] text-muted-foreground">Not applicable</div>;
  }
  const mode =
    typeof requirement === "object" && requirement && "allOf" in requirement
      ? "All required"
      : codes.length > 1
        ? "Any one"
        : undefined;
  return (
    <div className="grid gap-1.5">
      {mode && (
        <div className="text-center text-[9px] font-semibold text-muted-foreground">{mode}</div>
      )}
      {codes.map((permission) => (
        <label
          key={permission}
          title={permission}
          className="flex min-h-7 items-center justify-center gap-1 rounded border border-border px-1.5 text-[9px] font-medium"
        >
          <input
            type="checkbox"
            aria-label={`${moduleLabel} ${columnLabel} ${permission}`}
            checked={rolePermissions.includes(permission)}
            disabled={disabled}
            onChange={() => onToggle(permission)}
            className="h-3.5 w-3.5 shrink-0 accent-primary"
          />
          <span className="max-w-[86px] truncate font-mono">{compactPermission(permission)}</span>
        </label>
      ))}
    </div>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function compactPermission(value: string) {
  const segments = value.split(".");
  return segments.slice(Math.max(0, segments.length - 2)).join(".");
}
