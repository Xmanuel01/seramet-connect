import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Status } from "@/components/app/ui";
import { formatTime } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useOperationalMenu } from "@/hooks/use-operational-menu";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import type {
  OrderForPrint,
  PrintJob,
  ProductionStation,
} from "@/lib/seramet-print-service";
import type { TransactionOrder } from "@/lib/transaction-engine";
import {
  buildKitchenTickets,
  nextForwardKitchenState,
  shouldShowKitchenOrder,
  type KitchenSlaState,
  type KitchenState,
  type KitchenTicket,
} from "@/kitchen/kds-model";
import { permissions } from "@/platform/permissions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/kitchen")({
  head: () => ({
    meta: [
      { title: "Kitchen Display - Seramet" },
      {
        name: "description",
        content: "Full-screen kitchen display with station queues, SLA ageing and print recovery.",
      },
      { property: "og:title", content: "Kitchen Display - Seramet" },
      {
        property: "og:description",
        content: "Configured station queues, production lifecycle and real KOT print recovery.",
      },
    ],
  }),
  component: KDS,
});

const kdsCols: KitchenState[] = ["NEW", "PREPARING", "READY"];

function urgency(state: KitchenSlaState) {
  if (state === "LATE") return "border-danger/50 bg-danger-soft";
  if (state === "APPROACHING") return "border-warning/50 bg-warning-soft";
  return "border-border bg-card";
}

