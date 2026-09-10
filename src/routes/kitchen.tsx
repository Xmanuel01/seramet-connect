import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Status } from "@/components/app/ui";
import { formatTime } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { SerametPrintService } from "@/lib/seramet-print-service";
import {
  TransactionEngine,
  type ProductionStatus,
  type TransactionOrder,
} from "@/lib/transaction-engine";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/kitchen")({
  head: () => ({
    meta: [
      { title: "Kitchen Display - Seramet" },
      {
        name: "description",
        content: "Full-screen kitchen display with ticket ageing, prep queues and one-tap status.",
      },
      { property: "og:title", content: "Kitchen Display - Seramet" },
      {
        property: "og:description",
        content: "Ticket ageing, prep queues and one-tap status for the line.",
      },
    ],
  }),
  component: KDS,
});

type KitchenState = "NEW" | "PREPARING" | "READY" | "SERVED";
type PrintState = "KOT PRINTED" | "REPRINTED" | "PRINT FAILED" | "CANCELLED";
type KitchenTicket = {
  id: string;
  orderId: string;
  station: string;
  table: string;
  time: string;
  mins: number;
  state: KitchenState;
  printState: PrintState;
  items: string[];
  note?: string;
};

const kitchenStations = new Set(["MAIN KITCHEN", "GRILL", "DESSERT"]);
const kdsCols: KitchenState[] = ["NEW", "PREPARING", "READY"];
const printerCols: PrintState[] = ["KOT PRINTED", "REPRINTED", "PRINT FAILED", "CANCELLED"];

function urgency(m: number) {
  if (m >= 20) return "border-danger/50 bg-danger-soft";
  if (m >= 12) return "border-warning/50 bg-warning-soft";
  return "border-border bg-card";
}

