import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useBranchRows } from "@/lib/app-context";

export const Route = createFileRoute("/payables")({
  head: () => ({
    meta: [
      { title: "Accounts Payable - Seramet" },
      {
        name: "description",
        content: "Supplier invoice ageing, payment scheduling, approvals and cash planning.",
      },
    ],
  }),
  component: Payables,
});

const rows = [
  {
    supplier: "Main Meat Supplier",
    invoice: "MMS-2291",
    branch: "Westlands",
    due: "14 Aug",
    amount: 128400,
    paid: 60000,
    age: "12 d",
    status: "Partial",
  },
  {
    supplier: "Samwest",
    invoice: "SW-8842",
    branch: "Westlands",
    due: "18 Aug",
    amount: 96200,
    paid: 96200,
    age: "-",
    status: "Paid",
  },
  {
    supplier: "Muthurwa Groceries",
    invoice: "MG-0471",
    branch: "Ngong Road",
    due: "09 Aug",
    amount: 42800,
    paid: 0,
    age: "3 d overdue",
    status: "Critical",
  },
  {
    supplier: "Packaging Supplier",
    invoice: "PKG-1120",
    branch: "Ngong Road",
    due: "22 Aug",
    amount: 31600,
    paid: 0,
    age: "-",
    status: "Pending",
  },
];

function Payables() {
  const payableRows = useBranchRows(rows);
  const outstanding = payableRows.reduce((sum, row) => sum + row.amount - row.paid, 0);
  const overdue = payableRows
    .filter((row) => row.status === "Critical")
    .reduce((sum, row) => sum + row.amount - row.paid, 0);

  return (
    <AppShell
      title="Accounts payable"
      subtitle={`${payableRows.length} supplier invoices in current branch context`}
      actions={
        <>
          <Btn>Payment run</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary">Schedule payment</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Outstanding" value={outstanding} money invert />
        <Metric label="Overdue" value={overdue} money invert />
        <Metric label="Invoices" value={payableRows.length} />
        <Metric label="Paid this week" value={96200} money />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Supplier invoice ageing"
          sub="Payables are linked back to receiving, supplier bills and purchase orders"
          right={<Btn>Columns</Btn>}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips items={["Ageing: All", "Payment status: Any", "Approval: Required for overdue"]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr>
                <TH>Supplier</TH>
                <TH>Invoice</TH>
                <TH>Branch</TH>
                <TH>Due</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Paid</TH>
                <TH className="text-right">Outstanding</TH>
                <TH>Age</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {payableRows.map((row) => (
                <tr key={row.invoice} className="hover:bg-secondary/50">
                  <TD className="font-semibold">{row.supplier}</TD>
                  <TD className="num text-muted-foreground">{row.invoice}</TD>
                  <TD className="text-muted-foreground">{row.branch}</TD>
                  <TD className="text-muted-foreground">{row.due}</TD>
                  <TD className="num text-right">{ksh(row.amount)}</TD>
                  <TD className="num text-right text-muted-foreground">{ksh(row.paid)}</TD>
                  <TD className="num text-right font-semibold">{ksh(row.amount - row.paid)}</TD>
                  <TD className="text-muted-foreground">{row.age}</TD>
                  <TD>
                    <Status>{row.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
