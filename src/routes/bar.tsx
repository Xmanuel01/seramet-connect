import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Martini } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
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
  type KitchenTicket,
} from "@/kitchen/kds-model";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/bar")({
  head: () => ({
    meta: [
      { title: "Bar - Seramet" },
      {
        name: "description",
        content:
          "Authoritative bar production queue with payment-independent ticketing, SLA ageing and print recovery.",
      },
    ],
  }),
  component: BarModule,
});

function BarModule() {
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
  const [notice, setNotice] = useState("");
  const [recallTicketId, setRecallTicketId] = useState("");
  const [recallReason, setRecallReason] = useState("");

  const configuredStations = useMemo(
    () =>
      platformState.stations.filter(
        (station) =>
          station.tenantId === activeTenantId &&
          station.branchId === branchId &&
          station.active,
      ),
    [activeTenantId, branchId, platformState.stations],
  );

  const drinks = useMemo(
    () =>
      menuItems.filter(
        (product) =>
          normalizeStation(product.productionStation ?? "") === "BAR" &&
          product.branchAvailability?.[branch] !== false,
      ),
    [branch, menuItems],
  );

  const barTickets = useMemo(
    () =>
      state.orders
        .filter((order) => matchesBranch(order.branchId ?? order.branch))
        .filter(shouldShowKitchenOrder)
        .flatMap((order) => buildKitchenTickets(order, configuredStations, menuItems))
        .filter(
          (ticket) => normalizeStation(ticket.station) === "BAR" && ticket.state !== "SERVED",
        )
        .sort((a, b) => b.ageMinutes - a.ageMinutes),
    [configuredStations, matchesBranch, menuItems, state.orders],
  );

  const barJobs = useMemo(
    () =>
      printJobs
        .filter(
          (job) =>
            normalizeStation(job.productionStation ?? "") === "BAR" ||
            job.documentType === "BAR_TICKET",
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [printJobs],
  );

  const barPrinter = profile?.printers.find((printer) => printer.roles.includes("BAR"));
  const barModuleEnabled = Boolean(profile?.capabilities.BAR_MODULE);
  const backendWritable = backendStatus === "synced" || backendStatus === "syncing";
  const canOperate =
    barModuleEnabled && backendWritable && hasPermission(permissions.kitchenOperate);
  const canRecall = canOperate && hasPermission(permissions.productionAdjust);
  const canPrintProduction =
    Boolean(profile) &&
    profile?.kitchenMode !== "KDS_ONLY" &&
    profile?.kitchenMode !== undefined;

  const printQueueCount = barJobs.filter((job) =>
    ["Queued", "Sending", "Retrying"].includes(job.status),
  ).length;
  const printFailureCount = barJobs.filter((job) => job.status === "Failed").length;
  const lateCount = barTickets.filter((ticket) => ticket.slaState === "LATE").length;

  const moveTicket = async (ticket: KitchenTicket) => {
    const next = nextForwardKitchenState(ticket.state);
    if (!canOperate || !next) return;
    setNotice("");
    try {
      await mutate("setProductionStationStatus", {
        orderId: ticket.orderId,
        station: ticket.station,
        status: next,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Bar status could not be updated.");
    }
  };

  const recallTicket = async (ticket: KitchenTicket) => {
    if (!canRecall || ticket.state !== "READY" || !recallReason.trim()) return;
    setNotice("");
    try {
      await mutate("recallProductionStation", {
        orderId: ticket.orderId,
        station: ticket.station,
        reason: recallReason.trim(),
      });
      setRecallTicketId("");
      setRecallReason("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Bar ticket could not be recalled.");
    }
  };

  const reprintTicket = (ticket: KitchenTicket) => {
    if (!profile || !canPrintProduction) return;
    const order = state.orders.find((candidate) => candidate.id === ticket.orderId);
    if (!order) {
      setNotice("The source order is no longer available.");
      return;
    }

    const latest = latestPhysicalBarPrintJob(barJobs, ticket);
    if (latest && ["Queued", "Sending", "Retrying"].includes(latest.status)) {
      setNotice(`${ticket.stationLabel} already has a print job in progress.`);
      return;
    }

    const result = sendKitchenTickets(
      printOrderForBarTicket(order, ticket, profile.branch, branchId, currentUser.name),
      "REPRINT",
    );
    const physical = result.jobs.find(
      (job) =>
        job.kitchenDelivery === "PRODUCTION_PRINT" ||
        job.kitchenDelivery === "POS_FRONT_PRINT",
    );

    if (!physical) {
      setNotice(result.skipped.join("; ") || "No physical bar print route is available.");
      return;
    }
    setNotice(`Bar reprint ${physical.id} queued.`);
  };

  const retryTicketPrint = (ticket: KitchenTicket) => {
    const latest = latestPhysicalBarPrintJob(barJobs, ticket);
    if (!latest || latest.status !== "Failed") return;
    retryJob(latest.id);
    setNotice(`Retrying ${latest.id} for the bar.`);
  };

  return (
    <AppShell
      title="Bar"
      subtitle={`Live production queue - ${branchLabel}`}
    >
      {(notice || configurationError || !barModuleEnabled) && (
        <div className="mb-4 rounded-md border border-border bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            configurationError ||
            "The Bar module is disabled for this branch. Enable BAR_MODULE in branch hardware/capabilities before operating this queue."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Drink items" value={drinks.length} />
        <Metric label="Open tickets" value={barTickets.length} />
        <Metric label="Late tickets" value={lateCount} invert />
        <Metric label="Queued prints" value={printQueueCount} />
        <Metric label="Print failures" value={printFailureCount} invert />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Bar production queue"
            sub={`Payment-independent drink tickets - backend ${backendStatus}`}
            right={<Martini className="h-4 w-4 text-primary" />}
          />
          <DataTable
            cols={["Ticket", "Table / channel", "Age", "Items", "Payment", "Status", "Print"]}
          >
            {barTickets.map((ticket) => {
              const order = state.orders.find((candidate) => candidate.id === ticket.orderId);
              const latestPrint = latestPhysicalBarPrintJob(barJobs, ticket);
              const recalling = recallTicketId === ticket.id;
              const next = nextForwardKitchenState(ticket.state);

              return (
                <tr key={ticket.id} className="align-top hover:bg-secondary/50">
                  <TD>
                    <div className="num font-semibold">{ticket.orderId}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {formatTime(new Date(ticket.startedAt))}
                    </div>
                  </TD>
                  <TD>
                    <div className="font-semibold">{ticket.table}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {order?.channel ?? "Unknown channel"}
                    </div>
                  </TD>
                  <TD>
                    <div className="num">{ticket.ageMinutes} min</div>
                    <div className="mt-1">
                      <Status>{ticket.slaState.replaceAll("_", " ")}</Status>
                    </div>
                  </TD>
                  <TD>
                    <div className="space-y-1">
                      {ticket.items.map((item) => (
                        <div key={item.id}>
                          <div className="font-semibold">{item.label}</div>
                          {item.note && (
                            <div className="text-[11px] text-muted-foreground">
                              “{item.note}”
                            </div>
                          )}
                        </div>
                      ))}
                      {ticket.orderNote && (
                        <div className="mt-2 rounded-md border border-border bg-secondary/50 px-2 py-1 text-[11px]">
                          “{ticket.orderNote}”
                        </div>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <Status>{ticket.paymentStatus}</Status>
                  </TD>
                  <TD>
                    <div className="space-y-2">
                      <Status>{ticket.state}</Status>
                      {next && (
                        <button
                          className="block text-[11px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!canOperate}
                          onClick={() => void moveTicket(ticket)}
                        >
                          {nextActionLabel(ticket.state)}
                        </button>
                      )}
                      {ticket.state === "READY" && canRecall && !recalling && (
                        <button
                          className="block text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setRecallTicketId(ticket.id);
                            setRecallReason("");
                          }}
                        >
                          Recall
                        </button>
                      )}
                      {recalling && (
                        <div className="min-w-[180px] space-y-1">
                          <input
                            className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]"
                            value={recallReason}
                            onChange={(event) => setRecallReason(event.target.value)}
                            placeholder="Reason for recall"
                          />
                          <div className="flex gap-2">
                            <button
                              className="text-[11px] font-semibold text-primary disabled:opacity-50"
                              disabled={!recallReason.trim()}
                              onClick={() => void recallTicket(ticket)}
                            >
                              Confirm
                            </button>
                            <button
                              className="text-[11px] font-semibold text-muted-foreground"
                              onClick={() => {
                                setRecallTicketId("");
                                setRecallReason("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <div className="space-y-2">
                      <Status>{latestPrint?.status ?? "No job"}</Status>
                      {latestPrint?.status === "Failed" ? (
                        <button
                          className="block text-[11px] font-semibold text-primary hover:underline"
                          onClick={() => retryTicketPrint(ticket)}
                        >
                          Retry print
                        </button>
                      ) : (
                        <button
                          className="block text-[11px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!canPrintProduction}
                          onClick={() => reprintTicket(ticket)}
                        >
                          {latestPrint ? "Reprint" : "Print ticket"}
                        </button>
                      )}
                      {latestPrint?.failureReason && (
                        <div className="max-w-[210px] text-[11px] text-danger">
                          {latestPrint.failureReason}
                        </div>
                      )}
                    </div>
                  </TD>
                </tr>
              );
            })}
            {barTickets.length === 0 && (
              <tr>
                <TD className="text-muted-foreground" colSpan={7}>
                  No active bar production tickets for this branch.
                </TD>
              </tr>
            )}
          </DataTable>
        </Panel>

        <Panel>
          <PanelHead
            title="Bar readiness"
            sub="Branch capability, station routing and printer health"
          />
          <div className="space-y-3 p-4 text-[13px]">
            <ReadinessRow
              label="Bar module"
              value={barModuleEnabled ? "Enabled" : "Disabled"}
            />
            <ReadinessRow
              label="Backend"
              value={backendStatus}
            />
            <ReadinessRow
              label="Operate permission"
              value={hasPermission(permissions.kitchenOperate) ? "Granted" : "Denied"}
            />
            <ReadinessRow
              label="Bar printer"
              value={barPrinter?.name ?? "No dedicated BAR printer"}
            />
            <ReadinessRow
              label="Printer state"
              value={barPrinter?.connection ?? "Shared / fallback route"}
            />

            <div className="pt-2">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Bar menu
              </div>
              <div className="max-h-[360px] space-y-2 overflow-auto">
                {drinks.map((drink) => (
                  <div
                    key={drink.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-card px-3 py-2 text-[12px]"
                  >
                    <span className="min-w-0 truncate font-semibold">{drink.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {drink.out ? "86" : `${drink.prep} min`}
                    </span>
                  </div>
                ))}
                {drinks.length === 0 && (
                  <div className="rounded-md bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
                    No menu items are currently routed to BAR for this branch.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function ReadinessRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 p-3">
      <span className="font-semibold">{label}</span>
      <Status>{value}</Status>
    </div>
  );
}

function latestPhysicalBarPrintJob(jobs: PrintJob[], ticket: KitchenTicket) {
  return jobs
    .filter(
      (job) =>
        job.orderId === ticket.orderId &&
        normalizeStation(job.productionStation ?? "") === normalizeStation(ticket.station) &&
        (job.kitchenDelivery === "PRODUCTION_PRINT" ||
          job.kitchenDelivery === "POS_FRONT_PRINT"),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function printOrderForBarTicket(
  order: TransactionOrder,
  ticket: KitchenTicket,
  branchName: string,
  branchId: string,
  requestedBy: string,
): OrderForPrint {
  return {
    orderId: order.id,
    branch: branchName,
    terminalId: `BAR-${branchId}`,
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
          normalizeStation(line.productionStation ?? "") === normalizeStation(ticket.station) &&
          line.productionStatus !== "CANCELLED",
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

function nextActionLabel(state: KitchenTicket["state"]) {
  if (state === "NEW") return "Start";
  if (state === "PREPARING") return "Mark ready";
  if (state === "READY") return "Mark served";
  return "Complete";
}

function normalizeStation(value: string) {
  return value.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ").toUpperCase();
}
