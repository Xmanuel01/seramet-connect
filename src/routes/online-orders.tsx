import { createFileRoute } from "@tanstack/react-router";
import { Wifi } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh, orders } from "@/data/mock";
import { useAppContext, useBranchRows } from "@/lib/app-context";

export const Route = createFileRoute("/online-orders")({
  head: () => ({
    meta: [
      { title: "Online Orders - Seramet" },
      {
        name: "description",
        content: "Online order intake, acceptance, fulfilment and channel reconciliation.",
      },
    ],
  }),
  component: OnlineOrders,
});

function OnlineOrders() {
  const { branchLabel } = useAppContext();
  const rows = useBranchRows(orders)
    .filter((order) => order.channel === "Online" || order.channel === "Delivery")
    .map((order, index) => {
      const partner = ["Glovo", "Uber Eats", "Bolt Food"][index % 3]!;
      const settlement = partner === "Uber Eats" ? "Credit / M-Pesa / Cash / Card" : "Credit";
      return {
        ...order,
        partner,
        settlement,
        account: `${partner} receivable`,
        amount: Math.round(order.amount * 1.12),
      };
    });
  const pending = rows.filter(
    (order) => order.status === "Preparing" || order.pay === "Pending",
  ).length;
  const value = rows.reduce((sum, order) => sum + order.amount, 0);

  return (
    <AppShell
      title="Online orders"
      subtitle={`Channel orders routed to assigned branch pricing - ${branchLabel}`}
      actions={<Btn>Sync channels</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Online queue" value={rows.length} />
        <Metric label="Pending action" value={pending} invert />
        <Metric label="Channel value" value={value} money />
        <Metric
          label="Credited orders"
          value={rows.filter((row) => row.settlement.includes("Credit")).length}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Channel intake"
          sub="Glovo, Uber Eats and Bolt Food orders post against partner receivable accounts"
          right={<Wifi className="h-4 w-4 text-primary" />}
        />
        <DataTable
          cols={[
            "Order",
            "Time",
            "Customer",
            "Partner",
            { l: "Online price", r: true },
            "Settlement",
            "Account",
            "Status",
          ]}
        >
          {rows.map((order) => (
            <tr key={order.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{order.id}</TD>
              <TD className="num text-muted-foreground">{order.time}</TD>
              <TD>{order.who}</TD>
              <TD>{order.partner}</TD>
              <TD className="num text-right font-semibold">{ksh(order.amount)}</TD>
              <TD>
                <Status>{order.settlement}</Status>
              </TD>
              <TD className="text-muted-foreground">{order.account}</TD>
              <TD>
                <Status>{order.status}</Status>
              </TD>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <TD className="text-muted-foreground" colSpan={8}>
                Online ordering is enabled, but no channel orders match this branch.
              </TD>
            </tr>
          )}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
