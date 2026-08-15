import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Report Centre - Seramet" },
      {
        name: "description",
        content: "Pinned, recent and categorised reports across sales, stock, finance and people.",
      },
      { property: "og:title", content: "Report Centre - Seramet" },
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
  {
    name: "Procurement",
    n: 8,
    items: ["Supplier performance", "Purchase spend", "Late deliveries"],
  },
  { name: "Management", n: 12, items: ["Board pack", "Branch scorecard", "Risk register"] },
];

const preview = [
  { branch: "Westlands", sales: 121480, orders: 172, margin: "61%", state: "Healthy" },
  { branch: "Ngong Road", sales: 92940, orders: 136, margin: "56%", state: "Attention" },
];

function Reports() {
  const { branch, branchLabel, matchesBranch } = useAppContext();
  const scopedPreview = preview.filter((row) => matchesBranch(row.branch));
  const totalSales = scopedPreview.reduce((sum, row) => sum + row.sales, 0);
  const totalOrders = scopedPreview.reduce((sum, row) => sum + row.orders, 0);
  const avgOrder = totalOrders ? Math.round(totalSales / totalOrders) : 0;
  return (
    <AppShell
      title="Report centre"
      subtitle={`80 reports - 6 pinned  -  ${branchLabel}`}
      actions={<Btn variant="primary">Build report</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Pinned" value={6} />
        <Metric label="Recently used" value={12} />
        <Metric label="Scheduled" value={9} />
        <Metric label="Exports today" value={17} delta={24} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Report shell preview"
            sub="Daily sales summary"
            right={<Btn>Refresh</Btn>}
          />
          <div className="border-b border-border px-4 py-3">
            <Chips items={["Date: Today", `Branch: ${branch}`, "Channel: All"]} />
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
            <Metric label="Net sales" value={totalSales} money delta={8.4} />
            <Metric label="Orders" value={totalOrders} delta={4.1} />
            <Metric label="Average order" value={avgOrder} money />
            <Metric
              label="Gross margin"
              value={scopedPreview.length === 1 ? Number.parseInt(scopedPreview[0].margin) : 59}
              suffix="%"
            />
          </div>
          <div className="grid gap-3 p-3 md:hidden">
            {scopedPreview.map((r) => (
              <article
                key={r.branch}
                className="rounded-lg border border-border bg-card p-3 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-bold">{r.branch}</div>
                    <div className="num mt-1 text-[16px] font-bold">{ksh(r.sales)}</div>
                  </div>
                  <Status>{r.state}</Status>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Orders </span>
                    <span className="num font-semibold">{r.orders}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Margin </span>
                    <span className="num font-semibold">{r.margin}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <TH>Branch</TH>
                  <TH className="text-right">Sales</TH>
                  <TH className="text-right">Orders</TH>
                  <TH className="text-right">Margin</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {scopedPreview.map((r) => (
                  <tr key={r.branch} className="hover:bg-secondary/50">
                    <TD className="font-semibold">{r.branch}</TD>
                    <TD className="num text-right font-semibold">{ksh(r.sales)}</TD>
                    <TD className="num text-right">{r.orders}</TD>
                    <TD className="num text-right">{r.margin}</TD>
                    <TD>
                      <Status>{r.state}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            <Btn>Export</Btn>
            <Btn>Share</Btn>
            <Btn variant="primary">Save view</Btn>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Pinned and recent" sub="Fast access for managers" />
          <ul className="divide-y divide-border">
            {[
              "Profit & loss",
              "Stock valuation",
              "Daily sales summary",
              "Attendance summary",
              "Supplier performance",
            ].map((item, index) => (
              <li
                key={item}
                className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-secondary/50"
              >
                <span className="font-semibold">{item}</span>
                <span className="text-[11px] text-muted-foreground">
                  {index < 3 ? "Pinned" : "Recent"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cats.map((c) => (
          <Panel key={c.name}>
            <PanelHead title={c.name} sub={`${c.n} reports`} />
            <ul className="divide-y divide-border">
              {c.items.map((i) => (
                <li
                  key={i}
                  className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-secondary/50"
                >
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
