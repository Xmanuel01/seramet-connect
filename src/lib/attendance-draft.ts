export type AttendanceDraft = {
  selected: string;
  sessionId: string;
  reason: string;
  occurredAt: string;
  action: "IN" | "OUT" | "CORRECT_IN" | "CORRECT_OUT" | "EXPLAIN";
  pending?: { action: "IN" | "OUT"; key: string };
  supervisor?: { key: string; payload: string };
};
const prefix = "seramet.attendance.";
const maximumAge = 8 * 60 * 60 * 1000;
export function readAttendanceDraft(scope: string, now = Date.now()): AttendanceDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(prefix + scope) ?? "null") as {
      at?: number;
      draft?: AttendanceDraft;
    } | null;
    if (!value?.at || value.at > now || now - value.at > maximumAge || !value.draft) return null;
    const draft = value.draft;
    if (
      !["IN", "OUT", "CORRECT_IN", "CORRECT_OUT", "EXPLAIN"].includes(draft.action) ||
      typeof draft.selected !== "string" ||
      typeof draft.sessionId !== "string" ||
      typeof draft.reason !== "string" ||
      draft.reason.length > 500 ||
      typeof draft.occurredAt !== "string"
    )
      return null;
    if (
      draft.pending &&
      (!["IN", "OUT"].includes(draft.pending.action) || !/^[0-9a-f-]{36}$/.test(draft.pending.key))
    )
      return null;
    if (draft.supervisor && !safeSupervisor(draft.supervisor)) return null;
    return draft;
  } catch {
    return null;
  }
}
export function writeAttendanceDraft(scope: string, draft: AttendanceDraft) {
  try {
    // Deliberately serialize this allowlist, never arbitrary form data, GPS,
    // credentials, PINs or bearer tokens. Scope contains non-secret session IDs.
    sessionStorage.setItem(
      prefix + scope,
      JSON.stringify({
        at: Date.now(),
        draft: {
          selected: draft.selected,
          sessionId: draft.sessionId,
          reason: draft.reason,
          occurredAt: draft.occurredAt,
          action: draft.action,
          pending: draft.pending,
          supervisor:
            draft.supervisor && safeSupervisor(draft.supervisor) ? draft.supervisor : undefined,
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}
function safeSupervisor(value: { key: string; payload: string }) {
  try {
    if (
      !/^[0-9a-f-]{36}$/.test(value.key) ||
      typeof value.payload !== "string" ||
      value.payload.length > 2000
    )
      return false;
    const command = JSON.parse(value.payload) as Record<string, unknown>;
    const allowed = [
      "branchId",
      "employeeId",
      "action",
      "reason",
      "sessionId",
      "expectedVersion",
      "occurredAt",
    ];
    return (
      Object.keys(command).every((key) => allowed.includes(key)) &&
      typeof command.branchId === "string" &&
      typeof command.employeeId === "string" &&
      typeof command.reason === "string" &&
      ["IN", "OUT", "CORRECT_IN", "CORRECT_OUT", "EXPLAIN"].includes(String(command.action))
    );
  } catch {
    return false;
  }
}
