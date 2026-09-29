import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
  } = useAppContext();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [assignedBranchIds, setAssignedBranchIds] = useState<string[]>([branchId]);
  const [primaryBranchId, setPrimaryBranchId] = useState(branchId);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [employeeCreateKey, setEmployeeCreateKey] = useState(() => crypto.randomUUID());
  const canManage =
    hasPermission(permissions.usersManage) && hasPermission(permissions.employeeCredentialsManage);

  const headers = useMemo(() => {
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
      const response = await fetch("/api/seramet/employees", { headers });
      const body = (await response.json().catch(() => ({}))) as {
        employees?: EmployeeRow[];
        message?: string;
      };
      if (!response.ok) throw new Error(body.message ?? "Employees could not be loaded");
      setEmployees(body.employees ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Employees could not be loaded");
    } finally {
      setBusy(false);
    }
  }, [headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/seramet/employees", {
        method: "POST",
        headers,
        body: JSON.stringify({
          idempotencyKey: employeeCreateKey,
          ...draft,
          assignedBranchIds,
          primaryBranchId,
          effectiveFrom: new Date().toISOString(),
          ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
          ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Employee could not be created");
      setDraft(emptyDraft);
      setEmployeeCreateKey(crypto.randomUUID());
      setAssignedBranchIds([branchId]);
      setPrimaryBranchId(branchId);
      setShowForm(false);
      setNotice("Employee created. The temporary PIN must be changed before normal use.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Employee could not be created");
    } finally {
      setBusy(false);
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
        canManage ? (
          <Btn variant="primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {showForm ? "Close" : "Add employee"}
          </Btn>
        ) : undefined
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

      {showForm && canManage ? (
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
