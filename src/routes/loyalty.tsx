import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

type Member = {
  id: string;
  customer: string;
  tier: string;
  points: number;
  balance: number;
  lastVisit: string;
  status: string;
};

export const Route = createFileRoute("/loyalty")({
  head: () => ({ meta: [{ title: "Loyalty - Seramet" }] }),
  component: Loyalty,
});

const members: Member[] = [
  {
    id: "LY-001",
    customer: "Kelvin Otieno",
    tier: "Gold",
    points: 4820,
    balance: 184600,
    lastVisit: "3 days",
    status: "Active",
  },
  {
    id: "LY-002",
    customer: "Sarah Njeri",
    tier: "Silver",
    points: 2140,
    balance: 68400,
    lastVisit: "1 day",
    status: "Active",
  },
  {
    id: "LY-003",
    customer: "Peter Kamau",
    tier: "Bronze",
    points: 880,
    balance: 27800,
    lastVisit: "18 days",
    status: "Attention",
  },
  {
    id: "LY-004",
    customer: "Asha Mohamed",
    tier: "Gold",
    points: 5120,
    balance: 224000,
    lastVisit: "5 days",
    status: "Active",
  },
  {
    id: "LY-005",
    customer: "Brian Oloo",
    tier: "Silver",
    points: 1720,
    balance: 46100,
    lastVisit: "41 days",
    status: "Pending",
  },
];

const columns: EnterpriseColumn<Member>[] = [
  { key: "customer", label: "Customer", sortable: true },
  { key: "tier", label: "Tier", sortable: true },
  { key: "points", label: "Points", align: "right", sortable: true },
  {
    key: "balance",
    label: "Lifetime value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.balance)}</span>,
  },
  { key: "lastVisit", label: "Last visit", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Loyalty() {
  return (
    <AppShell
      title="Loyalty"
      subtitle="Tiers, rewards, coupons, balances and manual point adjustments"
      actions={
        <>
          <Btn>New reward</Btn>
          <Btn variant="primary">Create campaign</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Members" value={1246} delta={8} />
        <Metric label="Points issued" value={842000} />
        <Metric label="Rewards redeemed" value={318} delta={12} />
        <Metric label="Loyalty revenue" value={986400} money delta={9.2} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead
            title="Customer balances"
            sub="Search, sort, select and bulk update loyalty members"
          />
          <EnterpriseTable
            rows={members}
            columns={columns}
            filters={["Tier: All", "Branch: All"]}
          />
        </Panel>
        <Panel>
          <PanelHead title="Tiers and rewards" sub="Current configuration" />
          <table className="w-full">
            <thead>
              <tr>
                <TH>Tier</TH>
                <TH className="text-right">Spend threshold</TH>
                <TH>Reward</TH>
              </tr>
            </thead>
            <tbody>
              {[
                ["Bronze", 0, "1 point / KSh 100"],
                ["Silver", 50000, "1.5 points / KSh 100"],
                ["Gold", 150000, "2 points / KSh 100"],
              ].map(([tier, threshold, reward]) => (
                <tr key={String(tier)}>
                  <TD className="font-semibold">{tier}</TD>
                  <TD className="num text-right">{ksh(Number(threshold))}</TD>
                  <TD className="text-muted-foreground">{reward}</TD>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border p-3">
            <Btn className="w-full">Manual points adjustment</Btn>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
