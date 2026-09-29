import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";
import { useAppContext, useBranchRows } from "@/lib/app-context";

export const Route = createFileRoute("/warehouses")({
  head: () => ({
    meta: [
      { title: "Warehouses - Seramet" },
      {
        name: "description",
        content: "Stores and warehouses with stock value, utilisation and last count date.",
      },
      { property: "og:title", content: "Warehouses - Seramet" },
      { property: "og:description", content: "Store locations, stock value and count status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Warehouses,
});

const stores = [
  {
    name: "Westlands Main Store",
    branch: "Westlands",
    keeper: "Kelvin Mwangi",
    items: 184,
    value: 862400,
    lastCount: "11 Aug",
    status: "Healthy",
  },
  {
    name: "Westlands Kitchen",
    branch: "Westlands",
    keeper: "Musa Kilonzo",
    items: 96,
    value: 184200,
    lastCount: "12 Aug",
    status: "Attention",
  },
  {
    name: "Westlands Bar Store",
    branch: "Westlands",
    keeper: "Joan Achieng",
    items: 62,
    value: 214800,
    lastCount: "09 Aug",
    status: "Healthy",
  },
  {
    name: "Ngong Main Store",
    branch: "Ngong Road",
    keeper: "Faith Nduta",
    items: 148,
    value: 596400,
    lastCount: "04 Aug",
    status: "Critical",
  },
  {
    name: "Ngong Kitchen",
    branch: "Ngong Road",
    keeper: "Peter Kimani",
    items: 84,
    value: 142600,
    lastCount: "12 Aug",
    status: "Healthy",
  },
];

function Warehouses() {
  const { branchLabel } = useAppContext();
  const scopedStores = useBranchRows(stores);
  const totalValue = scopedStores.reduce((sum, row) => sum + row.value, 0);
  return (
    <AppShell
      title="Warehouses & stores"
      subtitle={`${scopedStores.length} storage locations  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Stock count</Btn>
          <Btn variant="primary">New location</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Total stock value" value={totalValue} money delta={3.2} />
        <Metric label="Storage locations" value={scopedStores.length} />
        <Metric
          label="Locations overdue for count"
          value={scopedStores.filter((row) => row.status === "Critical").length}
        />
        <Metric label="Pending transfers" value={2} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Locations" sub="Counts are due every 7 days" />
        <DataTable
          cols={[
            "Location",
            "Branch",
            "Storekeeper",
            { l: "Items", r: true },
            { l: "Stock value", r: true },
            "Last count",
            "Status",
          ]}
        >
          {scopedStores.map((s) => (
            <tr key={s.name} className="hover:bg-secondary/50">
              <TD className="font-semibold">{s.name}</TD>
              <TD className="text-muted-foreground">{s.branch}</TD>
              <TD>{s.keeper}</TD>
              <TD className="num text-right">{s.items}</TD>
              <TD className="num text-right font-semibold">{ksh(s.value)}</TD>
              <TD className="text-muted-foreground">{s.lastCount}</TD>
              <TD>
                <Status>{s.status}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
