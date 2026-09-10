import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { EmptyState } from "@/components/app/EmptyState";
import { ksh } from "@/lib/currency";
import { emptyRecords } from "@/lib/empty-records";

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

const members = emptyRecords<Member>();

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
        <Metric label="Members" value={members.length} />
        <Metric label="Points issued" value={0} />
        <Metric label="Rewards redeemed" value={0} />
        <Metric label="Loyalty revenue" value={0} money />
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
          <EmptyState
            title="No loyalty configuration"
            description="Create tenant-specific tiers and rewards before enrolling members."
          />
          <div className="border-t border-border p-3">
            <Btn className="w-full">Manual points adjustment</Btn>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
