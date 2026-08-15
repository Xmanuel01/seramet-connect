import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";
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

const rows: Expense[] = [
  {
    id: "EXP-001",
    date: "13 Aug",
    employee: "Joan A.",
    category: "Transport",
    branch: "Westlands",
    vendor: "Bolt",
    amount: 1840,
    receipt: "IMG-1840.jpg",
    status: "Pending",
    approver: "Emmanuel K.",
  },
  {
    id: "EXP-002",
    date: "12 Aug",
    employee: "Musa K.",
    category: "Kitchen tools",
    branch: "Westlands",
    vendor: "KitchenPro",
    amount: 12400,
    receipt: "IMG-1240.jpg",
    status: "Approved",
    approver: "Emmanuel K.",
  },
  {
    id: "EXP-003",
    date: "11 Aug",
    employee: "Amina W.",
    category: "Airtime",
    branch: "Ngong Road",
    vendor: "Safaricom",
    amount: 1500,
    receipt: "MPESA-1500",
    status: "Paid",
    approver: "Finance",
  },
  {
    id: "EXP-004",
    date: "10 Aug",
    employee: "Kelvin M.",
    category: "Repairs",
    branch: "Westlands",
    vendor: "CoolTech",
    amount: 28600,
    receipt: "IMG-2860.jpg",
    status: "Critical",
    approver: "Finance",
  },
];

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
        <Metric label="Expenses MTD" value={total} money delta={3.1} invert />
        <Metric
          label="Pending approval"
          value={scopedRows.filter((row) => row.status === "Pending").length}
        />
        <Metric
          label="Missing receipts"
          value={scopedRows.filter((row) => row.receipt.startsWith("IMG")).length}
          invert
        />
        <Metric label="Avg approval time" value="4.2h" />
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
