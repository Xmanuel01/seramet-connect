import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { employees, ksh } from "@/data/mock";

export const Route = createFileRoute("/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll - Seramet" },
      {
        name: "description",
        content: "Payroll estimate, allowances, deductions, employer costs and run status.",
      },
      { property: "og:title", content: "Payroll - Seramet" },
      {
        property: "og:description",
        content: "Controlled payroll workflow with cost visibility and approval status.",
      },
    ],
  }),
  component: Payroll,
});

function Payroll() {
  return (
    <AppShell
      title="Payroll"
      subtitle="August 2026 run - draft - 42 employees"
      actions={
        <>
          <Btn>Review changes</Btn>
          <Btn variant="primary">Run payroll</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Payroll cost" value={1186400} money delta={2.8} invert />
        <Metric label="Employees" value={42} />
        <Metric label="Allowances" value={164200} money />
        <Metric label="Deductions" value={92400} money />
        <Metric label="Net pay" value={928600} money />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHead
            title="Payroll register"
            sub="Estimated from attendance, shifts and approved allowances"
            right={<Status>Draft</Status>}
          />
          <div className="grid gap-3 p-3 md:hidden">
            {employees.slice(0, 6).map((employee, index) => {
              const gross = 42000 + index * 3800;
              const deductions = 3200 + index * 420;
              return (
                <article
                  key={employee.name}
                  className="rounded-lg border border-border bg-card p-3 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold">{employee.name}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {employee.role} - {employee.branch}
                      </div>
                    </div>
                    <Status>{index === 1 ? "Pending" : "Approved"}</Status>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      <span className="block text-muted-foreground">Gross</span>
                      <span className="num font-semibold">{ksh(gross)}</span>
                    </div>
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      <span className="block text-muted-foreground">Deduct</span>
                      <span className="num font-semibold">{ksh(deductions)}</span>
                    </div>
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      <span className="block text-muted-foreground">Net</span>
                      <span className="num font-semibold">{ksh(gross - deductions)}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[780px]">
              <thead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Role</TH>
                  <TH>Branch</TH>
                  <TH className="text-right">Gross</TH>
                  <TH className="text-right">Deductions</TH>
                  <TH className="text-right">Net</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {employees.slice(0, 6).map((employee, index) => {
                  const gross = 42000 + index * 3800;
                  const deductions = 3200 + index * 420;
                  return (
                    <tr key={employee.name} className="hover:bg-secondary/50">
                      <TD className="font-semibold">{employee.name}</TD>
                      <TD className="text-muted-foreground">{employee.role}</TD>
                      <TD className="text-muted-foreground">{employee.branch}</TD>
                      <TD className="num text-right font-semibold">{ksh(gross)}</TD>
                      <TD className="num text-right text-muted-foreground">{ksh(deductions)}</TD>
                      <TD className="num text-right font-semibold">{ksh(gross - deductions)}</TD>
                      <TD>
                        <Status>{index === 1 ? "Pending" : "Approved"}</Status>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Run controls" sub="High-risk changes require approval" />
          <div className="space-y-3 p-4 text-[13px]">
            {[
              "Attendance locked",
              "Allowances reviewed",
              "Deductions reviewed",
              "Finance approval pending",
            ].map((step, index) => (
              <div
                key={step}
                className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2"
              >
                <span className="font-semibold">{step}</span>
                <Status>{index < 3 ? "Approved" : "Pending"}</Status>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
