import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/prime-cost")({
  head: () => ({
    meta: [
      { title: "Prime Cost - Seramet" },
      {
        name: "description",
        content: "Weekly restaurant prime cost: theoretical vs actual food cost, beverage cost and labour cost.",
      },
      { property: "og:title", content: "Prime Cost - Seramet" },
      {
        property: "og:description",
        content: "COGS plus labour as a percentage of sales, the single most important restaurant number.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrimeCost,
});

const cogs: [string, number, number, number][] = [
  ["Opening inventory", 1322000, 0, 0],
  ["Purchases", 1284600, 0, 0],
  ["Transfers in / out", -18400, 0, 0],
  ["Wastage and breakage", -42800, 0, 0],
  ["Staff meals", -21600, 0, 0],
  ["Closing inventory", -1161400, 0, 0],
];

const weeks = [
  { week: "Wk 29", sales: 968400, food: 31.2, bev: 22.4, labour: 24.8, status: "Healthy" },
  { week: "Wk 30", sales: 1024800, food: 32.8, bev: 23.1, labour: 25.6, status: "Healthy" },
  { week: "Wk 31", sales: 1108200, food: 34.6, bev: 24.4, labour: 26.1, status: "Attention" },
  { week: "Wk 32", sales: 1027200, food: 33.0, bev: 23.6, labour: 25.4, status: "Healthy" },
];

const variances = [
  { item: "Beef boneless", theoretical: 184600, actual: 201400, reason: "Portion drift on Nyama Choma" },
  { item: "Cooking oil", theoretical: 42800, actual: 51200, reason: "Fryer not filtered daily" },
  { item: "Soft drinks", theoretical: 96400, actual: 98100, reason: "Within tolerance" },
  { item: "Chicken whole", theoretical: 128400, actual: 124800, reason: "Yield better than recipe" },
];

function PrimeCost() {
  const { branchLabel } = useAppContext();
  const cogsTotal = cogs.reduce((sum, row) => sum + row[1], 0);
  return (
    <AppShell
      title="Prime cost"
      subtitle={`Cost of sales and labour against revenue  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Weekly view</Btn>
          <Btn variant="primary">Post COGS journal</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Food cost" value={33.0} suffix="%" invert />
        <Metric label="Beverage cost" value={23.6} suffix="%" invert />
        <Metric label="Labour cost" value={25.4} suffix="%" invert />
        <Metric label="Prime cost" value={58.4} suffix="%" invert />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Cost of goods sold build-up"
          sub="Inventory movement converted into a cost of sales posting"
          right={<Status>Ready to post</Status>}
        />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Component</TH>
              <TH className="text-right">Amount</TH>
            </tr>
          </thead>
          <tbody>
            {cogs.map(([label, amount]) => (
              <tr key={label} className="hover:bg-secondary/40">
                <TD className="font-semibold">{label}</TD>
                <TD className="num text-right">{ksh(amount)}</TD>
              </tr>
            ))}
            <tr className="bg-secondary/50">
              <TD className="font-bold">Cost of sales</TD>
              <TD className="num text-right font-bold">{ksh(cogsTotal)}</TD>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel className="mt-4">
        <PanelHead title="Weekly trend" sub="Prime cost target is 60% of sales" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Week</TH>
              <TH className="text-right">Sales</TH>
              <TH className="text-right">Food %</TH>
              <TH className="text-right">Beverage %</TH>
              <TH className="text-right">Labour %</TH>
              <TH className="text-right">Prime %</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {weeks.map((row) => (
              <tr key={row.week} className="hover:bg-secondary/40">
                <TD className="font-semibold">{row.week}</TD>
                <TD className="num text-right">{ksh(row.sales)}</TD>
                <TD className="num text-right">{row.food}%</TD>
                <TD className="num text-right">{row.bev}%</TD>
                <TD className="num text-right">{row.labour}%</TD>
                <TD className="num text-right font-semibold">
                  {(row.food + row.labour).toFixed(1)}%
                </TD>
                <TD>
                  <Status>{row.status}</Status>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className="mt-4">
        <PanelHead
          title="Theoretical vs actual usage"
          sub="Recipe cost against measured consumption, with the accountable reason"
        />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Item</TH>
              <TH className="text-right">Theoretical</TH>
              <TH className="text-right">Actual</TH>
              <TH className="text-right">Variance</TH>
              <TH>Reason</TH>
            </tr>
          </thead>
          <tbody>
            {variances.map((row) => (
              <tr key={row.item} className="hover:bg-secondary/40">
                <TD className="font-semibold">{row.item}</TD>
                <TD className="num text-right text-muted-foreground">{ksh(row.theoretical)}</TD>
                <TD className="num text-right">{ksh(row.actual)}</TD>
                <TD className="num text-right font-semibold">{ksh(row.actual - row.theoretical)}</TD>
                <TD className="text-muted-foreground">{row.reason}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}