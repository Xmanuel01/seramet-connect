import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import type { EnterpriseDashboard, EnterpriseOverview } from "@/enterprise/types";

type QueryState = "loading" | "ready" | "error";

export function useEnterprise() {
  const { activeTenantId, branchId, currentUser, isAllBranches, role } = useAppContext();
  const headers = useMemo(() => {
    const token = getSerametAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-user-id": currentUser.id,
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      "x-seramet-user": currentUser.name,
      "x-seramet-role": role,
      ...(isAllBranches ? { "x-seramet-branch-scope": "ALL" } : {}),
    };
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, isAllBranches, role]);
  const [overview, setOverview] = useState<EnterpriseOverview | null>(null);
  const [dashboard, setDashboard] = useState<EnterpriseDashboard | null>(null);
  const [scopeNodeId, setScopeNodeId] = useState("");
  const scopeNodeIdRef = useRef("");
  const [auditEvents, setAuditEvents] = useState<Array<Record<string, unknown>>>([]);
  const [exportMessage, setExportMessage] = useState("");
  const [status, setStatus] = useState<QueryState>("loading");
  const [error, setError] = useState("");

  const end = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const start = useMemo(() => {
    const date = new Date(`${end}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  }, [end]);

  const request = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, { ...init, headers: { ...headers, ...init?.headers } });
      const body = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.message ?? body.error ?? `Enterprise request failed (${response.status})`,
        );
      }
      return body;
    },
    [headers],
  );

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const result = await request<{ overview: EnterpriseOverview }>(
        "/api/seramet/enterprise/overview",
      );
      setOverview(result.overview);
      const currentScope = scopeNodeIdRef.current;
      const nextScope =
        currentScope && result.overview.nodes.some((node) => node.id === currentScope)
          ? currentScope
          : (result.overview.rootNodes[0]?.id ?? result.overview.nodes[0]?.id ?? "");
      scopeNodeIdRef.current = nextScope;
      setScopeNodeId(nextScope);
      if (nextScope) {
        const query = new URLSearchParams({
          scopeNodeId: nextScope,
          periodStart: start,
          periodEnd: end,
        });
        const auditQuery = new URLSearchParams({ scopeNodeId: nextScope, limit: "100" });
        const [dashboardResult, auditResult] = await Promise.all([
          request<{ dashboard: EnterpriseDashboard }>(
            `/api/seramet/enterprise/dashboard?${query.toString()}`,
          ),
          request<{ events: Array<Record<string, unknown>> }>(
            `/api/seramet/enterprise/audit?${auditQuery.toString()}`,
          ).catch(() => ({ events: [] })),
        ]);
        setDashboard(dashboardResult.dashboard);
        setAuditEvents(auditResult.events);
      } else {
        setDashboard(null);
        setAuditEvents([]);
      }
      setStatus("ready");
    } catch (cause) {
      setOverview(null);
      setDashboard(null);
      setError(cause instanceof Error ? cause.message : "Enterprise control data is unavailable");
      setStatus("error");
    }
  }, [end, request, start]);

  const selectScope = useCallback(
    async (nextScope: string) => {
      scopeNodeIdRef.current = nextScope;
      setScopeNodeId(nextScope);
      setStatus("loading");
      setError("");
      try {
        const query = new URLSearchParams({
          scopeNodeId: nextScope,
          periodStart: start,
          periodEnd: end,
        });
        const auditQuery = new URLSearchParams({ scopeNodeId: nextScope, limit: "100" });
        const [result, auditResult] = await Promise.all([
          request<{ dashboard: EnterpriseDashboard }>(
            `/api/seramet/enterprise/dashboard?${query.toString()}`,
          ),
          request<{ events: Array<Record<string, unknown>> }>(
            `/api/seramet/enterprise/audit?${auditQuery.toString()}`,
          ).catch(() => ({ events: [] })),
        ]);
        setDashboard(result.dashboard);
        setAuditEvents(auditResult.events);
        setStatus("ready");
      } catch (cause) {
        setDashboard(null);
        setError(cause instanceof Error ? cause.message : "Enterprise scope is unavailable");
        setStatus("error");
      }
    },
    [end, request, start],
  );

  const requestAuditExport = useCallback(async () => {
    if (!scopeNodeIdRef.current) return;
    setExportMessage("Preparing scoped export...");
    try {
      const result = await request<{ export: { id: string; status: string } }>(
        "/api/seramet/enterprise/exports",
        {
          method: "POST",
          body: JSON.stringify({
            scopeNodeId: scopeNodeIdRef.current,
            exportType: "ENTERPRISE_AUDIT",
            rowLimit: 1000,
            idempotencyKey: `enterprise-audit:${crypto.randomUUID()}`,
          }),
        },
      );
      setExportMessage(`Audit export ${result.export.status.toLowerCase()} (${result.export.id})`);
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : "Audit export failed");
    }
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    overview,
    dashboard,
    auditEvents,
    exportMessage,
    scopeNodeId,
    status,
    error,
    refresh,
    selectScope,
    requestAuditExport,
    period: { start, end },
  };
}
