import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh, orders } from "@/data/mock";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Seramet" },
      { name: "description", content: "Every dine-in, take away, delivery and online order with payment and status." },
      { property: "og:title", content: "Orders — Seramet" },
      { property: "og:description", content: "All channels, payments and order statuses in one table." },
    ],
  }),
  component: Orders,
});

function Orders() {
  return (
    <AppShell
      title="Orders"
      subtitle="308 orders today across 2 branches"
      actions={<><Btn>Saved views</Btn><Btn>Export</Btn><Btn variant="primary">New order</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Orders" value={308} delta={4.1} />
        <Metric label="Net sales" value={184420} money delta={8.4} />
        <Metric label="Unpaid bills" value={11360} money />
        <Metric label="Cancelled" value={4} delta={-20} invert />
      </div>
      <Panel className="mt-4">
        <PanelHead title="All orders" sub="Live · refreshed 20 seconds ago" right={<Btn>Columns</Btn>} />
        <div className="border-b border-border px-4 py-3">
          <Chips items={["Date: Today", "Branch: All", "Channel: All", "Status: Any"]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr>
                <TH>Order</TH><TH>Time</TH><TH>Customer / table</TH><TH>Channel</TH><TH>Branch</TH>
                <TH>Employee</TH><TH className="text-right">Amount</TH><TH>Payment</TH><TH>Status</TH><TH />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-secondary/50">
                  <TD className="num font-semibold">{o.id}</TD>
                  <TD className="num text-muted-foreground">{o.time}</TD>
                  <TD className="font-medium">{o.who}</TD>
                  <TD className="text-muted-foreground">{o.channel}</TD>
                  <TD className="text-muted-foreground">{o.branch}</TD>
                  <TD className="text-muted-foreground">{o.emp}</TD>
                  <TD className="num text-right font-semibold">{ksh(o.amount)}</TD>
                  <TD><Status>{o.pay === "Pending" ? "Pending" : o.pay}</Status></TD>
                  <TD><Status>{o.status}</Status></TD>
                  <TD className="text-right text-muted-foreground">···</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}