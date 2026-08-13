import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, Timeline } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/refunds")({
  head: () => ({
    meta: [
      { title: "Refunds — Seramet" },
      { name: "description", content: "High-risk refund workflow with reason capture, approval chain and payout method." },
      { property: "og:title", content: "Refunds — Seramet" },
      { property: "og:description", content: "Refund requests, approvals and payout tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Refunds,
});

const rows = [
  { id: "RF-0184", order: "#1798", customer: "Walk-in", method: "M-Pesa", amount: 4200, by: "Joan A.", status: "Pending" },
  { id: "RF-0183", order: "#1731", customer: "Sarah Njeri", method: "M-Pesa", amount: 900, by: "Amina W.", status: "Approved" },
  { id: "RF-0182", order: "#1702", customer: "Peter Kamau", method: "Cash", amount: 1450, by: "Brian O.", status: "Completed" },
  { id: "RF-0181", order: "#1688", customer: "Kelvin Otieno", method: "Card", amount: 1980, by: "Cecilia W.", status: "Rejected" },
];

function Refunds() {
  return (
    <AppShell title="Refunds" subtitle="Sensitive action — every refund requires a reason and manager approval" actions={<><Btn>Export</Btn><Btn variant="danger">Request refund</Btn></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Refunds this month" value={18} delta={-6} invert />
        <Metric label="Refund value" value={42800} money delta={-11.4} invert />
        <Metric label="Refund rate" value="0.9" suffix="% of sales" />
        <Metric label="Awaiting approval" value={1} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead title="Refund requests" sub="Approval required above KSh 1,000" />
          <DataTable cols={["Refund", "Order", "Customer", "Method", { l: "Amount", r: true }, "Requested by", "Status"]}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{r.id}</TD>
                <TD className="num text-muted-foreground">{r.order}</TD>
                <TD>{r.customer}</TD>
                <TD>{r.method}</TD>
                <TD className="num text-right font-semibold">{ksh(r.amount)}</TD>
                <TD className="text-muted-foreground">{r.by}</TD>
                <TD><Status>{r.status}</Status></TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead title="RF-0184" sub="Order #1798 · Westlands · KSh 4,200" right={<Status>Pending</Status>} />
          <div className="space-y-2 border-b border-border px-4 py-3 text-[13px]">
            <div className="text-muted-foreground">Reason</div>
            <p>Cold food complaint escalated by the floor supervisor. Customer declined a replacement dish.</p>
          </div>
          <Timeline items={[["Requested", "Joan A. · 11:38"], ["Supervisor endorsed", "Joan A. · 11:44"], ["Awaiting GM approval", "Pending"]]} />
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <Btn variant="danger" className="flex-1">Reject</Btn>
            <Btn variant="primary" className="flex-1">Approve refund</Btn>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
