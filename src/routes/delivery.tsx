import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine, type TransactionOrder } from "@/lib/transaction-engine";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

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
  deliveryState: NonNullable<TransactionOrder["delivery"]>["status"] | "PLATFORM";
};

export const Route = createFileRoute("/delivery")({
  head: () => ({
    meta: [
      { title: "Delivery Tasks - Seramet" },
      {
        name: "description",
        content: "Single delivery engine for configured marketplace and direct delivery channels.",
      },
      { property: "og:title", content: "Delivery Tasks - Seramet" },
      {
        property: "og:description",
        content: "Track delivery tasks, rider assignment and delivery status across all channels.",
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
  const { activeTenantId, branch, branchLabel, currentUser, matchesBranch } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [selectedRiders, setSelectedRiders] = useState<Record<string, string>>({});
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
    .filter((order) => Boolean(resolveChannel(order.channel)))
    .map((order, index) => {
      const channel = resolveChannel(order.channel)!;
      const ownDispatch =
        channel.channelType !== "MARKETPLACE" &&
        channel.metadata["riderManagedExternally"] !== true;
      return {
        id: `DLT-${order.id.replace(/\D/g, "").slice(-6) || String(index + 1).padStart(4, "0")}`,
        orderId: order.id,
        order: order.id,
        channel: channel.displayName,
        customer: order.customer,
        rider: ownDispatch ? (order.delivery?.rider ?? "Unassigned") : "Platform rider",
        branch: order.branch,
        value: order.total,
        status: deliveryStatus(order, ownDispatch),
        eta: deliveryEta(order),
        ownDispatch,
        deliveryState: ownDispatch ? (order.delivery?.status ?? "UNASSIGNED") : "PLATFORM",
      };
    });

  const assign = (row: DeliveryTask, riderOverride?: string) => {
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
    void mutate("assignDeliveryRider", { orderId: row.orderId, rider });
    setNotice(`${rider} assigned to ${row.orderId}.`);
  };

  const move = (row: DeliveryTask, status: NonNullable<TransactionOrder["delivery"]>["status"]) => {
    void mutate("setDeliveryStatus", { orderId: row.orderId, status });
    setNotice(`${row.orderId} updated to ${status.replaceAll("_", " ").toLowerCase()}.`);
  };

  const columns: EnterpriseColumn<DeliveryTask>[] = [
    { key: "id", label: "Task", sortable: true },
    { key: "order", label: "Order", sortable: true },
    { key: "channel", label: "Channel", sortable: true },
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
    { key: "eta", label: "ETA" },
    { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
  ];

  const active = scopedRows.filter(
    (row) => !["Delivered", "Cancelled", "Returned"].includes(row.status),
  );
  const unassigned = active.filter((row) => row.ownDispatch && row.rider === "Unassigned");

  return (
    <AppShell
      title="Delivery"
      subtitle={`One delivery engine across all channels  -  ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => (window.location.href = "/riders")}>Dispatch settings</Btn>
          <Btn
            variant="primary"
            disabled={unassigned.length === 0 || availableRiders.length === 0}
            onClick={() => unassigned[0] && assign(unassigned[0])}
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
        <Metric label="Active deliveries" value={active.length} />
        <Metric label="Unassigned" value={unassigned.length} invert />
        <Metric
          label="Delivery value"
          value={scopedRows.reduce((sum, row) => sum + row.value, 0)}
          money
        />
        <Metric
          label="Ready for pickup"
          value={scopedRows.filter((row) => row.status === "Ready for pickup").length}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Delivery tasks"
          sub="The same persistent order drives kitchen readiness, rider assignment and dispatch"
          right={<Status>{availableRiders.length} rider(s) eligible</Status>}
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Status: Active"]}
          renderExpanded={(row) => (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {!row.ownDispatch ? (
                <span className="text-muted-foreground">
                  Rider assignment is controlled by {row.channel}; Seramet tracks the
                  restaurant-side order lifecycle.
                </span>
              ) : (
                <>
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
                    onClick={() => assign(row)}
                    disabled={!availableRiders.some((rider) => rider.branch === row.branch)}
                  >
                    {row.rider === "Unassigned" ? "Assign rider" : "Reassign"}
                  </Btn>
                  <Btn
                    onClick={() => move(row, "PICKED_UP")}
                    disabled={
                      row.rider === "Unassigned" ||
                      row.deliveryState !== "ASSIGNED" ||
                      row.status !== "Ready for pickup"
                    }
                  >
                    Picked up
                  </Btn>
                  <Btn
                    onClick={() => move(row, "OUT_FOR_DELIVERY")}
                    disabled={row.deliveryState !== "PICKED_UP"}
                  >
                    Out for delivery
                  </Btn>
                  <Btn
                    variant="primary"
                    onClick={() => move(row, "DELIVERED")}
                    disabled={row.deliveryState !== "OUT_FOR_DELIVERY"}
                  >
                    Delivered
                  </Btn>
                </>
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
