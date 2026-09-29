import { createFileRoute } from "@tanstack/react-router";
import { Wifi } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export const Route = createFileRoute("/online-orders")({
  head: () => ({
    meta: [
      { title: "Online Orders - Seramet" },
      {
        name: "description",
        content: "Online order intake, acceptance, fulfilment and channel reconciliation.",
      },
    ],
  }),
  component: OnlineOrders,
});

function OnlineOrders() {
  const { activeTenantId, branchLabel, matchesBranch } = useAppContext();
  const { state } = useTransactionEngine();
  const [syncNotice, setSyncNotice] = useState("");
  const repository = getConfigurationRepository();
  const channels = repository.listOrderChannels(activeTenantId, true);
  const onlineChannels = channels.filter(
    (channel) => !["DINE_IN", "TAKEAWAY", "KIOSK"].includes(channel.channelType),
  );
  const resolveChannel = (value: string) =>
    onlineChannels.find(
      (channel) => channel.id === value || channel.code === value || channel.displayName === value,
    );
  const rows = state.orders
    .filter((order) => matchesBranch(order.branchId ?? order.branch))
    .filter((order) => Boolean(resolveChannel(order.channel)))
    .map((order) => {
      const channel = resolveChannel(order.channel)!;
      const partner = channel.displayName;
      const payments = state.payments.filter((payment) => payment.orderId === order.id);
      const receivable = state.marketplaceReceivables.find(
        (candidate) => candidate.orderId === order.id,
      );
      const settlement = receivable
        ? receivable.status.replaceAll("_", " ")
        : payments.length
          ? Array.from(
              new Set(payments.map((payment) => payment.method.replaceAll("_", " "))),
            ).join(" + ")
          : channel.isExternallyPaid
            ? "Provider receivable pending"
            : "Pending";
      const account =
        receivable?.receivableAccount ??
        (channel.isExternallyPaid ? "Marketplace Receivables" : "Direct customer");
      return {
        ...order,
        partner,
        settlement,
        account,
        receivable,
        channelType: channel.channelType,
      };
    });
  const pending = rows.filter(
    (order) => order.paymentStatus !== "PAID" || !["PAID", "SERVED"].includes(order.status),
  ).length;
  const value = rows.reduce((sum, order) => sum + order.total, 0);

  return (
    <AppShell
      title="Online orders"
      subtitle={`Channel orders routed into the unified Seramet order engine - ${branchLabel}`}
      actions={
        <Btn
          onClick={() => {
            const connections = repository
              .listConnections(activeTenantId)
              .filter(
                (connection) => connection.status === "ACTIVE" || connection.status === "SANDBOX",
              );
            setSyncNotice(
              connections.length
                ? `${connections.length} connected channel${connections.length === 1 ? "" : "s"} queued for synchronization.`
                : "No connected order provider is available. Configure one in Integrations.",
            );
          }}
        >
          Sync channels
        </Btn>
      }
    >
      {syncNotice && (
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px] font-medium">
          {syncNotice}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Online queue" value={rows.length} />
        <Metric label="Pending action" value={pending} invert />
        <Metric label="Channel value" value={value} money />
        <Metric
          label="Partner orders"
          value={rows.filter((row) => row.channelType === "MARKETPLACE").length}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Channel intake"
          sub="Every delivery partner and direct online order is now the same persistent Seramet order object"
          right={<Wifi className="h-4 w-4 text-primary" />}
        />
        <div className="hidden md:block">
          <DataTable
            cols={[
              "Order",
              "Time",
              "Customer",
              "Partner",
              { l: "Online price", r: true },
              "Settlement",
              "Account",
              "Status",
            ]}
          >
            {rows.map((order) => (
              <tr key={order.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{order.id}</TD>
                <TD className="num text-muted-foreground">{order.createdAt.slice(11, 16)}</TD>
                <TD>{order.customer}</TD>
                <TD>{order.partner}</TD>
                <TD className="num text-right font-semibold">{ksh(order.total)}</TD>
                <TD>
                  <Status>{order.settlement}</Status>
                </TD>
                <TD className="text-muted-foreground">{order.account}</TD>
                <TD>
                  <Status>{order.status.replaceAll("_", " ")}</Status>
                </TD>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <TD className="text-muted-foreground" colSpan={8}>
                  No online or delivery orders have entered this branch yet.
                </TD>
              </tr>
            )}
          </DataTable>
        </div>
        <div className="divide-y divide-border md:hidden">
          {rows.map((order) => (
            <div key={order.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num truncate text-[13px] font-semibold">{order.id}</div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {order.partner} · {order.customer}
                  </div>
                </div>
                <Status>{order.status.replaceAll("_", " ")}</Status>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <OrderDetail label="Online price" value={ksh(order.total)} />
                <OrderDetail label="Received" value={order.createdAt.slice(11, 16)} />
                <OrderDetail label="Settlement" value={order.settlement} />
                <OrderDetail label="Account" value={order.account} />
              </div>
            </div>
          ))}
          {!rows.length && (
            <div className="p-8 text-center text-[12px] text-muted-foreground">
              No online or delivery orders have entered this branch yet.
            </div>
          )}
        </div>
      </Panel>
    </AppShell>
  );
}

function OrderDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-secondary/40 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-semibold">{value}</div>
    </div>
  );
}
