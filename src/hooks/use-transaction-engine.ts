import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { applyServerMutation } from "@/lib/seramet-repository";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import { offlineStore } from "@/offline/offline-store";
import {
  offlineAllowedCommands,
  type OfflineAllowedCommand,
  type OfflineCommand,
} from "@/offline/types";

export type BackendStatus =
  "loading" | "synced" | "syncing" | "offline" | "reconnecting" | "conflict" | "error";

type PersistenceMode = "unknown" | "development" | "authoritative";

export function useTransactionEngine() {
  const { activeTenantId, branch, branchId, role, currentUser } = useAppContext();
  const [state, setState] = useState<TransactionState>(() => createEmptyTransactionState(""));
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("loading");
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>("unknown");
  const [revision, setRevision] = useState(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const deviceIdRef = useRef("development-pos");

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
    };
  }, [activeTenantId, branch, branchId, currentUser.id, currentUser.name, role]);

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await offlineStore.pending(activeTenantId, deviceIdRef.current);
      setPendingSyncCount(pending.length);
    } catch {
      setPendingSyncCount(0);
    }
  }, [activeTenantId]);

  const syncFromBackend = useCallback(async () => {
    try {
      setBackendStatus((current) => (current === "offline" ? "reconnecting" : "loading"));
      const health = await fetch("/api/seramet/health");
      if (!health.ok) throw new Error(`Server readiness failed: ${health.status}`);
      const healthBody = (await health.json()) as { database?: string };
      const mode: PersistenceMode =
        healthBody.database === "authoritative" ? "authoritative" : "development";
      setPersistenceMode(mode);
      if (mode === "development") {
        setState(TransactionEngine.load());
        setRevision(0);
        setBackendStatus("synced");
        await refreshPendingCount();
        return;
      }
      const session = await fetch("/api/seramet/auth/session", { headers });
      if (!session.ok) throw new Error(`Session validation failed: ${session.status}`);
      const sessionBody = (await session.json()) as { actor?: { deviceId?: string } };
      if (sessionBody.actor?.deviceId) deviceIdRef.current = sessionBody.actor.deviceId;
      const cached = await offlineStore.readCachedState(activeTenantId);
      if (cached) {
        setState(cached.state);
        setRevision(cached.revision);
      }
      const response = await fetch(
        `/api/seramet/transactions?branchId=${encodeURIComponent(branchId)}`,
        { headers },
      );
      if (!response.ok) throw new Error(`Transaction sync failed: ${response.status}`);
      const body = (await response.json()) as { state?: TransactionState; revision?: number };
      if (!body.state) throw new Error("Transaction sync did not return state");
      await offlineStore.cacheState(activeTenantId, body.state, body.revision ?? 0);
      setState(body.state);
      setRevision(body.revision ?? 0);
      setBackendStatus("synced");
      await refreshPendingCount();
    } catch (error) {
      console.error(error);
      try {
        const cached = await offlineStore.readCachedState(activeTenantId);
        if (cached) {
          setState(cached.state);
          setRevision(cached.revision);
        }
      } catch {
        // A missing cache is expected on a device's first offline launch.
      }
      setBackendStatus("offline");
    }
  }, [activeTenantId, branchId, headers, refreshPendingCount]);

  const flushOfflineCommands = useCallback(async () => {
    const commands = await offlineStore.pending(activeTenantId, deviceIdRef.current);
    if (!commands.length) return;
    setBackendStatus("reconnecting");
    for (const command of commands) {
      await offlineStore.updateCommand({ ...command, syncStatus: "SYNCING" });
    }
    const response = await fetch("/api/seramet/offline/sync", {
      method: "POST",
      headers,
      body: JSON.stringify({ commands }),
    });
    if (!response.ok) throw new Error(`Offline synchronization failed: ${response.status}`);
    const result = (await response.json()) as {
      commands: Array<{ id: string; status: string; code?: string }>;
    };
    for (const command of commands) {
      const server = result.commands.find((item) => item.id === command.id);
      const syncStatus = server?.status === "conflict" ? "CONFLICT" : "SYNCED";
      await offlineStore.updateCommand({
        ...command,
        syncStatus,
        ...(server?.code ? { error: server.code } : {}),
      });
    }
    await refreshPendingCount();
    if (result.commands.some((command) => command.status === "conflict")) {
      setBackendStatus("conflict");
      return;
    }
    await syncFromBackend();
  }, [activeTenantId, headers, refreshPendingCount, syncFromBackend]);

  useEffect(() => {
    void syncFromBackend();
  }, [syncFromBackend]);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void syncFromBackend(), 150);
    };
    window.addEventListener("seramet:realtime", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("seramet:realtime", refresh);
    };
  }, [syncFromBackend]);

  useEffect(() => {
    const online = () => void flushOfflineCommands().catch(() => setBackendStatus("offline"));
    const offline = () => setBackendStatus("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [flushOfflineCommands]);

  const localActor = useMemo(
    () => ({
      id: currentUser.id,
      name: currentUser.name,
      tenantId: activeTenantId,
      roleIds: [],
      permissions: [],
      assignedBranchIds: [branchId],
      assignedBranches: [{ id: branchId, name: branch }],
      branchScope: { type: "BRANCH" as const, branchId },
      branchId,
      role,
      branch,
      deviceId: deviceIdRef.current,
    }),
    [activeTenantId, branch, branchId, currentUser.id, currentUser.name, role],
  );

  const createOfflineCommand = useCallback(
    async (
      action: OfflineAllowedCommand,
      payload: unknown,
      idempotencyKey: string,
      localEffects?: OfflineCommand["localEffects"],
    ): Promise<OfflineCommand> => {
      const id = crypto.randomUUID();
      return {
        id,
        tenantId: activeTenantId,
        branchId,
        deviceId: deviceIdRef.current,
        actorId: currentUser.id,
        commandType: action,
        payload,
        createdAt: new Date().toISOString(),
        clientSequence: await offlineStore.nextSequence(deviceIdRef.current),
        idempotencyKey,
        syncStatus: "PENDING",
        correlationId: crypto.randomUUID(),
        ...(localEffects ? { localEffects } : {}),
      };
    },
    [activeTenantId, branchId, currentUser.id],
  );

  const mutate = useCallback(
    async (
      action: string,
      payload: unknown,
      optimistic?: (current: TransactionState) => TransactionState,
      localEffects?: OfflineCommand["localEffects"],
    ) => {
      const idempotencyKey = `command:${crypto.randomUUID()}`;
      const applyOptimistic = () => {
        const next = optimistic
          ? optimistic(state)
          : applyServerMutation(state, action, payload, localActor);
        setState(next);
        void offlineStore.cacheState(activeTenantId, next, revision);
        return next;
      };
      if (persistenceMode === "development") {
        const next = applyOptimistic();
        TransactionEngine.save(next);
        await persistDevelopmentSnapshot(next, headers);
        return { state: next, revision };
      }
      if (!navigator.onLine || backendStatus === "offline") {
        if (!offlineAllowedCommands.has(action as OfflineAllowedCommand)) {
          throw new Error(`${action} is unavailable while the POS is offline`);
        }
        const command = await createOfflineCommand(
          action as OfflineAllowedCommand,
          payload,
          idempotencyKey,
          localEffects,
        );
        await offlineStore.enqueue(command);
        const nextState = applyOptimistic();
        setBackendStatus("offline");
        await refreshPendingCount();
        return { state: nextState, revision, offline: true as const };
      }
      setBackendStatus("syncing");
      try {
        const response = await fetch("/api/seramet/transactions/mutate", {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ action, payload, idempotencyKey }),
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(`Transaction command failed: ${response.status} ${message}`);
        }
        const body = (await response.json()) as { state: TransactionState; revision?: number };
        setState(body.state);
        setRevision(body.revision ?? revision + 1);
        await offlineStore.cacheState(activeTenantId, body.state, body.revision ?? revision + 1);
        setBackendStatus("synced");
        return body;
      } catch (error) {
        if (offlineAllowedCommands.has(action as OfflineAllowedCommand)) {
          const command = await createOfflineCommand(
            action as OfflineAllowedCommand,
            payload,
            idempotencyKey,
            localEffects,
          );
          await offlineStore.enqueue(command);
          const nextState = applyOptimistic();
          setBackendStatus("offline");
          await refreshPendingCount();
          return { state: nextState, revision, offline: true as const };
        }
        setBackendStatus("error");
        throw error;
      }
    },
    [
      activeTenantId,
      backendStatus,
      createOfflineCommand,
      headers,
      localActor,
      persistenceMode,
      refreshPendingCount,
      revision,
      state,
    ],
  );

  const apply = useCallback(
    (updater: (current: TransactionState) => TransactionState) => {
      if (persistenceMode === "authoritative") {
        setBackendStatus("error");
        throw new Error("Authoritative deployments require a typed server mutation");
      }
      setState((current) => {
        const next = updater(current);
        TransactionEngine.save(next);
        setBackendStatus("syncing");
        void persistDevelopmentSnapshot(next, headers)
          .then(() => setBackendStatus("synced"))
          .catch(() => setBackendStatus("error"));
        return next;
      });
    },
    [headers, persistenceMode],
  );

  const reset = useCallback(() => {
    if (persistenceMode === "authoritative") {
      throw new Error("Authoritative data cannot be reset from the browser");
    }
    const next = TransactionEngine.reset();
    setState(next);
    void persistDevelopmentSnapshot(next, headers);
  }, [headers, persistenceMode]);

  return {
    state,
    apply,
    mutate,
    reset,
    backendStatus,
    persistenceMode,
    pendingSyncCount,
    syncFromBackend,
    flushOfflineCommands,
  };
}

async function persistDevelopmentSnapshot(
  state: TransactionState,
  headers: Record<string, string>,
) {
  const idempotencyKey = `snapshot:${crypto.randomUUID()}`;
  const response = await fetch("/api/seramet/transactions", {
    method: "PUT",
    headers: { ...headers, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ state, idempotencyKey }),
  });
  if (!response.ok)
    throw new Error(`Development transaction persistence failed: ${response.status}`);
}
