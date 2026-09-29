import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { applyServerMutation } from "@/lib/seramet-repository";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import { acknowledgedSyncStatus, offlineStore } from "@/offline/offline-store";
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
  const revisionRef = useRef(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [activeMutationCount, setActiveMutationCount] = useState(0);
  const [offlineReplayInProgress, setOfflineReplayInProgress] = useState(false);
  const deviceIdRef = useRef("development-pos");
  const scopeKey = `${activeTenantId}:${branchId}`;
  const scopeRef = useRef(scopeKey);
  const hydrationScopeRef = useRef("");
  const sessionScopeRef = useRef("");
  const serverScopeRef = useRef("");
  const modeRef = useRef<PersistenceMode>("unknown");
  const refreshInFlightRef = useRef<{
    scope: string;
    promise: Promise<{ state: TransactionState; revision: number } | undefined>;
  } | null>(null);
  const mutationInFlightRef = useRef(0);
  const refreshAfterMutationRef = useRef(false);
  const flushInFlightRef = useRef<Promise<void> | null>(null);

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

  // Refresh is a silent read once the POS is online. An in-flight background
  // read must never overwrite a newer mutation or a different branch.
  const syncFromBackend = useCallback(async () => {
    const requestScope = scopeKey;
    if (refreshInFlightRef.current?.scope === requestScope) {
      return refreshInFlightRef.current.promise;
    }
    const refresh = async () => {
      setBackendStatus((current) =>
        current === "offline" ? "reconnecting" : current === "loading" ? "loading" : current,
      );
      try {
        let mode = modeRef.current;
        if (mode === "unknown") {
          const health = await fetch("/api/seramet/health");
          if (!health.ok) {
            throw Object.assign(new Error(`Server health failed: ${health.status}`), {
              httpStatus: health.status,
            });
          }
          const healthBody = (await health.json()) as { database?: string };
          mode = healthBody.database === "authoritative" ? "authoritative" : "development";
          if (scopeRef.current !== requestScope) return undefined;
          modeRef.current = mode;
          setPersistenceMode(mode);
        }
        if (mode === "development") {
          const localState = TransactionEngine.load();
          if (scopeRef.current !== requestScope) return undefined;
          setState(localState);
          setRevision(0);
          revisionRef.current = 0;
          setBackendStatus("synced");
          await refreshPendingCount();
          return { state: localState, revision: 0 };
        }
        if (sessionScopeRef.current !== requestScope) {
          const session = await fetch("/api/seramet/auth/session", { headers });
          if (!session.ok) {
            throw Object.assign(new Error(`Session validation failed: ${session.status}`), {
              httpStatus: session.status,
            });
          }
          const sessionBody = (await session.json()) as { actor?: { deviceId?: string } };
          if (scopeRef.current !== requestScope) return undefined;
          if (sessionBody.actor?.deviceId) deviceIdRef.current = sessionBody.actor.deviceId;
          sessionScopeRef.current = requestScope;
        }
        if (hydrationScopeRef.current !== requestScope) {
          hydrationScopeRef.current = requestScope;
          const cached = await offlineStore.readCachedState(activeTenantId, branchId);
          if (
            cached &&
            scopeRef.current === requestScope &&
            serverScopeRef.current !== requestScope
          ) {
            setState(cached.state);
            setRevision(cached.revision);
            revisionRef.current = cached.revision;
          }
        }
        const response = await fetch(
          `/api/seramet/transactions?branchId=${encodeURIComponent(branchId)}`,
          { headers },
        );
        if (!response.ok) {
          throw Object.assign(new Error(`Transaction refresh failed: ${response.status}`), {
            httpStatus: response.status,
          });
        }
        const body = (await response.json()) as { state?: TransactionState; revision?: number };
        if (!body.state) throw new Error("Transaction refresh did not return state");
        if (scopeRef.current !== requestScope) return undefined;
        const nextRevision = body.revision ?? 0;
        if (mutationInFlightRef.current > 0) {
          refreshAfterMutationRef.current = true;
          return undefined;
        }
        if (nextRevision < revisionRef.current) {
          // A slower read must not roll back a later committed write.
          return undefined;
        }
        if (nextRevision !== revisionRef.current || serverScopeRef.current !== requestScope) {
          setState(body.state);
          setRevision(nextRevision);
          revisionRef.current = nextRevision;
          serverScopeRef.current = requestScope;
          await offlineStore.cacheState(activeTenantId, branchId, body.state, nextRevision);
        }
        setBackendStatus("synced");
        await refreshPendingCount();
        return { state: body.state, revision: nextRevision };
      } catch (error) {
        if (scopeRef.current !== requestScope) return undefined;
        console.error(error);
        const httpStatus = (error as { httpStatus?: number }).httpStatus;
        // HTTP rejections are NOT an internet outage and must not enable
        // offline mutations or overwrite a valid working state with stale cache.
        const transportFailure = error instanceof TypeError || !navigator.onLine;
        setBackendStatus(
          httpStatus !== undefined ? "error" : transportFailure ? "offline" : "error",
        );
        return undefined;
      }
    };
    const promise = refresh();
    refreshInFlightRef.current = { scope: requestScope, promise };
    try {
      return await promise;
    } finally {
      if (refreshInFlightRef.current?.promise === promise) {
        refreshInFlightRef.current = null;
      }
    }
  }, [activeTenantId, branchId, headers, refreshPendingCount, scopeKey]);

  const flushOfflineCommands = useCallback(async () => {
    if (flushInFlightRef.current) return flushInFlightRef.current;
    const run = async () => {
      const commands = await offlineStore.replayable(activeTenantId, deviceIdRef.current);
      if (!commands.length) return;
      setOfflineReplayInProgress(true);
      for (const command of commands) {
        await offlineStore.updateCommand({ ...command, syncStatus: "SYNCING" });
      }
      const response = await fetch("/api/seramet/offline/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ commands }),
      });
      if (!response.ok) {
        // Keep original identities unresolved for idempotent replay.
        throw new Error(`Offline synchronization failed: ${response.status}`);
      }
      const result = (await response.json()) as {
        commands?: Array<{ id: string; status: string; code?: string }>;
      };
      let conflicts = false;
      let failures = false;
      for (const command of commands) {
        const server = result.commands?.find((item) => item.id === command.id);
        const syncStatus = acknowledgedSyncStatus(server?.status);
        conflicts ||= syncStatus === "CONFLICT";
        failures ||= syncStatus === "FAILED";
        await offlineStore.updateCommand({
          ...command,
          syncStatus,
          ...(server?.code ? { error: server.code } : {}),
          ...(!server ? { error: "MISSING_SERVER_ACKNOWLEDGEMENT" } : {}),
        });
      }
      await refreshPendingCount();
      if (conflicts || failures) {
        setBackendStatus(conflicts ? "conflict" : "error");
        return;
      }
      await syncFromBackend();
    };
    const promise = run();
    flushInFlightRef.current = promise;
    try {
      await promise;
    } finally {
      setOfflineReplayInProgress(false);
      if (flushInFlightRef.current === promise) flushInFlightRef.current = null;
    }
  }, [activeTenantId, headers, refreshPendingCount, syncFromBackend]);

  useEffect(() => {
    // Switching branches must invalidate all branch-filtered snapshots.
    scopeRef.current = scopeKey;
    hydrationScopeRef.current = "";
    sessionScopeRef.current = "";
    serverScopeRef.current = "";
    modeRef.current = "unknown";
    revisionRef.current = 0;
    setRevision(0);
    setState(createEmptyTransactionState(activeTenantId));
    setPersistenceMode("unknown");
    setBackendStatus("loading");
    void syncFromBackend().then((snapshot) => {
      if (snapshot && navigator.onLine) {
        void flushOfflineCommands().catch(() => setBackendStatus("error"));
      }
    });
  }, [activeTenantId, flushOfflineCommands, scopeKey, syncFromBackend]);

  useEffect(() => {
    // Many events can arrive during one write. Coalesce bursts and retain one
    // trailing refresh so we never lose the latest revision or spin on every event.
    let timer: number | undefined;
    let inFlight = false;
    let queued = false;
    let disposed = false;
    let lastStarted = 0;
    const run = async () => {
      timer = undefined;
      if (disposed || inFlight || !queued) return;
      queued = false;
      inFlight = true;
      lastStarted = Date.now();
      try {
        await syncFromBackend();
      } finally {
        inFlight = false;
        if (queued && !disposed) schedule();
      }
    };
    const schedule = () => {
      if (disposed || inFlight || timer !== undefined) return;
      const delay = Math.max(300, 2_000 - (Date.now() - lastStarted));
      timer = window.setTimeout(() => void run(), delay);
    };
    const refresh = () => {
      // Visibility/focus refresh catches up after background tabs are paused.
      if (document.visibilityState === "hidden") return;
      queued = true;
      schedule();
    };
    window.addEventListener("seramet:realtime", refresh);
    window.addEventListener("seramet:refresh", refresh);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("seramet:realtime", refresh);
      window.removeEventListener("seramet:refresh", refresh);
    };
  }, [syncFromBackend]);

  useEffect(() => {
    const online = () => {
      void syncFromBackend().then((snapshot) => {
        if (snapshot) void flushOfflineCommands().catch(() => setBackendStatus("error"));
      });
    };
    const offline = () => setBackendStatus("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [flushOfflineCommands, syncFromBackend]);

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
        expectedRevision: revisionRef.current,
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
        void offlineStore.cacheState(activeTenantId, branchId, next, revision);
        return next;
      };
      if (persistenceMode === "development") {
        if (action === "closeCashDrawer") {
          const next = applyServerMutation(state, action, payload, localActor);
          await persistDevelopmentSnapshot(next, headers);
          TransactionEngine.save(next);
          setState(next);
          return { state: next, revision };
        }
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
      // A normal online save does not mean connectivity is lost or offline replay is running.
      // The separate activity counter drives the unobtrusive "Saving" badge in POS.
      mutationInFlightRef.current += 1;
      setActiveMutationCount((count) => count + 1);
      let receivedServerResponse = false;
      let serverConflict = false;
      try {
        const response = await fetch("/api/seramet/transactions/mutate", {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            action,
            payload,
            idempotencyKey,
            expectedRevision: revisionRef.current,
          }),
        });
        receivedServerResponse = true;
        if (!response.ok) {
          const failure = (await response.json().catch(() => ({}))) as {
            code?: string;
            message?: string;
            current?: { revision?: number; state?: TransactionState };
          };
          if (response.status === 409 && failure.current?.state) {
            serverConflict = true;
            const currentRevision = failure.current.revision ?? revisionRef.current;
            setState(failure.current.state);
            setRevision(currentRevision);
            revisionRef.current = currentRevision;
            setBackendStatus("conflict");
          }
          throw new Error(
            failure.message ?? `Transaction command failed with status ${response.status}`,
          );
        }
        const body = (await response.json()) as { state: TransactionState; revision?: number };
        setState(body.state);
        const nextRevision = body.revision ?? revisionRef.current + 1;
        setRevision(nextRevision);
        revisionRef.current = nextRevision;
        // IndexedDB cache failures must never misreport a committed server save as failed.
        void offlineStore.cacheState(activeTenantId, branchId, body.state, nextRevision).catch(
          (cause) => console.warn("Unable to update the offline read cache", cause),
        );
        setBackendStatus("synced");
        return body;
      } catch (error) {
        if (
          !receivedServerResponse &&
          offlineAllowedCommands.has(action as OfflineAllowedCommand)
        ) {
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
        if (!serverConflict) setBackendStatus("error");
        throw error;
      } finally {
        mutationInFlightRef.current -= 1;
        setActiveMutationCount((count) => Math.max(0, count - 1));
        if (mutationInFlightRef.current === 0 && refreshAfterMutationRef.current) {
          refreshAfterMutationRef.current = false;
          queueMicrotask(() => void syncFromBackend());
        }
      }
    },
    [
      activeTenantId,
      backendStatus,
      branchId,
      createOfflineCommand,
      headers,
      localActor,
      persistenceMode,
      refreshPendingCount,
      revision,
      state,
      syncFromBackend,
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
    activeMutationCount,
    offlineReplayInProgress,
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
