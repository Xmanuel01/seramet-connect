import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";

type Receivable = {
  id: string;
  customer: string;
  invoice: string;
  due: string;
  amount: number;
  paid: number;
  outstanding: number;
  age: string;
  status: string;
};

export const Route = createFileRoute("/receivables")({
  head: () => ({ meta: [{ title: "Accounts Receivable - Seramet" }] }),
  component: Receivables,
});

const rows: Receivable[] = [
  {
    id: "AR-001",
    customer: "Kilimani Catering",
    invoice: "INV-2026-1820",
    due: "14 Aug",
    amount: 124000,
    paid: 60000,
    outstanding: 64000,
    age: "4d",
    status: "Partial",
  },
  {
    id: "AR-002",
    customer: "Westlands Gym",
    invoice: "INV-2026-1812",
    due: "18 Aug",
    amount: 86000,
    paid: 0,
    outstanding: 86000,
    age: "-",
    status: "Pending",
  },
  {
    id: "AR-003",
    customer: "Sarit Retail Team",
    invoice: "INV-2026-1740",
    due: "02 Aug",
    amount: 142800,
    paid: 0,
    outstanding: 142800,
    age: "11d overdue",
    status: "Critical",
  },
  {
    id: "AR-004",
    customer: "Nairobi Studio",
    invoice: "INV-2026-1701",
    due: "09 Aug",
    amount: 62000,
    paid: 62000,
    outstanding: 0,
    age: "-",
    status: "Paid",
  },
];

const columns: EnterpriseColumn<Receivable>[] = [
  { key: "customer", label: "Customer", sortable: true },
  { key: "invoice", label: "Invoice", sortable: true },
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
  { key: "age", label: "Age", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Receivables() {
  return (
    <AppShell
      title="Accounts receivable"
      subtitle="Customer invoices, ageing and collection status"
      actions={
        <>
          <Btn>Send reminders</Btn>
          <Btn variant="primary">New invoice</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Receivables" value={292800} money />
        <Metric label="Overdue" value={142800} money invert delta={18} />
        <Metric label="Collection rate" value={64} suffix="%" />
        <Metric label="Customers owing" value={3} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Customer ageing" sub="Search, sort, saved views and bulk reminders" />
        <EnterpriseTable
          rows={rows}
          columns={columns}
          filters={["Age: All", "Branch: All", "Status: Open"]}
        />
      </Panel>
    </AppShell>
  );
}
