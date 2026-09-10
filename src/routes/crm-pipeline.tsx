import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext, useBranchRows } from "@/lib/app-context";

export const Route = createFileRoute("/crm-pipeline")({
  head: () => ({
    meta: [
      { title: "CRM Pipeline - Seramet" },
      {
        name: "description",
        content: "Lead pipeline with owners, values, next actions and ageing.",
      },
    ],
  }),
  component: CrmPipeline,
});

const stages = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];
const leads = emptyRecords();

function CrmPipeline() {
  const { branchLabel } = useAppContext();
  const scopedLeads = useBranchRows(leads);
  const pipelineValue = scopedLeads.reduce((sum, lead) => sum + lead.value, 0);
  return (
    <AppShell
      title="CRM pipeline"
      subtitle={`Corporate catering and repeat account opportunities  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Import leads</Btn>
          <Btn variant="primary">New lead</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Pipeline value" value={pipelineValue} money />
        <Metric
          label="Open leads"
          value={scopedLeads.filter((lead) => !["Won", "Lost"].includes(lead.stage)).length}
        />
        <Metric label="Weighted forecast" value="Not available" />
        <Metric label="Avg age" value="Not available" />
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3">
        {stages.map((stage) => (
          <Panel key={stage} className="min-w-0 p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-bold">{stage}</h2>
              <span className="num rounded bg-secondary px-1.5 text-[12px] font-bold">
                {scopedLeads.filter((lead) => lead.stage === stage).length}
              </span>
            </div>
            <div className="space-y-2">
              {scopedLeads
                .filter((lead) => lead.stage === stage)
                .map((lead) => (
                  <article
                    key={lead.id}
                    className="rounded-lg border border-border bg-card p-3 shadow-card"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold">{lead.customer}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {lead.company}
                        </div>
                      </div>
                      <Status className="shrink-0">
                        {stage === "Won" ? "Approved" : stage === "Lost" ? "Rejected" : "Pending"}
                      </Status>
                    </div>
                    <div className="num mt-2 text-[15px] font-bold">{ksh(lead.value)}</div>
                    <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                        <dt>Owner</dt>
                        <dd className="truncate text-right font-semibold text-foreground">
                          {lead.owner}
                        </dd>
                      </div>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                        <dt>Next</dt>
                        <dd className="truncate text-right">{lead.next}</dd>
                      </div>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                        <dt>Age</dt>
                        <dd className="num truncate text-right">{lead.age}</dd>
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
