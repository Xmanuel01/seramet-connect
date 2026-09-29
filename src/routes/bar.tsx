import { createFileRoute } from "@tanstack/react-router";
import { Martini } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { products, tickets } from "@/data/mock";
import { SerametPrintService } from "@/lib/seramet-print-service";
import { useAppContext } from "@/lib/app-context";

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

function BarModule() {
  const { branch } = useAppContext();
  const profile = SerametPrintService.getBranchHardwareProfile(branch);
  const drinks = products.filter(
    (product) =>
      product.productionStation === "BAR" && product.branchAvailability?.[branch] !== false,
  );
  const barTickets = tickets.filter((ticket) =>
    ticket.items.some((item) => drinks.some((drink) => item.includes(drink.name))),
  );
  const barPrinter = profile.printers.find((printer) => printer.roles.includes("BAR"));

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
            sub="Drink tickets route through the BAR production station"
            right={<Martini className="h-4 w-4 text-primary" />}
          />
          <DataTable cols={["Ticket", "Table", "Time", "Age", "Items", "Status"]}>
            {barTickets.map((ticket) => (
              <tr key={ticket.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">#{ticket.id}</TD>
                <TD>{ticket.table}</TD>
                <TD className="num text-muted-foreground">{ticket.time}</TD>
                <TD className="num text-muted-foreground">{ticket.mins} min</TD>
                <TD>
                  {ticket.items
                    .filter((item) => drinks.some((drink) => item.includes(drink.name)))
                    .join(", ")}
                </TD>
                <TD>
                  <Status>{ticket.state}</Status>
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
