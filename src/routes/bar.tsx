import { createFileRoute } from "@tanstack/react-router";
import { Martini } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { SerametPrintService } from "@/lib/seramet-print-service";
import { formatTime } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useOperationalMenu } from "@/hooks/use-operational-menu";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import {
  TransactionEngine,
  type ProductionStatus,
  type TransactionOrder,
} from "@/lib/transaction-engine";

export const Route = createFileRoute("/bar")({
  head: () => ({
    meta: [
      { title: "Bar - Seramet" },
      {
        name: "description",
        content: "Bar station queue, drink production, stock pressure and printer routing.",
      },
    ],
  }),
  component: BarModule,
});

type BarTicket = {
  id: string;
  orderId: string;
  table: string;
  time: string;
  mins: number;
  items: string[];
  state: ProductionStatus;
};

function BarModule() {
  const { activeTenantId, branch, branchId, currentUser, matchesBranch, role } = useAppContext();
  const profile = SerametPrintService.getBranchHardwareProfile(branch);
  const { state, mutate, backendStatus } = useTransactionEngine();
  const { items: menuItems } = useOperationalMenu({
    tenantId: activeTenantId,
    branchId,
    userId: currentUser.id,
    userName: currentUser.name,
    role,
  });
  const drinks = menuItems.filter(
    (product) =>
      product.productionStation === "BAR" && product.branchAvailability?.[branch] !== false,
  );
  const barTickets = state.orders
    .filter((order) => matchesBranch(order.branchId ?? order.branch))
    .filter((order) => !["CANCELLED", "PAID", "REFUNDED"].includes(order.status))
    .map(toBarTicket)
    .filter((ticket): ticket is BarTicket => Boolean(ticket))
    .sort((a, b) => b.mins - a.mins);
  const barPrinter = profile.printers.find((printer) => printer.roles.includes("BAR"));

  const updateTicket = (ticket: BarTicket, next: ProductionStatus) => {
    void mutate("setProductionStationStatus", {
      orderId: ticket.orderId,
      station: "BAR",
      status: next,
    });
  };

  return (
    <AppShell
      title="Bar"
      subtitle={`Bar station and routing - ${branch}`}
      actions={
        <>
          <Btn>Print prep list</Btn>
          <Btn variant="primary">New drink ticket</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Drink items" value={drinks.length} />
        <Metric label="Open tickets" value={barTickets.length} />
        <Metric label="Printer queue" value={barPrinter?.queue ?? 0} />
        <Metric label="Failures" value={barPrinter?.failures ?? 0} invert />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Bar queue"
            sub={`Drink tickets route through the BAR production station - ${backendStatus}`}
            right={<Martini className="h-4 w-4 text-primary" />}
          />
          <DataTable cols={["Ticket", "Table", "Time", "Age", "Items", "Status"]}>
            {barTickets.map((ticket) => (
              <tr key={ticket.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{ticket.orderId}</TD>
                <TD>{ticket.table}</TD>
                <TD className="num text-muted-foreground">{ticket.time}</TD>
                <TD className="num text-muted-foreground">{ticket.mins} min</TD>
                <TD>{ticket.items.join(", ")}</TD>
                <TD>
                  <div className="flex flex-wrap items-center gap-2">
                    <Status>{ticket.state}</Status>
                    {ticket.state === "NEW" && (
                      <button
                        className="text-[11px] font-semibold text-primary hover:underline"
                        onClick={() => updateTicket(ticket, "PREPARING")}
                      >
                        Start
                      </button>
                    )}
                    {ticket.state === "PREPARING" && (
                      <button
                        className="text-[11px] font-semibold text-primary hover:underline"
                        onClick={() => updateTicket(ticket, "READY")}
                      >
                        Ready
                      </button>
                    )}
                    {ticket.state === "READY" && (
                      <button
                        className="text-[11px] font-semibold text-primary hover:underline"
                        onClick={() => updateTicket(ticket, "SERVED")}
                      >
                        Served
                      </button>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
            {barTickets.length === 0 && (
              <tr>
                <TD className="text-muted-foreground" colSpan={6}>
                  No active bar tickets for this branch.
                </TD>
              </tr>
            )}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead
            title="Bar hardware"
            sub="Capability and printer mapping are branch-specific"
          />
          <div className="space-y-3 p-4 text-[13px]">
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{barPrinter?.name ?? "No BAR printer mapped"}</span>
                <Status>{barPrinter?.connection ?? "Warning"}</Status>
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                Mode {profile.kitchenMode.replaceAll("_", " ")}
              </div>
            </div>
            <div className="grid gap-2">
              {drinks.map((drink) => (
                <div
                  key={drink.id}
                  className="flex items-center justify-between rounded-md bg-card px-3 py-2 text-[12px]"
                >
                  <span className="font-semibold">{drink.name}</span>
                  <span className="text-muted-foreground">{drink.prep} min</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function toBarTicket(order: TransactionOrder): BarTicket | null {
  const lines = order.lines.filter((line) => line.productionStation === "BAR");
  if (lines.length === 0) return null;
  const statuses = lines.map((line) => line.productionStatus ?? "NEW");
  const state: ProductionStatus = statuses.every((status) => status === "SERVED")
    ? "SERVED"
    : statuses.every((status) => status === "READY" || status === "SERVED")
      ? "READY"
      : statuses.some((status) => status === "PREPARING")
        ? "PREPARING"
        : "NEW";
  const created = new Date(order.createdAt);
  const mins = Number.isFinite(created.getTime())
    ? Math.max(0, Math.floor((Date.now() - created.getTime()) / 60000))
    : 0;
  return {
    id: `${order.id}:BAR`,
    orderId: order.id,
    table: order.table ?? order.customer ?? order.id,
    time: formatTime(created),
    mins,
    items: lines.map((line) => `${line.name} x${line.quantity}`),
    state,
  };
}
