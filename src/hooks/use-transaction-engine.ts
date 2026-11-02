import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { closingMutationActions } from "@/payments/daily-closing";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { posConnectivity, usePosConnectivity } from "@/lib/pos-connectivity";
import { tracePos } from "@/lib/pos-lifecycle-trace";
import { serializeOfflineReplay } from "@/offline/replay-coordinator";
import { useAppContext } from "@/lib/app-context";
import { applyServerMutation } from "@/lib/seramet-repository";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import { acknowledgedSyncStatus, offlineStore } from "@/offline/offline-store";
import {
  createTransactionRefreshCoordinator,
  mayApplyRemoteSnapshot,
  readOptionalOfflineSnapshot,
} from "@/lib/transaction-refresh-coordinator";
import {
  offlineAllowedCommands,
  type OfflineAllowedCommand,
  type OfflineCommand,
} from "@/offline/types";

export type BackendStatus =
  "loading" | "synced" | "syncing" | "offline" | "reconnecting" | "conflict" | "error";

type PersistenceMode = "unknown" | "development" | "authoritative";

// Shared by every page in this tab. Each page used to repeat the health and session requests
// before it could ask for its snapshot; the server's persistence mode cannot change while the
// tab is open, and a sign-in scope only needs proving once (an auth rejection forgets it).
let probedPersistenceMode: Exclude<PersistenceMode, "unknown"> | undefined;
const validatedSessions = new Map<string, { deviceId?: string }>();

