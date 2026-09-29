import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext, useBranchRows } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/complaints")({
  head: () => ({ meta: [{ title: "Complaints - Seramet" }] }),
  component: Complaints,
});

const columns = ["Open", "Investigating", "Awaiting Customer", "Resolved", "Closed"];
const cases = [
  {
    id: "CMP-0114",
    status: "Open",
    customer: "Kelvin Otieno",
    order: "#1798",
    branch: "Westlands",
    issue: "Cold food",
    severity: "High",
    assignee: "Joan A.",
    createdAt: "2026-08-14T10:18:00+03:00",
    age: "1h",
  },
  {
    id: "CMP-0111",
    status: "Investigating",
    customer: "Sarah Njeri",
    order: "#1810",
    branch: "Ngong Road",
    issue: "Missing item",
    severity: "Medium",
    assignee: "Brian O.",
    createdAt: "2026-08-14T09:42:00+03:00",
    age: "2h",
  },
  {
    id: "CMP-0108",
    status: "Awaiting Customer",
    customer: "Peter Kamau",
    order: "#1772",
    branch: "Westlands",
    issue: "Late delivery",
    severity: "Low",
    assignee: "Faith N.",
    createdAt: "2026-08-13T16:22:00+03:00",
    age: "1d",
  },
  {
    id: "CMP-0102",
    status: "Resolved",
    customer: "Asha Mohamed",
    order: "#1680",
    branch: "Ngong Road",
    issue: "Wrong bill",
    severity: "Medium",
    assignee: "Amina W.",
    createdAt: "2026-08-12T13:05:00+03:00",
    age: "2d",
  },
  {
    id: "CMP-0098",
    status: "Closed",
    customer: "Brian Oloo",
    order: "#1629",
    branch: "Westlands",
    issue: "Overcharge",
    severity: "Low",
    assignee: "Joan A.",
    createdAt: "2026-08-10T18:36:00+03:00",
    age: "4d",
  },
];

function Complaints() {
  const { branch, branches, branchLabel, canSwitchBranch, setBranch } = useAppContext();
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const scopedCases = useBranchRows(cases).filter(
    (item) => !periodDate || item.createdAt.slice(0, 10) === periodDate,
  );
  const openCases = scopedCases.filter((item) => !["Resolved", "Closed"].includes(item.status));
  const branchFilterAction = canSwitchBranch ? (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-semibold transition-colors hover:bg-secondary">
        Filter branch
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Complaint branch scope</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {branches.map((item) => (
          <DropdownMenuItem key={item} onClick={() => setBranch(item)}>
            {item === branch ? `${item} - active` : item}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <button
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-muted-foreground"
      disabled
    >
      {branchLabel}
    </button>
  );

  return (
    <AppShell
      title="Complaints"
      subtitle={`Case-management workflow for service recovery  -  ${branchLabel}`}
      actions={
        <>
          {branchFilterAction}
          <Btn variant="primary">New complaint</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open cases" value={openCases.length} />
        <Metric label="Avg resolution" value="2.4d" delta={-18} />
        <Metric
          label="High severity"
          value={scopedCases.filter((item) => item.severity === "High").length}
        />
        <Metric
          label="Recovered customers"
          value={scopedCases.filter((item) => item.status === "Resolved").length * 6}
          delta={9}
        />
      </div>
      <Panel className="mt-4">
        <div className="px-4 py-3">
          <Chips
            items={[
              { label: "Scope", value: branchLabel },
              {
                label: "Period",
                value: formatFilterDate(periodDate),
                dateValue: periodDate,
                onDateChange: setPeriodDate,
                onClear: () => setPeriodDate(""),
              },
              { label: "Cases", value: `${scopedCases.length} visible` },
            ]}
            onClear={() => setPeriodDate("")}
          />
        </div>
      </Panel>
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3">
        {columns.map((column) => (
          <Panel key={column} className="min-w-0 p-3">
            <PanelHead
              title={column}
              right={
                <span className="num text-[12px] font-bold">
                  {scopedCases.filter((c) => c.status === column).length}
                </span>
              }
            />
            <div className="mt-3 space-y-2">
              {scopedCases
                .filter((item) => item.status === column)
                .map((item) => (
                  <article key={item.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <span className="num text-[12px] font-bold">{item.id}</span>
                      <Status className="shrink-0">
                        {item.severity === "High"
                          ? "Critical"
                          : item.severity === "Medium"
                            ? "Attention"
                            : "Pending"}
                      </Status>
                    </div>
                    <div className="mt-2 truncate text-[13px] font-semibold">{item.issue}</div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {item.customer} - {item.order}
                    </div>
                    <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                        <dt>Branch</dt>
                        <dd className="truncate text-right">{item.branch}</dd>
                      </div>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                        <dt>Date</dt>
                        <dd className="num truncate text-right">
                          {formatFilterDate(item.createdAt.slice(0, 10))}
                        </dd>
                      </div>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                        <dt>Assigned</dt>
                        <dd className="truncate text-right">{item.assignee}</dd>
                      </div>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                        <dt>Age</dt>
                        <dd className="num truncate text-right">{item.age}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
            </div>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
