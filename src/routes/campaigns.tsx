import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { emptyRecords } from "@/lib/empty-records";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Campaign = {
  id: string;
  name: string;
  channel: string;
  segment: string;
  branch: string;
  sent: number;
  redeemed: number;
  revenue: number;
  status: string;
};

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "Campaigns - Seramet" },
      {
        name: "description",
        content:
          "Customer campaigns across WhatsApp, SMS and email with segment targeting and revenue attribution.",
      },
      { property: "og:title", content: "Campaigns - Seramet" },
      {
        property: "og:description",
        content: "Plan, send and measure customer campaigns per branch and segment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Campaigns,
});

const rows = emptyRecords<Campaign>();

const columns: EnterpriseColumn<Campaign>[] = [
  { key: "name", label: "Campaign", sortable: true },
  { key: "channel", label: "Channel", sortable: true },
  { key: "segment", label: "Segment", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "sent", label: "Sent", align: "right", sortable: true },
  { key: "redeemed", label: "Redeemed", align: "right", sortable: true },
  {
    key: "revenue",
    label: "Attributed revenue",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.revenue)}</span>,
  },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Campaigns() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const sent = scopedRows.reduce((sum, row) => sum + row.sent, 0);
  const redeemed = scopedRows.reduce((sum, row) => sum + row.redeemed, 0);
  return (
    <AppShell
      title="Campaigns"
      subtitle={`Targeted customer messaging and revenue attribution  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Message templates</Btn>
          <Btn variant="primary">New campaign</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Messages sent" value={sent} />
        <Metric label="Redemptions" value={redeemed} />
        <Metric
          label="Redemption rate"
          value={sent ? Math.round((redeemed / sent) * 100) : 0}
          suffix="%"
        />
        <Metric
          label="Attributed revenue"
          value={scopedRows.reduce((sum, row) => sum + row.revenue, 0)}
          money
        />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Campaign register" sub="Every send is written to the notification log" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Period: This quarter"]}
        />
      </Panel>
    </AppShell>
  );
}
