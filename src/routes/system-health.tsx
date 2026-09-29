import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";

export const Route = createFileRoute("/system-health")({
  head: () => ({ meta: [{ title: "System Health - Seramet" }] }),
  component: SystemHealthPage,
});

type Health = {
  database: { status: string; schemaVersion: number };
  queue: { status: string };
  workers: Array<{ status: string; count: number }>;
  deadLetters: number;
  backup: { status: string; completed_at: string | null; verified_at: string | null } | null;
  build: { version: string; buildId: string; environment: string };
};

function SystemHealthPage() {
  const { activeTenantId, branchId, currentUser } = useAppContext();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = getSerametAccessToken();
      const response = await fetch("/api/seramet/system/health", {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "x-seramet-tenant-id": activeTenantId,
          "x-seramet-user-id": currentUser.id,
          "x-seramet-branch-id": branchId,
        },
      });
      if (!response.ok) throw new Error(`Health request failed (${response.status})`);
      setHealth((await response.json()) as Health);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "System health is unavailable");
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, branchId, currentUser.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const workerCount = health?.workers.reduce((total, row) => total + Number(row.count), 0) ?? 0;
  return (
    <AppShell
      title="System Health"
      subtitle="Authoritative services and background operations"
      actions={
        <Btn onClick={() => void load()} disabled={loading}>
          <RefreshCcw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Btn>
      }
    >
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Database"
          value={health?.database.status ?? "Checking"}
          note={`Schema v${health?.database.schemaVersion ?? "-"}`}
        />
        <Metric
          label="Durable Queue"
          value={health?.queue.status ?? "Checking"}
          note="Critical background delivery"
        />
        <Metric label="Worker Jobs" value={String(workerCount)} note="Recorded in current tenant" />
        <Metric
          label="Dead Letters"
          value={String(health?.deadLetters ?? 0)}
          note={health?.deadLetters ? "Manager review required" : "No open failures"}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Worker Status" sub="Persistent job state by outcome" />
          <div className="grid gap-2 p-4">
            {(health?.workers ?? []).map((row) => (
              <div
                key={row.status}
                className="flex items-center justify-between border-b border-border py-2 text-sm"
              >
                <Status>{row.status}</Status>
                <strong>{row.count}</strong>
              </div>
            ))}
            {!health?.workers.length && (
              <p className="text-sm text-muted-foreground">No worker jobs recorded.</p>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Deployment" sub="Support and recovery context" />
          <dl className="grid grid-cols-[140px_1fr] gap-y-3 p-4 text-sm">
            <dt className="text-muted-foreground">Environment</dt>
            <dd>{health?.build.environment ?? "-"}</dd>
            <dt className="text-muted-foreground">Application</dt>
            <dd>{health?.build.version ?? "-"}</dd>
            <dt className="text-muted-foreground">Build</dt>
            <dd className="break-all">{health?.build.buildId ?? "-"}</dd>
            <dt className="text-muted-foreground">Last backup</dt>
            <dd>{health?.backup?.completed_at ?? "Not reported"}</dd>
            <dt className="text-muted-foreground">Restore verified</dt>
            <dd>{health?.backup?.verified_at ?? "Not reported"}</dd>
          </dl>
        </Panel>
      </div>
    </AppShell>
  );
}