function KDS() {
  const { branch, branchLabel, currentUser, matchesBranch } = useAppContext();
  const profile = SerametPrintService.getBranchHardwareProfile(branch);
  const hasKdsWorkflow =
    profile.kitchenMode === "KDS_ONLY" || profile.kitchenMode === "KDS_AND_PRINTER";
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [printOverrides, setPrintOverrides] = useState<Record<string, PrintState>>({});

  const rows = useMemo(
    () =>
      state.orders
        .filter((order) => matchesBranch(order.branchId ?? order.branch))
        .filter((order) => !["CANCELLED", "PAID", "REFUNDED"].includes(order.status))
        .flatMap(toKitchenTickets)
        .sort((a, b) => b.mins - a.mins),
    [matchesBranch, state.orders],
  );

  const visibleRows = hasKdsWorkflow ? rows.filter((ticket) => ticket.state !== "SERVED") : rows;
  const cols = hasKdsWorkflow ? kdsCols : printerCols;
  const modeSummary = hasKdsWorkflow
    ? "KDS controls accept, preparing, ready and served status."
    : profile.kitchenMode === "PRINTER_ONLY"
      ? "Printer-only branch: operational kitchen status is captured from print and POS events."
      : "No dedicated kitchen system: production copies print at the POS/front printer when configured.";

  const moveTicket = (ticket: KitchenTicket, next: KitchenState) => {
    if (!hasKdsWorkflow) return;
    void mutate("setProductionStationStatus", {
      orderId: ticket.orderId,
      station: ticket.station,
      status: next as ProductionStatus,
    });
  };

  const markPrintState = (id: string, next: PrintState) => {
    if (hasKdsWorkflow) return;
    setPrintOverrides((current) => ({ ...current, [id]: next }));
  };

  const counts = useMemo(
    () => ({
      onTime: visibleRows.filter((ticket) => ticket.mins < 12).length,
      approaching: visibleRows.filter((ticket) => ticket.mins >= 12 && ticket.mins < 20).length,
      late: visibleRows.filter((ticket) => ticket.mins >= 20).length,
    }),
    [visibleRows],
  );

  return (
    <AppShell bare>
      <div className="flex flex-col gap-3 border-b border-border bg-card px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[16px] font-extrabold tracking-tight">Seramet Kitchen</h1>
            <Status>{profile.kitchenMode.replaceAll("_", " ")}</Status>
            <Status>{backendStatus === "synced" ? "Healthy" : backendStatus}</Status>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {branchLabel} - {visibleRows.length} active station tickets - {modeSummary}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[12px] font-semibold">
          <span className="text-success">{counts.onTime} on time</span>
          <span className="text-warning">{counts.approaching} approaching</span>
          <span className="text-danger">{counts.late} late</span>
        </div>
      </div>
      <div className={cn("grid gap-3 p-3", hasKdsWorkflow ? "md:grid-cols-3" : "md:grid-cols-4")}>
        {cols.map((column) => {
          const columnRows = hasKdsWorkflow
            ? visibleRows.filter((ticket) => ticket.state === column)
            : visibleRows.filter(
                (ticket) => (printOverrides[ticket.id] ?? ticket.printState) === column,
              );
          return (
            <div key={column} className="rounded-xl bg-secondary/50 p-2">
              <div className="flex items-center justify-between px-2 py-2">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.12em]">{column}</h2>
                <span className="num rounded bg-card px-1.5 text-[12px] font-bold">
                  {columnRows.length}
                </span>
              </div>
              <div className="space-y-2">
                {columnRows.map((ticket) => (
                  <article
                    key={ticket.id}
                    className={cn("rounded-lg border p-3", urgency(ticket.mins))}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-[15px] font-extrabold">
                        {ticket.table.startsWith("ORDER") ? ticket.table : `TABLE ${ticket.table}`}
                      </span>
                      <span className="num text-[13px] font-bold">{ticket.orderId}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                      {ticket.station}
                    </div>
                    <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                      <span>{ticket.time}</span>
                      <span className="num font-bold text-foreground">{ticket.mins} MIN</span>
                    </div>
                    <ul className="mt-2.5 space-y-1 border-t border-border pt-2.5 text-[14px] font-semibold">
                      {ticket.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    {ticket.note && (
                      <p className="mt-2 rounded bg-card px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-danger">
                        {ticket.note}
                      </p>
                    )}
                    {hasKdsWorkflow ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          onClick={() =>
                            moveTicket(ticket, ticket.state === "NEW" ? "PREPARING" : "NEW")
                          }
                          className="h-10 rounded-md border border-border bg-card text-[13px] font-semibold"
                        >
                          {ticket.state === "NEW" ? "Accept" : "Recall"}
                        </button>
                        <button
                          onClick={() =>
                            moveTicket(
                              ticket,
                              ticket.state === "NEW"
                                ? "PREPARING"
                                : ticket.state === "PREPARING"
                                  ? "READY"
                                  : "SERVED",
                            )
                          }
                          className="h-10 rounded-md bg-primary text-[13px] font-semibold text-primary-foreground"
                        >
                          {ticket.state === "NEW"
                            ? "Start"
                            : ticket.state === "PREPARING"
                              ? "Ready"
                              : "Served"}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => markPrintState(ticket.id, "REPRINTED")}
                          className="h-10 rounded-md border border-border bg-card text-[13px] font-semibold"
                        >
                          Reprint KOT
                        </button>
                        <button
                          onClick={() =>
                            markPrintState(
                              ticket.id,
                              (printOverrides[ticket.id] ?? ticket.printState) === "PRINT FAILED"
                                ? "KOT PRINTED"
                                : "CANCELLED",
                            )
                          }
                          className="h-10 rounded-md bg-primary text-[13px] font-semibold text-primary-foreground"
                        >
                          {(printOverrides[ticket.id] ?? ticket.printState) === "PRINT FAILED"
                            ? "Mark printed"
                            : "Cancel ticket"}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {columnRows.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
                    No tickets in this queue.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

function toKitchenTickets(order: TransactionOrder): KitchenTicket[] {
  const stations = new Map<string, TransactionOrder["lines"]>();
  order.lines.forEach((line) => {
    const station = line.productionStation ?? "NONE";
    if (!kitchenStations.has(station)) return;
    stations.set(station, [...(stations.get(station) ?? []), line]);
  });

  return [...stations.entries()].map(([station, lines]) => {
    const statuses = lines.map((line) => line.productionStatus ?? "NEW");
    const state: KitchenState = statuses.every((status) => status === "SERVED")
      ? "SERVED"
      : statuses.every((status) => status === "READY" || status === "SERVED")
        ? "READY"
        : statuses.some((status) => status === "PREPARING")
          ? "PREPARING"
          : "NEW";
    const created = new Date(order.createdAt);
    const now = Date.now();
    const mins = Number.isFinite(created.getTime())
      ? Math.max(0, Math.floor((now - created.getTime()) / 60000))
      : 0;
    return {
      id: `${order.id}:${station}`,
      orderId: order.id,
      station,
      table: order.table ?? `ORDER ${order.id.replace("ORD-", "")}`,
      time: formatTime(created),
      mins,
      state,
      printState: "KOT PRINTED",
      items: lines.flatMap((line) => [
        `${line.name} x${line.quantity}`,
        ...(line.itemNote ? [`  - ${line.itemNote}`] : []),
      ]),
      ...(order.kitchenNote ? { note: order.kitchenNote } : {}),
    };
  });
}
