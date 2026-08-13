import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput, Toolbar } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — Seramet" },
      { name: "description", content: "Issue, track and settle customer invoices with ageing and payment status." },
      { property: "og:title", content: "Invoices — Seramet" },
      { property: "og:description", content: "Customer invoices, ageing and settlement tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Invoices,
});

const rows = [
  { id: "INV-2026-0412", customer: "Acme Corporate Lunch", branch: "Westlands", issued: "01 Aug", due: "15 Aug", amount: 184600, paid: 100000, status: "Partial" },
  { id: "INV-2026-0411", customer: "Kelvin Otieno", branch: "Westlands", issued: "31 Jul", due: "14 Aug", amount: 24800, paid: 24800, status: "Paid" },
  { id: "INV-2026-0410", customer: "Nairobi Tech Hub", branch: "Ngong Road", issued: "28 Jul", due: "11 Aug", amount: 96400, paid: 0, status: "Pending" },
  { id: "INV-2026-0409", customer: "Sarah Njeri", branch: "Westlands", issued: "24 Jul", due: "07 Aug", amount: 12400, paid: 0, status: "Late" },
  { id: "INV-2026-0408", customer: "Riverside Events", branch: "Ngong Road", issued: "18 Jul", due: "01 Aug", amount: 248000, paid: 248000, status: "Paid" },
];

function Invoices() {
  return (
    <AppShell title="Invoices" subtitle="Customer billing, ageing and settlement" actions={<><Btn>Export</Btn><Btn variant="primary">New invoice</Btn></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Invoiced this month" value={566200} money delta={12.4} />
        <Metric label="Outstanding" value={193200} money delta={4.8} invert />
        <Metric label="Overdue" value={12400} money delta={-22} invert />
        <Metric label="Avg days to pay" value="11.4" suffix=" days" />
      </div>
      <Panel className="mt-4">
        <PanelHead title="All invoices" sub="5 of 128 invoices" right={<SearchInput placeholder="Search invoice or customer…" />} />
        <div className="px-4 pt-3"><Chips items={["Branch: All", "Status: Open", "Period: This month"]} /></div>
        <Toolbar />
        <DataTable cols={["Invoice", "Customer", "Branch", "Issued", "Due", { l: "Amount", r: true }, { l: "Outstanding", r: true }, "Status"]}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{r.id}</TD>
              <TD>{r.customer}</TD>
              <TD className="text-muted-foreground">{r.branch}</TD>
              <TD className="text-muted-foreground">{r.issued}</TD>
              <TD className="text-muted-foreground">{r.due}</TD>
              <TD className="num text-right">{ksh(r.amount)}</TD>
              <TD className="num text-right font-semibold">{ksh(r.amount - r.paid)}</TD>
              <TD><Status>{r.status}</Status></TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
