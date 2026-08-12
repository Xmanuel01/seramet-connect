import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customer 360 — Seramet" },
      { name: "description", content: "Customer profiles, loyalty tiers, spend history and complaint tracking." },
      { property: "og:title", content: "Customer 360 — Seramet" },
      { property: "og:description", content: "Loyalty, spend history and service recovery in one profile." },
    ],
  }),
  component: Customers,
});

const history = [
  { id: "#1841", date: "12 Aug", branch: "Westlands", channel: "Delivery", amount: 1980, status: "Paid" },
  { id: "#1712", date: "05 Aug", branch: "Westlands", channel: "Dine-In", amount: 4620, status: "Completed" },
  { id: "#1655", date: "29 Jul", branch: "Ngong Road", channel: "Take Away", amount: 1240, status: "Completed" },
  { id: "#1590", date: "21 Jul", branch: "Westlands", channel: "Dine-In", amount: 3860, status: "Completed" },
];

function Customers() {
  return (
    <AppShell
      title="Kelvin Otieno"
      subtitle="+254 712 448 210 · kelvin.o@example.com · Gold tier · Westlands regular"
      actions={<><Btn>Message</Btn><Btn>Adjust points</Btn><Btn variant="primary">New order</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Lifetime value" value={184600} money delta={11.2} />
        <Metric label="Orders" value={64} delta={6} />
        <Metric label="Average order" value={2884} money delta={3.4} />
        <Metric label="Last visit" value="3 days" />
        <Metric label="Outstanding" value={0} money />
        <Metric label="Loyalty points" value={4820} delta={9} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHead title="Order history" sub="Last 4 of 64 orders" right={<Btn>View all</Btn>} />
          <table className="w-full">
            <thead><tr><TH>Order</TH><TH>Date</TH><TH>Branch</TH><TH>Channel</TH><TH className="text-right">Amount</TH><TH>Status</TH></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="hover:bg-secondary/50">
                  <TD className="num font-semibold">{h.id}</TD>
                  <TD className="text-muted-foreground">{h.date}</TD>
                  <TD className="text-muted-foreground">{h.branch}</TD>
                  <TD className="text-muted-foreground">{h.channel}</TD>
                  <TD className="num text-right font-semibold">{ksh(h.amount)}</TD>
                  <TD><Status>{h.status}</Status></TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <PanelHead title="Service history" sub="1 open complaint" />
          <ul className="divide-y divide-border">
            <li className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold">CMP-0114 · Cold food</span>
                <Status>Attention</Status>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">Order #1798 · Westlands · assigned to Joan A. · 1 day old</p>
            </li>
            <li className="px-4 py-3 text-[12px] text-muted-foreground">
              Feedback average <span className="num font-semibold text-foreground">4.5 / 5</span> across 18 reviews.
            </li>
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}