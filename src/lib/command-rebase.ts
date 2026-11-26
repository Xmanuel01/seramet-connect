import type { TransactionState } from "@/lib/transaction-engine";

/** Every id a command names: `orderId`, `billId`, `paymentIds` and so on, at any depth. */
export function commandTargetIds(payload: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, field] of Object.entries(value)) {
      if (/(^id|Id)$/.test(key) && typeof field === "string" && field) {
        ids.add(field);
      } else if (/Ids$/.test(key) && Array.isArray(field)) {
        for (const item of field) if (typeof item === "string" && item) ids.add(item);
      } else {
        visit(field, depth + 1);
      }
    }
  };
  visit(payload, 0);
  return ids;
}

/** The state's records (top-level collections and payment operations) whose id is named. */
function recordsById(state: TransactionState, ids: Set<string>) {
  const found = new Map<string, string>();
  const scan = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const id = (row as { id?: unknown } | null)?.id;
      if (typeof id === "string" && ids.has(id)) found.set(id, JSON.stringify(row));
    }
  };
  for (const value of Object.values(state)) scan(value);
  for (const value of Object.values(state.paymentOperations ?? {})) scan(value);
  return found;
}

/**
 * A command refused because the restaurant's revision moved can be sent again on the new
 * revision when nothing it names changed in between: the change was elsewhere (another
 * table, the kitchen, another till). If any named record changed, the conflict is real.
 */
export function commandTargetsUnchanged(
  before: TransactionState,
  after: TransactionState,
  payload: unknown,
) {
  const ids = commandTargetIds(payload);
  const was = recordsById(before, ids);
  const now = recordsById(after, ids);
  for (const id of ids) if (was.get(id) !== now.get(id)) return false;
  return true;
}
