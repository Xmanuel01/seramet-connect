import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { employees } from "@/data/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "People — Seramet" },
      { name: "description", content: "Attendance, shift scheduling, payroll estimates and employee records." },
      { property: "og:title", content: "People — Seramet" },
      { property: "og:description", content: "Attendance, scheduling and payroll for every branch." },
    ],
  }),
  component: People,
});

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shiftFor = (i: number, d: number) =>
  (i + d) % 4 === 0 ? "OFF" : (i + d) % 3 === 0 ? "12:00–21:30" : "09:30–21:30";

function People() {
  return (
    <AppShell
      title="People"
      subtitle="42 employees · 2 branches · week of 10 August"
      actions={<><Btn>Attendance</Btn><Btn variant="primary">Publish schedule</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Employees" value={42} />
        <Metric label="Present" value={34} />
        <Metric label="Absent" value={2} />
        <Metric label="Late" value={3} delta={50} invert />
        <Metric label="On leave" value={3} />
        <Metric label="Overtime hrs" value={26} delta={12} invert />
        <Metric label="Payroll estimate" value={1186400} money delta={2.8} invert />
        <Metric label="Open positions" value={4} />
      </div>

      <Panel className="mt-4">
        <PanelHead title="Weekly schedule" sub="Westlands · drag to reassign · conflicts highlighted" right={<Btn>Filter branch</Btn>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr>
                <TH>Employee</TH>
                {days.map((d) => <TH key={d}>{d}</TH>)}
              </tr>
            </thead>
            <tbody>
              {employees.map((e, i) => (
                <tr key={e.name}>
                  <TD className="whitespace-nowrap">
                    <div className="font-semibold">{e.name}</div>
                    <div className="text-[11px] text-muted-foreground">{e.role} · {e.branch}</div>
                  </TD>
                  {days.map((d, di) => {
                    const s = shiftFor(i, di);
                    const off = s === "OFF";
                    const ot = !off && i % 5 === 0 && di > 4;
                    return (
                      <TD key={d}>
                        <div className={cn(
                          "rounded-md px-2 py-1.5 text-[11px] font-semibold",
                          off ? "bg-secondary text-muted-foreground" : ot ? "bg-warning-soft text-warning" : "bg-accent text-accent-foreground",
                        )}>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr><TH>Employee</TH><TH>Role</TH><TH>Department</TH><TH>Branch</TH><TH>Scheduled</TH><TH>Status</TH></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.name} className="hover:bg-secondary/50">
                  <TD className="font-semibold">{e.name}</TD>
                  <TD className="text-muted-foreground">{e.role}</TD>
                  <TD className="text-muted-foreground">{e.dept}</TD>
                  <TD className="text-muted-foreground">{e.branch}</TD>
                  <TD className="num">{e.shift}</TD>
                  <TD><Status>{e.status}</Status></TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}