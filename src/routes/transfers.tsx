import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { emptyRecords } from "@/lib/empty-records";

export const Route = createFileRoute("/transfers")({
  head: () => ({
    meta: [
      { title: "Stock Transfers - Seramet" },
      {
        name: "description",
        content:
          "Move stock between stores and branches with a controlled request, approval and receipt flow.",
      },
      { property: "og:title", content: "Stock Transfers - Seramet" },
      {
        property: "og:description",
        content: "Inter-branch stock transfers with full activity trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Transfers,
});

const transfers = emptyRecords<{
  id: string;
  from: string;
  to: string;
  items: number;
  value: number;
  status: string;
}>();

const lines = emptyRecords<{ item: string; qty: string }>();

function Transfers() {
  return (
    <AppShell
      title="Stock transfers"
      subtitle="Between stores and branches"
      actions={
        <>
          <Btn>Export</Btn>
          <Btn variant="primary">New transfer</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open transfers" value={0} />
        <Metric label="In transit" value={0} />
        <Metric label="Awaiting approval" value={0} />
        <Metric label="Transferred value (30d)" value={0} money />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead title="All transfers" />
          <DataTable
            cols={[
              "Transfer",
              "From",
              "To",
              { l: "Items", r: true },
              { l: "Value", r: true },
              "Status",
            ]}
          >
            {transfers.map((t) => (
              <tr key={t.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{t.id}</TD>
                <TD>{t.from}</TD>
                <TD>{t.to}</TD>
                <TD className="num text-right">{t.items}</TD>
                <TD className="num text-right font-semibold">{ksh(t.value)}</TD>
                <TD>
                  <Status>{t.status.toLowerCase() === "in transit" ? "Pending" : t.status}</Status>
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead
            title="Transfer details"
            sub="Select a transfer to view its movement history"
          />
          <DataTable cols={["Item", { l: "Quantity", r: true }]}>
            {lines.map((l) => (
              <tr key={l.item}>
                <TD>{l.item}</TD>
                <TD className="num text-right font-semibold">{l.qty}</TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>
    </AppShell>
  );
}
