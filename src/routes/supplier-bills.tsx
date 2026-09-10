import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";

type Bill = {
  id: string;
  supplier: string;
  bill: string;
  po: string;
  due: string;
  amount: number;
  paid: number;
  outstanding: number;
  status: string;
};

export const Route = createFileRoute("/supplier-bills")({
  head: () => ({ meta: [{ title: "Supplier Bills - Seramet" }] }),
  component: SupplierBills,
});

const rows: Bill[] = emptyRecords();

const columns: EnterpriseColumn<Bill>[] = [
  { key: "supplier", label: "Supplier", sortable: true },
  { key: "bill", label: "Bill", sortable: true },
  { key: "po", label: "PO", sortable: true },
  { key: "due", label: "Due", sortable: true },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.amount)}</span>,
  },
  {
    key: "paid",
    label: "Paid",
    align: "right",
    sortable: true,
    render: (row) => <span className="num text-muted-foreground">{ksh(row.paid)}</span>,
  },
  {
    key: "outstanding",
    label: "Outstanding",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.outstanding)}</span>,
  },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function SupplierBills() {
  const total = rows.reduce((sum, row) => sum + row.outstanding, 0);
  const overdue = rows
    .filter((row) => row.status === "Overdue")
    .reduce((sum, row) => sum + row.outstanding, 0);
  const matched = rows.length
    ? Math.round((rows.filter((row) => row.po).length / rows.length) * 100)
    : 0;
  return (
    <AppShell
      title="Supplier bills"
      subtitle="Bills matched to purchase orders and receiving records"
      actions={
        <>
          <Btn>Schedule payment</Btn>
          <Btn variant="primary">Enter bill</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Supplier payables" value={total} money />
        <Metric label="Overdue" value={overdue} money invert />
        <Metric label="Due this week" value={0} />
        <Metric label="Matched bills" value={matched} suffix="%" />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Bill register" sub="Match bills, schedule payments and review ageing" />
        <EnterpriseTable
          rows={rows}
          columns={columns}
          filters={["Due: All", "Supplier: All", "Status: Open"]}
        />
      </Panel>
    </AppShell>
  );
}
