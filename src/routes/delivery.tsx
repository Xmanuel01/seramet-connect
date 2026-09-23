import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import {
  collectionMethodLabel,
  collectionStatusLabel,
  deliveryOwnership,
  isDeliveryOrder,
  riderLiabilityAmount,
} from "@/lib/delivery-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { type TransactionOrder } from "@/lib/transaction-engine";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

type DeliveryView = "OWN" | "PLATFORM" | "ALL";

type DeliveryTask = {
  id: string;
  orderId: string;
  order: string;
  channel: string;
  customer: string;
  rider: string;
  branch: string;
  value: number;
  status: string;
  eta: string;
  fulfilment: "Restaurant rider" | "Platform rider";
  ownDispatch: boolean;
  deliveryState: NonNullable<TransactionOrder["delivery"]>["status"] | "PLATFORM";
  appPaid: number;
  cashDue: number;
  providerExpected: number;
  collectionAmount: number;
  collectionMethod: string;
  collectionStatus: string;
  raw: TransactionOrder;
};

export const Route = createFileRoute("/delivery")({
  head: () => ({
    meta: [
      { title: "Delivery Tasks - Seramet" },
      {
        name: "description",
        content: "Dispatch, marketplace fulfilment and rider accountability across delivery channels.",
      },
      { property: "og:title", content: "Delivery Tasks - Seramet" },
      {
        property: "og:description",
        content: "Track restaurant riders, platform couriers and collection/remittance state.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Delivery,
});

const lifecycle = [
  "Received",
  "Accepted",
  "Preparing",
  "Ready for pickup",
  "Picked up",
  "Out for delivery",
  "Delivered",
];

function deliveryStatus(order: TransactionOrder, ownDispatch: boolean) {
  if (order.status === "CANCELLED") return "Cancelled";
  if (order.status === "REFUNDED") return "Returned";
  if (ownDispatch) {
    const status = order.delivery?.status ?? "UNASSIGNED";
    if (status === "DELIVERED") return "Delivered";
    if (status === "OUT_FOR_DELIVERY") return "Out for delivery";
    if (status === "PICKED_UP") return "Picked up";
  }
  if (order.status === "PAID" && order.delivery?.status === "DELIVERED") return "Delivered";
  if (order.status === "READY" || order.status === "SERVED") return "Ready for pickup";
  if (order.status === "IN_PROGRESS" || order.status === "SENT_TO_KITCHEN") return "Preparing";
  if (order.status === "HELD") return "Pending";
  return "Received";
}

function deliveryEta(order: TransactionOrder) {
  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000),
  );
  if (order.delivery?.status === "DELIVERED") return "Completed";
  if (order.delivery?.status === "OUT_FOR_DELIVERY") return `${ageMinutes} min since intake`;
  if (order.status === "READY" || order.status === "SERVED")
    return `Ready ${ageMinutes} min after intake`;
  return `${ageMinutes} min in queue`;
}

function Delivery() {
  const { activeTenantId, branch, branchLabel, matchesBranch } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [selectedRiders, setSelectedRiders] = useState<Record<string, string>>({});
  const [view, setView] = useState<DeliveryView>("OWN");
  const [notice, setNotice] = useState("");
  const repository = getConfigurationRepository();
  const tenant = repository.getTenant(activeTenantId);
  const orderChannels = repository.listOrderChannels(activeTenantId, true);
  const resolveChannel = (value: string) =>
    orderChannels.find(
      (channel) => channel.id === value || channel.code === value || channel.displayName === value,
    );

  const availableRiders = useMemo(
    () =>
      state.employees.filter((employee) => {
        if (!employee.active || employee.role !== "Rider") return false;
        if (!matchesBranch(employee.branchId ?? employee.branch)) return false;
        const today = state.attendanceRecords.find(
          (record) =>
            record.employeeId === employee.id &&
            record.date ===
              new Intl.DateTimeFormat("en-CA", {
                timeZone: tenant.timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date()),
        );
        return Boolean(today?.clockIn && !["ABSENT", "ON_LEAVE", "OFF"].includes(today.status));
      }),
    [matchesBranch, state.attendanceRecords, state.employees, tenant.timezone],
  );

  const scopedRows = useMemo<DeliveryTask[]>(() => {
    return state.orders
      .filter((order) => matchesBranch(order.branchId ?? order.branch))
      .filter((order) => {
        const channel = resolveChannel(order.channel);
        return isDeliveryOrder(order, channel);
      })
      .map((order, index) => {
        const channel = resolveChannel(order.channel);
        const owner = deliveryOwnership(order, channel);
        const ownDispatch = owner === "RESTAURANT";
        const receivable = state.marketplaceReceivables.find(
          (candidate) => candidate.orderId === order.id && candidate.status !== "CANCELLED",
        );
        const cashDue = order.externalSource?.cashDueAmount ?? order.delivery?.collection?.amount ?? 0;
        const appPaid = order.externalSource?.providerAppPaidAmount ?? receivable?.appPaidAmount ?? 0;
        return {
          id: `DLT-${order.id.replace(/\D/g, "").slice(-6) || String(index + 1).padStart(4, "0")}`,
          orderId: order.id,
          order: order.id,
          channel: channel?.displayName ?? order.channel,
          customer: order.customer,
          rider: ownDispatch ? (order.delivery?.rider ?? "Unassigned") : "Platform rider",
          branch: order.branch,
          value: order.total,
          status: deliveryStatus(order, ownDispatch),
          eta: deliveryEta(order),
          fulfilment: ownDispatch ? "Restaurant rider" : "Platform rider",
          ownDispatch,
          deliveryState: ownDispatch ? (order.delivery?.status ?? "UNASSIGNED") : "PLATFORM",
          appPaid,
          cashDue,
          providerExpected: receivable?.expectedNetSettlementAmount ?? 0,
          collectionAmount: order.delivery?.collection?.amount ?? 0,
          collectionMethod: collectionMethodLabel(order.delivery?.collection?.method),
          collectionStatus: collectionStatusLabel(order.delivery?.collection?.status),
          raw: order,
        };
      });
  }, [matchesBranch, orderChannels, state.marketplaceReceivables, state.orders]);

  const ownRows = scopedRows.filter((row) => row.ownDispatch);
  const platformRows = scopedRows.filter((row) => !row.ownDispatch);
  const visibleRows = view === "OWN" ? ownRows : view === "PLATFORM" ? platformRows : scopedRows;
  const activeOwn = ownRows.filter(
    (row) => !["Delivered", "Cancelled", "Returned"].includes(row.status),
  );
  const unassigned = activeOwn.filter((row) => row.rider === "Unassigned");
  const ownValue = ownRows.reduce((sum, row) => sum + row.value, 0);
  const riderFundsOutstanding = ownRows.reduce(
    (sum, row) => sum + riderLiabilityAmount(row.raw),
    0,
  );

  const assign = async (row: DeliveryTask, riderOverride?: string) => {
    const rider =
      riderOverride ??
      selectedRiders[row.orderId] ??
      availableRiders.find((item) => item.branch === row.branch)?.name;
    if (!rider) {
      setNotice(
        "No eligible rider is available for this branch. Check Riders or Attendance first.",
      );
      return;
    }
    try {
      await mutate("assignDeliveryRider", { orderId: row.orderId, rider });
      setNotice(`${rider} assigned to ${row.orderId}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Rider assignment failed.");
    }
  };

  const move = async (
    row: DeliveryTask,
    status: NonNullable<TransactionOrder["delivery"]>["status"],
  ) => {
    try {
      await mutate("setDeliveryStatus", { orderId: row.orderId, status });
      setNotice(`${row.orderId} updated to ${status.replaceAll("_", " ").toLowerCase()}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Delivery status update failed.");
    }
  };

  const recordCollection = async (
    row: DeliveryTask,
    method: "COMPANY_TILL_DIRECT" | "RIDER_CASH" | "RIDER_MPESA",
  ) => {
    const amount = row.raw.delivery?.collection?.amount ?? row.cashDue;
    if (!amount) {
      setNotice("This delivery has no customer amount due to the restaurant.");
      return;
    }
    const customerReference =
      method === "RIDER_MPESA"
        ? window.prompt("Customer M-Pesa transaction/reference received by the rider")?.trim()
        : undefined;
    if (method === "RIDER_MPESA" && !customerReference) return;
    try {
      await mutate("recordDeliveryCollection", {
        orderId: row.orderId,
        input: {
          method,
          amount,
          ...(customerReference ? { customerReference } : {}),
        },
      });
      setNotice(
        method === "COMPANY_TILL_DIRECT"
          ? "Direct company Till payment route recorded. It is only confirmed when the actual payment is confirmed."
          : `${ksh(amount)} recorded as temporarily held by ${row.rider}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Collection could not be recorded.");
    }
  };

  const remit = async (row: DeliveryTask) => {
    const collection = row.raw.delivery?.collection;
    if (!collection) return;
    const remittanceReference =
      collection.method === "RIDER_MPESA"
        ? window.prompt("Company Till transaction/reference used by the rider")?.trim()
        : undefined;
    if (collection.method === "RIDER_MPESA" && !remittanceReference) return;
    try {
      await mutate("markDeliveryRemitted", {
        orderId: row.orderId,
        input: { ...(remittanceReference ? { remittanceReference } : {}) },
      });
      setNotice(
        `${row.orderId} marked remitted. Finance/management must confirm receipt before the rider liability closes.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Remittance could not be recorded.");
    }
  };

  const confirmRemittance = async (row: DeliveryTask) => {
    try {
      await mutate("confirmDeliveryRemittance", { orderId: row.orderId });
      setNotice(`${row.orderId} rider remittance confirmed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Remittance confirmation failed.");
    }
  };

  const columns: EnterpriseColumn<DeliveryTask>[] = [
    { key: "id", label: "Task", sortable: true },
    { key: "order", label: "Order", sortable: true },
    { key: "channel", label: "Source", sortable: true },
    { key: "customer", label: "Customer", sortable: true },
    { key: "fulfilment", label: "Fulfilment", sortable: true },
    { key: "rider", label: "Rider", sortable: true },
    {
      key: "value",
      label: "Order value",
      align: "right",
      sortable: true,
      render: (row) => <span className="num font-semibold">{ksh(row.value)}</span>,
    },
    { key: "eta", label: "ETA" },
    { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
  ];

  return (
    <AppShell
      title="Delivery"
      subtitle={`Dispatch, marketplace fulfilment and rider accountability - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => (window.location.href = "/riders")}>Rider accounts</Btn>
          <Btn
            variant="primary"
            disabled={unassigned.length === 0 || availableRiders.length === 0}
            onClick={() => unassigned[0] && void assign(unassigned[0])}
          >
            Assign next rider
          </Btn>
        </>
      }
    >
      {notice && (
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px] font-medium">
          {notice} <span className="ml-2 text-muted-foreground">Backend: {backendStatus}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Active own deliveries" value={activeOwn.length} />
        <Metric label="Unassigned" value={unassigned.length} invert />
        <Metric label="Own-delivery value" value={ownValue} money />
        <Metric
          label="Ready for pickup"
          value={activeOwn.filter((row) => row.status === "Ready for pickup").length}
        />
        <Metric label="Rider funds outstanding" value={riderFundsOutstanding} money invert />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Delivery tasks"
          sub="Order source, fulfilment owner and payment collection are tracked independently"
          right={<Status>{availableRiders.length} rider(s) eligible</Status>}
        />

        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          {([
            ["OWN", "Own dispatch", ownRows.length],
            ["PLATFORM", "Platform delivery", platformRows.length],
            ["ALL", "All", scopedRows.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={
                view === value
                  ? "rounded-md bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground"
                  : "rounded-md bg-secondary px-3 py-2 text-[12px] font-semibold text-foreground hover:bg-secondary/80"
              }
            >
              {label} · {count}
            </button>
          ))}
        </div>

        <EnterpriseTable
          rows={visibleRows}
          columns={columns}
          filters={[`Branch: ${branch}`, view === "OWN" ? "Fulfilment: Restaurant" : view === "PLATFORM" ? "Fulfilment: Platform" : "Fulfilment: All"]}
          renderExpanded={(row) => (
            <div className="space-y-3 text-[12px]">
              <div className="grid gap-2 rounded-md bg-secondary/40 p-3 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <div className="text-muted-foreground">App/platform paid</div>
                  <div className="num font-semibold">{ksh(row.appPaid)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cash/customer due</div>
                  <div className="num font-semibold">{ksh(row.cashDue)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Expected from marketplace</div>
                  <div className="num font-semibold">{ksh(row.providerExpected)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Collection route</div>
                  <div className="font-semibold">{row.collectionMethod}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Collection status</div>
                  <div className="font-semibold">{row.collectionStatus}</div>
                </div>
              </div>

              {!row.ownDispatch ? (
                <div className="rounded-md border border-border px-3 py-2 text-muted-foreground">
                  Courier assignment is controlled by {row.channel}. Seramet tracks preparation,
                  provider pickup and the exact marketplace receivable separately from Mona rider
                  accounts.
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={
                      selectedRiders[row.orderId] ?? (row.rider === "Unassigned" ? "" : row.rider)
                    }
                    onChange={(event) =>
                      setSelectedRiders((current) => ({
                        ...current,
                        [row.orderId]: event.target.value,
                      }))
                    }
                    className="h-9 rounded-md border border-border bg-card px-2 text-[12px]"
                  >
                    <option value="">Select rider</option>
                    {availableRiders
                      .filter((rider) => rider.branch === row.branch)
                      .map((rider) => (
                        <option key={rider.id} value={rider.name}>
                          {rider.name}
                        </option>
                      ))}
                  </select>
                  <Btn
                    onClick={() => void assign(row)}
                    disabled={!availableRiders.some((rider) => rider.branch === row.branch)}
                  >
                    {row.rider === "Unassigned" ? "Assign rider" : "Reassign"}
                  </Btn>
                  <Btn
                    onClick={() => void move(row, "PICKED_UP")}
                    disabled={
                      row.rider === "Unassigned" ||
                      row.deliveryState !== "ASSIGNED" ||
                      row.status !== "Ready for pickup"
                    }
                  >
                    Picked up
                  </Btn>
                  <Btn
                    onClick={() => void move(row, "OUT_FOR_DELIVERY")}
                    disabled={row.deliveryState !== "PICKED_UP"}
                  >
                    Out for delivery
                  </Btn>
                  <Btn
                    variant="primary"
                    onClick={() => void move(row, "DELIVERED")}
                    disabled={row.deliveryState !== "OUT_FOR_DELIVERY"}
                  >
                    Delivered
                  </Btn>
                </div>
              )}

              {row.ownDispatch && row.collectionAmount > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <span className="mr-1 font-semibold">Customer payment:</span>
                  {["Not set", "Customer due"].includes(row.collectionMethod) && (
                    <>
                      <Btn onClick={() => void recordCollection(row, "COMPANY_TILL_DIRECT")}>
                        Paid direct to company Till
                      </Btn>
                      <Btn onClick={() => void recordCollection(row, "RIDER_CASH")}>
                        Rider collected cash
                      </Btn>
                      <Btn onClick={() => void recordCollection(row, "RIDER_MPESA")}>
                        Customer paid rider M-Pesa
                      </Btn>
                    </>
                  )}
                  {row.raw.delivery?.collection?.status === "COLLECTED_BY_RIDER" && (
                    <Btn variant="primary" onClick={() => void remit(row)}>
                      Mark remitted
                    </Btn>
                  )}
                  {row.raw.delivery?.collection?.status === "REMITTED_PENDING_CONFIRMATION" && (
                    <Btn variant="primary" onClick={() => void confirmRemittance(row)}>
                      Confirm restaurant received funds
                    </Btn>
                  )}
                </div>
              )}
            </div>
          )}
        />
      </Panel>

      <Panel className="mt-4">
        <PanelHead
          title="Delivery status lifecycle"
          sub="Declined, failed, returned and cancelled remain exception paths"
        />
        <div className="flex flex-wrap items-center gap-2 px-4 py-4">
          {lifecycle.map((step, index) => (
            <span key={step} className="flex items-center gap-2">
              <Status>{step}</Status>
              {index < lifecycle.length - 1 && <span className="text-muted-foreground">-&gt;</span>}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {["Declined", "Failed delivery", "Returned", "Cancelled"].map((exception) => (
            <Status key={exception}>{exception}</Status>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
