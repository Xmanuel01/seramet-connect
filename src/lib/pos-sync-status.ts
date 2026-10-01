import type { BackendStatus } from "@/hooks/use-transaction-engine";

/** Connection health is independent of saves and persisted offline commands. */
export function connectionPresentation(status: BackendStatus, internetOnline = true) {
  // Browser connectivity and verified server availability are different facts.
  if (!internetOnline) return { label: "Internet offline", health: "offline" as const };
  switch (status) {
    case "synced":
    case "syncing":
      return { label: "Online", health: "online" as const };
    case "reconnecting":
      return { label: "Reconnecting", health: "connecting" as const };
    case "loading":
      return { label: "Connecting", health: "connecting" as const };
    case "offline":
      return { label: "Connection lost", health: "warning" as const };
    case "conflict":
      return { label: "Sync conflict", health: "warning" as const };
    case "error":
      return { label: "Server issue", health: "warning" as const };
  }
}

export function syncActivityLabel(
  status: BackendStatus,
  activeMutationCount: number,
  pendingSyncCount: number,
  offlineReplayInProgress = false,
) {
  if (offlineReplayInProgress) {
    return `Replaying ${pendingSyncCount} offline command${pendingSyncCount === 1 ? "" : "s"}`;
  }
  const pending = pendingSyncCount
    ? `${pendingSyncCount} offline command${pendingSyncCount === 1 ? "" : "s"} pending`
    : "";
  if (activeMutationCount > 0 || status === "syncing") {
    return pending ? `Saving · ${pending}` : "Saving";
  }
  return pending || null;
}
