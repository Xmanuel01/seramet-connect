import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Unplug } from "lucide-react";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  IntegrationEvent,
  ExternalResourceMapping,
  IntegrationDeadLetter,
  IntegrationHealthRecord,
  IntegrationOutbox,
} from "@/integrations/runtime/models";
import type { Branch, IntegrationConnection, ProviderDefinition } from "@/platform/types";

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

export function IntegrationOperations({
  connections,
  providers,
  branches,
  userId,
  tenantId,
  onConnectionChanged,
}: {
  connections: IntegrationConnection[];
  providers: ProviderDefinition[];
  branches: Branch[];
  userId: string;
  tenantId: string;
  onConnectionChanged: (connection: IntegrationConnection) => void;
}) {
  const [tab, setTab] = useState<"OVERVIEW" | "EVENTS" | "MAPPINGS" | "DEAD_LETTERS">("OVERVIEW");
  const [data, setData] = useState<Diagnostics>(emptyDiagnostics);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<IntegrationEvent | null>(null);
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [mappingConnection, setMappingConnection] = useState(connections[0]?.id ?? "");
  const [mappingType, setMappingType] = useState<ExternalResourceMapping["resourceType"]>("STORE");
  const [externalId, setExternalId] = useState("");
  const [internalId, setInternalId] = useState("");
  const [mappingBranch, setMappingBranch] = useState(branches[0]?.id ?? "");

  const headers = useMemo(
    () => ({
      "content-type": "application/json",
      "x-seramet-tenant-id": tenantId,
      "x-seramet-user-id": userId,
    }),
    [tenantId, userId],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/seramet/integrations/diagnostics", { headers });
      const payload = (await response.json()) as { ok: boolean; message?: string } & Diagnostics;
      if (!response.ok || !payload.ok)
        throw new Error(payload.message ?? "Integration diagnostics could not be loaded");
      setData({
        events: payload.events,
        mappings: payload.mappings,
        outbox: payload.outbox,
        deadLetters: payload.deadLetters,
        health: payload.health,
      });
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Integration diagnostics could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }, [headers]);
  useEffect(() => {
    void load();
  }, [load]);

  const testConnection = async (connectionId: string) => {
    setNotice("Testing connection...");
    const response = await fetch(
      `/api/seramet/integrations/connections/${encodeURIComponent(connectionId)}/test`,
      { method: "POST", headers },
    );
    const payload = (await response.json()) as {
      ok: boolean;
      message?: string;
      health?: IntegrationHealthRecord;
    };
    setNotice(
      payload.ok
        ? (payload.health?.message ?? "Connection tested")
        : (payload.message ?? "Connection test failed"),
    );
    await load();
  };
  const toggleConnection = (connection: IntegrationConnection) => {
    const next = {
      ...connection,
      status:
        connection.status === "DISABLED"
          ? connection.secretReference
            ? ("CONFIGURED" as const)
            : ("CREDENTIALS_REQUIRED" as const)
          : ("DISABLED" as const),
      statusMessage:
        connection.status === "DISABLED"
          ? "Connection requires a successful test before activation"
          : "Disabled by an integration manager",
      updatedAt: new Date().toISOString(),
    };
    onConnectionChanged(next);
    setNotice(
      next.status === "DISABLED"
        ? `${next.displayName} disabled`
        : `${next.displayName} enabled for testing`,
    );
  };
  const replay = async (eventId: string) => {
    const response = await fetch(
      `/api/seramet/integrations/events/${encodeURIComponent(eventId)}/replay`,
      { method: "POST", headers },
    );
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setNotice(
      payload.ok ? "A new replay attempt was recorded" : (payload.message ?? "Replay failed"),
    );
    await load();
  };
  const saveMapping = async () => {
    if (!mappingConnection || !externalId.trim() || !internalId.trim()) {
      setNotice("Connection, external ID and internal ID are required");
      return;
    }
    const response = await fetch("/api/seramet/integrations/mappings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        connectionId: mappingConnection,
        resourceType: mappingType,
        externalId: externalId.trim(),
        internalId: internalId.trim(),
        ...(mappingType === "STORE" ? { branchId: mappingBranch } : {}),
        status: "MAPPED",
        metadata: {},
      }),
    });
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setNotice(
      payload.ok
        ? "Mapping saved and ready for validation"
        : (payload.message ?? "Mapping could not be saved"),
    );
    if (payload.ok) {
      setExternalId("");
      setInternalId("");
      await load();
    }
  };
  const unmap = async (id: string) => {
    const response = await fetch(`/api/seramet/integrations/mappings/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
    });
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setNotice(payload.ok ? "Mapping removed" : (payload.message ?? "Mapping could not be removed"));
    await load();
  };

  const filteredEvents = data.events.filter(
    (event) =>
      (providerFilter === "ALL" || event.providerId === providerFilter) &&
      (statusFilter === "ALL" || event.status === statusFilter),
  );
  return (
    <Panel className="mb-4 overflow-hidden">
      <PanelHead
        title="Integration operations"
        sub="Live connection health, immutable events, mappings and recovery"
        right={
          <Btn onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Btn>
        }
      />
      <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2">
        {(["OVERVIEW", "EVENTS", "MAPPINGS", "DEAD_LETTERS"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`h-8 whitespace-nowrap rounded-md px-3 text-[12px] font-semibold ${tab === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
          >
            {item.replace("_", " ")}
            {item === "EVENTS"
              ? ` (${data.events.length})`
              : item === "DEAD_LETTERS"
                ? ` (${data.deadLetters.filter((row) => row.status === "OPEN").length})`
                : ""}
          </button>
        ))}
      </div>
      {notice && (
        <div className="border-b border-border bg-secondary/40 px-4 py-2 text-[12px] text-muted-foreground">
          {notice}
        </div>
      )}

      {tab === "OVERVIEW" && (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((connection) => {
            const provider = providers.find((item) => item.id === connection.providerId);
            const branch = branches.find((item) => item.id === connection.branchId);
            const health = data.health.find((item) => item.connectionId === connection.id);
            const events = data.events.filter((item) => item.connectionId === connection.id);
            return (
              <div key={connection.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold">
                      {provider?.displayName ?? connection.displayName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {branch?.name ?? "Tenant-wide"} · {connection.environment}
                    </div>
                  </div>
                  <Status>{health?.status ?? connection.status}</Status>
                </div>
                <p className="mt-3 min-h-8 text-[11px] text-muted-foreground">
                  {health?.message ?? connection.statusMessage ?? "No server health check recorded"}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <MiniMetric
                    label="Last sync"
                    value={relativeTime(health?.lastSuccessfulRequestAt)}
                  />
                  <MiniMetric
                    label="Pending"
                    value={String(
                      events.filter((item) =>
                        ["RECEIVED", "QUEUED", "RETRY_PENDING"].includes(item.status),
                      ).length,
                    )}
                  />
                  <MiniMetric
                    label="Issues"
                    value={String(
                      (health?.mappingIssueCount ?? 0) +
                        events.filter((item) =>
                          ["FAILED", "DEAD_LETTER", "MAPPING_REQUIRED"].includes(item.status),
                        ).length,
                    )}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Btn onClick={() => void testConnection(connection.id)}>Test connection</Btn>
                  <Btn
                    onClick={() => {
                      setMappingConnection(connection.id);
                      setTab("MAPPINGS");
                    }}
                  >
                    View mappings
                  </Btn>
                  <Btn
                    onClick={() => {
                      setProviderFilter(connection.providerId);
                      setTab("EVENTS");
                    }}
                  >
                    Event log
                  </Btn>
                  <Btn onClick={() => toggleConnection(connection)}>
                    {connection.status === "DISABLED" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Unplug className="h-3.5 w-3.5" />
                    )}
                    {connection.status === "DISABLED" ? "Enable" : "Disable"}
                  </Btn>
                </div>
              </div>
            );
          })}
          {!connections.length && <EmptyState text="No integration connections configured" />}
        </div>
      )}

      {tab === "EVENTS" && (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Select
              value={providerFilter}
              onChange={setProviderFilter}
              options={[
                { value: "ALL", label: "All providers" },
                ...providers.map((item) => ({ value: item.id, label: item.displayName })),
              ]}
            />
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                "ALL",
                "RECEIVED",
                "PROCESSING",
                "PROCESSED",
                "MAPPING_REQUIRED",
                "RETRY_PENDING",
                "FAILED",
                "DEAD_LETTER",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[12px]">
              <thead className="border-y border-border bg-secondary/40 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Resource</th>
                  <th className="px-3 py-2">Direction</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Sync</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-3 py-2">{new Date(event.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {providers.find((item) => item.id === event.providerId)?.displayName ??
                        event.providerId}
                    </td>
                    <td className="px-3 py-2 font-medium">{event.eventType}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {event.externalResourceId ?? "-"}
                    </td>
                    <td className="px-3 py-2">{event.direction}</td>
                    <td className="px-3 py-2">{event.attemptCount}</td>
                    <td className="px-3 py-2">
                      <Status>{event.status}</Status>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Btn onClick={() => setSelectedEvent(event)}>Details</Btn>
                        {["FAILED", "DEAD_LETTER", "MAPPING_REQUIRED"].includes(event.status) && (
                          <Btn onClick={() => void replay(event.id)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Replay
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredEvents.length && <EmptyState text="No events match these filters" />}
          </div>
        </div>
      )}

      {tab === "MAPPINGS" && (
        <div className="p-4">
          <div className="grid gap-2 rounded-lg border border-border bg-secondary/20 p-3 md:grid-cols-2 xl:grid-cols-6">
            <Select
              value={mappingConnection}
              onChange={setMappingConnection}
              options={connections.map((item) => ({ value: item.id, label: item.displayName }))}
            />
            <Select
              value={mappingType}
              onChange={(value) => setMappingType(value as ExternalResourceMapping["resourceType"])}
              options={["STORE", "CATEGORY", "ITEM", "MODIFIER_GROUP", "MODIFIER"].map((value) => ({
                value,
                label: value.replaceAll("_", " "),
              }))}
            />
            {mappingType === "STORE" && (
              <Select
                value={mappingBranch}
                onChange={setMappingBranch}
                options={branches.map((item) => ({ value: item.id, label: item.name }))}
              />
            )}
            <input
              className="h-9 rounded-md border border-border bg-card px-3 text-[12px]"
              placeholder="External ID"
              value={externalId}
              onChange={(event) => setExternalId(event.target.value)}
            />
            <input
              className="h-9 rounded-md border border-border bg-card px-3 text-[12px]"
              placeholder={mappingType === "STORE" ? "Internal store ID" : "Internal resource ID"}
              value={internalId}
              onChange={(event) => setInternalId(event.target.value)}
            />
            <Btn variant="primary" onClick={() => void saveMapping()}>
              Save mapping
            </Btn>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead className="border-y border-border bg-secondary/40 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Provider connection</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">External ID</th>
                  <th className="px-3 py-2">Internal ID</th>
                  <th className="px-3 py-2">Branch</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.mappings.map((mapping) => (
                  <tr key={mapping.id}>
                    <td className="px-3 py-2">
                      {connections.find((item) => item.id === mapping.connectionId)?.displayName ??
                        mapping.connectionId}
                    </td>
                    <td className="px-3 py-2">{mapping.resourceType}</td>
                    <td className="px-3 py-2 font-medium">{mapping.externalId}</td>
                    <td className="px-3 py-2">{mapping.internalId}</td>
                    <td className="px-3 py-2">
                      {branches.find((item) => item.id === mapping.branchId)?.name ?? "-"}
                    </td>
                    <td className="px-3 py-2">
                      <Status>{mapping.status}</Status>
                    </td>
                    <td className="px-3 py-2">
                      <Status>{mapping.syncStatus ?? "NOT SYNCED"}</Status>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {mapping.lastSyncedAt ? relativeTime(mapping.lastSyncedAt) : "Never"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Btn onClick={() => void unmap(mapping.id)}>Unmap</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.mappings.length && <EmptyState text="No store or menu mappings configured" />}
          </div>
        </div>
      )}

      {tab === "DEAD_LETTERS" && (
        <div className="p-4 space-y-2">
          {data.deadLetters.map((letter) => (
            <div
              key={letter.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                <div>
                  <div className="text-[12px] font-semibold">
                    {letter.sourceType} {letter.sourceId}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {letter.error} · {letter.attemptCount} attempts ·{" "}
                    {new Date(letter.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <Status>{letter.status}</Status>
            </div>
          ))}
          {!data.deadLetters.length && <EmptyState text="No dead-letter events" />}
        </div>
      )}

      <Dialog
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle>Integration event details</DialogTitle>
            <DialogDescription>
              Immutable payload and processing metadata are redacted before display.
            </DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-3 text-[12px]">
              <Detail label="Correlation ID" value={selectedEvent.correlationId} />
              <Detail label="Provider event ID" value={selectedEvent.providerEventId ?? "-"} />
              <Detail label="External resource" value={selectedEvent.externalResourceId ?? "-"} />
              <Detail
                label="Timeline"
                value={`${selectedEvent.receivedAt} → ${selectedEvent.processedAt ?? selectedEvent.status}`}
              />
              <pre className="max-h-64 overflow-auto rounded-md bg-secondary p-3 text-[11px]">
                {JSON.stringify(selectedEvent.payload, null, 2)}
              </pre>
              {selectedEvent.lastError && (
                <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-danger">
                  {selectedEvent.lastError}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/50 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-semibold">{value}</div>
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return (
    <div className="col-span-full py-8 text-center text-[12px] text-muted-foreground">{text}</div>
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
      className="h-9 rounded-md border border-border bg-card px-3 text-[12px]"
    >
      <option value="" disabled>
        Select
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-medium">{value}</span>
    </div>
  );
}
function relativeTime(value?: string) {
  if (!value) return "Never";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  return minutes < 1
    ? "Now"
    : minutes < 60
      ? `${minutes}m ago`
      : `${Math.round(minutes / 60)}h ago`;
}
