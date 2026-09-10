import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/Tabs";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers - Seramet" },
      {
        name: "description",
        content: "Authoritative supplier, purchasing and payable performance records.",
      },
    ],
  }),
  component: Suppliers,
});

function Suppliers() {
  const control = useInventoryControlCentre(true);
  const suppliers = control.data.flatMap((branch) =>
    branch.procurement.suppliers.map((supplier) => ({ ...supplier, branchId: branch.branchId })),
  );
  const outstanding = suppliers.reduce(
    (total, supplier) => total + Number(supplier.outstanding_minor),
    0,
  );
  const openOrders = suppliers.reduce((total, supplier) => total + Number(supplier.order_count), 0);

  return (
    <AppShell
      title="Suppliers"
      subtitle="Supplier master and evidence from authoritative procurement records"
      actions={<Btn onClick={() => void control.refresh()}>Refresh</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Suppliers" value={suppliers.length} />
        <Metric label="Outstanding" value={outstanding / 100} money />
        <Metric label="Purchase orders" value={openOrders} />
        <Metric
          label="Data status"
          value={control.status === "ready" ? "Current" : control.status}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Supplier directory"
          sub={control.error || "Purchases, terms, lead time and receipt history"}
        />
        <DataTable
          cols={[
            "Supplier",
            "Code",
            "Branch",
            "Lead time",
            "Terms",
            { l: "Ordered", r: true },
            { l: "Outstanding", r: true },
            "Status",
          ]}
        >
          {suppliers.map((supplier) => (
            <tr key={`${supplier.branchId}:${supplier.id}`} className="hover:bg-secondary/50">
              <TD className="font-semibold">{supplier.name}</TD>
              <TD className="num text-muted-foreground">{supplier.code}</TD>
              <TD className="num text-muted-foreground">{supplier.branchId}</TD>
              <TD className="num">{supplier.lead_time_days} days</TD>
              <TD className="num">{supplier.payment_terms_days} days</TD>
              <TD className="num text-right">{ksh(Number(supplier.ordered_minor) / 100)}</TD>
              <TD className="num text-right">{ksh(Number(supplier.outstanding_minor) / 100)}</TD>
              <TD>
                <Status>{supplier.received_count > 0 ? "Active" : "New"}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
