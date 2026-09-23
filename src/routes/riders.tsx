import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import {
  customerCollectedAmount,
  resolveDeliveryFulfilment,
  riderHeldAmount,
  riderOutstandingForOrder,
} from "@/delivery/delivery-model";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { currentDateKey, ksh } from "@/lib/currency";
import type {
  RiderRemittanceMethod,
  TransactionOrder,
} from "@/lib/transaction-engine";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

type Rider = {
  id: string;
  name: string;
  branch: string;
  shift: string;
  clockedIn: string;
  activeTasks: number;
  completedToday: number;
  deliveredValueToday: number;
  toRemit: number;
  status: string;
  orders: TransactionOrder[];
};

type RemittanceDraft = {
  amount: string;
  method: RiderRemittanceMethod;
  reference: string;
};

export const Route = createFileRoute("/riders")({
  head: () => ({
    meta: [
      { title: "Riders - Seramet" },
      {
        name: "description",
        content:
          "Rider roster, own-delivery workload, delivered value and customer-funds remittance.",
      },
      { property: "og:title", content: "Riders - Seramet" },
      {
        property: "og:description",
        content:
          "Manage rider availability, delivery workload and rider-held cash/M-Pesa accountability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Riders,
});

const columns: EnterpriseColumn<Rider>[] = [
  { key: "name", label: "Rider", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "shift", label: "Shift", sortable: true },
  { key: "clockedIn", label: "Clocked in" },
  { key: "activeTasks", label: "Active", align: "right", sortable: true },
  { key: "completedToday", label: "Delivered", align: "right", sortable: true },
  {
    key: "deliveredValueToday",
    label: "Delivered value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.deliveredValueToday)}</span>,
  },
  {
    key: "toRemit",
    label: "To remit",
    align: "right",
    sortable: true,
    render: (row) => (
      <span className={row.toRemit > 0 ? "num font-bold text-warning" : "num font-semibold"}>
        {ksh(row.toRemit)}
      </span>
    ),
  },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

const eligibility = [
  "Assigned to the branch",
  "On the current shift",
  "Clocked in / not marked absent",
  "Available (not on break)",
  "Not overloaded",
  "Not on leave or off day",
];

const strategies = [
  "Manual dispatcher assignment",
  "Auto round-robin",
  "First available",
  "Least active deliveries",
  "First rider to accept",
];

function Riders() {
  const {
    activeTenantId,
    branch,
    branchLabel,
    isAllBranches,
    matchesBranch,
  } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [notice, setNotice] = useState("");
  const [remittanceDrafts, setRemittanceDrafts] = useState<Record<string, RemittanceDraft>>({});
  const today = currentDateKey();
  const repository = getConfigurationRepository();
  const channels = repository.listOrderChannels(activeTenantId, true);
  const resolveChannel = (value: string) =>
    channels.find(
      (channel) => channel.id === value || channel.code === value || channel.displayName === value,
    );

  const ownDeliveryOrders = useMemo(
    () =>
      state.orders.filter((order) => {
        if (!matchesBranch(order.branchId ?? order.branch)) return false;
        const channel = resolveChannel(order.channel);
        return Boolean(channel && resolveDeliveryFulfilment(order, channel) === "OWN_DELIVERY");
      }),
    [channels, matchesBranch, state.orders],
  );

  const scopedRows = useMemo<Rider[]>(() => {
    const employees = state.employees.filter(
      (employee) =>
        employee.active &&
        employee.role === "Rider" &&
        matchesBranch(employee.branchId ?? employee.branch),
    );
    return employees.map((employee) => {
      const attendance = state.attendanceRecords.find(
        (record) => record.employeeId === employee.id && record.date === today,
      );
      const ownOrders = ownDeliveryOrders.filter(
        (order) => order.branch === employee.branch && order.delivery?.rider === employee.name,
      );
      const activeTasks = ownOrders.filter(
        (order) =>
          order.delivery?.status !== "DELIVERED" &&
          !["CANCELLED", "REFUNDED"].includes(order.status),
      ).length;
      const deliveredTodayOrders = ownOrders.filter(
        (order) =>
          order.delivery?.status === "DELIVERED" &&
          (order.delivery.deliveredAt ?? "").slice(0, 10) === today,
      );
      const completedToday = deliveredTodayOrders.length;
      const deliveredValueToday = deliveredTodayOrders.reduce(
        (sum, order) => sum + order.total,
        0,
      );
      const toRemit = ownOrders.reduce(
        (sum, order) => sum + riderOutstandingForOrder(state, order),
        0,
      );
      let status = attendance?.clockIn
        ? activeTasks > 0
          ? "In progress"
          : "Available"
        : "Not clocked in";
      if (attendance?.status === "ABSENT") status = "Absent";
      if (attendance?.status === "ON_LEAVE") status = "On leave";
      if (attendance?.status === "OFF") status = "Off shift";
      return {
        id: employee.id,
        name: employee.name,
        branch: employee.branch,
        shift: employee.shift,
        clockedIn: attendance?.clockIn ?? "-",
        activeTasks,
        completedToday,
        deliveredValueToday,
        toRemit,
        status,
        orders: ownOrders,
      };
    });
  }, [
    matchesBranch,
    ownDeliveryOrders,
    state,
    state.attendanceRecords,
    state.employees,
    today,
  ]);

  const available = scopedRows.filter((row) => row.status === "Available");
  const totalActive = scopedRows.reduce((sum, row) => sum + row.activeTasks, 0);
  const deliveredValueToday = scopedRows.reduce(
    (sum, row) => sum + row.deliveredValueToday,
    0,
  );
  const totalToRemit = scopedRows.reduce((sum, row) => sum + row.toRemit, 0);

  const addRider = () => {
    if (isAllBranches) {
      setNotice("Select a single branch before adding a rider.");
      return;
    }
    const name = window.prompt("Rider name");
    if (!name?.trim()) return;
    const shift = window.prompt("Shift (HH:MM-HH:MM)", "10:00-21:30") ?? "10:00-21:30";
    void mutate("addRider", { name, branch, shift });
    setNotice(`${name.trim()} added to the ${branch} rider roster.`);
  };

  const remittanceDraftFor = (row: Rider): RemittanceDraft =>
    remittanceDrafts[row.id] ?? {
      amount: String(row.toRemit),
      method: "CASH_HANDOVER",
      reference: "",
    };

  const updateRemittanceDraft = (row: Rider, patch: Partial<RemittanceDraft>) => {
    setRemittanceDrafts((current) => ({
      ...current,
      [row.id]: {
        ...(current[row.id] ?? {
          amount: String(row.toRemit),
          method: "CASH_HANDOVER",
          reference: "",
        }),
        ...patch,
      },
    }));
  };

  const receiveRemittance = async (row: Rider) => {
    const draft = remittanceDraftFor(row);
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("Enter the amount received from the rider.");
      return;
    }
    if (amount > row.toRemit) {
      setNotice(`${row.name} only has ${ksh(row.toRemit)} outstanding.`);
      return;
    }
    try {
      await mutate("recordRiderRemittance", {
        input: {
          rider: row.name,
          branch: row.branch,
          method: draft.method,
          amount,
          ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
        },
      });
      setRemittanceDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setNotice(
        `${ksh(amount)} received from ${row.name}. This clears rider custody only; it does not create another sale.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Rider remittance could not be recorded.");
    }
  };

  return (
    <AppShell
      title="Riders"
      subtitle={`Own-delivery workload, value and remittance accountability  -  ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => (window.location.href = "/delivery")}>View delivery queue</Btn>
          <Btn variant="primary" onClick={addRider}>
            Add rider
          </Btn>
        </>
      }
    >
      {notice && (
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px] font-medium">
          {notice} <span className="ml-2 text-muted-foreground">Backend: {backendStatus}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Riders on roster" value={scopedRows.length} />
        <Metric label="Available now" value={available.length} />
        <Metric label="Active deliveries" value={totalActive} />
        <Metric label="Delivered value today" value={deliveredValueToday} money />
        <Metric label="To remit" value={totalToRemit} money invert={totalToRemit > 0} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Rider roster"
          sub="Only restaurant-fulfilled deliveries count toward rider workload, delivered value and custody"
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Fulfilment: Restaurant rider", "Shift: Today"]}
          renderExpanded={(row) => {
            const pending = row.orders.filter(
              (order) => riderOutstandingForOrder(state, order) > 0,
            );
            const draft = remittanceDraftFor(row);
            return (
              <div className="grid gap-3 text-[12px]">
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Assigned own deliveries
                    </div>
                    <div className="mt-1 text-lg font-bold">{row.orders.length}</div>
                  </div>
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Customer funds held
                    </div>
                    <div className="num mt-1 text-lg font-bold">
                      {ksh(
                        row.orders.reduce(
                          (sum, order) => sum + riderHeldAmount(order),
                          0,
                        ),
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Outstanding remittance
                    </div>
                    <div className="num mt-1 text-lg font-bold text-warning">{ksh(row.toRemit)}</div>
                  </div>
                </div>

                {pending.length > 0 && (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <div className="min-w-[720px]">
                      <div className="grid grid-cols-[1fr_1fr_110px_130px_130px] gap-2 bg-secondary px-3 py-2 font-semibold">
                        <span>Order</span>
                        <span>Source</span>
                        <span className="text-right">Value</span>
                        <span className="text-right">Rider collected</span>
                        <span className="text-right">To remit</span>
                      </div>
                      {pending.map((order) => {
                        const channel = resolveChannel(order.channel);
                        return (
                          <div
                            key={order.id}
                            className="grid grid-cols-[1fr_1fr_110px_130px_130px] gap-2 border-t border-border px-3 py-2"
                          >
                            <span className="font-semibold">{order.id}</span>
                            <span>{channel?.displayName ?? order.channel}</span>
                            <span className="num text-right">{ksh(order.total)}</span>
                            <span className="num text-right">{ksh(riderHeldAmount(order))}</span>
                            <span className="num text-right font-bold text-warning">
                              {ksh(riderOutstandingForOrder(state, order))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {row.toRemit > 0 ? (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border border-warning/30 bg-warning-soft p-3">
                    <label className="grid gap-1 font-semibold">
                      Receive via
                      <select
                        value={draft.method}
                        onChange={(event) =>
                          updateRemittanceDraft(row, {
                            method: event.target.value as RiderRemittanceMethod,
                          })
                        }
                        className="h-9 rounded-md border border-border bg-card px-2 text-foreground"
                      >
                        <option value="CASH_HANDOVER">Cash handover</option>
                        <option value="MPESA_TO_TILL">M-Pesa to company Till</option>
                      </select>
                    </label>
                    <label className="grid gap-1 font-semibold">
                      Amount
                      <input
                        inputMode="decimal"
                        value={draft.amount}
                        onChange={(event) =>
                          updateRemittanceDraft(row, { amount: event.target.value })
                        }
                        className="h-9 w-36 rounded-md border border-border bg-card px-2 text-foreground"
                      />
                    </label>
                    <label className="grid min-w-56 flex-1 gap-1 font-semibold">
                      Reference
                      <input
                        value={draft.reference}
                        onChange={(event) =>
                          updateRemittanceDraft(row, { reference: event.target.value })
                        }
                        placeholder={
                          draft.method === "MPESA_TO_TILL"
                            ? "Company Till transaction reference"
                            : "Optional handover note/reference"
                        }
                        className="h-9 rounded-md border border-border bg-card px-2 text-foreground"
                      />
                    </label>
                    <Btn variant="primary" onClick={() => void receiveRemittance(row)}>
                      Receive remittance
                    </Btn>
                  </div>
                ) : (
                  <div className="rounded-md bg-success-soft px-3 py-2 font-semibold text-success">
                    No rider-held customer funds are outstanding.
                  </div>
                )}

                <p className="text-muted-foreground">
                  Direct Company Till and already-paid-online orders do not create rider custody.
                  Cash or customer M-Pesa received by the rider stays outstanding until a cashier or
                  supervisor confirms the handover/transfer here.
                </p>
              </div>
            );
          }}
        />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Eligibility rules" sub="A rider must satisfy these before assignment" />
          <ul className="space-y-2 px-4 py-4 text-[13px]">
            {eligibility.map((rule) => (
              <li key={rule} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {rule}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHead
            title="Assignment strategy"
            sub="Manual assignment is active; automation can be enabled per branch later"
          />
          <div className="flex flex-wrap gap-2 px-4 py-4">
            {strategies.map((strategy) => (
              <Status key={strategy}>{strategy}</Status>
            ))}
          </div>
          <p className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
            Delivery value is operational workload, not rider earnings. Rider custody is separately
            tracked from sales so remittance never doubles revenue.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
