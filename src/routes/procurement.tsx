import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement — Seramet" },
      { name: "description", content: "Purchase orders, receiving, supplier performance and payables in one flow." },
      { property: "og:title", content: "Procurement — Seramet" },
      { property: "og:description", content: "Purchase orders, receiving and supplier performance." },
    ],
  }),
  component: Procurement,
});

const poLines = [
  { item: "Beef Boneless", qty: "40 kg", cost: 620 },
  { item: "Chicken Whole", qty: "25 kg", cost: 480 },
  { item: "Goat Meat", qty: "15 kg", cost: 720 },
];

const suppliers = [
  { s: "Main Meat Supplier", spend: 842000, out: 68400, otd: 88, rating: "Attention" },
  { s: "Samwest", spend: 612400, out: 0, otd: 96, rating: "Healthy" },
  { s: "Muthurwa Groceries", spend: 318200, out: 42800, otd: 74, rating: "Critical" },
  { s: "Packaging Supplier", spend: 148600, out: 31600, otd: 92, rating: "Healthy" },
];

function Procurement() {
  const total = poLines.reduce((s, l) => s + l.cost * parseFloat(l.qty), 0);
  return (
    <AppShell
      title="Procurement"
      subtitle="8 open purchase orders · 3 awaiting approval"
      actions={<><Btn>Receiving</Btn><Btn variant="primary">New purchase order</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Open POs" value={8} />
        <Metric label="Awaiting approval" value={3} />
        <Metric label="Deliveries expected" value={5} />
        <Metric label="Supplier payables" value={299000} money delta={9.1} invert />
        <Metric label="Price increases" value={2} />
        <Metric label="Late deliveries" value={1} delta={-50} invert />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead title="PO-2026-0182" sub="Main Meat Supplier · Westlands · expected 14 Aug" right={<Status>Pending</Status>} />
          <table className="w-full">
            <thead><tr><TH>Item</TH><TH className="text-right">Quantity</TH><TH className="text-right">Unit cost</TH><TH className="text-right">Line total</TH></tr></thead>
            <tbody>
              {poLines.map((l) => (
                <tr key={l.item}>
                  <TD className="font-semibold">{l.item}</TD>
                  <TD className="num text-right">{l.qty}</TD>
                  <TD className="num text-right">{ksh(l.cost)}</TD>
                  <TD className="num text-right font-semibold">{ksh(l.cost * parseFloat(l.qty))}</TD>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="text-[13px] text-muted-foreground">
              Total <span className="num text-[16px] font-bold text-foreground">{ksh(total)}</span>
            </div>
            <div className="flex gap-2">
              <Btn>Reject</Btn>
              <Btn>Save draft</Btn>
              <Btn variant="primary">Approve</Btn>
            </div>
          </div>
          <ol className="space-y-3 border-t border-border px-4 py-4 text-[12px]">
            {[
              ["Draft created", "Kelvin M. · 10:12"],
              ["Submitted for approval", "Kelvin M. · 12:18"],
              ["Awaiting GM approval", "Pending"],
            ].map(([t, m]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div><div className="font-semibold">{t}</div><div className="text-muted-foreground">{m}</div></div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel>
          <PanelHead title="Supplier performance" sub="Last 90 days" />
          <table className="w-full">
            <thead><tr><TH>Supplier</TH><TH className="text-right">Spend</TH><TH className="text-right">On-time</TH><TH>Status</TH></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.s}>
                  <TD className="font-semibold">{s.s}</TD>
                  <TD className="num text-right">{ksh(s.spend)}</TD>
                  <TD className="num text-right">{s.otd}%</TD>
                  <TD><Status>{s.rating}</Status></TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </AppShell>
  );
}