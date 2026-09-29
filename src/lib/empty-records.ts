/**
 * Produces a typed empty collection for an operational view that has no
 * authoritative query wired yet. This prevents sample records from appearing
 * in a pilot while preserving the view's table and workflow structure.
 */
// The default is intentionally permissive for legacy view-only tables while
// their authoritative query models are migrated route by route.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emptyRecords<T = any>(): T[] {
  return [];
}
