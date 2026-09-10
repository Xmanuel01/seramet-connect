import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { EmptyState } from "@/components/app/EmptyState";
import { emptyRecords } from "@/lib/empty-records";

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

type CustomerSegment = {
  name: string;
  customers: number;
  value: number;
  trend: number;
  status: string;
};

const segments = emptyRecords<CustomerSegment>();

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
        <Metric label="Active customers" value={0} />
        <Metric label="Pipeline value" value={0} money />
        <Metric label="Loyalty members" value={0} />
        <Metric label="Open complaints" value={0} invert />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Customer segments"
            sub="Segments connect Customer 360, loyalty, complaints and CRM pipeline"
          />
          {segments.length ? (
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
          ) : (
            <EmptyState
              title="No customer segments yet"
              description="Segments will appear after customer and order activity is recorded."
            />
          )}
        </Panel>
        <Panel>
          <PanelHead title="Next best actions" sub="Operational CRM prompts" />
          <EmptyState
            title="No CRM actions"
            description="Evidence-based actions will appear as customer activity is collected."
          />
        </Panel>
      </div>
    </AppShell>
  );
}
