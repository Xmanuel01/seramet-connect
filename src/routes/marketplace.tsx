import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock3, RefreshCw, Store, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { formatMoney } from "@/lib/currency";
import { marketplaceProgress } from "@/integrations/marketplace/order-progress";
import { businessDateForTimestamp } from "@/lib/business-date";
import { permissions } from "@/platform/permissions";
import type {
  MarketplaceSyncPreview,
  NormalizedMarketplaceMenu,
} from "@/integrations/marketplace/types";
import type {
  ExternalResourceMapping,
  IntegrationDeadLetter,
  IntegrationEvent,
  IntegrationHealthRecord,
  IntegrationOutbox,
} from "@/integrations/runtime/models";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { ProviderCapability } from "@/platform/types";
import { parseMarketplaceConnectionConfig } from "@/integrations/marketplace/types";

export const Route = createFileRoute("/marketplace")({
  head: () => ({
    meta: [
      { title: "Marketplace - Seramet" },
      {
        name: "description",
        content: "Two-way marketplace orders, menu synchronization and live exceptions.",
      },
    ],
  }),
  component: MarketplaceControlCentre,
});

type Diagnostics = {
  events: IntegrationEvent[];
  mappings: ExternalResourceMapping[];
  outbox: IntegrationOutbox[];
  deadLetters: IntegrationDeadLetter[];
  health: IntegrationHealthRecord[];
};

const emptyDiagnostics: Diagnostics = {
  events: [],
  mappings: [],
  outbox: [],
  deadLetters: [],
  health: [],
};

