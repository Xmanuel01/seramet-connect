import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders - Seramet" },
      {
        name: "description",
        content:
          "Purchase order list, approval state, receiving progress and supplier commitment tracking.",
      },
    ],
  }),
  component: PurchaseOrders,
});

const purchaseOrders = [
  {
    id: "PO-2026-0182",
    supplier: "Main Meat Supplier",
    branch: "Westlands",
    created: "13 Aug",
    expected: "14 Aug",
    amount: 58400,
    received: 0,
    status: "Pending",
  },
  {
    id: "PO-2026-0181",
    supplier: "Samwest",
    branch: "Westlands",
    created: "12 Aug",
    expected: "15 Aug",
    amount: 96200,
    received: 96200,
    status: "Received",
  },
  {
    id: "PO-2026-0179",
    supplier: "Muthurwa Groceries",
    branch: "Ngong Road",
    created: "11 Aug",
    expected: "13 Aug",
    amount: 42800,
    received: 21800,
    status: "Partial",
  },
  {
    id: "PO-2026-0176",
    supplier: "Packaging Supplier",
    branch: "Ngong Road",
    created: "09 Aug",
    expected: "16 Aug",
    amount: 31600,
    received: 0,
    status: "Approved",
  },
];

function PurchaseOrders() {
  const { branch, branchLabel } = useAppContext();
  const rows =
    branch === "All Branches"
      ? purchaseOrders
      : purchaseOrders.filter((row) => row.branch === branch);
  const openValue = rows
    .filter((row) => row.status !== "Received")
    .reduce((sum, row) => sum + row.amount - row.received, 0);
  const pending = rows.filter((row) => row.status === "Pending").length;

  return (
    <AppShell
      title="Purchase orders"
      subtitle={`PO approvals, receiving progress and supplier commitments - ${branchLabel}`}
      actions={
        <>
          <Btn>Saved views</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary">New purchase order</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Visible POs" value={rows.length} />
        <Metric label="Open value" value={openValue} money invert />
        <Metric label="Pending approval" value={pending} invert />
        <Metric
          label="Received today"
          value={rows.filter((row) => row.status === "Received").length}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Purchase order register"
          sub="Approval, receiving and supplier bill conversion stay in one procurement flow"
          right={<Btn>Columns</Btn>}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips items={[`Branch: ${branch}`, "Status: All", "Expected: Next 7 days"]} />
        </div>
        <div className="grid gap-3 p-3 md:hidden">
          {rows.map((po) => (
            <article
              key={po.id}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num text-[13px] font-bold">{po.id}</div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {po.supplier} - {po.branch}
                  </div>
                </div>
                <Status>{po.status}</Status>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="block text-muted-foreground">Amount</span>
                  <span className="num font-semibold">{ksh(po.amount)}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="block text-muted-foreground">Received</span>
                  <span className="num font-semibold">{ksh(po.received)}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="block text-muted-foreground">Expected</span>
                  <span className="font-semibold">{po.expected}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <TH>PO</TH>
                <TH>Supplier</TH>
                <TH>Branch</TH>
                <TH>Created</TH>
                <TH>Expected</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">Open</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => (
                <tr key={po.id} className="hover:bg-secondary/50">
                  <TD className="num font-semibold">{po.id}</TD>
                  <TD>{po.supplier}</TD>
                  <TD className="text-muted-foreground">{po.branch}</TD>
                  <TD className="text-muted-foreground">{po.created}</TD>
                  <TD className="text-muted-foreground">{po.expected}</TD>
                  <TD className="num text-right">{ksh(po.amount)}</TD>
                  <TD className="num text-right text-muted-foreground">{ksh(po.received)}</TD>
                  <TD className="num text-right font-semibold">{ksh(po.amount - po.received)}</TD>
                  <TD>
                    <Status>{po.status}</Status>
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
