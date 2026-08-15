import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { employees } from "@/data/mock";
import { cn } from "@/lib/utils";
import { branchMetric, useAppContext, useBranchRows } from "@/lib/app-context";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "People - Seramet" },
      {
        name: "description",
        content: "Attendance, shift scheduling, payroll estimates and employee records.",
      },
      { property: "og:title", content: "People - Seramet" },
      {
        property: "og:description",
        content: "Attendance, scheduling and payroll for every branch.",
      },
    ],
  }),
  component: People,
});

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shiftFor = (i: number, d: number) =>
  (i + d) % 4 === 0 ? "OFF" : (i + d) % 3 === 0 ? "12:00-21:30" : "09:30-21:30";

function People() {
  const { branch, branchLabel } = useAppContext();
  const rows = useBranchRows(employees);
  const present = rows.filter((employee) => employee.status === "Present").length;
  const absent = rows.filter((employee) => employee.status === "Absent").length;
  const late = rows.filter((employee) => employee.status === "Late").length;
  const onLeave = rows.filter((employee) => employee.status === "On Leave").length;
  return (
    <AppShell
      title="People"
      subtitle={`${branch === "All Branches" ? 42 : rows.length * 5} employees  -  ${branchLabel}  -  week of 10 August`}
      actions={
        <>
          <Btn>Attendance</Btn>
          <Btn variant="primary">Publish schedule</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Employees" value={branch === "All Branches" ? 42 : rows.length * 5} />
        <Metric label="Present" value={branch === "All Branches" ? 34 : present * 5} />
        <Metric label="Absent" value={branch === "All Branches" ? 2 : absent} />
        <Metric label="Late" value={branch === "All Branches" ? 3 : late} delta={50} invert />
        <Metric label="On leave" value={branch === "All Branches" ? 3 : onLeave} />
        <Metric label="Overtime hrs" value={branchMetric(26, branch)} delta={12} invert />
        <Metric
          label="Payroll estimate"
          value={branchMetric(1186400, branch)}
          money
          delta={2.8}
          invert
        />
        <Metric label="Open positions" value={branch === "All Branches" ? 4 : 2} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Weekly schedule"
          sub={`${branchLabel}  -  drag to reassign  -  conflicts highlighted`}
          right={<Btn>Filter branch</Btn>}
        />
        <div className="grid gap-3 p-3 md:hidden">
          {rows.map((e, i) => (
            <article key={e.name} className="rounded-lg border border-border bg-card p-3">
              <div className="mb-3">
                <div className="text-[13px] font-semibold">{e.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {e.role} - {e.branch}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {days.map((d, di) => {
                  const s = shiftFor(i, di);
                  const off = s === "OFF";
                  const ot = !off && i % 5 === 0 && di > 4;
                  return (
                    <div
                      key={d}
                      className={cn(
                        "rounded-md px-2 py-1.5 text-[11px] font-semibold",
                        off
                          ? "bg-secondary text-muted-foreground"
                          : ot
                            ? "bg-warning-soft text-warning"
                            : "bg-accent text-accent-foreground",
                      )}
                    >
                      {d} {s}
                      {ot && <div className="text-[10px] font-medium">Overtime</div>}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr>
                <TH>Employee</TH>
                {days.map((d) => (
                  <TH key={d}>{d}</TH>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.name}>
                  <TD className="whitespace-nowrap">
                    <div className="font-semibold">{e.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {e.role} - {e.branch}
                    </div>
                  </TD>
                  {days.map((d, di) => {
                    const s = shiftFor(i, di);
                    const off = s === "OFF";
                    const ot = !off && i % 5 === 0 && di > 4;
                    return (
                      <TD key={d}>
                        <div
                          className={cn(
                            "rounded-md px-2 py-1.5 text-[11px] font-semibold",
                            off
                              ? "bg-secondary text-muted-foreground"
                              : ot
                                ? "bg-warning-soft text-warning"
                                : "bg-accent text-accent-foreground",
                          )}
                        >
                          {s}
                          {ot && <div className="text-[10px] font-medium">Overtime</div>}
                        </div>
                      </TD>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-4">
        <PanelHead title="Today's attendance" sub="Clock-in from POS terminals and mobile" />
        <div className="grid gap-3 p-3 md:hidden">
          {rows.map((e) => (
            <article
              key={e.name}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold">{e.name}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {e.role} - {e.dept}
                  </div>
                </div>
                <Status>{e.status}</Status>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Branch </span>
                  <span className="font-semibold">{e.branch}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Shift </span>
                  <span className="num font-semibold">{e.shift}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <TH>Employee</TH>
                <TH>Role</TH>
                <TH>Department</TH>
                <TH>Branch</TH>
                <TH>Scheduled</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.name} className="hover:bg-secondary/50">
                  <TD className="font-semibold">{e.name}</TD>
                  <TD className="text-muted-foreground">{e.role}</TD>
                  <TD className="text-muted-foreground">{e.dept}</TD>
                  <TD className="text-muted-foreground">{e.branch}</TD>
                  <TD className="num">{e.shift}</TD>
                  <TD>
                    <Status>{e.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
