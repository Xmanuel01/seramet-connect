import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead } from "@/components/app/ui";
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
      if (!response.ok) throw new Error("Couldn't check the system right now. Try Refresh.");
      setHealth((await response.json()) as Health);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message.startsWith("Couldn't")
          ? reason.message
          : "Couldn't check the system right now. Try Refresh.",
      );
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, branchId, currentUser.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const count = (statuses: string[]) =>
    health?.workers
      .filter((row) => statuses.includes(row.status))
      .reduce((total, row) => total + Number(row.count), 0) ?? 0;
  const waiting = count(["PENDING", "RETRY_PENDING", "CLAIMED", "RUNNING"]);
  const failed = (health?.deadLetters ?? 0) + count(["FAILED", "DEAD_LETTER"]);
  const working = (status?: string) =>
    !health ? "Checking" : status === "available" || status === "ok" ? "Working" : "Problem";
  const allGood =
    !!health &&
    working(health.database.status) === "Working" &&
    working(health.queue.status) === "Working" &&
    failed === 0;
  const date = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        )
      : "Not recorded";
  return (
    <AppShell
      title="System health"
      actions={
        <Btn onClick={() => void load()} disabled={loading}>
          <RefreshCcw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Btn>
      }
    >
      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      ) : health ? (
        <div
          className={`mb-4 rounded-md border p-3 text-sm font-semibold ${allGood ? "border-success/30 bg-success-soft text-success" : "border-warning/30 bg-warning-soft text-warning"}`}
        >
          {allGood
            ? "Everything is working."
            : "Something needs attention. Contact Seramet support if it doesn't clear after a few minutes."}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Your data" value={working(health?.database.status)} />
        <Metric label="Background tasks" value={working(health?.queue.status)} />
        <Metric label="Tasks waiting" value={String(waiting)} />
        <Metric label="Failed tasks" value={String(failed)} invert={failed > 0} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="About" />
        <dl className="grid grid-cols-[140px_1fr] gap-y-3 p-4 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd>{health?.build.version ?? "-"}</dd>
          <dt className="text-muted-foreground">Last backup</dt>
          <dd>{date(health?.backup?.completed_at)}</dd>
        </dl>
      </Panel>
    </AppShell>
  );
}
