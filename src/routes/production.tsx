import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";

export const Route = createFileRoute("/production")({
  head: () => ({
    meta: [
      { title: "Production - Seramet" },
      {
        name: "description",
        content: "Batch production runs, yields and variance against recipe expectations.",
      },
      { property: "og:title", content: "Production - Seramet" },
      { property: "og:description", content: "Batch runs, yields and production variance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Production,
});

const runs = [
  {
    id: "PR-0412",
    item: "Beef Pilau (bulk)",
    planned: 40,
    produced: 38,
    unit: "portions",
    variance: -5,
    chef: "Musa K.",
    status: "Completed",
  },
  {
    id: "PR-0413",
    item: "Chapati dough",
    planned: 200,
    produced: 200,
    unit: "pcs",
    variance: 0,
    chef: "Peter K.",
    status: "Completed",
  },
  {
    id: "PR-0414",
    item: "Passion juice concentrate",
    planned: 30,
    produced: 27,
    unit: "L",
    variance: -10,
    chef: "Faith N.",
    status: "Attention",
  },
  {
    id: "PR-0415",
    item: "Bhajia batter",
    planned: 15,
    produced: 0,
    unit: "kg",
    variance: 0,
    chef: "Musa K.",
    status: "Preparing",
  },
];

function Production() {
  return (
    <AppShell
      title="Production"
      subtitle="Kitchen batch runs  -  Westlands"
      actions={
        <>
          <Btn>Print sheet</Btn>
          <Btn variant="primary">New production run</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Runs today" value={9} delta={12} />
        <Metric label="Output value" value={186400} money delta={6.1} />
        <Metric label="Yield variance" value="-4.1" suffix="%" invert delta={-1.4} />
        <Metric label="Runs in progress" value={1} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Production runs" sub="Yield variance beyond 5% is flagged for review" />
        <DataTable
          cols={[
            "Run",
            "Item",
            { l: "Planned", r: true },
            { l: "Produced", r: true },
            "Unit",
            { l: "Variance", r: true },
            "Chef",
            "Status",
          ]}
        >
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{r.id}</TD>
              <TD>{r.item}</TD>
              <TD className="num text-right">{r.planned}</TD>
              <TD className="num text-right">{r.produced}</TD>
              <TD className="text-muted-foreground">{r.unit}</TD>
              <TD
                className={
                  "num text-right font-semibold " +
                  (r.variance < -5
                    ? "text-danger"
                    : r.variance < 0
                      ? "text-warning"
                      : "text-success")
                }
              >
                {r.variance}%
              </TD>
              <TD>{r.chef}</TD>
              <TD>
                <Status>{r.status}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
