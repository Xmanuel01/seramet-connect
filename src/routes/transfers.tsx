import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, Timeline } from "@/components/app/Tabs";

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

const transfers = [
  {
    id: "TRF-0344",
    from: "Westlands Main Store",
    to: "Ngong Main Store",
    items: 4,
    value: 18400,
    status: "In Transit",
  },
  {
    id: "TRF-0343",
    from: "Westlands Main Store",
    to: "Westlands Kitchen",
    items: 7,
    value: 9200,
    status: "Completed",
  },
  {
    id: "TRF-0342",
    from: "Ngong Main Store",
    to: "Westlands Main Store",
    items: 2,
    value: 6400,
    status: "Pending",
  },
  {
    id: "TRF-0341",
    from: "Westlands Main Store",
    to: "Ngong Main Store",
    items: 3,
    value: 12800,
    status: "Completed",
  },
];

const lines = [
  { item: "Beef Boneless", qty: "10 kg" },
  { item: "Ajab Flour", qty: "2 bales" },
  { item: "Cooking Oil", qty: "8 L" },
  { item: "Takeaway Boxes", qty: "100 pcs" },
];

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
        <Metric label="Open transfers" value={5} />
        <Metric label="In transit" value={2} />
        <Metric label="Awaiting approval" value={1} />
        <Metric label="Transferred value (30d)" value={184200} money delta={7.2} />
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
                <TD className="num text-right font-semibold">KSh {t.value.toLocaleString()}</TD>
                <TD>
                  <Status>{t.status.toLowerCase() === "in transit" ? "Pending" : t.status}</Status>
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead
            title="TRF-0344"
            sub="Westlands Main to Ngong Main"
            right={<Status>Pending</Status>}
          />
          <DataTable cols={["Item", { l: "Quantity", r: true }]}>
            {lines.map((l) => (
              <tr key={l.item}>
                <TD>{l.item}</TD>
                <TD className="num text-right font-semibold">{l.qty}</TD>
              </tr>
            ))}
          </DataTable>
          <Timeline
            items={[
              ["Draft created", "Kelvin M.  -  08:02"],
              ["Requested", "Kelvin M.  -  08:14"],
              ["Approved", "Joan A.  -  08:41"],
              ["In transit", "Dispatched 09:05"],
              ["Received", "Pending"],
            ]}
          />
          <div className="border-t border-border p-3">
            <Btn variant="primary" className="w-full">
              Confirm receipt
            </Btn>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