function MarketplaceControlCentre() {
  const {
    activeTenantId,
    branchId,
    branchLabel,
    currentUser,
    matchesBranch,
    timeZone,
    hasPermission,
  } = useAppContext();
  const { state } = useTransactionEngine();
  const configuration = useMemo(() => getConfigurationRepository(), []);
  const providers = useMemo(
    () => configuration.listProviders().filter((provider) => provider.category === "DELIVERY"),
    [configuration],
  );
  const connections = useMemo(
    () =>
      configuration
        .listConnections(activeTenantId, branchId)
        .filter((connection) =>
          providers.some((provider) => provider.id === connection.providerId),
        ),
    [activeTenantId, branchId, configuration, providers],
  );
  const [tab, setTab] = useState<"ORDERS" | "MENU_SYNC" | "RECONCILIATION" | "EXCEPTIONS">(
    "ORDERS",
  );
  const [history, setHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedConnectionId, setSelectedConnectionId] = useState(connections[0]?.id ?? "");
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(emptyDiagnostics);
  const [preview, setPreview] = useState<MarketplaceSyncPreview | null>(null);
  const [previewMenu, setPreviewMenu] = useState<NormalizedMarketplaceMenu | null>(null);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [prepMinutes, setPrepMinutes] = useState(25);
  const [rejectionReason, setRejectionReason] = useState("");
  const [restoreAt, setRestoreAt] = useState("");
  const [allMarketplaces, setAllMarketplaces] = useState(true);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const scope = `${activeTenantId}:${branchId}:${currentUser.id}`;
  const currentScope = useRef(scope);
  const selectedOrder = state.orders.find(
    (order) => order.id === selectedOrderId && matchesBranch(order.branchId ?? order.branch),
  );
  const orderProvider = providers.find(
    (provider) => provider.id === selectedOrder?.externalSource?.providerId,
  );
  const orderConnection = connections.find(
    (connection) => connection.id === selectedOrder?.externalSource?.connectionId,
  );
  const maximumPrepMinutes = parseMarketplaceConnectionConfig(
    orderConnection?.configuration ?? {},
  ).maximumPrepMinutes;
  const decision = diagnostics.outbox.find(
    (record) =>
      record.connectionId === selectedOrder?.externalSource?.connectionId &&
      record.resourceId === selectedOrder?.externalSource?.externalOrderId &&
      ["ORDER_ACCEPTED", "ORDER_REJECTED"].includes(record.eventType),
  );

  useEffect(() => {
    currentScope.current = scope;
    setSelectedOrderId("");
    setRejectionReason("");
    setRestoreAt("");
    setSelectedItems([]);
    setDiagnostics(emptyDiagnostics);
    setPreview(null);
    setPreviewMenu(null);
    setNotice("");
    setWorking(false);
  }, [scope]);

  const headers = useMemo(
    () => ({
      "content-type": "application/json",
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-user-id": currentUser.id,
      "x-seramet-branch-id": branchId,
    }),
    [activeTenantId, branchId, currentUser.id],
  );

  const loadDiagnostics = useCallback(async () => {
    try {
      const response = await fetch("/api/seramet/integrations/diagnostics", { headers });
      const payload = (await response.json()) as Diagnostics & { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false)
        throw new Error(payload.message ?? "Marketplace diagnostics could not be loaded");
      if (currentScope.current !== scope) return;
      setDiagnostics({
        events: payload.events ?? [],
        mappings: payload.mappings ?? [],
        outbox: payload.outbox ?? [],
        deadLetters: payload.deadLetters ?? [],
        health: payload.health ?? [],
      });
    } catch (error) {
      if (currentScope.current === scope)
        setNotice(error instanceof Error ? error.message : "Marketplace diagnostics failed");
    }
  }, [headers, scope]);

  useEffect(() => {
    void loadDiagnostics();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadDiagnostics();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadDiagnostics]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const connectionScopeKey = connections.map((connection) => connection.id).join("|");
  useEffect(() => {
    if (connections.some((connection) => connection.id === selectedConnectionId)) return;
    setSelectedConnectionId(connections[0]?.id ?? "");
    setPreview(null);
    setPreviewMenu(null);
  }, [connectionScopeKey, connections, selectedConnectionId]);

  const marketplaceOrders = state.orders
    .filter((order) => matchesBranch(order.branchId ?? order.branch))
    .filter((order) => Boolean(order.externalSource))
    .map((order) => {
      const source = order.externalSource!;
      const provider = providers.find((candidate) => candidate.id === source.providerId);
      const receivable = state.marketplaceReceivables.find(
        (candidate) => candidate.id === source.marketplaceReceivableId,
      );
      const health = diagnostics.health.find(
        (candidate) => candidate.connectionId === source.connectionId,
      );
      const receivedAt = new Date(source.receivedAt).getTime();
      const ageMinutes = Math.max(0, Math.floor((now.getTime() - receivedAt) / 60_000));
      const connection = connections.find((candidate) => candidate.id === source.connectionId);
      const slaMinutes = Number(connection?.configuration["slaWarningMinutes"] ?? 20);
      return {
        ...order,
        progress: marketplaceProgress(order, diagnostics.outbox),
        source,
        provider,
        receivable,
        health,
        ageMinutes,
        slaWarning:
          !["READY", "SERVED", "PAID", "CANCELLED"].includes(order.status) &&
          ageMinutes >= slaMinutes,
      };
    })
    .filter((order) => providerFilter === "ALL" || order.source.connectionId === providerFilter)
    .filter((order) => statusFilter === "ALL" || order.progress.progress === statusFilter)
    .filter(
      (order) =>
        history ||
        !order.progress.closed ||
        businessDateForTimestamp(order.source.receivedAt, timeZone) ===
          businessDateForTimestamp(now, timeZone),
    )
    .filter((order) =>
      `${order.id} ${order.source.externalOrderId} ${order.source.providerDisplayReference ?? ""} ${order.customer}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );

  const totalReceivable = state.marketplaceReceivables
    .filter((item) => matchesBranch(item.branchId))
    .filter((item) => !["SETTLED", "CANCELLED"].includes(item.status))
    .reduce((sum, item) => sum + item.outstandingAmount, 0);
  const openExceptions = diagnostics.deadLetters.filter((letter) => letter.status === "OPEN");
  const selectedConnection = connections.find(
    (connection) => connection.id === selectedConnectionId,
  );
  const selectedProvider = providers.find(
    (provider) => provider.id === selectedConnection?.providerId,
  );
  const supports = (capability: ProviderCapability) =>
    Boolean(selectedProvider?.capabilities.includes(capability));
  const selectedMappings = diagnostics.mappings.filter(
    (mapping) => mapping.connectionId === selectedConnectionId,
  );

  const previewSync = async () => {
    if (!selectedConnectionId) return setNotice("Select a marketplace connection first.");
    setWorking(true);
    try {
      const response = await fetch(
        `/api/seramet/integrations/marketplace/menu-preview?connectionId=${encodeURIComponent(selectedConnectionId)}`,
        { headers },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        menu?: NormalizedMarketplaceMenu;
        preview?: MarketplaceSyncPreview;
      };
      if (!response.ok || !payload.menu || !payload.preview)
        throw new Error(payload.message ?? "Menu preview failed");
      if (currentScope.current !== scope) return;
      setPreview(payload.preview);
      setPreviewMenu(payload.menu);
      setNotice("Preview generated from the current Seramet menu and mappings.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Menu preview failed");
    } finally {
      setWorking(false);
    }
  };

  const syncMenu = async () => {
    if (!preview) return setNotice("Preview the menu before synchronizing.");
    await postAction(
      "/api/seramet/integrations/marketplace/menu-sync",
      {
        connectionId: preview.connectionId,
        confirmedMenuHash: preview.menuHash,
        allowDestructive: preview.destructive,
      },
      "Menu synchronization queued.",
    );
  };

  const syncIncremental = async (kind: "availability" | "price") => {
    if (!previewMenu || !selectedConnectionId)
      return setNotice("Preview the current menu before queuing an incremental sync.");
    setWorking(true);
    try {
      for (const item of previewMenu.items) {
        const endpoint = `/api/seramet/integrations/marketplace/${kind}`;
        const body =
          kind === "availability"
            ? {
                branchId,
                internalItemId: item.internalId,
                connectionIds: [selectedConnectionId],
                available: item.available,
                quantityAvailable: item.quantityAvailable,
              }
            : {
                connectionId: selectedConnectionId,
                internalItemId: item.internalId,
                price: item.price,
                currency: previewMenu.currency,
              };
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? `${kind} synchronization failed`);
        }
      }
      setNotice(`${kind === "price" ? "Price" : "Availability"} synchronization queued.`);
      await loadDiagnostics();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Incremental synchronization failed");
    } finally {
      setWorking(false);
    }
  };

  const setStoreStatus = (status: "OPEN" | "PAUSED" | "CLOSED_TEMPORARILY") =>
    postAction(
      "/api/seramet/integrations/marketplace/store-status",
      { connectionId: selectedConnectionId, status },
      `Store ${status.toLowerCase().replace("_", " ")} queued.`,
    );

  const recoverOrders = () =>
    postAction(
      "/api/seramet/integrations/workers/recover-marketplace-orders",
      { connectionId: selectedConnectionId },
      "Active provider orders recovered through the normal ingestion workflow.",
    );

  async function postAction(path: string, body: unknown, success: string) {
    setWorking(true);
    try {
      const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "Action failed");
      if (currentScope.current !== scope) return;
      setNotice(success);
      await loadDiagnostics();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Marketplace action failed");
    } finally {
      setWorking(false);
    }
  }

  async function setAvailability(itemIds: string[], available: boolean) {
    const restore = !available && restoreAt ? new Date(restoreAt) : null;
    if (restore && (!Number.isFinite(restore.getTime()) || restore.getTime() <= Date.now())) {
      setNotice("Choose a future restoration time.");
      return;
    }
    setWorking(true);
    let queued = 0;
    const errors: string[] = [];
    try {
      for (const internalItemId of itemIds) {
        if (currentScope.current !== scope) break;
        const response = await fetch("/api/seramet/integrations/marketplace/availability", {
          method: "POST",
          headers,
          body: JSON.stringify({
            branchId,
            internalItemId,
            available,
            ...(!allMarketplaces ? { connectionIds: [selectedConnectionId] } : {}),
            ...(restore ? { restoreAt: restore.toISOString() } : {}),
          }),
        });
        const payload = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || payload.ok === false)
          errors.push(`${internalItemId}: ${payload.message ?? "Update failed"}`);
        else queued++;
      }
      if (currentScope.current === scope) {
        setNotice(`${queued} item updates queued.${errors.length ? ` ${errors.join("; ")}` : ""}`);
        await loadDiagnostics();
      }
    } catch (error) {
      if (currentScope.current === scope)
        setNotice(
          `${queued} updates queued. ${error instanceof Error ? error.message : "Connection interrupted"}`,
        );
    } finally {
      if (currentScope.current === scope) setWorking(false);
    }
  }

  return (
    <AppShell
      title="Marketplace"
      subtitle={`Two-way order and catalog operations - ${branchLabel}`}
      actions={
        <Btn onClick={() => void loadDiagnostics()} disabled={working}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Btn>
      }
    >
      {notice && (
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[12px] font-medium">
          {notice}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Marketplace orders" value={marketplaceOrders.length} />
        <Metric label="Provider receivable" value={totalReceivable} money />
        <Metric label="Open exceptions" value={openExceptions.length} invert />
        <Metric
          label="SLA attention"
          value={marketplaceOrders.filter((order) => order.slaWarning).length}
          invert
        />
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {(["ORDERS", "MENU_SYNC", "RECONCILIATION", "EXCEPTIONS"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`h-9 whitespace-nowrap rounded-md px-3 text-[12px] font-semibold ${tab === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
          >
            {
              {
                ORDERS: "Orders",
                MENU_SYNC: "Menu",
                RECONCILIATION: "Reconciliation",
                EXCEPTIONS: "Needs attention",
              }[item]
            }
          </button>
        ))}
      </div>

      {tab === "ORDERS" && (
        <>
          {selectedOrder?.externalSource && (
            <section className="my-4 border-y border-border py-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  Order{" "}
                  {selectedOrder.externalSource.providerDisplayReference ??
                    selectedOrder.externalSource.externalOrderId}
                </h2>
                <Btn onClick={() => setSelectedOrderId("")}>Close</Btn>
              </div>
              <div>
                {selectedOrder.customer} · {formatMoney(selectedOrder.total)} ·{" "}
                {selectedOrder.externalSource.externallyPaid
                  ? "Paid to marketplace"
                  : "Collection due"}
              </div>
              <ul className="space-y-1">
                {selectedOrder.lines.map((line) => (
                  <li key={line.id}>
                    {line.quantity} × {line.name}
                    {line.itemNote ? ` — ${line.itemNote}` : ""}
                  </li>
                ))}
              </ul>
              {selectedOrder.kitchenNote && <p>{selectedOrder.kitchenNote}</p>}
              <div className="flex flex-wrap gap-4">
                <Status>{marketplaceProgress(selectedOrder, diagnostics.outbox).provider}</Status>
                <Status>{marketplaceProgress(selectedOrder, diagnostics.outbox).progress}</Status>
                <span>Saved in POS: {selectedOrder.id}</span>
              </div>
              {selectedOrder.status === "HELD" &&
                !decision &&
                hasPermission(permissions.integrationsOrdersManage) && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                      Preparation minutes
                      <input
                        aria-label="Preparation minutes"
                        type="number"
                        min={1}
                        max={maximumPrepMinutes}
                        value={prepMinutes}
                        onChange={(event) => setPrepMinutes(Number(event.target.value))}
                        className="block h-10 w-28 rounded-md border border-border bg-card px-3"
                      />
                    </label>
                    <Btn
                      disabled={
                        working ||
                        !orderProvider?.capabilities.includes("ACCEPT_ORDER") ||
                        !Number.isInteger(prepMinutes) ||
                        prepMinutes < 1 ||
                        prepMinutes > maximumPrepMinutes
                      }
                      onClick={() =>
                        void postAction(
                          "/api/seramet/integrations/marketplace/decision",
                          { branchId, orderId: selectedOrder.id, decision: "ACCEPT", prepMinutes },
                          "Acceptance queued. Awaiting marketplace confirmation.",
                        )
                      }
                    >
                      <Check className="h-4 w-4" />
                      Accept
                    </Btn>
                    <label className="text-sm">
                      Rejection reason
                      <input
                        maxLength={500}
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        className="block h-10 w-full rounded-md border border-border bg-card px-3"
                      />
                    </label>
                    <Btn
                      disabled={
                        working ||
                        !orderProvider?.capabilities.includes("REJECT_ORDER") ||
                        !rejectionReason.trim()
                      }
                      onClick={() =>
                        void postAction(
                          "/api/seramet/integrations/marketplace/decision",
                          {
                            branchId,
                            orderId: selectedOrder.id,
                            decision: "REJECT",
                            reason: rejectionReason,
                          },
                          "Rejection queued. Awaiting marketplace confirmation.",
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                      Reject
                    </Btn>
                  </div>
                )}
              {decision &&
                decision.status !== "PROCESSED" &&
                hasPermission(permissions.integrationsOrdersManage) && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Status>{decision.status}</Status>
                    <Btn
                      disabled={working || !orderProvider?.capabilities.includes("GET_ORDER")}
                      onClick={() =>
                        void postAction(
                          "/api/seramet/integrations/marketplace/decision/recover",
                          { branchId, recordId: decision.id },
                          "Provider decision verified and POS updated.",
                        )
                      }
                    >
                      <RefreshCw className="h-4 w-4" />
                      Verify with provider
                    </Btn>
                    {decision.lastError && (
                      <p className="w-full break-words text-sm text-destructive">
                        {decision.lastError}
                      </p>
                    )}
                  </div>
                )}
            </section>
          )}
          <div className="my-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              value={providerFilter}
              onChange={setProviderFilter}
              options={[
                { value: "ALL", label: "All providers" },
                ...connections.map((connection) => ({
                  value: connection.id,
                  label: connection.displayName,
                })),
              ]}
            />
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                "ALL",
                "Review",
                "Accepted",
                "Scheduled",
                "Kitchen queued",
                "Preparing",
                "Ready",
                "Collected",
                "Fulfilled",
                "Cancelled",
              ].map((value) => ({ value, label: value.replace("_", " ") }))}
            />
            <input
              aria-label="Search marketplace orders"
              placeholder="Order reference or customer"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 min-w-0 rounded-md border border-border bg-card px-3 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={history}
                onChange={(event) => setHistory(event.target.checked)}
              />{" "}
              All history
            </label>
          </div>
          <Panel>
            <PanelHead
              title="All marketplace orders"
              sub="One Seramet order lifecycle with provider status, production SLA and receivable state"
              right={<RefreshCw className="h-4 w-4 text-primary" />}
            />
            <div className="hidden md:block">
              <DataTable
                cols={[
                  "Provider",
                  "External order",
                  "Seramet order",
                  "Customer",
                  { l: "Amount", r: true },
                  "Received",
                  "Prep timer",
                  "Kitchen / handover",
                  "Provider confirmation",
                  "Payment",
                  "Health",
                ]}
              >
                {marketplaceOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-secondary/50">
                    <TD className="font-semibold">{order.provider?.displayName ?? "Provider"}</TD>
                    <TD className="num">
                      {order.source.providerDisplayReference ?? order.source.externalOrderId}
                    </TD>
                    <TD className="num font-semibold">
                      <button
                        className="text-primary underline"
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        {order.id}
                      </button>
                    </TD>
                    <TD>{order.customer}</TD>
                    <TD className="num text-right font-semibold">{formatMoney(order.total)}</TD>
                    <TD>{relativeAge(order.ageMinutes)}</TD>
                    <TD className={order.slaWarning ? "font-semibold text-warning" : ""}>
                      {order.ageMinutes} min
                    </TD>
                    <TD>
                      <Status>{order.progress.progress}</Status>
                    </TD>
                    <TD>
                      <Status>{order.progress.provider}</Status>
                    </TD>
                    <TD>
                      <Status>{order.receivable?.status ?? order.paymentStatus}</Status>
                    </TD>
                    <TD>
                      <Status>{order.health?.status ?? "NOT CHECKED"}</Status>
                    </TD>
                  </tr>
                ))}
                {!marketplaceOrders.length && (
                  <tr>
                    <TD colSpan={11} className="text-muted-foreground">
                      No marketplace orders match these filters.
                    </TD>
                  </tr>
                )}
              </DataTable>
            </div>
            <div className="divide-y divide-border md:hidden">
              {marketplaceOrders.map((order) => (
                <div key={order.id} className="p-4">
                  <button
                    className="mb-2 text-primary underline"
                    onClick={() => setSelectedOrderId(order.id)}
                  >
                    Review {order.id}
                  </button>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-semibold">
                        {order.provider?.displayName ?? "Provider"} ·{" "}
                        {order.source.providerDisplayReference ?? order.source.externalOrderId}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {order.id} · {order.customer}
                      </div>
                    </div>
                    <Status>{order.progress.progress}</Status>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <Mini label="Provider confirmation" value={order.progress.provider} />
                    <Mini label="Amount" value={formatMoney(order.total)} />
                    <Mini
                      label="Prep"
                      value={`${order.ageMinutes} min`}
                      warning={order.slaWarning}
                    />
                    <Mini
                      label="Receivable"
                      value={order.receivable?.status ?? order.paymentStatus}
                    />
                  </div>
                </div>
              ))}
              {!marketplaceOrders.length && (
                <Empty text="No marketplace orders match these filters." />
              )}
            </div>
          </Panel>
        </>
      )}

      {tab === "MENU_SYNC" && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel>
            <PanelHead
              title="Marketplace menu synchronization"
              sub="Preview deterministic changes before provider catalog writes"
              right={<Store className="h-4 w-4 text-primary" />}
            />
            <div className="space-y-4 p-4">
              <Select
                value={selectedConnectionId}
                onChange={(value) => {
                  setSelectedConnectionId(value);
                  setPreview(null);
                  setPreviewMenu(null);
                  setSelectedItems([]);
                }}
                options={connections.map((connection) => ({
                  value: connection.id,
                  label: connection.displayName,
                }))}
              />
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => void previewSync()} disabled={working || !selectedConnectionId}>
                  Validate & preview
                </Btn>
                <Btn
                  onClick={() => void syncMenu()}
                  disabled={working || !preview || !supports("SYNC_MENU")}
                >
                  Sync menu
                </Btn>
                <Btn
                  onClick={() => void syncIncremental("availability")}
                  disabled={working || !previewMenu || !supports("SYNC_AVAILABILITY")}
                >
                  Sync availability
                </Btn>
                <Btn
                  onClick={() => void syncIncremental("price")}
                  disabled={working || !previewMenu || !supports("SYNC_PRICES")}
                >
                  Sync prices
                </Btn>
              </div>
              {selectedProvider && !supports("SYNC_MENU") && (
                <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[11px] text-warning">
                  {selectedProvider.displayName} does not support full menu publishing on this
                  connection.
                </div>
              )}
              {preview ? (
                <>
                  {previewMenu && hasPermission(permissions.integrationsMenuSync) && (
                    <section className="space-y-3 border-y border-border py-3">
                      <div className="flex flex-wrap gap-3 items-end">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={allMarketplaces}
                            onChange={(event) => setAllMarketplaces(event.target.checked)}
                          />
                          All marketplaces in this branch
                        </label>
                        <label className="text-sm">
                          Restore at (optional, device time)
                          <input
                            type="datetime-local"
                            value={restoreAt}
                            onChange={(event) => setRestoreAt(event.target.value)}
                            className="block h-10 max-w-full rounded-md border border-border bg-card px-2"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <label className="flex gap-2 items-center text-sm">
                          <input
                            type="checkbox"
                            checked={
                              previewMenu.items.length > 0 &&
                              selectedItems.length === previewMenu.items.length
                            }
                            onChange={(event) =>
                              setSelectedItems(
                                event.target.checked
                                  ? previewMenu.items.map((item) => item.internalId)
                                  : [],
                              )
                            }
                          />
                          Select all items
                        </label>
                        <Btn
                          disabled={working || !selectedItems.length}
                          onClick={() => void setAvailability(selectedItems, false)}
                        >
                          <X className="h-4 w-4" />
                          Mark selected unavailable
                        </Btn>
                        <Btn
                          disabled={working || !selectedItems.length}
                          onClick={() => void setAvailability(selectedItems, true)}
                        >
                          <Check className="h-4 w-4" />
                          Restore selected
                        </Btn>
                      </div>
                      {previewMenu.items.map((item) => {
                        const mapping = selectedMappings.find(
                          (row) =>
                            row.resourceType === "ITEM" && row.internalId === item.internalId,
                        );
                        const desired = mapping?.metadata["availabilityOverride"] as
                          { available?: boolean; restoreAt?: string } | undefined;
                        const available = desired?.available ?? item.available;
                        return (
                          <div
                            key={item.internalId}
                            className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <label className="flex gap-2 items-center text-sm font-semibold break-words">
                                <input
                                  type="checkbox"
                                  checked={selectedItems.includes(item.internalId)}
                                  onChange={(event) =>
                                    setSelectedItems((current) =>
                                      event.target.checked
                                        ? [...current, item.internalId]
                                        : current.filter((id) => id !== item.internalId),
                                    )
                                  }
                                />
                                {item.name}
                              </label>
                              <div className="text-xs text-muted-foreground">
                                {available ? "Available" : "Unavailable"} ·{" "}
                                {mapping?.syncStatus ?? "Not published"}
                              </div>
                              {desired?.restoreAt && (
                                <div className="text-xs text-muted-foreground">
                                  Restoration check:{" "}
                                  {new Date(desired.restoreAt).toLocaleString(undefined, {
                                    timeZone,
                                  })}{" "}
                                  ({timeZone})
                                </div>
                              )}
                              <ul className="text-xs space-y-1 mt-1">
                                {connections
                                  .filter(
                                    (connection) =>
                                      allMarketplaces || connection.id === selectedConnectionId,
                                  )
                                  .map((connection) => {
                                    const channel = diagnostics.mappings.find(
                                      (row) =>
                                        row.connectionId === connection.id &&
                                        row.resourceType === "ITEM" &&
                                        row.internalId === item.internalId,
                                    );
                                    const override = channel?.metadata["availabilityOverride"] as
                                      { available?: boolean } | undefined;
                                    return (
                                      <li key={connection.id} className="break-words">
                                        {connection.displayName}:{" "}
                                        {channel
                                          ? `${override ? (override.available ? "Available requested" : "Unavailable requested") : "Catalog default"} · ${channel.syncStatus ?? "Not synced"}`
                                          : "No item mapping"}
                                        {channel?.lastError ? ` · ${channel.lastError}` : ""}
                                      </li>
                                    );
                                  })}
                              </ul>
                            </div>
                            <Btn
                              disabled={
                                working ||
                                (!allMarketplaces && (!mapping || !supports("SYNC_AVAILABILITY")))
                              }
                              onClick={() => void setAvailability([item.internalId], !available)}
                            >
                              {available ? (
                                <X className="h-4 w-4" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              {available ? "Mark unavailable" : "Restore item"}
                            </Btn>
                          </div>
                        );
                      })}
                    </section>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Mini label="Unchanged" value={String(preview.counts.unchanged)} />
                    <Mini label="Price changes" value={String(preview.counts.priceChanges)} />
                    <Mini label="Availability" value={String(preview.counts.availabilityChanges)} />
                    <Mini label="New" value={String(preview.counts.newItems)} />
                    <Mini
                      label="Unmapped"
                      value={String(preview.counts.unmapped)}
                      warning={preview.counts.unmapped > 0}
                    />
                    <Mini
                      label="Removed"
                      value={String(preview.counts.removed)}
                      warning={preview.counts.removed > 0}
                    />
                    <Mini
                      label="Conflicts"
                      value={String(preview.counts.conflicts)}
                      warning={preview.counts.conflicts > 0}
                    />
                    <Mini
                      label="Generated"
                      value={new Date(preview.generatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    />
                  </div>
                  <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
                    {preview.operations.map((operation) => (
                      <div
                        key={`${operation.internalId}-${operation.operation}`}
                        className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold">{operation.name}</div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {operation.externalId ?? "No external ID"}
                          </div>
                        </div>
                        <Status>{operation.operation.replaceAll("_", " ")}</Status>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Empty text="Choose a connection and preview the current Seramet menu." />
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHead
              title="Store control"
              sub={selectedConnection?.displayName ?? "Select a connection"}
            />
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-2">
                <Mini
                  label="Store mappings"
                  value={String(
                    selectedMappings.filter((mapping) => mapping.resourceType === "STORE").length,
                  )}
                />
                <Mini
                  label="Item mappings"
                  value={String(
                    selectedMappings.filter((mapping) => mapping.resourceType === "ITEM").length,
                  )}
                />
                <Mini
                  label="Unmapped"
                  value={String(
                    selectedMappings.filter((mapping) =>
                      ["UNMAPPED", "CONFLICT"].includes(mapping.status),
                    ).length,
                  )}
                />
                <Mini
                  label="Pending sync"
                  value={String(
                    selectedMappings.filter((mapping) => mapping.syncStatus === "PENDING").length,
                  )}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Btn
                  onClick={() => void setStoreStatus("OPEN")}
                  disabled={!selectedConnectionId || working || !supports("UPDATE_STORE_STATUS")}
                >
                  Open
                </Btn>
                <Btn
                  onClick={() => void setStoreStatus("PAUSED")}
                  disabled={!selectedConnectionId || working || !supports("UPDATE_STORE_STATUS")}
                >
                  Pause
                </Btn>
                <Btn
                  onClick={() => void setStoreStatus("CLOSED_TEMPORARILY")}
                  disabled={!selectedConnectionId || working || !supports("UPDATE_STORE_STATUS")}
                >
                  Close
                </Btn>
              </div>
              {supports("RECOVER_ACTIVE_ORDERS") && (
                <Btn
                  className="w-full"
                  onClick={() => void recoverOrders()}
                  disabled={!selectedConnectionId || working}
                >
                  <RefreshCw className="h-4 w-4" /> Recover active orders
                </Btn>
              )}
              <a
                href="/integrations"
                className="block rounded-md border border-border px-3 py-2 text-center text-[12px] font-semibold text-primary hover:bg-secondary"
              >
                Resolve mappings in Integrations
              </a>
            </div>
          </Panel>
        </div>
      )}

      {tab === "RECONCILIATION" && (
        <Panel className="mt-4">
          <PanelHead title="Marketplace balances" sub={branchLabel} />
          <div className="overflow-x-auto">
            <DataTable cols={["Marketplace", "Gross", "Settled", "Outstanding", "Open balances"]}>
              {connections.map((connection) => {
                const balances = state.marketplaceReceivables.filter(
                  (balance) =>
                    matchesBranch(balance.branchId) &&
                    balance.connectionId === connection.id &&
                    balance.status !== "CANCELLED",
                );
                return (
                  <tr key={connection.id}>
                    <TD>{connection.displayName}</TD>
                    <TD>
                      {formatMoney(balances.reduce((sum, balance) => sum + balance.grossAmount, 0))}
                    </TD>
                    <TD>
                      {formatMoney(
                        balances.reduce((sum, balance) => sum + balance.settledAmount, 0),
                      )}
                    </TD>
                    <TD>
                      {formatMoney(
                        balances.reduce((sum, balance) => sum + balance.outstandingAmount, 0),
                      )}
                    </TD>
                    <TD>{balances.filter((balance) => balance.outstandingAmount > 0).length}</TD>
                  </tr>
                );
              })}
            </DataTable>
          </div>
          <div className="flex flex-wrap gap-4 p-4">
            <a href="/payments" className="text-primary">
              Payments and reconciliation
            </a>
            <a href="/invoices" className="text-primary">
              Invoices
            </a>
            <a href="/receipts" className="text-primary">
              Receipts
            </a>
          </div>
        </Panel>
      )}

      {tab === "EXCEPTIONS" && (
        <Panel className="mt-4">
          <PanelHead
            title="Live order exceptions"
            sub="Mapping, provider, SLA and outbound synchronization failures"
          />
          <div className="divide-y divide-border">
            {marketplaceOrders
              .filter((order) => order.slaWarning)
              .map((order) => (
                <ExceptionRow
                  key={`sla-${order.id}`}
                  title={`${order.id} is approaching its preparation SLA`}
                  detail={`${order.provider?.displayName ?? "Marketplace"} · ${order.ageMinutes} minutes since receipt`}
                  kind="warning"
                />
              ))}
            {openExceptions.map((letter) => (
              <ExceptionRow
                key={letter.id}
                title={`${letter.sourceType} ${letter.sourceId}`}
                detail={`${letter.error} · ${letter.attemptCount} attempts`}
                kind="danger"
              />
            ))}
            {!openExceptions.length && !marketplaceOrders.some((order) => order.slaWarning) && (
              <Empty text="No current marketplace exceptions." />
            )}
          </div>
        </Panel>
      )}
    </AppShell>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 min-w-0 rounded-md border border-border bg-card px-3 text-[12px] text-foreground"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
function Mini({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-md border px-2.5 py-2 ${warning ? "border-warning/40 bg-warning-soft" : "border-border bg-secondary/40"}`}
    >
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-[11px] font-semibold ${warning ? "text-warning" : ""}`}>
        {value}
      </div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="p-8 text-center text-[12px] text-muted-foreground">{text}</div>;
}
function ExceptionRow({
  title,
  detail,
  kind,
}: {
  title: string;
  detail: string;
  kind: "warning" | "danger";
}) {
  const Icon = kind === "danger" ? AlertTriangle : Clock3;
  return (
    <div className="flex items-start gap-3 p-4">
      <Icon className={`mt-0.5 h-4 w-4 ${kind === "danger" ? "text-danger" : "text-warning"}`} />
      <div>
        <div className="text-[12px] font-semibold">{title}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
function relativeAge(minutes: number) {
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
