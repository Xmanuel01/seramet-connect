import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/branches")({
  head: () => ({ meta: [{ title: "Branches - Seramet" }] }),
  component: Branches,
});

const branches = [
  {
    name: "Westlands",
    manager: "Joan A.",
    sales: 121480,
    margin: 61,
    food: 31,
    staff: 24,
    state: "Healthy",
  },
  {
    name: "Ngong Road",
    manager: "Brian O.",
    sales: 92940,
    margin: 56,
    food: 36,
    staff: 18,
    state: "Attention",
  },
];

function Branches() {
  const [newBranch, setNewBranch] = useState("");
  const {
    branch,
    branches: configuredBranches,
    isAllBranches,
    addBranch,
    removeBranch,
  } = useAppContext();
  const operationalBranches = configuredBranches.filter((item) => item !== "All Branches");
  const configuredRows = operationalBranches.map(
    (name) =>
      branches.find((item) => item.name === name) ?? {
        name,
        manager: "Unassigned",
        sales: 0,
        margin: 0,
        food: 0,
        staff: 0,
        state: "Setup",
      },
  );
  const scopedBranches = isAllBranches
    ? configuredRows
    : configuredRows.filter((item) => item.name === branch);
  const totalSales = scopedBranches.reduce((sum, item) => sum + item.sales, 0);
  const totalStaff = scopedBranches.reduce((sum, item) => sum + item.staff, 0);
  return (
    <AppShell
      title="Branches"
      subtitle="Operational performance and configuration by location"
      actions={
        <>
          <Btn>Compare</Btn>
          <Btn
            variant="primary"
            onClick={() => {
              addBranch(newBranch);
              setNewBranch("");
            }}
          >
            Add branch
          </Btn>
        </>
      }
    >
      <Panel className="mb-4 p-4">
        <PanelHead
          title="Branch configuration"
          sub="Branches can be added or deleted from the operating system"
        />
        <div className="mt-3 flex gap-2">
          <input
            value={newBranch}
            onChange={(event) => setNewBranch(event.target.value)}
            placeholder="New branch name"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
          />
          <Btn
            onClick={() => {
              addBranch(newBranch);
              setNewBranch("");
            }}
          >
            Add
          </Btn>
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Branches" value={scopedBranches.length} />
        <Metric label="Total sales" value={totalSales} money delta={8.4} />
        <Metric label="Employees" value={totalStaff} />
        <Metric label="Open alerts" value={isAllBranches ? 5 : 2} invert />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {scopedBranches.map((item) => (
          <Panel key={item.name} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-bold">{item.name}</h2>
                <p className="text-[12px] text-muted-foreground">Manager: {item.manager}</p>
              </div>
              <div className="flex items-center gap-2">
                <Status>{item.state}</Status>
                <button
                  onClick={() => removeBranch(item.name)}
                  className="text-[12px] font-semibold text-muted-foreground hover:text-danger"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric label="Sales" value={item.sales} money />
              <Metric label="Margin" value={item.margin} suffix="%" />
              <Metric label="Food cost" value={item.food} suffix="%" invert />
              <Metric label="Staff" value={item.staff} />
            </div>
          </Panel>
        ))}
      </div>
      <Panel className="mt-4">
        <PanelHead title="Branch comparison" sub="Daily operating scorecard" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Branch</TH>
              <TH>Manager</TH>
              <TH className="text-right">Sales</TH>
              <TH className="text-right">Margin</TH>
              <TH className="text-right">Food cost</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {scopedBranches.map((item) => (
              <tr key={item.name}>
                <TD className="font-semibold">{item.name}</TD>
                <TD className="text-muted-foreground">{item.manager}</TD>
                <TD className="num text-right font-semibold">{ksh(item.sales)}</TD>
                <TD className="num text-right">{item.margin}%</TD>
                <TD className="num text-right">{item.food}%</TD>
                <TD>
                  <Status>{item.state}</Status>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
