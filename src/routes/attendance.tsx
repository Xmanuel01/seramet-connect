import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { employees } from "@/data/mock";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance - Seramet" },
      {
        name: "description",
        content: "Daily attendance, clock-in status, lateness and overtime by branch.",
      },
      { property: "og:title", content: "Attendance - Seramet" },
      {
        property: "og:description",
        content: "Clock-in status, lateness and overtime for every employee.",
      },
    ],
  }),
  component: Attendance,
});

function Attendance() {
  return (
    <AppShell
      title="Attendance"
      subtitle="Today - Westlands and Ngong Road - live from POS terminals and mobile"
      actions={
        <>
          <Btn>Date: Today</Btn>
          <Btn variant="primary">Export timesheet</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Present" value={34} />
        <Metric label="Absent" value={2} />
        <Metric label="Late" value={3} delta={50} invert />
        <Metric label="Overtime hrs" value={26} delta={12} invert />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Daily attendance"
          sub="Filter by date, branch, department and status"
          right={<Btn>Columns</Btn>}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips items={["Date: Today", "Branch: All", "Department: All", "Status: Any"]} />
        </div>
        <div className="grid gap-3 p-3 md:hidden">
          {employees.map((employee, index) => {
            const clockIn =
              employee.status === "Absent" || employee.shift === "OFF"
                ? "-"
                : index % 3 === 0
                  ? "09:37"
                  : "09:24";
            const openShift = employee.status === "Absent" || employee.shift === "OFF";
            return (
              <article
                key={employee.name}
                className="rounded-lg border border-border bg-card p-3 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold">{employee.name}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {employee.dept} - {employee.branch}
                    </div>
                  </div>
                  <Status>{employee.status}</Status>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Scheduled </span>
                    <span className="num font-semibold">{employee.shift}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Clock in </span>
                    <span className="num font-semibold">{clockIn}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Clock out </span>
                    <span className="num font-semibold">{openShift ? "-" : "Open"}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Worked </span>
                    <span className="num font-semibold">{openShift ? "-" : "4.6h"}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr>
                <TH>Employee</TH>
                <TH>Department</TH>
                <TH>Branch</TH>
                <TH>Scheduled</TH>
                <TH>Clock in</TH>
                <TH>Clock out</TH>
                <TH>Worked</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee, index) => (
                <tr key={employee.name} className="hover:bg-secondary/50">
                  <TD className="font-semibold">{employee.name}</TD>
                  <TD className="text-muted-foreground">{employee.dept}</TD>
                  <TD className="text-muted-foreground">{employee.branch}</TD>
                  <TD className="num">{employee.shift}</TD>
                  <TD className="num">
                    {employee.status === "Absent" || employee.shift === "OFF"
                      ? "-"
                      : index % 3 === 0
                        ? "09:37"
                        : "09:24"}
                  </TD>
                  <TD className="num">
                    {employee.status === "Absent" || employee.shift === "OFF" ? "-" : "Open"}
                  </TD>
                  <TD className="num">
                    {employee.status === "Absent" || employee.shift === "OFF" ? "-" : "4.6h"}
                  </TD>
                  <TD>
                    <Status>{employee.status}</Status>
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
