import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Expense = {
  id: string;
  date: string;
  employee: string;
  category: string;
  branch: string;
  vendor: string;
  amount: number;
  receipt: string;
  status: string;
  approver: string;
};

export const Route = createFileRoute("/expenses")({
  head: () => ({ meta: [{ title: "Expenses - Seramet" }] }),
  component: Expenses,
});

const rows: Expense[] = emptyRecords();

const columns: EnterpriseColumn<Expense>[] = [
  { key: "date", label: "Date", sortable: true },
  { key: "employee", label: "Employee", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "vendor", label: "Vendor", sortable: true },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.amount)}</span>,
  },
  { key: "receipt", label: "Receipt", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
  { key: "approver", label: "Approver", sortable: true },
];

function Expenses() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const total = scopedRows.reduce((sum, row) => sum + row.amount, 0);
  const preview = scopedRows.find((row) => row.status === "Critical") ?? scopedRows[0];
  return (
    <AppShell
      title="Expenses"
      subtitle={`Employee claims, vendor spend and receipt review  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Export</Btn>
          <Btn variant="primary">New expense</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expenses MTD" value={total} money invert />
        <Metric
          label="Pending approval"
          value={scopedRows.filter((row) => row.status === "Pending").length}
        />
        <Metric
          label="Missing receipts"
          value={scopedRows.filter((row) => row.receipt.startsWith("IMG")).length}
          invert
        />
        <Metric label="Avg approval time" value="Not available" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHead
            title="Expense register"
            sub="Search, sort, column visibility, saved views and bulk approval"
          />
          <EnterpriseTable
            rows={scopedRows}
            columns={columns}
            filters={["Date: This month", `Branch: ${branch}`, "Status: Open"]}
          />
        </Panel>
        <Panel>
          <PanelHead
            title="Receipt preview"
            sub={preview ? `${preview.id} - ${preview.vendor}` : "No receipt selected"}
          />
          <div className="p-4">
            <div className="rounded-lg border border-border bg-secondary/60 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Receipt image
              </div>
              <div className="mt-3 grid h-44 place-items-center rounded-md bg-card text-center text-[12px] text-muted-foreground">
                {preview ? (
                  <>
                    {preview.vendor} receipt
                    <br />
                    {ksh(preview.amount)}
                    <br />
                    {preview.date} 2026
                  </>
                ) : (
                  "No branch receipt"
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Btn variant="primary">Approve</Btn>
              <Btn variant="danger">Reject</Btn>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
