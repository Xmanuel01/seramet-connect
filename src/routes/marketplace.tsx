import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock3, RefreshCw, Store, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { formatMoney } from "@/lib/currency";
import { getSerametAccessToken } from "@/lib/access-token";
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
import {
  availabilityLabel,
  orderStage,
  orderStages,
  prepCountdown,
  restorationTime,
  type AvailabilityDuration,
  type OrderStage,
} from "@/integrations/marketplace/operations-view";
import { MarketplaceConnections } from "@/components/app/MarketplaceConnections";
import { MarketplaceClosing } from "@/components/app/MarketplaceClosing";

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
    currency,
    hasPermission,
  } = useAppContext();
  const engine = useTransactionEngine();
  const { state, syncFromBackend } = engine;
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
  const [tab, setTab] = useState<
    "ORDERS" | "MENU_SYNC" | "RECONCILIATION" | "EXCEPTIONS" | "CONNECTIONS"
  >("ORDERS");
  const [history, setHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [stage, setStage] = useState<OrderStage>("All active");
  const [duration, setDuration] = useState<AvailabilityDuration>("MANUAL");
  const [pauseDuration, setPauseDuration] = useState<AvailabilityDuration>("30");
  const [pauseDelay, setPauseDelay] = useState("0");
  const [selectedConnectionId, setSelectedConnectionId] = useState(connections[0]?.id ?? "");
  const currentConnection = useRef(selectedConnectionId);
  useEffect(() => {
    currentConnection.current = selectedConnectionId;
  }, [selectedConnectionId]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(emptyDiagnostics);
  const [preview, setPreview] = useState<MarketplaceSyncPreview | null>(null);
  const [previewMenu, setPreviewMenu] = useState<NormalizedMarketplaceMenu | null>(null);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [prepMinutes, setPrepMinutes] = useState(25);
  const [rejectionReason, setRejectionReason] = useState("");
  const [allMarketplaces, setAllMarketplaces] = useState(true);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
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
    setDuration("MANUAL");
    setStage("All active");
    setSelectedItems([]);
    setPrices({});
    setDiagnostics(emptyDiagnostics);
    setPreview(null);
    setPreviewMenu(null);
    setNotice("");
    setWorking(false);
  }, [scope]);

  const accessToken = getSerametAccessToken();
  const headers = useMemo(
    () => ({
      "content-type": "application/json",
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-user-id": currentUser.id,
      "x-seramet-branch-id": branchId,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    }),
    [activeTenantId, currentUser.id, branchId, accessToken],
  );

  const loadDiagnostics = useCallback(async () => {
    try {
      const response = await fetch("/api/seramet/integrations/diagnostics", { headers });
      const payload = (await response.json()) as Diagnostics & { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false)
        throw new Error(payload.message ?? "Marketplace diagnostics could not be loaded");
      if (currentScope.current !== scope) return;
      setDiagnostics({
        events: (payload.events ?? []).filter((row) => !row.branchId || row.branchId === branchId),
        mappings: (payload.mappings ?? []).filter(
          (row) => !row.branchId || row.branchId === branchId,
        ),
        outbox: (payload.outbox ?? []).filter((row) => !row.branchId || row.branchId === branchId),
        deadLetters: (payload.deadLetters ?? []).filter(
          (row) => !row.branchId || row.branchId === branchId,
        ),
        health: (payload.health ?? []).filter((row) => !row.branchId || row.branchId === branchId),
      });
    } catch (error) {
      if (currentScope.current === scope)
        setNotice(error instanceof Error ? error.message : "Marketplace diagnostics failed");
    }
  }, [headers, scope, branchId]);

  useEffect(() => {
    void loadDiagnostics();
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void loadDiagnostics();
        void syncFromBackend();
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadDiagnostics, syncFromBackend]);

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

  const branchOrders = state.orders
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
          prepCountdown(order, now).includes("overdue") ||
          (order.status === "HELD" &&
            !source.metadata["acceptanceConfirmedAt"] &&
            ageMinutes >= slaMinutes),
      };
    });
  const allOrders = branchOrders
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

  const marketplaceOrders = allOrders.filter(
    (order) =>
      history ||
      (stage === "All active"
        ? !order.progress.closed
        : orderStage(order, diagnostics.outbox) === stage),
  );

  const outstandingReceivables = state.marketplaceReceivables
    .filter((item) => matchesBranch(item.branchId))
    .filter((item) => !["SETTLED", "CANCELLED"].includes(item.status));
  const receivableCurrencies = new Set(outstandingReceivables.map((item) => item.currency));
  const totalReceivable =
    receivableCurrencies.size > 1
      ? "Multiple currencies"
      : formatMoney(
          outstandingReceivables.reduce((sum, item) => sum + item.outstandingAmount, 0),
          outstandingReceivables[0]?.currency ?? currency,
        );
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
      if (currentScope.current !== scope || currentConnection.current !== selectedConnectionId)
        return;
      setPreview(payload.preview);
      setPreviewMenu(payload.menu);
      setNotice("Preview generated from the current Seramet menu and mappings.");
    } catch (error) {
      if (currentScope.current === scope && currentConnection.current === selectedConnectionId)
        setNotice(error instanceof Error ? error.message : "Menu preview failed");
    } finally {
      if (currentScope.current === scope) setWorking(false);
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

  const setStoreStatus = (status: "OPEN" | "PAUSED" | "CLOSED_TEMPORARILY") => {
    const startsAt = new Date(Date.now() + Number(pauseDelay) * 60_000);
    return postAction(
      "/api/seramet/integrations/marketplace/store-status",
      {
        connectionId: selectedConnectionId,
        status,
        ...(status !== "OPEN"
          ? {
              ...(pauseDelay !== "0" ? { startsAt: startsAt.toISOString() } : {}),
              resumeAt: restorationTime(pauseDuration, startsAt, timeZone),
            }
          : {}),
      },
      status !== "OPEN" && pauseDelay !== "0"
        ? "Store pause scheduled."
        : "Store update requested. Awaiting marketplace confirmation.",
    );
  };

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
      await syncFromBackend();
    } catch (error) {
      if (currentScope.current === scope)
        setNotice(error instanceof Error ? error.message : "Marketplace action failed");
    } finally {
      if (currentScope.current === scope) setWorking(false);
    }
  }

  async function setAvailability(
    itemIds: string[],
    available: boolean,
    resourceType: "ITEM" | "MODIFIER" = "ITEM",
  ) {
    const restore = !available ? restorationTime(duration, new Date(), timeZone) : undefined;
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
            resourceType,
            available,
            ...(!allMarketplaces ? { connectionIds: [selectedConnectionId] } : {}),
            ...(restore ? { restoreAt: restore } : {}),
          }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          queued?: unknown[];
        };
        if (!response.ok || payload.ok === false)
          errors.push(`${internalItemId}: ${payload.message ?? "Update failed"}`);
        else if (!payload.queued?.length)
          errors.push(`${internalItemId}: no eligible marketplace mapping`);
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
      subtitle={branchLabel}
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
      {connections.some((connection) => connection.metadata["localSimulation"]) && (
        <div className="mb-4 border-l-4 border-warning bg-warning-soft px-4 py-2 text-sm">
          Local simulation · sample orders · no marketplace requests
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Marketplace orders" value={marketplaceOrders.length} />
        <Metric label="Awaiting payout" value={totalReceivable} money />
        <Metric
          label="Needs attention"
          value={openExceptions.length + branchOrders.filter((order) => order.slaWarning).length}
          invert
        />
        <Metric
          label="Preparation overdue"
          value={marketplaceOrders.filter((order) => order.slaWarning).length}
          invert
        />
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {(["ORDERS", "MENU_SYNC", "RECONCILIATION", "EXCEPTIONS", "CONNECTIONS"] as const)
          .filter((item) => item !== "RECONCILIATION" || hasPermission(permissions.financeView))
          .map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`h-9 whitespace-nowrap rounded-md px-3 text-[12px] font-semibold ${tab === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
            >
              {
                {
                  ORDERS: "Orders",
                  MENU_SYNC: "Menu",
                  RECONCILIATION: "Daily closing",
                  EXCEPTIONS: "Needs attention",
                  CONNECTIONS: "Connections",
                }[item]
              }
            </button>
          ))}
      </div>

      {tab === "ORDERS" && (
        <>
          <div
            role="tablist"
            aria-label="Order stage"
            className="my-4 flex gap-2 overflow-x-auto pb-2"
          >
            {orderStages.map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={stage === value && !history}
                onClick={() => {
                  setStage(value);
                  setHistory(false);
                }}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${stage === value && !history ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground"}`}
              >
                {value} (
                {
                  allOrders.filter((order) =>
                    value === "All active"
                      ? !order.progress.closed
                      : orderStage(order, diagnostics.outbox) === value,
                  ).length
                }
                )
              </button>
            ))}
          </div>
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
              {selectedOrder.delivery?.rider && <p>Courier: {selectedOrder.delivery.rider}</p>}
              {selectedOrder.externalSource.scheduledFor && (
                <p>
                  Scheduled for{" "}
                  {new Date(selectedOrder.externalSource.scheduledFor).toLocaleString(undefined, {
                    timeZone,
                  })}{" "}
                  ({timeZone})
                </p>
              )}
              <div className="flex flex-wrap gap-4">
                <Status>{marketplaceProgress(selectedOrder, diagnostics.outbox).provider}</Status>
                <Status>{marketplaceProgress(selectedOrder, diagnostics.outbox).progress}</Status>
                <span>Saved in POS: {selectedOrder.id}</span>
              </div>
              {selectedOrder.status === "HELD" &&
                !decision &&
                !selectedOrder.externalSource.metadata["acceptanceConfirmedAt"] &&
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
              {Boolean(selectedOrder.externalSource.metadata["acceptanceConfirmedAt"]) &&
                !["READY", "CANCELLED"].includes(selectedOrder.status) &&
                !selectedOrder.externalSource.pickedUpAt &&
                !selectedOrder.externalSource.completedAt &&
                hasPermission(permissions.integrationsOrdersManage) && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                      Ready in minutes
                      <input
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
                        !orderProvider?.capabilities.includes("UPDATE_READY_TIME") ||
                        !Number.isInteger(prepMinutes) ||
                        prepMinutes < 1 ||
                        prepMinutes > maximumPrepMinutes
                      }
                      onClick={() =>
                        void postAction(
                          "/api/seramet/integrations/marketplace/ready-time",
                          {
                            branchId,
                            orderId: selectedOrder.id,
                            readyAt: new Date(Date.now() + prepMinutes * 60_000).toISOString(),
                          },
                          "Preparation update requested. Awaiting confirmation.",
                        )
                      }
                    >
                      <Clock3 className="h-4 w-4" /> Update ready time
                    </Btn>
                    {!orderProvider?.capabilities.includes("UPDATE_READY_TIME") && (
                      <span className="text-sm text-muted-foreground">
                        This marketplace does not support ready-time updates.
                      </span>
                    )}
                    <a href="/kitchen" className="text-primary text-sm">
                      Open kitchen
                    </a>
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
              title={history ? "Order history" : stage}
              sub={branchLabel}
              right={<RefreshCw className="h-4 w-4 text-primary" />}
            />
            <div className="hidden md:block overflow-x-auto">
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
                      {prepCountdown(order, now)}
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
                      value={prepCountdown(order, now)}
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
              title="Marketplace menu"
              sub={selectedConnection?.displayName ?? "Select a marketplace"}
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
                <Btn
                  onClick={() => void previewSync()}
                  disabled={
                    working ||
                    !selectedConnectionId ||
                    !hasPermission(permissions.integrationsMenuSync)
                  }
                >
                  Review menu
                </Btn>
                <Btn
                  onClick={() => void syncMenu()}
                  disabled={
                    working ||
                    !preview ||
                    !supports("SYNC_MENU") ||
                    !hasPermission(permissions.integrationsMenuSync)
                  }
                >
                  Publish reviewed menu
                </Btn>
                <Btn
                  onClick={() => void syncIncremental("availability")}
                  disabled={
                    working ||
                    !previewMenu ||
                    !supports("SYNC_AVAILABILITY") ||
                    !hasPermission(permissions.integrationsMenuSync)
                  }
                >
                  Sync availability
                </Btn>
                <Btn
                  onClick={() => void syncIncremental("price")}
                  disabled={
                    working ||
                    !previewMenu ||
                    !supports("SYNC_PRICES") ||
                    !hasPermission(permissions.integrationsMenuSync)
                  }
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
                          Unavailable for
                          <select
                            value={duration}
                            onChange={(event) =>
                              setDuration(event.target.value as AvailabilityDuration)
                            }
                            className="block h-10 max-w-full rounded-md border border-border bg-card px-2"
                          >
                            <option value="30">30 minutes</option>
                            <option value="60">1 hour</option>
                            <option value="TODAY">Until midnight ({timeZone})</option>
                            <option value="MANUAL">Until restored</option>
                          </select>
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
                                {availabilityLabel(mapping)}
                              </div>
                              {supports("SYNC_PRICES") && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <label className="text-xs">
                                    Marketplace price ({previewMenu.currency})
                                    <input
                                      aria-label={`Price for ${item.name}`}
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      value={
                                        prices[`${selectedConnectionId}:${item.internalId}`] ??
                                        item.price
                                      }
                                      onChange={(event) =>
                                        setPrices((current) => ({
                                          ...current,
                                          [`${selectedConnectionId}:${item.internalId}`]:
                                            event.target.value,
                                        }))
                                      }
                                      className="ml-2 h-9 w-28 rounded-md border border-border bg-card px-2"
                                    />
                                  </label>
                                  <Btn
                                    disabled={
                                      working ||
                                      !mapping ||
                                      !(
                                        prices[`${selectedConnectionId}:${item.internalId}`] ?? ""
                                      ).trim() ||
                                      !Number.isFinite(
                                        Number(
                                          prices[`${selectedConnectionId}:${item.internalId}`],
                                        ),
                                      ) ||
                                      Number(prices[`${selectedConnectionId}:${item.internalId}`]) <
                                        0
                                    }
                                    onClick={() =>
                                      void postAction(
                                        "/api/seramet/integrations/marketplace/price",
                                        {
                                          connectionId: selectedConnectionId,
                                          internalItemId: item.internalId,
                                          price: Number(
                                            prices[`${selectedConnectionId}:${item.internalId}`],
                                          ),
                                          currency: previewMenu.currency,
                                        },
                                        "Price update requested for this marketplace.",
                                      )
                                    }
                                  >
                                    Send price
                                  </Btn>
                                </div>
                              )}
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
                                    return (
                                      <li key={connection.id} className="break-words">
                                        {connection.displayName}:{" "}
                                        {channel ? availabilityLabel(channel) : "No item mapping"}
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
                  {selectedMappings.some((row) => row.resourceType === "MODIFIER") && (
                    <section className="space-y-2 border-y border-border py-3">
                      <h3 className="font-semibold">Modifiers</h3>
                      {selectedMappings
                        .filter((row) => row.resourceType === "MODIFIER")
                        .map((mapping) => {
                          const desired = mapping.metadata["availabilityOverride"] as
                            { available?: boolean } | undefined;
                          return (
                            <div
                              key={mapping.id}
                              className="flex flex-wrap gap-3 justify-between items-center"
                            >
                              <div>
                                <p>
                                  {String(mapping.metadata["displayName"] ?? mapping.internalId)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {availabilityLabel(mapping)}
                                </p>
                              </div>
                              <Btn
                                disabled={
                                  working ||
                                  !supports("SYNC_MODIFIERS") ||
                                  !supports("SYNC_AVAILABILITY") ||
                                  !hasPermission(permissions.integrationsMenuSync)
                                }
                                onClick={() =>
                                  void setAvailability(
                                    [mapping.internalId],
                                    desired?.available === false,
                                    "MODIFIER",
                                  )
                                }
                              >
                                {desired?.available === false
                                  ? "Restore modifier"
                                  : "Mark unavailable"}
                              </Btn>
                            </div>
                          );
                        })}
                      {!supports("SYNC_MODIFIERS") && (
                        <p className="text-sm text-muted-foreground">
                          Modifier updates are not supported by this marketplace.
                        </p>
                      )}
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
              <div className="text-sm" role="status">
                {(() => {
                  const mapping = selectedMappings.find((row) => row.resourceType === "STORE");
                  const desired = mapping?.metadata["storeOverride"] as
                    { status?: string; startsAt?: string; resumeAt?: string } | undefined;
                  return (
                    <>
                      <strong>
                        {desired?.startsAt && Date.parse(desired.startsAt) > Date.now()
                          ? "Pause scheduled"
                          : mapping?.syncStatus === "PENDING"
                            ? "Updating store"
                            : mapping?.syncStatus === "FAILED"
                              ? "Store update failed"
                              : mapping?.metadata["confirmedStoreStatus"]
                                ? `Confirmed: ${String(mapping.metadata["confirmedStoreStatus"]).toLowerCase()}`
                                : "Store status not verified"}
                      </strong>
                      {desired?.startsAt && Date.parse(desired.startsAt) > Date.now() && (
                        <p>
                          Starts{" "}
                          {new Date(desired.startsAt).toLocaleString(undefined, { timeZone })} (
                          {timeZone})
                        </p>
                      )}
                      {desired?.resumeAt && (
                        <p>
                          Reopens{" "}
                          {new Date(desired.resumeAt).toLocaleString(undefined, { timeZone })} (
                          {timeZone})
                        </p>
                      )}
                      {mapping?.lastError && <p className="text-warning">{mapping.lastError}</p>}
                    </>
                  );
                })()}
              </div>
              <label className="block text-sm">
                Pause starts
                <select
                  aria-label="Pause starts"
                  value={pauseDelay}
                  onChange={(event) => setPauseDelay(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2"
                >
                  <option value="0">Now</option>
                  <option value="15">In 15 minutes</option>
                  <option value="30">In 30 minutes</option>
                  <option value="60">In 1 hour</option>
                </select>
              </label>
              <label className="block text-sm">
                Pause duration
                <select
                  value={pauseDuration}
                  onChange={(event) => setPauseDuration(event.target.value as AvailabilityDuration)}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2"
                >
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="TODAY">Until midnight ({timeZone})</option>
                  <option value="MANUAL">Until reopened</option>
                </select>
              </label>
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
                  disabled={
                    !selectedConnectionId ||
                    working ||
                    !supports("UPDATE_STORE_STATUS") ||
                    !hasPermission(permissions.integrationsStoreManage)
                  }
                >
                  Open
                </Btn>
                <Btn
                  onClick={() => void setStoreStatus("PAUSED")}
                  disabled={
                    !selectedConnectionId ||
                    working ||
                    !supports("UPDATE_STORE_STATUS") ||
                    !hasPermission(permissions.integrationsStoreManage)
                  }
                >
                  Pause
                </Btn>
                <Btn
                  onClick={() => void setStoreStatus("CLOSED_TEMPORARILY")}
                  disabled={
                    !selectedConnectionId ||
                    working ||
                    !supports("UPDATE_STORE_STATUS") ||
                    !hasPermission(permissions.integrationsStoreManage)
                  }
                >
                  Close
                </Btn>
              </div>
              {!supports("UPDATE_STORE_STATUS") && (
                <p className="text-sm text-muted-foreground">
                  This marketplace does not support store availability updates.
                </p>
              )}
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

      {tab === "CONNECTIONS" && (
        <MarketplaceConnections
          timeZone={timeZone}
          connections={connections}
          providers={providers}
          diagnostics={diagnostics}
          working={working}
          canManage={hasPermission(permissions.settingsIntegrationManage)}
          onCheck={(id) =>
            void postAction(
              `/api/seramet/integrations/connections/${encodeURIComponent(id)}/test`,
              {},
              "Connection check completed.",
            )
          }
          onMenu={(id) => {
            setSelectedConnectionId(id);
            setPreview(null);
            setPreviewMenu(null);
            setTab("MENU_SYNC");
          }}
        />
      )}
      {tab === "RECONCILIATION" && hasPermission(permissions.financeView) && (
        <MarketplaceClosing engine={engine} connections={connections} />
      )}

      {tab === "EXCEPTIONS" && (
        <Panel className="mt-4">
          <PanelHead
            title="Live order exceptions"
            sub="Mapping, provider, SLA and outbound synchronization failures"
          />
          <div className="divide-y divide-border">
            {branchOrders
              .filter((order) => order.slaWarning)
              .map((order) => (
                <ExceptionRow
                  key={`sla-${order.id}`}
                  title={`${order.source.providerDisplayReference ?? order.source.externalOrderId} needs attention`}
                  detail={`${order.provider?.displayName ?? "Marketplace"} · ${order.ageMinutes} minutes since receipt`}
                  kind="warning"
                  action={
                    <Btn
                      onClick={() => {
                        setTab("ORDERS");
                        setSelectedOrderId(order.id);
                      }}
                    >
                      Review order
                    </Btn>
                  }
                />
              ))}
            {openExceptions.map((letter) => (
              <ExceptionRow
                key={letter.id}
                title={`${connections.find((connection) => connection.id === letter.connectionId)?.displayName ?? "Marketplace"}: update needs review`}
                detail={`${letter.error} · ${letter.attemptCount} attempts`}
                kind="danger"
                action={
                  <a href="/integrations" className="text-primary text-sm">
                    Review connection
                  </a>
                }
              />
            ))}
            {!openExceptions.length && !branchOrders.some((order) => order.slaWarning) && (
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
      <div
        className={`mt-0.5 break-words text-[11px] font-semibold ${warning ? "text-warning" : ""}`}
      >
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
  action,
}: {
  title: string;
  detail: string;
  kind: "warning" | "danger";
  action?: import("react").ReactNode;
}) {
  const Icon = kind === "danger" ? AlertTriangle : Clock3;
  return (
    <div className="flex items-start gap-3 p-4">
      <Icon className={`mt-0.5 h-4 w-4 ${kind === "danger" ? "text-danger" : "text-warning"}`} />
      <div className="min-w-0 break-words">
        <div className="text-[12px] font-semibold">{title}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
function relativeAge(minutes: number) {
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
