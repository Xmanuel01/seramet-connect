import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";

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

const rows: Bill[] = [
  {
    id: "BILL-001",
    supplier: "Main Meat Supplier",
    bill: "MMS-2291",
    po: "PO-2026-0182",
    due: "14 Aug",
    amount: 128400,
    paid: 60000,
    outstanding: 68400,
    status: "Partial",
  },
  {
    id: "BILL-002",
    supplier: "Samwest",
    bill: "SW-8842",
    po: "PO-2026-0179",
    due: "18 Aug",
    amount: 96200,
    paid: 96200,
    outstanding: 0,
    status: "Paid",
  },
  {
    id: "BILL-003",
    supplier: "Muthurwa Groceries",
    bill: "MG-0471",
    po: "PO-2026-0168",
    due: "09 Aug",
    amount: 42800,
    paid: 0,
    outstanding: 42800,
    status: "Critical",
  },
];

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
        <Metric label="Supplier payables" value={299000} money />
        <Metric label="Overdue" value={42800} money invert />
        <Metric label="Due this week" value={3} />
        <Metric label="Matched bills" value={92} suffix="%" />
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