export function useTransactionEngine() {
  const { activeTenantId, branch, branchId, role, currentUser } = useAppContext();
  const [state, setState] = useState<TransactionState>(() => createEmptyTransactionState(""));
  const stateRef = useRef(state);
  stateRef.current = state;
  const connection = usePosConnectivity();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("loading");
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>("unknown");
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [activeMutationCount, setActiveMutationCount] = useState(0);
  const [offlineReplayInProgress, setOfflineReplayInProgress] = useState(false);
  const [offlineStorageAvailable, setOfflineStorageAvailable] = useState(true);
  const deviceIdRef = useRef("development-pos");
  const scopeKey = `${activeTenantId}:${branchId}:${currentUser.id}:${currentUser.deviceId ?? "account"}`;
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
  const localMutationGenerationRef = useRef(0);
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
      const pending = (await offlineStore.pending(activeTenantId, deviceIdRef.current)).filter(
        (command) => command.branchId === branchId && command.actorId === currentUser.id,
      );
      setPendingSyncCount(pending.length);
      setOfflineStorageAvailable(true);
    } catch {
      setOfflineStorageAvailable(false);
    }
  }, [activeTenantId, branchId, currentUser.id]);

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
          if (!probedPersistenceMode) {
            const health = await fetch("/api/seramet/health");
            if (!health.ok) {
              throw Object.assign(new Error(`Server health failed: ${health.status}`), {
                httpStatus: health.status,
              });
            }
            const healthBody = (await health.json()) as { database?: string };
            if (healthBody.database !== "authoritative" && !import.meta.env.DEV)
              throw new Error("Authoritative persistence unavailable");
            probedPersistenceMode =
              healthBody.database === "authoritative" ? "authoritative" : "development";
          }
          mode = probedPersistenceMode;
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
          let validated = validatedSessions.get(requestScope);
          if (!validated) {
            const session = await authenticatedFetch("/api/seramet/auth/session", {
              headers,
              signal: AbortSignal.timeout(12_000),
            });
            if (!session.ok) {
              throw Object.assign(new Error(`Session validation failed: ${session.status}`), {
                httpStatus: session.status,
              });
            }
            const sessionBody = (await session.json()) as { actor?: { deviceId?: string } };
            const deviceId = sessionBody.actor?.deviceId;
            validated = deviceId ? { deviceId } : {};
            validatedSessions.set(requestScope, validated);
          }
          if (scopeRef.current !== requestScope) return undefined;
          if (validated.deviceId) deviceIdRef.current = validated.deviceId;
          sessionScopeRef.current = requestScope;
        }
        if (hydrationScopeRef.current !== requestScope) {
          hydrationScopeRef.current = requestScope;
          // Browsers with unavailable IndexedDB can still use the authoritative POS.
          const hydrationGeneration = localMutationGenerationRef.current;
          const cached = await readOptionalOfflineSnapshot(() =>
            offlineStore.readCachedState(activeTenantId, branchId, scopeKey),
          );
          if (
            cached &&
            scopeRef.current === requestScope &&
            localMutationGenerationRef.current === hydrationGeneration &&
            serverScopeRef.current !== requestScope
          ) {
            setState(cached.state);
            setRevision(cached.revision);
            revisionRef.current = cached.revision;
          }
        }
        const response = await authenticatedFetch(
          `/api/seramet/transactions?branchId=${encodeURIComponent(branchId)}${serverScopeRef.current === requestScope ? `&knownRevision=${revisionRef.current}` : ""}`,
          { headers, signal: AbortSignal.timeout(12_000) },
        );
        if (!response.ok) {
          throw Object.assign(new Error(`Transaction refresh failed: ${response.status}`), {
            httpStatus: response.status,
          });
        }
        const body = (await response.json()) as {
          state?: TransactionState;
          revision?: number;
          unchanged?: boolean;
        };
        tracePos(
          body.unchanged ? "SNAPSHOT_UNCHANGED" : "SNAPSHOT_READ",
          posConnectivity.id,
          body.revision,
        );
        if (body.unchanged && serverScopeRef.current === requestScope) {
          if (scopeRef.current !== requestScope) return undefined;
          await refreshPendingCount();
          setBackendStatus((current) => (current === "conflict" ? current : "synced"));
          return { state: stateRef.current, revision: revisionRef.current };
        }
        if (!body.state) throw new Error("Transaction refresh did not return state");
        if (scopeRef.current !== requestScope) return undefined;
        const nextRevision = body.revision ?? 0;
        // Never replace optimistic offline changes with a server snapshot before
        // all local commands for this branch have been acknowledged. Resolve the
        // queue before comparing revisions, since queued edits share the base revision.
        const unresolved =
          typeof indexedDB === "undefined"
            ? []
            : await offlineStore.pending(activeTenantId, deviceIdRef.current).catch(() => []);
        if (scopeRef.current !== requestScope) return undefined;
        if (mutationInFlightRef.current > 0) {
          refreshAfterMutationRef.current = true;
          return undefined;
        }
        const branchPending = unresolved.filter(
          (command) => command.branchId === branchId && command.actorId === currentUser.id,
        );
        if (branchPending.length > 0) {
          setPendingSyncCount(unresolved.length);
          setBackendStatus(
            branchPending.some((command) => command.syncStatus === "CONFLICT")
              ? "conflict"
              : "synced",
          );
          // Return readiness to the startup/reconnect caller so it can replay,
          // without replacing the locally edited snapshot in the UI.
          return { state: body.state, revision: nextRevision };
        }
        if (
          !mayApplyRemoteSnapshot({
            sameScope: scopeRef.current === requestScope,
            inFlightMutations: mutationInFlightRef.current,
            pendingLocalCommands: branchPending.length,
            nextRevision,
            currentRevision: revisionRef.current,
          })
        ) {
          return undefined;
        }
        if (nextRevision !== revisionRef.current || serverScopeRef.current !== requestScope) {
          setState(body.state);
          setRevision(nextRevision);
          revisionRef.current = nextRevision;
          serverScopeRef.current = requestScope;
          void offlineStore
            .cacheState(activeTenantId, branchId, body.state, nextRevision, scopeKey)
            .catch(() => undefined);
        }
        setBackendStatus("synced");
        await refreshPendingCount();
        return { state: body.state, revision: nextRevision };
      } catch (error) {
        if (scopeRef.current !== requestScope) return undefined;
        const httpStatus = (error as { httpStatus?: number }).httpStatus;
        if (httpStatus === 401 || httpStatus === 403) {
          validatedSessions.delete(requestScope);
          sessionScopeRef.current = "";
        }
        // HTTP rejections are NOT an internet outage and must not enable
        // offline mutations or overwrite a valid working state with stale cache.
        posConnectivity.failure(httpStatus, !navigator.onLine);
        void posConnectivity.requestVerification();
        setBackendStatus(httpStatus === 409 ? "conflict" : "error");
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
  }, [activeTenantId, branchId, headers, refreshPendingCount, scopeKey, currentUser.id]);

  const flushOfflineCommands = useCallback(async () => {
    if (flushInFlightRef.current) return flushInFlightRef.current;
    let replayStarted = false;
    const run = async () => {
      const requestScope = scopeKey;
      if (posConnectivity.getSnapshot().state !== "ONLINE") return;
      const replayable = await readOptionalOfflineSnapshot(() =>
        offlineStore.replayable(activeTenantId, deviceIdRef.current),
      );
      if (!replayable) {
        setOfflineStorageAvailable(false);
        return;
      }
      const commands = replayable
        .filter((command) => command.branchId === branchId && command.actorId === currentUser.id)
        .slice(0, 50);
      if (!commands.length) return;
      if (scopeRef.current !== requestScope) return;
      tracePos("REPLAY_START", posConnectivity.id, commands.length);
      replayStarted = true;
      setOfflineReplayInProgress(true);
      for (const command of commands) {
        await offlineStore.updateCommand({ ...command, syncStatus: "SYNCING" });
      }
      const response = await authenticatedFetch("/api/seramet/offline/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ commands }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        // Keep original identities unresolved for idempotent replay.
        if ([401, 403].includes(response.status))
          for (const command of commands)
            await offlineStore.updateCommand({
              ...command,
              syncStatus: "FAILED",
              error: "AUTHORIZATION_REJECTED",
            });
        throw Object.assign(new Error("Offline synchronization unavailable"), {
          httpStatus: response.status,
        });
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
      if (scopeRef.current !== requestScope) return;
      if (conflicts || failures) {
        setBackendStatus(conflicts ? "conflict" : "error");
        return;
      }
      await syncFromBackend();
    };
    const promise = serializeOfflineReplay(scopeKey, run);
    flushInFlightRef.current = promise;
    try {
      await promise;
    } finally {
      if (replayStarted) tracePos("REPLAY_END", posConnectivity.id);
      setOfflineReplayInProgress(false);
      if (flushInFlightRef.current === promise) flushInFlightRef.current = null;
    }
  }, [
    activeTenantId,
    branchId,
    currentUser.id,
    headers,
    refreshPendingCount,
    syncFromBackend,
    scopeKey,
  ]);

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
    const requestScope = scopeKey;
    void syncFromBackend().then((snapshot) => {
      if (snapshot && navigator.onLine && scopeRef.current === requestScope) {
        void flushOfflineCommands().catch(() => setBackendStatus("error"));
      }
    });
  }, [activeTenantId, flushOfflineCommands, scopeKey, syncFromBackend]);

  useEffect(() => {
    const coordinator = createTransactionRefreshCoordinator({
      refresh: syncFromBackend,
      now: Date.now,
      schedule: (run, delay) => window.setTimeout(run, delay),
      cancel: (timer) => window.clearTimeout(timer),
    });
    const refresh = () => {
      if (document.visibilityState !== "hidden") coordinator.request();
    };
    // No per-event full reload: one bounded, trailing refresh per event burst.
    window.addEventListener("seramet:realtime", refresh);
    window.addEventListener("seramet:refresh", refresh);
    return () => {
      coordinator.stop();
      window.removeEventListener("seramet:realtime", refresh);
      window.removeEventListener("seramet:refresh", refresh);
    };
  }, [syncFromBackend]);

  useEffect(() => {
    const verified = () => {
      if (posConnectivity.getSnapshot().state !== "ONLINE") return;
      void syncFromBackend().then((snapshot) => {
        if (snapshot) void flushOfflineCommands().catch(() => setBackendStatus("error"));
      });
    };
    return posConnectivity.subscribe(verified);
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
      expectedRevision?: number,
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
        expectedRevision: expectedRevision ?? revisionRef.current,
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
      expectedRevision?: number,
    ) => {
      const idempotencyKey = `command:${crypto.randomUUID()}`;
      const mutationScope = scopeKey;
      localMutationGenerationRef.current += 1;
      const applyOptimistic = () => {
        const next = optimistic
          ? optimistic(state)
          : applyServerMutation(state, action, payload, localActor);
        setState(next);
        void offlineStore
          .cacheState(activeTenantId, branchId, next, revision, scopeKey)
          .catch(() => undefined);
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
      if (!navigator.onLine || posConnectivity.getSnapshot().state === "OFFLINE") {
        if (!offlineAllowedCommands.has(action as OfflineAllowedCommand)) {
          throw new Error(`${action} is unavailable while the POS is offline`);
        }
        if (
          !currentUser.deviceId ||
          Date.now() - posConnectivity.getSnapshot().verifiedAt > 5 * 60_000
        )
          throw new Error("Verify this device session online before queuing further commands");
        const command = await createOfflineCommand(
          action as OfflineAllowedCommand,
          payload,
          idempotencyKey,
          localEffects,
          expectedRevision,
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
      const requestScope = scopeKey;
      try {
        const response = await authenticatedFetch("/api/seramet/transactions/mutate", {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            action,
            payload,
            idempotencyKey,
            expectedRevision: expectedRevision ?? revisionRef.current,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        receivedServerResponse = true;
        if (closingMutationActions.has(action) && scopeRef.current !== mutationScope) {
          const result = (await response.json()) as {
            state: TransactionState;
            revision?: number;
            message?: string;
          };
          if (!response.ok) throw new Error(result.message ?? "Closing was not acknowledged");
          return result;
        }
        if (!response.ok) {
          const failure = (await response.json().catch(() => ({}))) as {
            code?: string;
            message?: string;
            current?: { revision?: number; state?: TransactionState };
          };
          if (response.status === 409 && failure.current?.state) {
            serverConflict = true;
            const currentRevision = failure.current.revision ?? revisionRef.current;
            if (scopeRef.current !== requestScope)
              throw new Error("Branch changed while command was processing");
            setState(failure.current.state);
            setRevision(currentRevision);
            revisionRef.current = currentRevision;
            setBackendStatus("conflict");
          }
          throw Object.assign(
            new Error(
              failure.message ?? `Transaction command failed with status ${response.status}`,
            ),
            { httpStatus: response.status },
          );
        }
        const body = (await response.json()) as { state: TransactionState; revision?: number };
        if (scopeRef.current !== requestScope) return body;
        setState(body.state);
        const nextRevision = body.revision ?? revisionRef.current + 1;
        setRevision(nextRevision);
        revisionRef.current = nextRevision;
        // IndexedDB cache failures must never misreport a committed server save as failed.
        void offlineStore
          .cacheState(activeTenantId, branchId, body.state, nextRevision, scopeKey)
          .catch(() => undefined);
        setBackendStatus("synced");
        return body;
      } catch (error) {
        if (closingMutationActions.has(action) && scopeRef.current !== mutationScope) throw error;
        if (
          !receivedServerResponse &&
          offlineAllowedCommands.has(action as OfflineAllowedCommand) &&
          scopeRef.current === requestScope &&
          currentUser.deviceId &&
          Date.now() - posConnectivity.getSnapshot().verifiedAt <= 5 * 60_000
        ) {
          const command = await createOfflineCommand(
            action as OfflineAllowedCommand,
            payload,
            idempotencyKey,
            localEffects,
            expectedRevision,
          );
          await offlineStore.enqueue(command);
          const nextState = applyOptimistic();
          posConnectivity.failure(undefined, !navigator.onLine);
          void posConnectivity.requestVerification();
          await refreshPendingCount();
          return { state: nextState, revision, offline: true as const };
        }
        if (!serverConflict && scopeRef.current === requestScope) {
          const status = (error as { httpStatus?: number }).httpStatus;
          if (status === undefined || status >= 500) {
            setBackendStatus("error");
            posConnectivity.failure(status, !navigator.onLine);
          }
          if (status === undefined || status >= 500 || status === 401 || status === 403)
            void posConnectivity.requestVerification();
        }
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
      branchId,
      createOfflineCommand,
      headers,
      localActor,
      persistenceMode,
      refreshPendingCount,
      revision,
      state,
      scopeKey,
      currentUser.deviceId,
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
    revision,
    apply,
    mutate,
    reset,
    backendStatus: (backendStatus === "conflict"
      ? "conflict"
      : connection.state === "OFFLINE"
        ? "offline"
        : connection.state === "RECONNECTING"
          ? "reconnecting"
          : connection.state === "DEGRADED"
            ? "error"
            : backendStatus) as BackendStatus,
    persistenceMode,
    pendingSyncCount,
    activeMutationCount,
    offlineReplayInProgress,
    offlineStorageAvailable,
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
