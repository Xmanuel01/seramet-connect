import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";
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
const leads = [
  {
    id: "L-1182",
    stage: "New",
    customer: "Kilimani Catering",
    company: "Kilimani Events",
    branch: "Westlands",
    value: 124000,
    owner: "Joan A.",
    next: "Call buyer",
    age: "1d",
  },
  {
    id: "L-1174",
    stage: "Contacted",
    customer: "Asha Mohamed",
    company: "Office lunch account",
    branch: "Ngong Road",
    value: 86000,
    owner: "Brian O.",
    next: "Send menu",
    age: "3d",
  },
  {
    id: "L-1159",
    stage: "Qualified",
    customer: "Westlands Gym",
    company: "Corporate meals",
    branch: "Westlands",
    value: 214000,
    owner: "Emmanuel K.",
    next: "Pricing review",
    age: "6d",
  },
  {
    id: "L-1140",
    stage: "Proposal",
    customer: "Nairobi Studio",
    company: "Crew catering",
    branch: "Westlands",
    value: 172000,
    owner: "Joan A.",
    next: "Follow up",
    age: "9d",
  },
  {
    id: "L-1126",
    stage: "Won",
    customer: "Sarit Retail Team",
    company: "Staff meals",
    branch: "Westlands",
    value: 268000,
    owner: "Emmanuel K.",
    next: "Create account",
    age: "12d",
  },
  {
    id: "L-1098",
    stage: "Lost",
    customer: "Ngong School",
    company: "Term catering",
    branch: "Ngong Road",
    value: 92000,
    owner: "Brian O.",
    next: "Archive",
    age: "18d",
  },
];

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
        <Metric label="Pipeline value" value={pipelineValue} money delta={14} />
        <Metric
          label="Open leads"
          value={scopedLeads.filter((lead) => !["Won", "Lost"].includes(lead.stage)).length}
        />
        <Metric label="Weighted forecast" value={Math.round(pipelineValue * 0.44)} money />
        <Metric label="Avg age" value="6.4d" />
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
