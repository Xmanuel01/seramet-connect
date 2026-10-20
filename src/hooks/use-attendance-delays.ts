import { useSyncExternalStore } from "react";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { attendanceCollection } from "@/lib/attendance-display";

export type DelayRequest = {
  id: string;
  employeeId: string;
  employee: string;
  businessDate: string;
  expectedArrivalAt: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  version: number;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  unread: number;
};
type Snapshot = {
  requests: DelayRequest[];
  unread: number;
  canManage: boolean;
  timeZone: string;
  error: string;
  ready: boolean;
};
const empty: Snapshot = {
  requests: [],
  unread: 0,
  canManage: false,
  timeZone: "UTC",
  error: "",
  ready: false,
};
const stores = new Map<string, ReturnType<typeof createStore>>();
function createStore(tenantId: string, branchId: string) {
  let snapshot = empty;
  let timer: ReturnType<typeof setInterval> | undefined;
  let flight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (value: Snapshot) => {
    snapshot = value;
    listeners.forEach((listener) => listener());
  };
  const headers = () => {
    const token = getSerametAccessToken();
    return {
      "content-type": "application/json",
      "x-seramet-tenant-id": tenantId,
      "x-seramet-branch-id": branchId,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };
  const refresh = () => {
    if (flight || typeof document === "undefined" || document.hidden)
      return flight ?? Promise.resolve();
    controller = new AbortController();
    const signal = controller.signal;
    flight = (async () => {
      try {
        const response = await fetch(
          `/api/seramet/attendance/delays?branchId=${encodeURIComponent(branchId)}`,
          { headers: headers(), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) },
        );
        if (!response.ok)
          throw Object.assign(
            new Error(
              response.status === 403
                ? "Attendance requests are not authorized."
                : "Could not refresh delay requests.",
            ),
            { status: response.status },
          );
        const body = (await response.json()) as Omit<Snapshot, "error" | "ready">;
        attendanceCollection<DelayRequest>(body, "requests", [
          "id",
          "employee",
          "expectedArrivalAt",
          "reason",
          "status",
        ]);
        if (
          typeof body.timeZone !== "string" ||
          typeof body.canManage !== "boolean" ||
          !Number.isSafeInteger(body.unread) ||
          body.unread < 0
        )
          throw new Error("Attendance response is incomplete. Refresh or contact your supervisor.");
        if (!signal.aborted) publish({ ...body, error: "", ready: true });
      } catch (error) {
        if (!signal.aborted)
          publish({
            ...([401, 403].includes((error as { status?: number }).status ?? 0) ? empty : snapshot),
            error: error instanceof Error ? error.message : "Delay requests unavailable.",
          });
      } finally {
        flight = null;
      }
    })();
    return flight;
  };
  const changed = () => {
    void refresh();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        const previous = flight;
        if (previous && controller?.signal.aborted) void previous.then(() => refresh());
        else void refresh();
        timer = setInterval(changed, 30000);
        window.addEventListener("focus", changed);
        document.addEventListener("visibilitychange", changed);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearInterval(timer);
          controller?.abort();
          window.removeEventListener("focus", changed);
          document.removeEventListener("visibilitychange", changed);
          snapshot = empty;
        }
      };
    },
    refresh,
    async command(path: string, body: unknown) {
      const response = await fetch("/api/seramet/attendance/delays" + path, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok)
        throw Object.assign(new Error(result.message ?? "Delay request was not confirmed."), {
          status: response.status,
        });
      if (flight) await flight;
      await refresh();
    },
  };
}
export function useAttendanceDelays() {
  const { activeTenantId, branchId, currentUser, sessionId, authenticationLevel, hasPermission } =
    useAppContext();
  const enabled =
    hasPermission(permissions.attendanceUse) || hasPermission(permissions.staffManage);
  const scope = JSON.stringify([
    activeTenantId,
    branchId,
    currentUser.id,
    sessionId,
    authenticationLevel,
    [...currentUser.permissions].sort(),
  ]);
  let store = stores.get(scope);
  if (!store) {
    store = createStore(activeTenantId, branchId);
    stores.set(scope, store);
  }
  const value = useSyncExternalStore(
    enabled ? store.subscribe : () => () => {},
    enabled ? store.getSnapshot : () => empty,
    () => empty,
  );
  return {
    ...value,
    scope,
    employeeId: currentUser.id,
    branchId,
    command: store.command,
    refresh: store.refresh,
  };
}