function KDS() {
  const {
    activeTenantId,
    branch,
    branchId,
    branchLabel,
    currentUser,
    hasPermission,
    matchesBranch,
    platformState,
    role,
  } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const { items: menuItems } = useOperationalMenu({
    tenantId: activeTenantId,
    branchId,
    userId: currentUser.id,
    userName: currentUser.name,
    role,
  });
  const {
    profile,
    configurationError,
    jobs: printJobs,
    sendKitchenTickets,
    retryJob,
  } = useSerametPrintQueue(branchId);
  const [selectedStation, setSelectedStation] = useState("ALL");
  const [notice, setNotice] = useState("");
  const [recallTicketId, setRecallTicketId] = useState("");
  const [recallReason, setRecallReason] = useState("");

  const configuredStations = useMemo(
    () =>
      platformState.stations.filter(
        (station) =>
          station.tenantId === activeTenantId && station.branchId === branchId && station.active,
      ),
    [activeTenantId, branchId, platformState.stations],
  );

  const rows = useMemo(
    () =>
      state.orders
        .filter((order) => matchesBranch(order.branchId ?? order.branch))
        .filter(shouldShowKitchenOrder)
        .flatMap((order) => buildKitchenTickets(order, configuredStations, menuItems))
        .filter((ticket) => ticket.state !== "SERVED")
        .sort((a, b) => b.ageMinutes - a.ageMinutes),
    [configuredStations, matchesBranch, menuItems, state.orders],
  );

  const stations = useMemo(
    () =>
      [...new Map(rows.map((ticket) => [ticket.station, ticket.stationLabel])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1]),
      ),
    [rows],
  );
  const visibleRows =
    selectedStation === "ALL" ? rows : rows.filter((ticket) => ticket.station === selectedStation);

  const hasKdsWorkflow =
    profile?.kitchenMode === "KDS_ONLY" || profile?.kitchenMode === "KDS_AND_PRINTER";
  const canPrintProduction =
    profile?.kitchenMode === "PRINTER_ONLY" ||
    profile?.kitchenMode === "KDS_AND_PRINTER" ||
    profile?.kitchenMode === "NO_DEDICATED_KITCHEN_SYSTEM";
  const canRecall = hasPermission(permissions.productionAdjust);
  const modeSummary = profile
    ? hasKdsWorkflow
      ? "KDS production status is authoritative; configured print recovery remains available."
      : profile.kitchenMode === "PRINTER_ONLY"
        ? "Printer-only branch: KOT recovery uses the installed Seramet print bridge."
        : "Production copies route through the configured POS/front printer."
    : "Kitchen hardware configuration is incomplete.";

  const counts = useMemo(
    () => ({
      onTime: visibleRows.filter((ticket) => ticket.slaState === "ON_TIME").length,
      approaching: visibleRows.filter((ticket) => ticket.slaState === "APPROACHING").length,
      late: visibleRows.filter((ticket) => ticket.slaState === "LATE").length,
      untargeted: visibleRows.filter((ticket) => ticket.slaState === "UNTARGETED").length,
    }),
    [visibleRows],
  );

  const moveTicket = async (ticket: KitchenTicket) => {
    const next = nextForwardKitchenState(ticket.state);
    if (!hasKdsWorkflow || !next) return;
    setNotice("");
    try {
      await mutate("setProductionStationStatus", {
        orderId: ticket.orderId,
        station: ticket.station,
        status: next,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kitchen status could not be updated");
    }
  };

  const recallTicket = async (ticket: KitchenTicket) => {
    if (!canRecall || ticket.state !== "READY") return;
    setNotice("");
    try {
      await mutate("recallProductionStation", {
        orderId: ticket.orderId,
        station: ticket.station,
        reason: recallReason,
      });
      setRecallTicketId("");
      setRecallReason("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Station could not be recalled");
    }
  };

  const reprintTicket = (ticket: KitchenTicket) => {
    if (!profile || !canPrintProduction) return;
    const order = state.orders.find((candidate) => candidate.id === ticket.orderId);
    if (!order) {
      setNotice("The source order is no longer available.");
      return;
    }
    const latest = latestPhysicalPrintJob(printJobs, ticket);
    if (latest && ["Queued", "Sending", "Retrying"].includes(latest.status)) {
      setNotice(`${ticket.stationLabel} already has a print job in progress.`);
      return;
    }
    const result = sendKitchenTickets(
      printOrderForTicket(order, ticket, profile.branch, branchId, currentUser.name),
      "REPRINT",
    );
    if (result.jobs.length === 0) {
      setNotice(result.skipped.join("; ") || "No production print route is available.");
      return;
    }
    const physical = result.jobs.find(
      (job) => job.kitchenDelivery === "PRODUCTION_PRINT" || job.kitchenDelivery === "POS_FRONT_PRINT",
    );
    setNotice(
      physical
        ? `Reprint ${physical.id} queued for ${ticket.stationLabel}.`
        : `Kitchen duplicate queued for ${ticket.stationLabel}.`,
    );
  };

  const retryTicketPrint = (ticket: KitchenTicket) => {
    const latest = latestPhysicalPrintJob(printJobs, ticket);
    if (!latest || latest.status !== "Failed") return;
    retryJob(latest.id);
    setNotice(`Retrying ${latest.id} for ${ticket.stationLabel}.`);
  };

  return (
    <AppShell bare>
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[16px] font-extrabold tracking-tight">Seramet Kitchen</h1>
              <Status>{profile?.kitchenMode.replaceAll("_", " ") ?? "Configuration required"}</Status>
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
            {counts.untargeted > 0 && (
              <span className="text-muted-foreground">{counts.untargeted} without target</span>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StationFilter
            active={selectedStation === "ALL"}
            label="All stations"
            onClick={() => setSelectedStation("ALL")}
          />
          {stations.map(([code, label]) => (
            <StationFilter
              key={code}
              active={selectedStation === code}
              label={label}
              onClick={() => setSelectedStation(code)}
            />
          ))}
        </div>
      </div>

      {(notice || configurationError) && (
        <div className="mx-3 mt-3 rounded-md border border-border bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || configurationError}
        </div>
      )}

      {hasKdsWorkflow ? (
        <div className="grid gap-3 p-3 md:grid-cols-3">
          {kdsCols.map((column) => (
            <div key={column} className="rounded-xl bg-secondary/50 p-2">
              <div className="flex items-center justify-between px-2 py-2">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.12em]">{column}</h2>
                <span className="num rounded bg-card px-1.5 text-[12px] font-bold">
                  {visibleRows.filter((ticket) => ticket.state === column).length}
                </span>
              </div>
              <div className="space-y-2">
                {visibleRows
                  .filter((ticket) => ticket.state === column)
                  .map((ticket) => (
                    <KitchenTicketCard
                      key={ticket.id}
                      ticket={ticket}
                      order={state.orders.find((order) => order.id === ticket.orderId)}
                      printJob={latestPhysicalPrintJob(printJobs, ticket)}
                      canPrint={Boolean(canPrintProduction)}
                      canRecall={canRecall}
                      recalling={recallTicketId === ticket.id}
                      recallReason={recallReason}
                      onRecallReason={setRecallReason}
                      onBeginRecall={() => {
                        setRecallTicketId(ticket.id);
                        setRecallReason("");
                      }}
                      onCancelRecall={() => {
                        setRecallTicketId("");
                        setRecallReason("");
                      }}
                      onConfirmRecall={() => void recallTicket(ticket)}
                      onAdvance={() => void moveTicket(ticket)}
                      onReprint={() => reprintTicket(ticket)}
                      onRetryPrint={() => retryTicketPrint(ticket)}
                    />
                  ))}
                {visibleRows.filter((ticket) => ticket.state === column).length === 0 && (
                  <EmptyQueue />
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleRows.map((ticket) => (
            <KitchenTicketCard
              key={ticket.id}
              ticket={ticket}
              order={state.orders.find((order) => order.id === ticket.orderId)}
              printJob={latestPhysicalPrintJob(printJobs, ticket)}
              canPrint={Boolean(canPrintProduction)}
              canRecall={false}
              recalling={false}
              recallReason=""
              onRecallReason={() => undefined}
              onBeginRecall={() => undefined}
              onCancelRecall={() => undefined}
              onConfirmRecall={() => undefined}
              onAdvance={() => undefined}
              onReprint={() => reprintTicket(ticket)}
              onRetryPrint={() => retryTicketPrint(ticket)}
            />
          ))}
          {visibleRows.length === 0 && <EmptyQueue />}
        </div>
      )}
    </AppShell>
  );
}

function KitchenTicketCard({
  ticket,
  order,
  printJob,
  canPrint,
  canRecall,
  recalling,
  recallReason,
  onRecallReason,
  onBeginRecall,
  onCancelRecall,
  onConfirmRecall,
  onAdvance,
  onReprint,
  onRetryPrint,
}: {
  ticket: KitchenTicket;
  order?: TransactionOrder;
  printJob?: PrintJob;
  canPrint: boolean;
  canRecall: boolean;
  recalling: boolean;
  recallReason: string;
  onRecallReason: (value: string) => void;
  onBeginRecall: () => void;
  onCancelRecall: () => void;
  onConfirmRecall: () => void;
  onAdvance: () => void;
  onReprint: () => void;
  onRetryPrint: () => void;
}) {
  const next = nextForwardKitchenState(ticket.state);
  const printBusy = Boolean(printJob && ["Queued", "Sending", "Retrying"].includes(printJob.status));
  return (
    <article className={cn("rounded-lg border p-3", urgency(ticket.slaState))}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-extrabold">
          {ticket.table.startsWith("ORDER") ? ticket.table : `TABLE ${ticket.table}`}
        </span>
        <span className="num shrink-0 text-[13px] font-bold">{ticket.orderId}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Status>{ticket.stationLabel}</Status>
        {!ticket.stationConfigured && <Status>Unmapped station</Status>}
        {ticket.paymentStatus === "PAID" && <Status>Paid - production open</Status>}
        {printJob && <Status>{printJob.status}</Status>}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>{formatTime(new Date(ticket.startedAt))}</span>
        <span className="num font-bold text-foreground">
          {ticket.ageMinutes} MIN
          {ticket.targetMinutes ? ` / ${ticket.targetMinutes}` : ""}
        </span>
      </div>
      <ul className="mt-2.5 space-y-2 border-t border-border pt-2.5 text-[14px] font-semibold">
        {ticket.items.map((item) => (
          <li key={item.id}>
            <div>{item.label}</div>
            {item.note && (
              <div className="mt-0.5 rounded bg-card px-2 py-1 text-[11px] font-semibold text-danger">
                {item.note}
              </div>
            )}
          </li>
        ))}
      </ul>
      {ticket.orderNote && (
        <p className="mt-2 rounded bg-card px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-danger">
          {ticket.orderNote}
        </p>
      )}
      {!order && (
        <p className="mt-2 text-[11px] font-semibold text-danger">Source order unavailable.</p>
      )}
      {printJob?.failureReason && (
        <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">
          {printJob.failureReason}
        </p>
      )}

      {recalling ? (
        <div className="mt-3 space-y-2 rounded-md border border-warning/40 bg-card p-2">
          <label className="grid gap-1 text-[11px] font-semibold">
            Rework reason
            <input
              value={recallReason}
              onChange={(event) => onRecallReason(event.target.value)}
              placeholder="e.g. overcooked, wrong modifier"
              className="h-9 rounded-md border border-border bg-background px-2 text-[12px]"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onCancelRecall}
              className="h-9 rounded-md border border-border bg-card text-[12px] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmRecall}
              disabled={recallReason.trim().length < 4}
              className="h-9 rounded-md bg-warning text-[12px] font-semibold text-warning-foreground disabled:opacity-50"
            >
              Start rework
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {next ? (
            <button
              onClick={onAdvance}
              className="h-10 rounded-md bg-primary text-[13px] font-semibold text-primary-foreground"
            >
              {next === "PREPARING" ? "Start" : next === "READY" ? "Ready" : "Served"}
            </button>
          ) : (
            <div />
          )}
          {ticket.state === "READY" && canRecall ? (
            <button
              onClick={onBeginRecall}
              className="h-10 rounded-md border border-warning/50 bg-card text-[13px] font-semibold text-warning"
            >
              Recall / rework
            </button>
          ) : canPrint ? (
            <button
              onClick={printJob?.status === "Failed" ? onRetryPrint : onReprint}
              disabled={printBusy}
              className="h-10 rounded-md border border-border bg-card text-[13px] font-semibold disabled:opacity-50"
            >
              {printBusy
                ? "Printing..."
                : printJob?.status === "Failed"
                  ? "Retry print"
                  : "Reprint KOT"}
            </button>
          ) : null}
        </div>
      )}
      {ticket.state === "READY" && canRecall && canPrint && !recalling && (
        <button
          onClick={printJob?.status === "Failed" ? onRetryPrint : onReprint}
          disabled={printBusy}
          className="mt-2 h-9 w-full rounded-md border border-border bg-card text-[12px] font-semibold disabled:opacity-50"
        >
          {printBusy
            ? "Printing..."
            : printJob?.status === "Failed"
              ? "Retry print"
              : "Reprint KOT"}
        </button>
      )}
    </article>
  );
}

function StationFilter({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[11px] font-semibold",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
      )}
    >
      {label}
    </button>
  );
}

function EmptyQueue() {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
      No tickets in this queue.
    </div>
  );
}

function latestPhysicalPrintJob(jobs: PrintJob[], ticket: KitchenTicket) {
  return jobs
    .filter(
      (job) =>
        job.orderId === ticket.orderId &&
        job.productionStation === ticket.station &&
        (job.kitchenDelivery === "PRODUCTION_PRINT" || job.kitchenDelivery === "POS_FRONT_PRINT"),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function printOrderForTicket(
  order: TransactionOrder,
  ticket: KitchenTicket,
  branchName: string,
  branchId: string,
  requestedBy: string,
): OrderForPrint {
  return {
    orderId: order.id,
    branch: branchName,
    terminalId: `KDS-${branchId}`,
    ...(order.table ? { table: order.table } : {}),
    orderType: order.channel,
    requestedBy,
    cashier: order.cashier,
    waiter: order.waiter ?? order.cashier,
    createdAt: order.createdAt,
    customer: order.customer,
    ...(order.kitchenNote ? { kitchenNote: order.kitchenNote } : {}),
    lines: order.lines
      .filter(
        (line) =>
          line.productionStation === ticket.station && line.productionStatus !== "CANCELLED",
      )
      .map((line) => ({
        id: line.id,
        name: line.name,
        category: line.category,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        productionStation: ticket.station as ProductionStation,
        ...(line.itemNote ? { itemNote: line.itemNote } : {}),
      })),
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
  };
}
