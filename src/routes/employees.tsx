import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Plus, RefreshCcw, ShieldCheck, UserPlus, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EmployeeStationAccess } from "@/components/app/EmployeeStationAccess";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { randomPin } from "@/lib/random-pin";

export const Route = createFileRoute("/employees")({
  head: () => ({ meta: [{ title: "Employees - Seramet" }] }),
  component: Employees,
});

type EmployeeRow = {
  id: string;
  name: string;
  email: string | null;
  employee_code: string | null;
  phone: string | null;
  job_title: string | null;
  employment_status: string;
  active: number;
  primary_branch_id: string | null;
  locked_until: string | null;
  must_change: number | null;
  credential_configured: number;
  role_id: string | null;
  account_owner: number;
};

type EmployeeEdit = {
  id: string;
  fullName: string;
  employeeCode: string;
  jobTitle: string;
  email: string;
  phone: string;
  roleId: string;
  /** The account owner edits their own name and contact details; role and sign-in email stay. */
  owner: boolean;
};

const emptyDraft = {
  fullName: "",
  email: "",
  employeeCode: "",
  phone: "",
  jobTitle: "",
  roleId: "",
  pin: "",
  pinConfirmation: "",
  temporaryPin: true,
};

function Employees() {
  const {
    activeTenantId,
    branchId,
    branchRecords,
    roleRecords,
    currentUser,
    hasPermission,
    isAllBranches,
    authenticationLevel,
    sessionId,
    refreshConfiguration,
  } = useAppContext();
  const [storedEmployees, setEmployees] = useState<EmployeeRow[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [assignedBranchIds, setAssignedBranchIds] = useState<string[]>([branchId]);
  const [primaryBranchId, setPrimaryBranchId] = useState(branchId);
  const [showForm, setShowForm] = useState(false);
  const [stationEmployee, setStationEmployee] = useState<EmployeeRow | null>(null);
  const [editing, setEditing] = useState<EmployeeEdit | null>(null);
  const [editError, setEditError] = useState("");
  const [busy, setBusy] = useState(true);
  const [notice, setNoticeText] = useState("");
  // Errors stay until dismissed or replaced; confirmations fade after a few seconds.
  const [noticeFades, setNoticeFades] = useState(false);
  const setNotice = useCallback((text: string) => {
    setNoticeText(text);
    setNoticeFades(false);
  }, []);
  const flash = useCallback((text: string) => {
    setNoticeText(text);
    setNoticeFades(true);
  }, []);
  useEffect(() => {
    if (!notice || !noticeFades) return;
    const timer = window.setTimeout(() => setNoticeText(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeFades]);
  const [pinVisible, setPinVisible] = useState(false);
  const invitationKeys = useRef(new Map<string, string>());
  const [employeeCreateKey, setEmployeeCreateKey] = useState(() => crypto.randomUUID());
  const effectiveFrom = useRef(new Date().toISOString());
  const submitting = useRef(false);
  const uncertainPayload = useRef<string | null>(null);
  const scope = JSON.stringify([
    activeTenantId,
    branchId,
    currentUser.id,
    sessionId,
    isAllBranches,
  ]);
  const activeScope = useRef(scope);
  const employees = activeScope.current === scope ? storedEmployees : [];
  const canManageUsers = hasPermission(permissions.usersManage);
  const canManageCredentials = hasPermission(permissions.employeeCredentialsManage);
  const canManage = canManageUsers && canManageCredentials && authenticationLevel === "FULL";
  const missingPermissions = [
    ...(!canManageUsers ? [permissions.usersManage] : []),
    ...(!canManageCredentials ? [permissions.employeeCredentialsManage] : []),
  ];

  const headers = useCallback(() => {
    const token = getSerametAccessToken();
    return {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      ...(isAllBranches ? { "x-seramet-branch-scope": "ALL" } : {}),
    };
  }, [activeTenantId, branchId, isAllBranches]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/seramet/employees", {
        headers: headers(),
        signal: AbortSignal.timeout(15000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        employees?: EmployeeRow[];
        message?: string;
      };
      if (activeScope.current !== scope) return;
      if (!response.ok) throw new Error(body.message ?? "Employees could not be loaded");
      setEmployees(body.employees ?? []);
    } catch (error) {
      if (activeScope.current === scope)
        setNotice(error instanceof Error ? error.message : "Employees could not be loaded");
    } finally {
      if (activeScope.current === scope) setBusy(false);
    }
  }, [headers, scope, setNotice]);

  useEffect(() => {
    activeScope.current = scope;
    setEmployees([]);
    setDraft(emptyDraft);
    setPinVisible(false);
    setShowForm(false);
    setStationEmployee(null);
    setEditing(null);
    setNotice("");
    setAssignedBranchIds([branchId]);
    setPrimaryBranchId(branchId);
    setEmployeeCreateKey(crypto.randomUUID());
    effectiveFrom.current = new Date().toISOString();
    uncertainPayload.current = null;
    submitting.current = false;
    void load();
    return () => {
      activeScope.current = "";
    };
  }, [load, scope, branchId, setNotice]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || !canManage) return;
    submitting.current = true;
    setBusy(true);
    setNotice("");
    try {
      const payload = JSON.stringify({
        idempotencyKey: employeeCreateKey,
        ...draft,
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        assignedBranchIds,
        primaryBranchId,
        effectiveFrom: effectiveFrom.current,
      });
      if (uncertainPayload.current) {
        const check = await fetch(`/api/seramet/employees/creation-attempts/${employeeCreateKey}`, {
          headers: headers(),
          signal: AbortSignal.timeout(15000),
        });
        if (!check.ok)
          throw new Error("Could not verify the previous creation request; retry when connected");
        const result = (await check.json()) as { found: boolean };
        if (activeScope.current !== scope) return;
        if (result.found) {
          uncertainPayload.current = null;
          setShowForm(false);
          setDraft(emptyDraft);
          setPinVisible(false);
          setEmployeeCreateKey(crypto.randomUUID());
          effectiveFrom.current = new Date().toISOString();
          flash("The server confirmed the previous employee creation.");
          await load();
          return;
        }
        if (uncertainPayload.current !== payload)
          throw new Error(
            "The earlier creation is unconfirmed. Restore the original details before retrying; do not create another identity.",
          );
      }
      uncertainPayload.current = payload;
      const response = await fetch("/api/seramet/employees", {
        method: "POST",
        headers: headers(),
        body: payload,
        signal: AbortSignal.timeout(15000),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (activeScope.current !== scope) return;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) uncertainPayload.current = null;
        throw new Error(
          body.message ?? "Employee creation was not confirmed; safely retry the same request",
        );
      }
      uncertainPayload.current = null;
      setDraft(emptyDraft);
      setPinVisible(false);
      setEmployeeCreateKey(crypto.randomUUID());
      effectiveFrom.current = new Date().toISOString();
      setAssignedBranchIds([branchId]);
      setPrimaryBranchId(branchId);
      setShowForm(false);
      flash(
        draft.temporaryPin
          ? "Employee created. The temporary PIN must be changed before normal use."
          : "Employee created with the assigned role and branches.",
      );
      await load();
    } catch (error) {
      if (activeScope.current === scope)
        setNotice(error instanceof Error ? error.message : "Employee could not be created");
    } finally {
      if (activeScope.current === scope) {
        submitting.current = false;
        setBusy(false);
      }
    }
  };

  const active = employees.filter(
    (employee) => employee.active && employee.employment_status === "ACTIVE",
  );
  async function invitation(employee: EmployeeRow, revoke = false, statusOnly = false) {
    if (!canManage || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice("");
    const scopeAtStart = scope;
    const key = invitationKeys.current.get(employee.id) ?? crypto.randomUUID();
    invitationKeys.current.set(employee.id, key);
    try {
      const response = await fetch(
        `/api/seramet/employees/${encodeURIComponent(employee.id)}/invitation`,
        {
          method: statusOnly ? "GET" : revoke ? "DELETE" : "POST",
          headers: headers(),
          ...(!revoke && !statusOnly ? { body: JSON.stringify({ idempotencyKey: key }) } : {}),
          signal: AbortSignal.timeout(20000),
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        status?: string;
        expired?: boolean;
      };
      if (!response.ok) throw Error(result.message ?? "Invitation request was not confirmed.");
      if (activeScope.current !== scopeAtStart) return;
      if (revoke) invitationKeys.current.delete(employee.id);
      flash(
        revoke
          ? `${employee.name}'s invitation was cancelled. If they had already activated their account, it stays active.`
          : statusOnly
            ? invitationStatusText(employee.name, result.expired ? "EXPIRED" : result.status)
            : `Invitation sent to ${employee.email}. Ask ${employee.name} to check their inbox, and spam, for an email from Seramet POS.`,
      );
    } catch (error) {
      if (activeScope.current === scopeAtStart)
        setNotice(error instanceof Error ? error.message : "Invitation request unavailable.");
    } finally {
      if (activeScope.current === scopeAtStart) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }
  // The owner role is never handed out, and nobody can grant a role above their own access.
  const assignableRoles = roleRecords.filter(
    (role) =>
      role.active &&
      role.code !== "ACCOUNT_OWNER" &&
      !role.permissions.some((permission) => !currentUser.permissions.includes(permission)),
  );
  const canManageRoles = hasPermission(permissions.settingsRoleManage);
  async function addStandardRoles() {
    if (!canManageRoles || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/seramet/configuration/roles/standard", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ reason: "Standard staff roles added from Employees" }),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        added?: string[];
      };
      if (!response.ok) throw new Error(result.message ?? "Couldn't add the staff roles.");
      await refreshConfiguration();
      flash(
        result.added?.length
          ? "Staff roles added. Choose one for this employee."
          : "The staff roles are already set up.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't add the staff roles.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  // Other staff are edited by managers; the owner's own record only by the owner.
  function canEdit(employee: EmployeeRow) {
    return canManage && (!employee.account_owner || employee.id === currentUser.id);
  }
  function generateTemporaryPin() {
    const pin = randomPin();
    setDraft({ ...draft, pin, pinConfirmation: pin });
    setPinVisible(true);
  }
  function startEdit(employee: EmployeeRow) {
    if (!canEdit(employee)) return;
    setEditError("");
    setEditing({
      id: employee.id,
      fullName: employee.name,
      employeeCode: employee.employee_code ?? "",
      jobTitle: employee.job_title ?? "",
      email: employee.email ?? "",
      phone: employee.phone ?? "",
      roleId: employee.role_id ?? "",
      owner: Boolean(employee.account_owner),
    });
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setEditError("");
    const scopeAtStart = scope;
    try {
      const { id, owner, roleId, ...details } = editing;
      const response = await fetch(`/api/seramet/employees/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          ...details,
          ...(owner ? {} : { roleId }),
          email: details.email.trim(),
          phone: details.phone.trim(),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (activeScope.current !== scopeAtStart) return;
      if (!response.ok) throw new Error(result.message ?? "Couldn't save these details.");
      setEditing(null);
      flash(`${details.fullName.trim()} was updated.`);
      await load();
    } catch (error) {
      if (activeScope.current === scopeAtStart)
        setEditError(error instanceof Error ? error.message : "Couldn't save these details.");
    } finally {
      if (activeScope.current === scopeAtStart) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }
  const locked = employees.filter(
    (employee) => employee.locked_until && Date.parse(employee.locked_until) > Date.now(),
  );

  return (
    <AppShell
      title="Employees"
      subtitle="Staff, their roles and the branches they work at"
      actions={
        <Btn
          variant="primary"
          disabled={!canManage || busy}
          title={
            canManage
              ? "Create a new employee"
              : authenticationLevel !== "FULL"
                ? "Full account authentication required"
                : `Missing permissions: ${missingPermissions.join(", ")}`
          }
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {showForm ? "Close" : "Add employee"}
        </Btn>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Employees" value={employees.length} />
        <Metric label="Active" value={active.length} />
        <Metric label="Locked" value={locked.length} invert={locked.length > 0} />
        <Metric
          label="Branches"
          value={new Set(active.map((employee) => employee.primary_branch_id)).size}
        />
      </div>

      {!canManage && (
        <p role="status" className="mt-4 rounded-md border border-border bg-card px-4 py-3 text-sm">
          Add Employee requires <strong>Manage Users</strong> and{" "}
          <strong>Manage Employee Credentials</strong> permissions. Your current role is missing:{" "}
          <strong>{missingPermissions.join(", ")}</strong>. Ask an account owner to grant the
          permissions through role settings, or sign in with an authorized account. The button is
          disabled to protect employee identity and PIN administration.
          {authenticationLevel !== "FULL" &&
            " Full account authentication is also required; a terminal PIN session cannot administer credentials."}
        </p>
      )}
      {showForm && canManage && activeScope.current === scope ? (
        <Panel className="mt-4">
          <PanelHead
            title="Create employee access"
            sub="Role and branch access are explicit; the PIN is never displayed after submission"
            right={<ShieldCheck className="h-4 w-4 text-primary" />}
          />
          <form onSubmit={submit} className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            <Field
              label="Full name"
              value={draft.fullName}
              onChange={(value) => setDraft({ ...draft, fullName: value })}
              required
            />
            <Field
              label="Employee code"
              value={draft.employeeCode}
              onChange={(value) => setDraft({ ...draft, employeeCode: value.toUpperCase() })}
              required
            />
            <Field
              label="Job title"
              value={draft.jobTitle}
              onChange={(value) => setDraft({ ...draft, jobTitle: value })}
              required
            />
            <Field
              label="Email"
              type="email"
              value={draft.email}
              onChange={(value) => setDraft({ ...draft, email: value })}
              required
            />
            <Field
              label="Phone"
              type="tel"
              value={draft.phone}
              onChange={(value) => setDraft({ ...draft, phone: value })}
              required
            />
            {assignableRoles.length ? (
              <label className={labelClass}>
                Role
                <select
                  className={fieldClass}
                  required
                  value={draft.roleId}
                  onChange={(event) => setDraft({ ...draft, roleId: event.target.value })}
                >
                  <option value="">Select role</option>
                  {assignableRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className={labelClass}>
                Role
                <div className="mt-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm font-normal text-foreground">
                  {canManageRoles ? (
                    <>
                      There are no staff roles yet.{" "}
                      <button
                        type="button"
                        className="font-semibold text-primary underline underline-offset-2"
                        disabled={busy}
                        onClick={() => void addStandardRoles()}
                      >
                        Add standard roles
                      </button>
                    </>
                  ) : (
                    "There are no staff roles yet. Ask the account owner to add them in Settings."
                  )}
                </div>
              </div>
            )}
            <fieldset className="grid gap-2 md:col-span-2 xl:col-span-3">
              <legend className="text-xs font-semibold text-muted-foreground">
                Assigned branches
              </legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {branchRecords
                  .filter((branch) => currentUser.assignedBranchIds.includes(branch.id))
                  .map((branch) => (
                    <label
                      key={branch.id}
                      className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={assignedBranchIds.includes(branch.id)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...assignedBranchIds, branch.id]
                            : assignedBranchIds.filter((id) => id !== branch.id);
                          setAssignedBranchIds(next);
                          if (!next.includes(primaryBranchId)) setPrimaryBranchId(next[0] ?? "");
                        }}
                      />
                      <span>{branch.name}</span>
                    </label>
                  ))}
              </div>
            </fieldset>
            <label className={labelClass}>
              Primary branch
              <select
                className={fieldClass}
                required
                value={primaryBranchId}
                onChange={(event) => setPrimaryBranchId(event.target.value)}
              >
                <option value="">Select primary branch</option>
                {branchRecords
                  .filter((branch) => assignedBranchIds.includes(branch.id))
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid gap-1">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label="Temporary PIN"
                    type={pinVisible ? "text" : "password"}
                    inputMode="numeric"
                    value={draft.pin}
                    onChange={(value) =>
                      setDraft({ ...draft, pin: value.replace(/\D/g, "").slice(0, 6) })
                    }
                    required
                  />
                </div>
                <Btn type="button" onClick={generateTemporaryPin}>
                  Generate
                </Btn>
              </div>
              {pinVisible && draft.pin ? (
                <span className="text-xs text-muted-foreground">
                  Give this PIN to the employee now. It isn't shown again after you create them.
                </span>
              ) : null}
            </div>
            <Field
              label="Confirm PIN"
              type={pinVisible ? "text" : "password"}
              inputMode="numeric"
              value={draft.pinConfirmation}
              onChange={(value) =>
                setDraft({ ...draft, pinConfirmation: value.replace(/\D/g, "").slice(0, 6) })
              }
              required
            />
            <label className="flex items-center gap-3 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={draft.temporaryPin}
                onChange={(event) => setDraft({ ...draft, temporaryPin: event.target.checked })}
              />
              Require the employee to replace this temporary PIN
            </label>
            <div className="flex justify-end md:col-span-2 xl:col-span-3">
              <Btn type="submit" variant="primary" disabled={busy || !assignedBranchIds.length}>
                <Plus className="h-4 w-4" /> Create employee
              </Btn>
            </div>
          </form>
        </Panel>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm"
        >
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setNoticeText("")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <Panel className="mt-4 overflow-x-auto">
        <PanelHead
          title="Employee register"
          sub="Everyone who works in this branch"
          right={
            <Btn onClick={() => void load()} disabled={busy} title="Refresh">
              <RefreshCcw className="h-4 w-4" />
            </Btn>
          }
        />
        <table className="w-full min-w-[640px]">
          <thead>
            <tr>
              <TH>Employee</TH>
              <TH>Job title</TH>
              <TH>Branch</TH>
              <TH>PIN</TH>
              <TH>Status</TH>
              {canManage && <TH className="w-12" />}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr
                key={employee.id}
                className={canEdit(employee) ? "cursor-pointer hover:bg-secondary/50" : undefined}
                onClick={() => startEdit(employee)}
              >
                <TD>
                  <div className="font-semibold">
                    {employee.name}
                    {employee.account_owner ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Account owner
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[employee.employee_code, employee.email].filter(Boolean).join(" · ") ||
                      "No code or email"}
                  </div>
                </TD>
                <TD>{employee.job_title ?? "—"}</TD>
                <TD>
                  {branchRecords.find((branch) => branch.id === employee.primary_branch_id)?.name ??
                    "—"}
                </TD>
                <TD>
                  <Status className={statusTone[pinStatus(employee)]}>{pinStatus(employee)}</Status>
                </TD>
                <TD>
                  <Status className={statusTone[titleCase(employee.employment_status)]}>
                    {titleCase(employee.employment_status)}
                  </Status>
                </TD>
                {canManage && (
                  <TD className="text-right" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={busy}
                        aria-label={`Actions for ${employee.name}`}
                        className="inline-grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary disabled:opacity-50"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEdit(employee) && (
                          <DropdownMenuItem onSelect={() => startEdit(employee)}>
                            Edit details
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          disabled={!employee.email}
                          onSelect={() => void invitation(employee)}
                        >
                          {employee.email ? "Invite to sign in" : "Invite to sign in (needs email)"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void invitation(employee, false, true)}>
                          Check invitation
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void invitation(employee, true)}>
                          Cancel invitation
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setStationEmployee(employee)}>
                          Preparation stations
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                )}
              </tr>
            ))}
            {!employees.length && !busy ? (
              <tr>
                <TD colSpan={canManage ? 6 : 5}>No employees in this branch yet.</TD>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
      <Dialog open={!!editing} onOpenChange={(open) => !open && !busy && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.owner ? "Edit your details" : "Edit employee"}</DialogTitle>
            <DialogDescription>
              {editing?.owner
                ? "Changes apply straight away. Your role and sign-in email stay as they are."
                : "Changes, including a new role, apply straight away. Use the PIN reset to change a PIN."}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                value={editing.fullName}
                onChange={(value) => setEditing({ ...editing, fullName: value })}
                required
              />
              <Field
                label="Employee code"
                value={editing.employeeCode}
                onChange={(value) => setEditing({ ...editing, employeeCode: value.toUpperCase() })}
                required
              />
              <Field
                label="Job title"
                value={editing.jobTitle}
                onChange={(value) => setEditing({ ...editing, jobTitle: value })}
                required
              />
              {!editing.owner && (
                <label className={labelClass}>
                  Role
                  <select
                    className={fieldClass}
                    required
                    value={editing.roleId}
                    onChange={(event) => setEditing({ ...editing, roleId: event.target.value })}
                  >
                    <option value="">Select role</option>
                    {/* Keep the current role listed even when the editor could not grant it. */}
                    {[
                      ...assignableRoles,
                      ...roleRecords.filter(
                        (role) =>
                          role.id === editing.roleId &&
                          !assignableRoles.some((assignable) => assignable.id === role.id),
                      ),
                    ].map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Field
                label="Email"
                type="email"
                value={editing.email}
                onChange={(value) => setEditing({ ...editing, email: value })}
                disabled={editing.owner}
                required
              />
              <Field
                label="Phone"
                type="tel"
                value={editing.phone}
                onChange={(value) => setEditing({ ...editing, phone: value })}
                required
              />
              {editError ? (
                <p role="alert" className="text-sm text-danger sm:col-span-2">
                  {editError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Btn type="button" disabled={busy} onClick={() => setEditing(null)}>
                  Cancel
                </Btn>
                <Btn type="submit" variant="primary" disabled={busy}>
                  {busy ? "Saving..." : "Save changes"}
                </Btn>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {stationEmployee && canManage && (
        <EmployeeStationAccess
          employeeId={stationEmployee.id}
          name={stationEmployee.name}
          onClose={() => setStationEmployee(null)}
        />
      )}
    </AppShell>
  );
}

function pinStatus(employee: EmployeeRow) {
  if (!employee.credential_configured) return "No PIN";
  if (employee.locked_until && Date.parse(employee.locked_until) > Date.now()) return "Locked";
  return employee.must_change ? "PIN change needed" : "PIN set";
}

const statusTone: Record<string, string> = {
  "PIN set": "bg-success-soft text-success",
  "PIN change needed": "bg-warning-soft text-warning",
  Locked: "bg-danger-soft text-danger",
  Active: "bg-success-soft text-success",
};

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replaceAll("_", " ");

const fieldClass =
  "mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const labelClass = "grid gap-1 text-xs font-semibold text-muted-foreground";

function Field({
  label,
  value,
  onChange,
  type = "text",
  inputMode,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "numeric";
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        className={fieldClass}
        type={type}
        inputMode={inputMode}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={254}
        autoComplete="off"
      />
    </label>
  );
}

function invitationStatusText(name: string, status: string | undefined) {
  switch (status) {
    case "PENDING":
      return `${name} has been sent an invitation and hasn't activated their account yet.`;
    case "ACCEPTED":
      return `${name} has activated their account.`;
    case "REVOKED":
      return `${name}'s invitation was cancelled.`;
    case "EXPIRED":
      return `${name}'s invitation has expired. Send a new one.`;
    case "FAILED":
      return `${name}'s invitation didn't go out. Send a new one.`;
    case "PREPARING":
    case "ACCEPTING":
      return `${name}'s invitation is still being processed. Check again in a minute.`;
    default:
      return `${name} has no invitation yet.`;
  }
}
