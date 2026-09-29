import type { BackendStatus } from "@/hooks/use-transaction-engine";

/** Connection health is independent of saves and persisted offline commands. */
export function connectionPresentation(status: BackendStatus) {
  switch (status) {
    case "synced":
    case "syncing":
      return { label: "Online", health: "online" as const };
    case "reconnecting":
      return { label: "Reconnecting", health: "connecting" as const };
    case "loading":
      return { label: "Connecting", health: "connecting" as const };
    case "offline":
      return { label: "Offline", health: "offline" as const };
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
) {
  if (status === "reconnecting" && pendingSyncCount > 0) {
    return `Replaying ${pendingSyncCount} offline command${pendingSyncCount === 1 ? "" : "s"}`;
  }
  if (pendingSyncCount > 0) {
    return `${pendingSyncCount} offline command${pendingSyncCount === 1 ? "" : "s"} pending`;
  }
  if (activeMutationCount > 0 || status === "syncing") return "Saving";
  return null;
}
