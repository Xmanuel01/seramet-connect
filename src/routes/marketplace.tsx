import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Clock3, CloudCog, RefreshCw, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
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
  const { activeTenantId, branchId, branchLabel, currentUser, matchesBranch } = useAppContext();
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
  const [tab, setTab] = useState<"ORDERS" | "MENU_SYNC" | "EXCEPTIONS">("ORDERS");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedConnectionId, setSelectedConnectionId] = useState(connections[0]?.id ?? "");
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(emptyDiagnostics);
  const [preview, setPreview] = useState<MarketplaceSyncPreview | null>(null);
  const [previewMenu, setPreviewMenu] = useState<NormalizedMarketplaceMenu | null>(null);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);

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
      setDiagnostics({
        events: payload.events ?? [],
        mappings: payload.mappings ?? [],
        outbox: payload.outbox ?? [],
        deadLetters: payload.deadLetters ?? [],
        health: payload.health ?? [],
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Marketplace diagnostics failed");
    }
  }, [headers]);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

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
      const ageMinutes = Math.max(0, Math.floor((Date.now() - receivedAt) / 60_000));
      const connection = connections.find((candidate) => candidate.id === source.connectionId);
      const slaMinutes = Number(connection?.configuration["slaWarningMinutes"] ?? 20);
      return {
        ...order,
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
    .filter((order) => statusFilter === "ALL" || statusGroup(order.status) === statusFilter);

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

  const runWorker = () =>
    postAction(
      "/api/seramet/integrations/workers/outbox",
      { limit: 100 },
      "Due provider work processed.",
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
      setNotice(success);
      await loadDiagnostics();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Marketplace action failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AppShell
      title="Marketplace"
      subtitle={`Two-way order and catalog operations - ${branchLabel}`}
      actions={
        <Btn onClick={() => void runWorker()} disabled={working}>
          <CloudCog className="h-4 w-4" /> Process queue
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
        {(["ORDERS", "MENU_SYNC", "EXCEPTIONS"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`h-9 whitespace-nowrap rounded-md px-3 text-[12px] font-semibold ${tab === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
          >
            {item.replace("_", " ")}
          </button>
        ))}
      </div>

      {tab === "ORDERS" && (
        <>
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
                "NEW",
                "ACCEPTED",
                "PREPARING",
                "READY",
                "DISPATCHED",
                "COMPLETED",
                "CANCELLED",
                "EXCEPTION",
              ].map((value) => ({ value, label: value.replace("_", " ") }))}
            />
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
                  "Status",
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
                    <TD className="num font-semibold">{order.id}</TD>
                    <TD>{order.customer}</TD>
                    <TD className="num text-right font-semibold">{ksh(order.total)}</TD>
                    <TD>{relativeAge(order.ageMinutes)}</TD>
                    <TD className={order.slaWarning ? "font-semibold text-warning" : ""}>
                      {order.ageMinutes} min
                    </TD>
                    <TD>
                      <Status>{statusGroup(order.status)}</Status>
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
                    <TD colSpan={10} className="text-muted-foreground">
                      No marketplace orders match these filters.
                    </TD>
                  </tr>
                )}
              </DataTable>
            </div>
            <div className="divide-y divide-border md:hidden">
              {marketplaceOrders.map((order) => (
                <div key={order.id} className="p-4">
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
                    <Status>{statusGroup(order.status)}</Status>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <Mini label="Amount" value={ksh(order.total)} />
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
                  {selectedProvider.displayName} catalog writes are unavailable until an official
                  production contract supports them.
                </div>
              )}
              {preview ? (
                <>
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
function statusGroup(status: string) {
  if (status === "HELD" || status === "OPEN") return "NEW";
  if (status === "SENT_TO_KITCHEN") return "ACCEPTED";
  if (status === "IN_PROGRESS") return "PREPARING";
  if (status === "READY") return "READY";
  if (status === "SERVED") return "COMPLETED";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "PAID") return "COMPLETED";
  return status.replaceAll("_", " ");
}
