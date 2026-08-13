import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/receipts")({
  head: () => ({
    meta: [
      { title: "Receipts — Seramet" },
      { name: "description", content: "Every receipt issued across tills and branches, with reprint and delivery options." },
      { property: "og:title", content: "Receipts — Seramet" },
      { property: "og:description", content: "Till receipts with reprint, WhatsApp and email delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Receipts,
});

const rows = [
  { id: "RC-018422", order: "#1842", time: "12:42 PM", till: "Till 1", cashier: "Cecilia W.", amount: 4850, pay: "M-Pesa", status: "Paid" },
  { id: "RC-018411", order: "#1841", time: "12:38 PM", till: "Till 1", cashier: "Joan A.", amount: 1980, pay: "Card", status: "Paid" },
  { id: "RC-018381", order: "#1838", time: "12:28 PM", till: "Till 2", cashier: "Amina W.", amount: 760, pay: "Cash", status: "Paid" },
  { id: "RC-018372", order: "#1837", time: "12:26 PM", till: "Online", cashier: "System", amount: 900, pay: "M-Pesa", status: "Paid" },
  { id: "RC-018351", order: "#1835", time: "12:17 PM", till: "Till 2", cashier: "Amina W.", amount: 1450, pay: "Cash", status: "Reprinted" },
];

function Receipts() {
  return (
    <AppShell title="Receipts" subtitle="Issued today · Westlands and Ngong Road" actions={<><Btn>Export</Btn><Btn variant="primary">Reprint</Btn></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Receipts today" value={308} delta={4.1} />
        <Metric label="Value" value={184420} money delta={8.4} />
        <Metric label="Reprints" value={6} note="requires reason" />
        <Metric label="Digital delivery" value="41%" note="WhatsApp + email" />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Receipt register" sub="Immutable log — reprints are audited" right={<SearchInput placeholder="Search receipt or order…" />} />
        <DataTable cols={["Receipt", "Order", "Time", "Till", "Cashier", { l: "Amount", r: true }, "Method", "Status", "Send"]}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{r.id}</TD>
              <TD className="num text-muted-foreground">{r.order}</TD>
              <TD className="text-muted-foreground">{r.time}</TD>
              <TD>{r.till}</TD>
              <TD>{r.cashier}</TD>
              <TD className="num text-right font-semibold">{ksh(r.amount)}</TD>
              <TD>{r.pay}</TD>
              <TD><Status>{r.status}</Status></TD>
              <TD><div className="flex gap-1.5 text-[12px] font-semibold text-primary"><button>Print</button><button>WhatsApp</button><button>Email</button></div></TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
