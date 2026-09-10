import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useAppContext } from "@/lib/app-context";

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

const runs = emptyRecords();

function Production() {
  const { branchLabel } = useAppContext();
  return (
    <AppShell
      title="Production"
      subtitle={`Kitchen batch runs - ${branchLabel}`}
      actions={
        <>
          <Btn>Print sheet</Btn>
          <Btn variant="primary">New production run</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Runs today" value={0} />
        <Metric label="Output value" value={0} money />
        <Metric label="Yield variance" value="0" suffix="%" />
        <Metric label="Runs in progress" value={0} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Production runs" sub="Yield exceptions follow configured review rules" />
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
