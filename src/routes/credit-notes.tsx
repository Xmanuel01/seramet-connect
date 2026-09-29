import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Note = {
  id: string;
  date: string;
  type: string;
  party: string;
  document: string;
  branch: string;
  reason: string;
  amount: number;
  tax: number;
  status: string;
};

export const Route = createFileRoute("/credit-notes")({
  head: () => ({
    meta: [
      { title: "Credit & Debit Notes - Seramet" },
      {
        name: "description",
        content: "Credit notes against customer invoices and debit notes against supplier bills, with tax reversal.",
      },
      { property: "og:title", content: "Credit & Debit Notes - Seramet" },
      { property: "og:description", content: "Auditable adjustments that never delete the original document." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditNotes,
});

const rows: Note[] = [
  { id: "CN-0041", date: "15 Aug", type: "Credit note", party: "Zawadi Corporate", document: "INV-2026-0412", branch: "Westlands", reason: "Cancelled event covers", amount: 42800, tax: 6848, status: "Approved" },
  { id: "CN-0042", date: "15 Aug", type: "Credit note", party: "Walk-in - Table 12", document: "INV-2026-0418", branch: "Westlands", reason: "Dish returned - quality", amount: 2400, tax: 384, status: "Pending" },
  { id: "DN-0018", date: "14 Aug", type: "Debit note", party: "Main Meat Supplier", document: "BILL-001", branch: "Ngong Road", reason: "Short delivery 1.6 kg", amount: 992, tax: 159, status: "Approved" },
  { id: "DN-0019", date: "13 Aug", type: "Debit note", party: "Muthurwa Groceries", document: "BILL-003", branch: "Ngong Road", reason: "Spoiled produce rejected", amount: 6400, tax: 1024, status: "Pending" },
  { id: "CN-0043", date: "12 Aug", type: "Credit note", party: "Bolt Food", document: "INV-2026-0399", branch: "Westlands", reason: "Commission over-charge", amount: 8600, tax: 1376, status: "Approved" },
];

const columns: EnterpriseColumn<Note>[] = [
  { key: "id", label: "Note", sortable: true },
  { key: "date", label: "Date", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "party", label: "Customer / supplier", sortable: true },
  { key: "document", label: "Against document" },
  { key: "branch", label: "Branch", sortable: true },
  { key: "reason", label: "Reason" },
  { key: "amount", label: "Net", align: "right", sortable: true, render: (row) => <span className="num font-semibold">{ksh(row.amount)}</span> },
  { key: "tax", label: "Tax", align: "right", render: (row) => <span className="num text-muted-foreground">{ksh(row.tax)}</span> },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function CreditNotes() {
  const { branch, branchLabel } = useAppContext();
  const scoped = useBranchRows(rows);
  const credits = scoped.filter((r) => r.type === "Credit note").reduce((s, r) => s + r.amount, 0);
  const debits = scoped.filter((r) => r.type === "Debit note").reduce((s, r) => s + r.amount, 0);
  return (
    <AppShell
      title="Credit & debit notes"
      subtitle={`Adjustments against issued documents  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Debit note</Btn>
          <Btn variant="primary">Credit note</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Credit notes" value={credits} money invert />
        <Metric label="Debit notes" value={debits} money />
        <Metric label="Awaiting approval" value={scoped.filter((r) => r.status === "Pending").length} invert />
        <Metric label="Tax reversed" value={scoped.reduce((s, r) => s + r.tax, 0)} money />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Note register" sub="Every note posts a reversing journal and keeps the original document intact" />
        <EnterpriseTable rows={scoped} columns={columns} filters={[`Branch: ${branch}`, "Period: Aug 2026"]} />
      </Panel>
    </AppShell>
  );
}
