import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/crm")({
  head: () => ({
    meta: [
      { title: "CRM Overview - Seramet" },
      {
        name: "description",
        content: "Customer segments, pipeline value, loyalty activity and complaint recovery.",
      },
    ],
  }),
  component: CrmOverview,
});

const segments = [
  { name: "Corporate catering", customers: 38, value: 1840000, trend: 12, status: "Healthy" },
  { name: "Regular dine-in", customers: 420, value: 1260000, trend: 6, status: "Healthy" },
  { name: "Dormant guests", customers: 91, value: 248000, trend: -18, status: "Attention" },
  { name: "Complaint recovery", customers: 11, value: 86400, trend: -4, status: "Pending" },
];

function CrmOverview() {
  return (
    <AppShell
      title="CRM overview"
      subtitle="Customer growth, retention, pipeline and service recovery"
      actions={
        <>
          <Btn>Export</Btn>
          <Btn variant="primary">Create campaign</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Active customers" value={560} delta={8.4} />
        <Metric label="Pipeline value" value={956000} money delta={13.1} />
        <Metric label="Loyalty members" value={412} delta={9.5} />
        <Metric label="Open complaints" value={7} invert />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Customer segments"
            sub="Segments connect Customer 360, loyalty, complaints and CRM pipeline"
          />
          <table className="w-full">
            <thead>
              <tr>
                <TH>Segment</TH>
                <TH className="text-right">Customers</TH>
                <TH className="text-right">Value</TH>
                <TH className="text-right">Trend</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.name} className="hover:bg-secondary/50">
                  <TD className="font-semibold">{segment.name}</TD>
                  <TD className="num text-right">{segment.customers}</TD>
                  <TD className="num text-right">{ksh(segment.value)}</TD>
                  <TD className="num text-right">{segment.trend}%</TD>
                  <TD>
                    <Status>{segment.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <PanelHead title="Next best actions" sub="Operational CRM prompts" />
          <div className="space-y-2 p-4 text-[13px]">
            {[
              "Follow up 6 proposal-stage catering leads",
              "Send dormant guest win-back offer",
              "Review 2 unresolved complaint recoveries",
              "Invite Gold tier guests to weekend special",
            ].map((item) => (
              <div
                key={item}
                className="rounded-lg border border-border bg-secondary/40 p-3 font-semibold"
              >
                {item}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
