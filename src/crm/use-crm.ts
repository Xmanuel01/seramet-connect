import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

type QueryStatus = "idle" | "loading" | "ready" | "error";

type ApiErrorBody = {
  error?: string;
  message?: string;
};

export function useCrmApi() {
  const { activeTenantId, branch, branchId, currentUser, isAllBranches, role } = useAppContext();
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
      "x-seramet-branch": branch,
      ...(isAllBranches ? { "x-seramet-branch-scope": "ALL" } : {}),
    };
  }, [activeTenantId, branch, branchId, currentUser.id, currentUser.name, isAllBranches, role]);

  const request = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: { ...headers, ...(init?.headers ?? {}) },
      });
      const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? `CRM request failed (${response.status})`);
      }
      return body;
    },
    [headers],
  );

  const command = useCallback(
    <T>(path: string, body: unknown, method: "POST" | "PUT" | "DELETE" = "POST") =>
      request<T>(path, { method, body: JSON.stringify(body) }),
    [request],
  );

  const scopedPath = useCallback(
    (path: string) => {
      if (isAllBranches) return path;
      const separator = path.includes("?") ? "&" : "?";
      return `${path}${separator}branchId=${encodeURIComponent(branchId)}`;
    },
    [branchId, isAllBranches],
  );

  return { request, command, scopedPath, branchId, isAllBranches };
}

export function useCrmQuery<T>(path: string | null, enabled = true) {
  const { request } = useCrmApi();
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<QueryStatus>("idle");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled || !path) {
      setStatus("idle");
      return null;
    }
    setStatus("loading");
    setError("");
    try {
      const result = await request<T>(path);
      setData(result);
      setStatus("ready");
      return result;
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "CRM data is unavailable");
      setStatus("error");
      return null;
    }
  }, [enabled, path, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, status, error, refresh };
}
