import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, CalendarDays, IdCard, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { DataTable, Tabs, Timeline } from "@/components/app/Tabs";
import { employees, ksh } from "@/data/mock";

export const Route = createFileRoute("/employees")({
  head: () => ({
    meta: [
      { title: "Employee 360 - Seramet" },
      {
        name: "description",
        content: "Employee profile, attendance, shifts, leave, payroll, performance and documents.",
      },
      { property: "og:title", content: "Employee 360 - Seramet" },
      { property: "og:description", content: "A role-aware employee profile for managers and HR." },
    ],
  }),
  component: Employees,
});

const attendance = [
  {
    day: "Mon",
    scheduled: "09:30-21:30",
    in: "09:24",
    out: "21:35",
    worked: "12.1h",
    status: "Present",
  },
  {
    day: "Tue",
    scheduled: "09:30-21:30",
    in: "09:32",
    out: "21:26",
    worked: "11.9h",
    status: "Present",
  },
  { day: "Wed", scheduled: "OFF", in: "-", out: "-", worked: "-", status: "Approved" },
  {
    day: "Thu",
    scheduled: "12:00-21:30",
    in: "12:16",
    out: "21:38",
    worked: "9.4h",
    status: "Late",
  },
];

function Employees() {
  const employee = employees[0]!;
  return (
    <AppShell
      title={employee.name}
      subtitle={`${employee.role} - ${employee.dept} - ${employee.branch} - active employee`}
      actions={
        <>
          <Btn>Message</Btn>
          <Btn>Request leave</Btn>
          <Btn variant="primary">Edit employee</Btn>
        </>
      }
    >
      <Panel className="mb-4 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-accent text-[15px] font-extrabold text-accent-foreground">
              CW
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[18px] font-bold">{employee.name}</h2>
                <Status>{employee.status}</Status>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <IdCard className="h-3.5 w-3.5" /> EMP-0042
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" /> {employee.shift}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Service role
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-[12px]">
            Next review <span className="num font-semibold text-foreground">28 Aug 2026</span>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Attendance" value={96} suffix="%" delta={2.1} />
        <Metric label="Late arrivals" value={1} delta={-50} invert />
        <Metric label="Overtime" value="5.4h" delta={8} invert />
        <Metric label="Leave balance" value="14 days" />
        <Metric label="Payroll est." value={42600} money />
        <Metric label="Performance" value={4.6} suffix="/5" />
      </div>

      <div className="mt-4">
        <Tabs
          tabs={[
            "Overview",
            "Attendance",
            "Shifts",
            "Leave",
            "Payroll",
            "Performance",
            "Documents",
            "Discipline",
          ]}
        >
          {(tab) => (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Panel>
                <PanelHead
                  title={tab === "Overview" ? "Attendance this week" : tab}
                  sub="Manager-visible employee record"
                />
                <DataTable
                  cols={["Day", "Scheduled", "Clock in", "Clock out", "Worked", "Status"]}
                  mobileCards={attendance.map((a) => (
                    <article
                      key={a.day}
                      className="rounded-lg border border-border bg-card p-3 shadow-card"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-bold">{a.day}</div>
                        <Status>{a.status}</Status>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                        <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                          <span className="text-muted-foreground">Scheduled </span>
                          <span className="num font-semibold">{a.scheduled}</span>
                        </div>
                        <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                          <span className="text-muted-foreground">Worked </span>
                          <span className="num font-semibold">{a.worked}</span>
                        </div>
                        <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                          <span className="text-muted-foreground">In </span>
                          <span className="num font-semibold">{a.in}</span>
                        </div>
                        <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                          <span className="text-muted-foreground">Out </span>
                          <span className="num font-semibold">{a.out}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                >
                  {attendance.map((a) => (
                    <tr key={a.day} className="hover:bg-secondary/50">
                      <TD className="font-semibold">{a.day}</TD>
                      <TD className="num text-muted-foreground">{a.scheduled}</TD>
                      <TD className="num">{a.in}</TD>
                      <TD className="num">{a.out}</TD>
                      <TD className="num font-semibold">{a.worked}</TD>
                      <TD>
                        <Status>{a.status}</Status>
                      </TD>
                    </tr>
                  ))}
                </DataTable>
              </Panel>
              <Panel>
                <PanelHead
                  title="Employee activity"
                  right={<BadgeCheck className="h-4 w-4 text-success" />}
                />
                <Timeline
                  items={[
                    ["Shift confirmed", "Cecilia accepted the Saturday double shift."],
                    ["Manager note", "High guest feedback score on private room service."],
                    ["Document uploaded", "Food handler certificate renewed."],
                  ]}
                />
                <div className="border-t border-border p-3">
                  <Btn className="w-full">Open HR file</Btn>
                </div>
              </Panel>
            </div>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
