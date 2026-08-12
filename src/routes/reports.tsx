import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead } from "@/components/app/ui";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Report Centre — Seramet" },
      { name: "description", content: "Pinned, recent and categorised reports across sales, stock, finance and people." },
      { property: "og:title", content: "Report Centre — Seramet" },
      { property: "og:description", content: "Categorised, pinnable reports for every module." },
    ],
  }),
  component: Reports,
});

const cats = [
  { name: "Sales", n: 18, items: ["Daily sales summary", "Sales by category", "Payment mix"] },
  { name: "Inventory", n: 14, items: ["Stock valuation", "Waste report", "PAR shortfall"] },
  { name: "Finance", n: 21, items: ["Profit & loss", "Balance sheet", "Cash flow"] },
  { name: "Customers", n: 9, items: ["Retention cohort", "Loyalty engagement", "Top customers"] },
  { name: "People", n: 11, items: ["Attendance summary", "Overtime", "Payroll register"] },
  { name: "Kitchen", n: 7, items: ["Ticket times", "Recipe variance", "Prep volumes"] },
];

function Reports() {
  return (
    <AppShell title="Report centre" subtitle="80 reports · 6 pinned" actions={<Btn variant="primary">Build report</Btn>}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cats.map((c) => (
          <Panel key={c.name}>
            <PanelHead title={c.name} sub={`${c.n} reports`} />
            <ul className="divide-y divide-border">
              {c.items.map((i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-secondary/50">
                  {i}
                  <span className="text-[11px] text-muted-foreground">Pin</span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}