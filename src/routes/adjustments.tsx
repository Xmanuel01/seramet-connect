import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/adjustments")({
  head: () => ({
    meta: [
      { title: "Stock Adjustments - Seramet" },
      {
        name: "description",
        content: "Controlled stock adjustments with mandatory reason codes and manager approval.",
      },
      { property: "og:title", content: "Stock Adjustments - Seramet" },
      {
        property: "og:description",
        content: "Reason-coded stock adjustments with approval trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Adjustments,
});

const rows = emptyRecords();

function Adjustments() {
  return (
    <AppShell
      title="Stock adjustments"
      subtitle="Every adjustment requires a reason and is fully audited"
      actions={
        <>
          <Btn>Export</Btn>
          <Btn variant="danger">New adjustment</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Adjustments (30d)" value={0} invert />
        <Metric label="Net value impact" value={0} money invert />
        <Metric label="Awaiting approval" value={0} />
        <Metric label="Rejected" value={0} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Adjustment register" sub="Immutable - corrections create new entries" />
        <DataTable
          cols={[
            "Adjustment",
            "Item",
            { l: "Quantity", r: true },
            "Reason",
            "Store",
            "Raised by",
            { l: "Value", r: true },
            "Status",
          ]}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{r.id}</TD>
              <TD>{r.item}</TD>
              <TD
                className={
                  "num text-right font-semibold " +
                  (r.qty.startsWith("+") ? "text-success" : "text-danger")
                }
              >
                {r.qty}
              </TD>
              <TD className="text-muted-foreground">{r.reason}</TD>
              <TD className="text-muted-foreground">{r.store}</TD>
              <TD>{r.by}</TD>
              <TD className="num text-right">{ksh(r.value)}</TD>
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
