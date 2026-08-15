import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine, type TransactionState } from "@/lib/transaction-engine";

type BackendStatus = "loading" | "synced" | "syncing" | "offline" | "error";

export function useTransactionEngine() {
  const { branch, role, currentUser } = useAppContext();
  const [state, setState] = useState<TransactionState>(() => TransactionEngine.load());
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("loading");

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-seramet-dev-auth": "enabled",
      "x-seramet-user-id": currentUser.id,
      "x-seramet-user": currentUser.name,
      "x-seramet-role": role,
      "x-seramet-branch": branch,
    }),
    [branch, currentUser.id, currentUser.name, role],
  );

  const syncFromBackend = useCallback(async () => {
    try {
      setBackendStatus("loading");
      const response = await fetch(
        `/api/seramet/transactions?branch=${encodeURIComponent(branch)}`,
        { headers },
      );
      if (!response.ok) throw new Error(`Transaction sync failed: ${response.status}`);
      const body = (await response.json()) as { state?: TransactionState };
      if (!body.state) throw new Error("Transaction sync did not return state");
      TransactionEngine.save(body.state);
      setState(body.state);
      setBackendStatus("synced");
    } catch (error) {
      console.error(error);
      setBackendStatus("offline");
    }
  }, [branch, headers]);

  useEffect(() => {
    void syncFromBackend();
  }, [syncFromBackend]);

  const apply = useCallback(
    (updater: (current: TransactionState) => TransactionState) => {
      setState((current) => {
        const next = updater(current);
        TransactionEngine.save(next);
        setBackendStatus("syncing");
        void persistSnapshot(next, headers)
          .then(() => setBackendStatus("synced"))
          .catch((error) => {
            console.error(error);
            setBackendStatus("error");
          });
        return next;
      });
    },
    [headers],
  );

  const reset = useCallback(() => {
    const next = TransactionEngine.reset();
    setState(next);
    setBackendStatus("syncing");
    void persistSnapshot(next, headers)
      .then(() => setBackendStatus("synced"))
      .catch((error) => {
        console.error(error);
        setBackendStatus("error");
      });
  }, [headers]);

  return { state, apply, reset, backendStatus, syncFromBackend };
}

async function persistSnapshot(state: TransactionState, headers: Record<string, string>) {
  const idempotencyKey = `snapshot:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const response = await fetch("/api/seramet/transactions", {
    method: "PUT",
    headers: { ...headers, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ state, idempotencyKey }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Transaction persistence failed: ${response.status} ${body}`);
  }
}
