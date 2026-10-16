type TraceKind =
  | "APP_MOUNT"
  | "APP_UNMOUNT"
  | "POS_MOUNT"
  | "POS_UNMOUNT"
  | "PAGE_EXIT"
  | "AUTH_CHECK"
  | "AUTH_OK"
  | "AUTH_REJECTED"
  | "CONNECTIVITY"
  | "SNAPSHOT_READ"
  | "SNAPSHOT_UNCHANGED"
  | "REPLAY_START"
  | "REPLAY_END";
type Entry = { at: number; correlationId: string; kind: TraceKind; value?: string | number };
declare global {
  interface Window {
    __serametPosTrace?: Entry[];
  }
}

/** Memory-only, bounded evidence. Never pass URLs, actor IDs, payloads or errors. */
export function tracePos(kind: TraceKind, correlationId: string, value?: Entry["value"]) {
  if (typeof window === "undefined") return;
  const entries = (window.__serametPosTrace ??= []);
  entries.push({ at: Date.now(), correlationId, kind, ...(value === undefined ? {} : { value }) });
  if (entries.length > 2000) entries.splice(0, entries.length - 2000);
}
