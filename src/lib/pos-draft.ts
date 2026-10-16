export const draftPrefix = "seramet.pos.draft.v1:";
export type PosDraft = {
  lines: Record<string, number>;
  itemNotes: Record<string, string>;
  kitchenNote: string;
  activeOrderId: string | null;
  selectedTableNo: string | null;
  orderSource: string;
  customerId: string | null;
  savedAt: number;
  orderBaseline?: { revision: number; digest: string };
};
export const posDraftKey = (tenant: string, branch: string, actor: string, device: string) =>
  draftPrefix + [tenant, branch, actor, device].map(encodeURIComponent).join(":");
export function readPosDraft(key: string): PosDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as PosDraft | null;
    if (
      !value ||
      !Number.isFinite(value.savedAt) ||
      (value.orderBaseline &&
        (!Number.isSafeInteger(value.orderBaseline.revision) ||
          value.orderBaseline.revision < 0 ||
          !/^[a-f0-9]{64}$/.test(value.orderBaseline.digest))) ||
      Date.now() - value.savedAt > 12 * 60 * 60_000 ||
      value.savedAt > Date.now() ||
      !value.lines ||
      Object.keys(value.lines).length > 500 ||
      !Object.values(value.lines).every((n) => Number.isFinite(n) && n >= 0 && n <= 10000) ||
      !value.itemNotes ||
      Object.values(value.itemNotes).some((s) => typeof s !== "string" || s.length > 4000) ||
      typeof value.kitchenNote !== "string" ||
      value.kitchenNote.length > 4000 ||
      typeof value.orderSource !== "string" ||
      ![value.activeOrderId, value.selectedTableNo, value.customerId].every(
        (s) => s === null || typeof s === "string",
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function writePosDraft(key: string, value: PosDraft) {
  try {
    // Allowlist, never serialize payments, credentials, customer contact details or whole component state.
    sessionStorage.setItem(
      key,
      JSON.stringify({
        lines: value.lines,
        itemNotes: value.itemNotes,
        kitchenNote: value.kitchenNote,
        activeOrderId: value.activeOrderId,
        selectedTableNo: value.selectedTableNo,
        orderSource: value.orderSource,
        customerId: value.customerId,
        savedAt: value.savedAt,
        ...(value.orderBaseline ? { orderBaseline: value.orderBaseline } : {}),
      }),
    );
  } catch {
    /* A storage-denied browser can keep the mounted in-memory draft. */
  }
}
export function clearPosDrafts() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(draftPrefix)) sessionStorage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
}
