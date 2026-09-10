import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";
import type { EmployeeRecord } from "@/lib/transaction-engine";

export const Route = createFileRoute("/employees")({
  head: () => ({
    meta: [
      { title: "Employees - Seramet" },
      {
        name: "description",
        content: "Employee records, assignments, shifts and payroll configuration.",
      },
    ],
  }),
  component: Employees,
});

const columns: EnterpriseColumn<EmployeeRecord>[] = [
  { key: "name", label: "Employee", sortable: true },
  { key: "role", label: "Role", sortable: true },
  { key: "department", label: "Department", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "shift", label: "Shift" },
  {
    key: "netMonthlyPay",
    label: "Monthly pay",
    align: "right",
    render: (employee) => <span className="num">{ksh(employee.netMonthlyPay)}</span>,
  },
  {
    key: "active",
    label: "Status",
    render: (employee) => <Status>{employee.active ? "Active" : "Inactive"}</Status>,
  },
];

function Employees() {
  const { state } = useTransactionEngine();
  const { branch, branchLabel, matchesBranch } = useAppContext();
  const employees = state.employees.filter((employee) =>
    matchesBranch(employee.branchId ?? employee.branch),
  );
  const monthlyPayroll = employees.reduce((sum, employee) => sum + employee.netMonthlyPay, 0);

  return (
    <AppShell
      title="Employees"
      subtitle={`Employee records and branch assignments - ${branchLabel}`}
      actions={<Btn variant="primary">Add employee</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Employees" value={employees.length} />
        <Metric label="Active" value={employees.filter((employee) => employee.active).length} />
        <Metric
          label="Departments"
          value={new Set(employees.map((employee) => employee.department)).size}
        />
        <Metric label="Monthly payroll" value={monthlyPayroll} money />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Employee register" sub="Authoritative employee and assignment records" />
        <EnterpriseTable rows={employees} columns={columns} filters={[`Branch: ${branch}`]} />
      </Panel>
    </AppShell>
  );
}
