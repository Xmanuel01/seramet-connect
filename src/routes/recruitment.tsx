import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Applicant = {
  id: string;
  name: string;
  position: string;
  branch: string;
  source: string;
  stage: string;
  applied: string;
  status: string;
};

export const Route = createFileRoute("/recruitment")({
  head: () => ({
    meta: [
      { title: "Recruitment - Seramet" },
      {
        name: "description",
        content:
          "Open positions, applicant pipeline stages and hiring approvals across every branch.",
      },
      { property: "og:title", content: "Recruitment - Seramet" },
      {
        property: "og:description",
        content: "Track applicants from screening through offer and onboarding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Recruitment,
});

const rows: Applicant[] = [
  { id: "APP-501", name: "Joyce M.", position: "Cashier", branch: "Westlands", source: "Referral", stage: "Interview", applied: "02 Aug", status: "In progress" },
  { id: "APP-502", name: "Samuel N.", position: "Rider", branch: "Ngong Road", source: "Walk-in", stage: "Screening", applied: "06 Aug", status: "New" },
  { id: "APP-503", name: "Grace K.", position: "Sous chef", branch: "Westlands", source: "Job board", stage: "Offer", applied: "28 Jul", status: "Approved" },
  { id: "APP-504", name: "Elijah T.", position: "Storekeeper", branch: "Ngong Road", source: "Referral", stage: "Rejected", applied: "24 Jul", status: "Rejected" },
];

const columns: EnterpriseColumn<Applicant>[] = [
  { key: "name", label: "Applicant", sortable: true },
  { key: "position", label: "Position", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "source", label: "Source", sortable: true },
  { key: "stage", label: "Stage", sortable: true },
  { key: "applied", label: "Applied" },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

const stages = ["Screening", "Interview", "Trial shift", "Offer", "Onboarding"];

function Recruitment() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  return (
    <AppShell
      title="Recruitment"
      subtitle={`Open roles and applicant pipeline  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Job templates</Btn>
          <Btn variant="primary">Post vacancy</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open positions" value={3} />
        <Metric label="Applicants" value={scopedRows.length} />
        <Metric
          label="In interview"
          value={scopedRows.filter((row) => row.stage === "Interview").length}
        />
        <Metric label="Avg time to hire" value="18" suffix=" days" />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Pipeline stages" sub="Hiring approval follows the standard approval engine" />
        <div className="flex flex-wrap items-center gap-2 px-4 py-4">
          {stages.map((stage, index) => (
            <span key={stage} className="flex items-center gap-2">
              <Status>{stage}</Status>
              {index < stages.length - 1 && <span className="text-muted-foreground">-&gt;</span>}
            </span>
          ))}
        </div>
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="Applicants" sub="Source, stage and current decision state" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Stage: All"]}
        />
      </Panel>
    </AppShell>
  );
}
