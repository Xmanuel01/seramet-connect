import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { currentDateKey, ksh } from "@/lib/currency";
import {
  collectionMethodLabel,
  collectionStatusLabel,
  isOwnDelivery,
  riderFundsInHandAmount,
  riderRemittancePendingAmount,
} from "@/lib/delivery-operations";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { TransactionOrder } from "@/lib/transaction-engine";

type Rider = {
  id: string;
  name: string;
  branch: string;
  shift: string;
  clockedIn: string;
  activeTasks: number;
  completedToday: number;
  deliveredValue: number;
  fundsInHand: number;
  remittancePending: number;
  status: string;
  orders: TransactionOrder[];
};

export const Route = createFileRoute("/riders")({
  head: () => ({
    meta: [
      { title: "Riders - Seramet" },
      {
        name: "description",
        content:
          "Rider roster, delivery workload, delivered value and collection/remittance accountability.",
      },
      { property: "og:title", content: "Riders - Seramet" },
      {
        property: "og:description",
        content: "Manage rider availability, delivery history and money accountability.",
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
    key: "deliveredValue",
    label: "Delivered value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.deliveredValue)}</span>,
  },
  {
    key: "fundsInHand",
    label: "Funds with rider",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.fundsInHand)}</span>,
  },
  {
    key: "remittancePending",
    label: "Remitted - verify",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.remittancePending)}</span>,
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
  const { activeTenantId, branch, branchLabel, currentUser, isAllBranches, matchesBranch } =
    useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [notice, setNotice] = useState("");
  const today = currentDateKey();
  const repository = getConfigurationRepository();
  const channels = repository.listOrderChannels(activeTenantId, true);
  const resolveChannel = (value: string) =>
    channels.find(
      (channel) => channel.id === value || channel.code === value || channel.displayName === value,
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
      const ownOrders = state.orders.filter(
        (order) =>
          matchesBranch(order.branchId ?? order.branch) &&
          order.delivery?.rider === employee.name &&
          isOwnDelivery(order, resolveChannel(order.channel)),
      );
      const activeTasks = ownOrders.filter(
        (order) =>
          order.delivery?.status !== "DELIVERED" &&
          !["CANCELLED", "REFUNDED"].includes(order.status),
      ).length;
      const completedTodayOrders = ownOrders.filter(
        (order) =>
          order.delivery?.status === "DELIVERED" &&
          (order.delivery.deliveredAt ?? "").slice(0, 10) === today,
      );
      const completedToday = completedTodayOrders.length;
      const deliveredValue = completedTodayOrders.reduce((sum, order) => sum + order.total, 0);
      const fundsInHand = ownOrders.reduce(
        (sum, order) => sum + riderFundsInHandAmount(order),
        0,
      );
      const remittancePending = ownOrders.reduce(
        (sum, order) => sum + riderRemittancePendingAmount(order),
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
        deliveredValue,
        fundsInHand,
        remittancePending,
        status,
        orders: ownOrders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    });
  }, [
    channels,
    matchesBranch,
    state.attendanceRecords,
    state.employees,
    state.orders,
    today,
  ]);

  const available = scopedRows.filter((row) => row.status === "Available");
  const deliveredToday = scopedRows.reduce((sum, row) => sum + row.completedToday, 0);
  const deliveredValueToday = scopedRows.reduce((sum, row) => sum + row.deliveredValue, 0);
  const fundsWithRiders = scopedRows.reduce((sum, row) => sum + row.fundsInHand, 0);
  const remittedPending = scopedRows.reduce((sum, row) => sum + row.remittancePending, 0);

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

  return (
    <AppShell
      title="Riders"
      subtitle={`Rider workload, delivery value and money accountability - ${branchLabel}`}
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Metric label="Riders on roster" value={scopedRows.length} />
        <Metric label="Available now" value={available.length} />
        <Metric
          label="Active deliveries"
          value={scopedRows.reduce((sum, row) => sum + row.activeTasks, 0)}
        />
        <Metric label="Delivered today" value={deliveredToday} />
        <Metric label="Delivered value" value={deliveredValueToday} money />
        <Metric label="Funds with riders" value={fundsWithRiders + remittedPending} money invert />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Rider accounts"
          sub="Only restaurant-fulfilled deliveries count toward rider workload and accountability"
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Shift: Today", "Fulfilment: Restaurant rider"]}
          renderExpanded={(row) => (
            <div className="space-y-3 text-[12px]">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md bg-secondary/40 p-3">
                  <div className="text-muted-foreground">Delivered value today</div>
                  <div className="num mt-1 text-[16px] font-bold">{ksh(row.deliveredValue)}</div>
                </div>
                <div className="rounded-md bg-secondary/40 p-3">
                  <div className="text-muted-foreground">Physically / digitally with rider</div>
                  <div className="num mt-1 text-[16px] font-bold">{ksh(row.fundsInHand)}</div>
                </div>
                <div className="rounded-md bg-secondary/40 p-3">
                  <div className="text-muted-foreground">Remitted, awaiting confirmation</div>
                  <div className="num mt-1 text-[16px] font-bold">{ksh(row.remittancePending)}</div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[760px]">
                  <thead className="bg-secondary/50 text-left text-[11px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Delivery</th>
                      <th className="px-3 py-2">Collection</th>
                      <th className="px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.orders.slice(0, 12).map((order) => {
                      const channel = resolveChannel(order.channel);
                      const collection = order.delivery?.collection;
                      return (
                        <tr key={order.id} className="border-t border-border">
                          <td className="num px-3 py-2 font-semibold">{order.id}</td>
                          <td className="px-3 py-2">{channel?.displayName ?? order.channel}</td>
                          <td className="num px-3 py-2">{ksh(order.total)}</td>
                          <td className="px-3 py-2">
                            {order.delivery?.status.replaceAll("_", " ") ?? "Unassigned"}
                          </td>
                          <td className="px-3 py-2">
                            {collectionMethodLabel(collection?.method)} ·{" "}
                            {collectionStatusLabel(collection?.status)}
                          </td>
                          <td className="num px-3 py-2">{ksh(collection?.amount ?? 0)}</td>
                        </tr>
                      );
                    })}
                    {!row.orders.length && (
                      <tr>
                        <td colSpan={6} className="px-3 py-5 text-center text-muted-foreground">
                          No restaurant-fulfilled deliveries are assigned to this rider yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
            Direct company Till payments never become rider liabilities. Cash or personal M-Pesa
            received by a rider stays outstanding until remitted and independently confirmed.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
