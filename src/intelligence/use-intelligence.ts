import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import type { IntelligenceResponse, IntelligenceToolDefinition } from "@/intelligence/types";

export type IntelligenceSessionSummary = {
  id: string;
  title: string;
  status: string;
  retention_mode: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type IntelligenceBriefSummary = {
  id: string;
  branch_id: string | null;
  brief_type: "MORNING" | "EOD" | "OWNER" | "MANAGEMENT";
  period_start: string;
  period_end: string;
  status: string;
  quality: string;
  answer: IntelligenceResponse["answer"] | null;
  created_at: string;
  completed_at: string | null;
};

export type IntelligenceAdminSummary = {
  enabled: boolean;
  provider: null | {
    id: string;
    key: string;
    displayName: string;
    modelIdentifier: string;
    status: string;
    retentionMode: "EPHEMERAL" | "SHORT" | "STANDARD";
    promptVersion: string;
    secretConfigured: boolean;
    timeoutMs: number;
    maxInputUnits: number;
    maxOutputUnits: number;
    perMinuteLimit: number;
    dailyRequestLimit: number;
    monthlyRequestLimit: number;
    perUserDailyLimit: number;
    allowedFeatures: string[];
    allowedRoleIds: string[];
  };
  health: null | {
    status: string;
    observed_latency_ms: number | null;
    failure_code: string | null;
    observed_at: string;
  };
  usage: Record<string, number | null>;
};

export function useSerametIntelligence() {
  const {
    activeTenantId,
    branchId,
    branchRecords,
    currentUser,
    isAllBranches,
    role,
    permissions: userPermissions,
  } = useAppContext();
  const selectedBranchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );
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
  const [response, setResponse] = useState<IntelligenceResponse | null>(null);
  const [sessions, setSessions] = useState<IntelligenceSessionSummary[]>([]);
  const [briefs, setBriefs] = useState<IntelligenceBriefSummary[]>([]);
  const [tools, setTools] = useState<IntelligenceToolDefinition[]>([]);
  const [admin, setAdmin] = useState<IntelligenceAdminSummary | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const request = useCallback(
    async <T>(path: string, init?: RequestInit) => {
      const result = await fetch(path, { ...init, headers: { ...headers, ...init?.headers } });
      const payload = (await result.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!result.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Intelligence request failed (${result.status})`,
        );
      }
      return payload;
    },
    [headers],
  );

  const refresh = useCallback(async () => {
    if (!userPermissions.includes(permissions.intelligenceAsk)) return;
    setStatus((current) => (current === "idle" ? "loading" : current));
    setError("");
    try {
      const [sessionPayload, toolPayload, briefPayload, adminPayload] = await Promise.all([
        request<{ sessions: IntelligenceSessionSummary[] }>("/api/seramet/intelligence/sessions"),
        request<{ tools: IntelligenceToolDefinition[] }>("/api/seramet/intelligence/tools"),
        userPermissions.includes(permissions.intelligenceBriefsView)
          ? request<{ briefs: IntelligenceBriefSummary[] }>("/api/seramet/intelligence/briefs")
          : Promise.resolve({ briefs: [] }),
        userPermissions.includes(permissions.intelligenceUsageView)
          ? request<{ admin: IntelligenceAdminSummary }>("/api/seramet/intelligence/admin")
          : Promise.resolve({ admin: null }),
      ]);
      setSessions(sessionPayload.sessions);
      setTools(toolPayload.tools);
      setBriefs(briefPayload.briefs);
      setAdmin(adminPayload.admin);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Intelligence is unavailable");
      setStatus("error");
    }
  }, [request, userPermissions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ask = useCallback(
    async (question: string, sessionId?: string) => {
      setStatus("loading");
      setError("");
      try {
        const payload = await request<{ response: IntelligenceResponse }>(
          "/api/seramet/intelligence/ask",
          {
            method: "POST",
            body: JSON.stringify({
              question,
              ...(sessionId ? { sessionId } : {}),
              branchIds: selectedBranchIds,
            }),
          },
        );
        setResponse(payload.response);
        setStatus("ready");
        await refresh();
        return payload.response;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Intelligence is unavailable");
        setStatus("error");
        throw cause;
      }
    },
    [refresh, request, selectedBranchIds],
  );

  const createBrief = useCallback(
    async (briefType: IntelligenceBriefSummary["brief_type"]) => {
      setStatus("loading");
      setError("");
      try {
        await request("/api/seramet/intelligence/briefs", {
          method: "POST",
          body: JSON.stringify({
            briefType,
            ...(isAllBranches || briefType === "OWNER" ? {} : { branchId }),
          }),
        });
        await refresh();
        setStatus("ready");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Brief could not be queued");
        setStatus("error");
      }
    },
    [branchId, isAllBranches, refresh, request],
  );

  const sendFeedback = useCallback(
    async (
      messageId: string,
      rating: "HELPFUL" | "NOT_HELPFUL" | "INCORRECT_OR_MISSING_EVIDENCE",
    ) => {
      await request("/api/seramet/intelligence/feedback", {
        method: "POST",
        body: JSON.stringify({ messageId, rating }),
      });
    },
    [request],
  );

  const saveProviderConfiguration = useCallback(
    async (configuration: {
      id?: string;
      providerKey: string;
      displayName: string;
      modelIdentifier: string;
      enabled: boolean;
      secretReference?: string;
      timeoutMs: number;
      maxInputUnits: number;
      maxOutputUnits: number;
      perMinuteLimit: number;
      dailyRequestLimit: number;
      monthlyRequestLimit: number;
      perUserDailyLimit: number;
      retentionMode: "EPHEMERAL" | "SHORT" | "STANDARD";
      allowedFeatures: string[];
      allowedRoleIds: string[];
      promptVersion: string;
    }) => {
      setStatus("loading");
      setError("");
      try {
        await request("/api/seramet/intelligence/admin/provider", {
          method: "PUT",
          body: JSON.stringify(configuration),
        });
        await refresh();
        setStatus("ready");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Provider configuration was not saved");
        setStatus("error");
        throw cause;
      }
    },
    [refresh, request],
  );

  return {
    response,
    sessions,
    briefs,
    tools,
    admin,
    status,
    error,
    selectedBranchIds,
    ask,
    createBrief,
    sendFeedback,
    saveProviderConfiguration,
    refresh,
  };
}
