import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Status } from "@/components/app/ui";
import { tickets } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";
import { SerametPrintService } from "@/lib/seramet-print-service";
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
type TicketRow = (typeof tickets)[number] & { state: KitchenState; printState: PrintState };

const kdsCols: KitchenState[] = ["NEW", "PREPARING", "READY"];
const printerCols: PrintState[] = ["KOT PRINTED", "REPRINTED", "PRINT FAILED", "CANCELLED"];

function urgency(m: number) {
  if (m >= 20) return "border-danger/50 bg-danger-soft";
  if (m >= 12) return "border-warning/50 bg-warning-soft";
  return "border-border bg-card";
}

function KDS() {
  const { branch, branchLabel } = useAppContext();
  const profile = SerametPrintService.getBranchHardwareProfile(branch);
  const hasKdsWorkflow =
    profile.kitchenMode === "KDS_ONLY" || profile.kitchenMode === "KDS_AND_PRINTER";
  const [rows, setRows] = useState<TicketRow[]>(() =>
    tickets.map((ticket, index) => ({
      ...ticket,
      state: ticket.state as KitchenState,
      printState: index === 1 ? "REPRINTED" : index === 4 ? "PRINT FAILED" : "KOT PRINTED",
    })),
  );
  const visibleRows = hasKdsWorkflow ? rows.filter((ticket) => ticket.state !== "SERVED") : rows;
  const cols = hasKdsWorkflow ? kdsCols : printerCols;
  const modeSummary = hasKdsWorkflow
    ? "KDS controls accept, preparing, ready and served status."
    : profile.kitchenMode === "PRINTER_ONLY"
      ? "Printer-only branch: operational kitchen status is not electronically tracked."
      : "No dedicated kitchen system: production copies print at the POS/front printer when configured.";

  const moveTicket = (id: string, next: KitchenState) => {
    if (!hasKdsWorkflow) return;
    setRows((current) =>
      current.map((ticket) => (ticket.id === id ? { ...ticket, state: next } : ticket)),
    );
  };

  const markPrintState = (id: string, next: PrintState) => {
    if (hasKdsWorkflow) return;
    setRows((current) =>
      current.map((ticket) => (ticket.id === id ? { ...ticket, printState: next } : ticket)),
    );
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
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {branchLabel} - {visibleRows.length} active tickets - {modeSummary}
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
            : visibleRows.filter((ticket) => ticket.printState === column);
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
                      <span className="text-[15px] font-extrabold">TABLE {ticket.table}</span>
                      <span className="num text-[13px] font-bold">#{ticket.id}</span>
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
                            moveTicket(ticket.id, ticket.state === "NEW" ? "PREPARING" : "NEW")
                          }
                          className="h-10 rounded-md border border-border bg-card text-[13px] font-semibold"
                        >
                          {ticket.state === "NEW" ? "Accept" : "Recall"}
                        </button>
                        <button
                          onClick={() =>
                            moveTicket(
                              ticket.id,
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
                              ticket.printState === "PRINT FAILED" ? "KOT PRINTED" : "CANCELLED",
                            )
                          }
                          className="h-10 rounded-md bg-primary text-[13px] font-semibold text-primary-foreground"
                        >
                          {ticket.printState === "PRINT FAILED" ? "Mark printed" : "Cancel ticket"}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
