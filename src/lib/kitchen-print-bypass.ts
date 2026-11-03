// A branch can send orders to the kitchen without a working printer or KDS
// route for a limited time, for example while a printer is being replaced.
// The window is set on the server and stored on the branch, so every till sees
// the same state and the server alone decides when it ends.

export const KITCHEN_PRINT_BYPASS_HOURS = 36;
const BYPASS_MS = KITCHEN_PRINT_BYPASS_HOURS * 60 * 60 * 1000;

export type KitchenPrintBypass = {
  until: string;
  startedAt: string;
  startedBy: string;
  reason: string;
};

/** Branch metadata keys holding the bypass window. */
export const BYPASS_KEYS = {
  until: "kitchenPrintBypassUntil",
  startedAt: "kitchenPrintBypassStartedAt",
  startedBy: "kitchenPrintBypassBy",
  reason: "kitchenPrintBypassReason",
} as const;

/** The bypass in force at `at`, or null when none is set or it has run out. */
export function activeKitchenPrintBypass(
  metadata: Record<string, unknown> | undefined,
  at: Date | string = new Date(),
): KitchenPrintBypass | null {
  const until = metadata?.[BYPASS_KEYS.until];
  if (typeof until !== "string") return null;
  const end = Date.parse(until);
  const now = typeof at === "string" ? Date.parse(at) : at.getTime();
  if (!Number.isFinite(end) || !Number.isFinite(now) || now >= end) return null;
  const text = (key: string) => {
    const value = metadata?.[key];
    return typeof value === "string" ? value : "";
  };
  return {
    until,
    startedAt: text(BYPASS_KEYS.startedAt),
    startedBy: text(BYPASS_KEYS.startedBy),
    reason: text(BYPASS_KEYS.reason),
  };
}

/** Metadata that starts a bypass now, ending exactly 36 hours later. */
export function startKitchenPrintBypass(
  metadata: Record<string, unknown>,
  input: { startedBy: string; reason: string; at?: Date },
): Record<string, unknown> {
  const at = input.at ?? new Date();
  return {
    ...metadata,
    [BYPASS_KEYS.until]: new Date(at.getTime() + BYPASS_MS).toISOString(),
    [BYPASS_KEYS.startedAt]: at.toISOString(),
    [BYPASS_KEYS.startedBy]: input.startedBy,
    [BYPASS_KEYS.reason]: input.reason,
  };
}

/** Metadata with any bypass removed. */
export function endKitchenPrintBypass(metadata: Record<string, unknown>): Record<string, unknown> {
  const next = { ...metadata };
  for (const key of Object.values(BYPASS_KEYS)) delete next[key];
  return next;
}
