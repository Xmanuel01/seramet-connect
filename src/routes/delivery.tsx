import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import {
  customerCollectedAmount,
  deliveryFundsStatus,
  resolveDeliveryFulfilment,
  riderHeldAmount,
  riderOutstandingForOrder,
  type DeliveryFulfilment,
} from "@/delivery/delivery-model";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import {
  type DeliveryCollectionMethod,
  type TransactionOrder,
} from "@/lib/transaction-engine";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { cn } from "@/lib/utils";

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
  ownDispatch: boolean;
  fulfilment: DeliveryFulfilment;
  deliveryState: NonNullable<TransactionOrder["delivery"]>["status"] | "PLATFORM";
  fundsStatus: string;
  riderCollected: number;
  toRemit: number;
  orderRecord: TransactionOrder;
};

type CollectionDraft = {
  method: DeliveryCollectionMethod;
  amount: string;
  reference: string;
};

type DeliveryView = "OWN" | "PLATFORM" | "ALL";

export const Route = createFileRoute("/delivery")({
  head: () => ({
    meta: [
      { title: "Delivery Tasks - Seramet" },
      {
        name: "description",
        content: "Restaurant-rider and platform delivery operations with rider custody controls.",
      },
      { property: "og:title", content: "Delivery Tasks - Seramet" },
      {
        property: "og:description",
        content:
          "Track fulfilment ownership, rider assignment, collections and remittance without double-counting sales.",
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

const collectionLabels: Record<DeliveryCollectionMethod, string> = {
  COMPANY_TILL: "Company Till",
  CASH_TO_RIDER: "Cash to rider",
  RIDER_MPESA: "Rider M-Pesa",
  ALREADY_PAID_ONLINE: "Already paid online",
};

function deliveryStatus(order: TransactionOrder, ownDispatch: boolean) {
  if (order.status === "CANCELLED") return "Cancelled";
  if (order.status === "REFUNDED") return "Returned";
  if (ownDispatch) {
    const status = order.delivery?.status ?? "UNASSIGNED";
    if (status === "DELIVERED") return "Delivered";
    if (status === "OUT_FOR_DELIVERY") return "Out for delivery";
    if (status === "PICKED_UP") return "Picked up";
  }
  if (order.status === "PAID") return "Delivered";
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
  if (order.delivery?.status === "DELIVERED" || order.status === "PAID") return "Completed";
  if (order.delivery?.status === "OUT_FOR_DELIVERY") return `${ageMinutes} min since intake`;
  if (order.status === "READY" || order.status === "SERVED")
    return `Ready ${ageMinutes} min after intake`;
  return `${ageMinutes} min in queue`;
}

function Delivery() {
  const { activeTenantId, branch, branchLabel, matchesBranch } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [selectedRiders, setSelectedRiders] = useState<Record<string, string>>({});
  const [collectionDrafts, setCollectionDrafts] = useState<Record<string, CollectionDraft>>({});
  const [view, setView] = useState<DeliveryView>("OWN");
  const [notice, setNotice] = useState("");
  const repository = getConfigurationRepository();
  const tenant = repository.getTenant(activeTenantId);
  const deliveryChannels = repository
    .listOrderChannels(activeTenantId, true)
    .filter((channel) => !["DINE_IN", "TAKEAWAY", "KIOSK"].includes(channel.channelType));
  const resolveChannel = (value: string) =>
    deliveryChannels.find(
      (channel) => channel.id === value || channel.code === value || channel.displayName === value,
    );

  const availableRiders = useMemo(
    () =>
      state.employees.filter((employee) => {
        if (!employee.active || employee.role !== "Rider") return false;
        if (!matchesBranch(employee.branch)) return false;
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

  const scopedRows: DeliveryTask[] = state.orders
    .filter((order) => matchesBranch(order.branchId ?? order.branch))
    .flatMap((order, index) => {
      const channel = resolveChannel(order.channel);
      if (!channel) return [];
      const fulfilment = resolveDeliveryFulfilment(order, channel);
      if (fulfilment === "NOT_DELIVERY" || fulfilment === "PICKUP") return [];
      const ownDispatch = fulfilment === "OWN_DELIVERY";
      const providerRider = order.delivery?.rider?.trim();
      return [
        {
          id: `DLT-${order.id.replace(/\D/g, "").slice(-6) || String(index + 1).padStart(4, "0")}`,
          orderId: order.id,
          order: order.id,
          channel: channel.displayName,
          customer: order.customer,
          rider: ownDispatch
            ? (order.delivery?.rider ?? "Unassigned")
            : (providerRider ?? `${channel.displayName} rider`),
          branch: order.branch,
          value: order.total,
          status: deliveryStatus(order, ownDispatch),
          eta: deliveryEta(order),
          ownDispatch,
          fulfilment,
          deliveryState: ownDispatch ? (order.delivery?.status ?? "UNASSIGNED") : "PLATFORM",
          fundsStatus: ownDispatch ? deliveryFundsStatus(state, order) : "Platform managed",
          riderCollected: ownDispatch ? riderHeldAmount(order) : 0,
          toRemit: ownDispatch ? riderOutstandingForOrder(state, order) : 0,
          orderRecord: order,
        },
      ];
    });

  const active = scopedRows.filter(
    (row) => !["Delivered", "Cancelled", "Returned"].includes(row.status),
  );
  const ownRows = scopedRows.filter((row) => row.ownDispatch);
  const ownActive = active.filter((row) => row.ownDispatch);
  const platformRows = scopedRows.filter((row) => !row.ownDispatch);
  const unassigned = ownActive.filter((row) => row.rider === "Unassigned");
  const visibleRows =
    view === "OWN" ? ownRows : view === "PLATFORM" ? platformRows : scopedRows;

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
      const collectionMissing =
        status === "DELIVERED" &&
        customerCollectedAmount(row.orderRecord) === 0 &&
        !["PAID", "PROVIDER_RECEIVABLE"].includes(row.orderRecord.paymentStatus);
      setNotice(
        collectionMissing
          ? `${row.orderId} delivered. Record how the customer paid before closing rider accountability.`
          : `${row.orderId} updated to ${status.replaceAll("_", " ").toLowerCase()}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Delivery status update failed.");
    }
  };

  const draftFor = (row: DeliveryTask): CollectionDraft =>
    collectionDrafts[row.orderId] ?? {
      method: "COMPANY_TILL",
      amount: String(Math.max(0, row.value - customerCollectedAmount(row.orderRecord))),
      reference: "",
    };

  const updateDraft = (orderId: string, patch: Partial<CollectionDraft>) => {
    setCollectionDrafts((current) => ({
      ...current,
      [orderId]: {
        ...(current[orderId] ?? {
          method: "COMPANY_TILL",
          amount: "",
          reference: "",
        }),
        ...patch,
      },
    }));
  };

  const recordCollection = async (row: DeliveryTask) => {
    const draft = draftFor(row);
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("Enter the customer amount being recorded.");
      return;
    }
    try {
      await mutate("recordDeliveryCollection", {
        orderId: row.orderId,
        input: {
          method: draft.method,
          amount,
          ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
        },
      });
      setCollectionDrafts((current) => {
        const next = { ...current };
        delete next[row.orderId];
        return next;
      });
      setNotice(
        draft.method === "CASH_TO_RIDER" || draft.method === "RIDER_MPESA"
          ? `${ksh(amount)} recorded in ${row.rider}'s custody for ${row.orderId}.`
          : `${ksh(amount)} recorded as ${collectionLabels[draft.method]} for ${row.orderId}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Customer collection could not be recorded.");
    }
  };

  const columns: EnterpriseColumn<DeliveryTask>[] = [
    { key: "id", label: "Task", sortable: true },
    { key: "order", label: "Order", sortable: true },
    { key: "channel", label: "Source", sortable: true },
    { key: "customer", label: "Customer", sortable: true },
    { key: "rider", label: "Rider", sortable: true },
    { key: "branch", label: "Branch", sortable: true },
    {
      key: "value",
      label: "Order value",
      align: "right",
      sortable: true,
      render: (row) => <span className="num font-semibold">{ksh(row.value)}</span>,
    },
    {
      key: "fundsStatus",
      label: "Funds",
      render: (row) => <Status>{row.fundsStatus}</Status>,
    },
    { key: "eta", label: "ETA" },
    { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
  ];

  return (
    <AppShell
      title="Delivery"
      subtitle={`Restaurant-rider and platform delivery operations  -  ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => (window.location.href = "/riders")}>Rider accountability</Btn>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Active own deliveries" value={ownActive.length} />
        <Metric label="Unassigned" value={unassigned.length} invert />
        <Metric
          label="Own-delivery value"
          value={ownActive.reduce((sum, row) => sum + row.value, 0)}
          money
        />
        <Metric
          label="Ready for pickup"
          value={ownActive.filter((row) => row.status === "Ready for pickup").length}
        />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Delivery tasks"
          sub="Source and fulfilment are separate: only restaurant-rider orders affect rider workload and custody"
          right={<Status>{availableRiders.length} rider(s) eligible</Status>}
        />

        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          {(
            [
              ["OWN", `Own dispatch (${ownRows.length})`],
              ["PLATFORM", `Platform delivery (${platformRows.length})`],
              ["ALL", `All (${scopedRows.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "rounded-md px-3 py-2 text-[12px] font-semibold transition-colors",
                view === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground hover:bg-secondary/80",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <EnterpriseTable
          rows={visibleRows}
          columns={columns}
          filters={[
            `Branch: ${branch}`,
            view === "OWN"
              ? "Fulfilment: Restaurant rider"
              : view === "PLATFORM"
                ? "Fulfilment: Platform rider"
                : "Fulfilment: All delivery",
          ]}
          renderExpanded={(row) => {
            if (!row.ownDispatch) {
              return (
                <div className="text-[12px] text-muted-foreground">
                  {row.channel} controls the courier. Seramet tracks restaurant preparation and
                  handoff, but this order does not contribute to Mona rider value, workload or
                  remittance.
                </div>
              );
            }

            const draft = draftFor(row);
            const recorded = customerCollectedAmount(row.orderRecord);
            return (
              <div className="grid gap-3 text-[12px]">
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

                <div className="grid gap-2 rounded-lg border border-border bg-secondary/30 p-3 md:grid-cols-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Customer recorded
                    </div>
                    <div className="num mt-1 font-bold">{ksh(recorded)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Rider collected
                    </div>
                    <div className="num mt-1 font-bold">{ksh(row.riderCollected)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      To remit
                    </div>
                    <div className="num mt-1 font-bold">{ksh(row.toRemit)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Funds status
                    </div>
                    <div className="mt-1 font-bold">{row.fundsStatus}</div>
                  </div>
                </div>

                {recorded < row.value && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="grid gap-1 font-semibold text-muted-foreground">
                      Customer paid via
                      <select
                        value={draft.method}
                        onChange={(event) =>
                          updateDraft(row.orderId, {
                            method: event.target.value as DeliveryCollectionMethod,
                          })
                        }
                        className="h-9 rounded-md border border-border bg-card px-2 text-foreground"
                      >
                        {Object.entries(collectionLabels).map(([method, label]) => (
                          <option key={method} value={method}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 font-semibold text-muted-foreground">
                      Amount
                      <input
                        inputMode="decimal"
                        value={draft.amount}
                        onChange={(event) => updateDraft(row.orderId, { amount: event.target.value })}
                        className="h-9 w-32 rounded-md border border-border bg-card px-2 text-foreground"
                      />
                    </label>
                    <label className="grid min-w-52 flex-1 gap-1 font-semibold text-muted-foreground">
                      Reference
                      <input
                        value={draft.reference}
                        onChange={(event) =>
                          updateDraft(row.orderId, { reference: event.target.value })
                        }
                        placeholder={
                          draft.method === "COMPANY_TILL"
                            ? "M-Pesa Till transaction code"
                            : "Optional customer/reference"
                        }
                        className="h-9 rounded-md border border-border bg-card px-2 text-foreground"
                      />
                    </label>
                    <Btn
                      variant="primary"
                      onClick={() => void recordCollection(row)}
                      disabled={
                        (draft.method === "CASH_TO_RIDER" || draft.method === "RIDER_MPESA") &&
                        row.rider === "Unassigned"
                      }
                    >
                      Record collection
                    </Btn>
                  </div>
                )}

                <p className="text-muted-foreground">
                  Rider-held cash and rider M-Pesa create a custody balance only. Later remittance
                  to the restaurant clears that custody balance and never creates another sale.
                </p>
              </div>
            );
          }}
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
