import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCcw, ShieldCheck, UserPlus, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

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
  } = useAppContext();
  const [storedEmployees, setEmployees] = useState<EmployeeRow[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [assignedBranchIds, setAssignedBranchIds] = useState<string[]>([branchId]);
  const [primaryBranchId, setPrimaryBranchId] = useState(branchId);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
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
  }, [headers, scope]);

  useEffect(() => {
    activeScope.current = scope;
    setEmployees([]);
    setDraft(emptyDraft);
    setShowForm(false);
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
  }, [load, scope, branchId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || !canManage) return;
    submitting.current = true;
    setBusy(true);
    setNotice("");
    try {
      const { email, phone, ...required } = draft;
      const payload = JSON.stringify({
        idempotencyKey: employeeCreateKey,
        ...required,
        assignedBranchIds,
        primaryBranchId,
        effectiveFrom: effectiveFrom.current,
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
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
          setEmployeeCreateKey(crypto.randomUUID());
          effectiveFrom.current = new Date().toISOString();
          setNotice("The server confirmed the previous employee creation.");
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
      setEmployeeCreateKey(crypto.randomUUID());
      effectiveFrom.current = new Date().toISOString();
      setAssignedBranchIds([branchId]);
      setPrimaryBranchId(branchId);
      setShowForm(false);
      setNotice(
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
  const locked = employees.filter(
    (employee) => employee.locked_until && Date.parse(employee.locked_until) > Date.now(),
  );

  return (
    <AppShell
      title="Employees"
      subtitle="Authoritative employee identities, roles and branch access"
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
              label="Email (optional)"
              type="email"
              value={draft.email}
              onChange={(value) => setDraft({ ...draft, email: value })}
            />
            <Field
              label="Phone (optional)"
              value={draft.phone}
              onChange={(value) => setDraft({ ...draft, phone: value })}
            />
            <label className={labelClass}>
              Operational role
              <select
                className={fieldClass}
                required
                value={draft.roleId}
                onChange={(event) => setDraft({ ...draft, roleId: event.target.value })}
              >
                <option value="">Select role</option>
                {roleRecords
                  .filter(
                    (role) =>
                      role.active &&
                      role.code !== "ACCOUNT_OWNER" &&
                      !role.permissions.some(
                        (permission) => !currentUser.permissions.includes(permission),
                      ),
                  )
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
              </select>
            </label>
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
            <Field
              label="Temporary PIN"
              type="password"
              inputMode="numeric"
              value={draft.pin}
              onChange={(value) =>
                setDraft({ ...draft, pin: value.replace(/\D/g, "").slice(0, 6) })
              }
              required
            />
            <Field
              label="Confirm PIN"
              type="password"
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
        <p role="status" className="mt-4 rounded-md border border-border bg-card px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}

      <Panel className="mt-4 overflow-x-auto">
        <PanelHead
          title="Employee register"
          sub="PIN hashes and credential metadata are never returned"
          right={
            <Btn onClick={() => void load()} disabled={busy} title="Refresh">
              <RefreshCcw className="h-4 w-4" />
            </Btn>
          }
        />
        <table className="w-full min-w-[820px]">
          <thead>
            <tr>
              <TH>Employee</TH>
              <TH>Code</TH>
              <TH>Job title</TH>
              <TH>Primary branch</TH>
              <TH>Credential</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <TD>
                  <div className="font-semibold">{employee.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {employee.email ?? "No email"}
                  </div>
                </TD>
                <TD>{employee.employee_code ?? "Not assigned"}</TD>
                <TD>{employee.job_title ?? "Not configured"}</TD>
                <TD>
                  {branchRecords.find((branch) => branch.id === employee.primary_branch_id)?.name ??
                    "Not assigned"}
                </TD>
                <TD>
                  <Status>
                    {!employee.credential_configured
                      ? "NOT CONFIGURED"
                      : employee.locked_until && Date.parse(employee.locked_until) > Date.now()
                        ? "LOCKED"
                        : employee.must_change
                          ? "RESET REQUIRED"
                          : "READY"}
                  </Status>
                </TD>
                <TD>
                  <Status>{employee.employment_status}</Status>
                </TD>
              </tr>
            ))}
            {!employees.length && !busy ? (
              <tr>
                <TD colSpan={6}>No employees are configured in this branch scope.</TD>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}

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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "numeric";
  required?: boolean;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        className={fieldClass}
        type={type}
        inputMode={inputMode}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={254}
        autoComplete="off"
      />
    </label>
  );
}
