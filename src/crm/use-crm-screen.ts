import { useEffect, useState } from "react";
import { useCrmApi } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";

type ScreenState<T> = {
  key: string;
  status: "loading" | "ready" | "error";
  data: T | null;
  error: string;
};

export function useCrmScreenQuery<T>(path: string | null, allowed: boolean) {
  const { activeTenantId, branchId, isAllBranches } = useAppContext();
  const { request } = useCrmApi();
  const scopeKey = activeTenantId + ":" + (isAllBranches ? "ALL" : branchId);
  const key = scopeKey + ":" + (path ?? "");
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ScreenState<T>>({
    key: "",
    status: "loading",
    data: null,
    error: "",
  });

  useEffect(() => {
    if (!allowed || !path) return;
    const controller = new AbortController();
    setState({ key, status: "loading", data: null, error: "" });
    void request<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ key, status: "ready", data, error: "" });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            status: "error",
            data: null,
            error: cause instanceof Error ? cause.message : "Request failed",
          });
        }
      });
    return () => controller.abort();
  }, [allowed, key, path, request, revision]);

  const current = allowed && path && state.key === key ? state : null;
  return {
    data: current?.status === "ready" ? current.data : null,
    status: allowed ? (current?.status ?? "loading") : ("denied" as const),
    error: current?.error ?? "",
    refresh: () => setRevision((value) => value + 1),
  };
}

export function crmErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Action failed. Please retry.";
}

export const crmFieldClass =
  "h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]";
export const crmTextAreaClass =
  "w-full rounded-md border border-border bg-background p-3 text-[13px]";
