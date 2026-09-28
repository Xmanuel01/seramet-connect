/**
 * Fast in-tab POS returns. Cache keys include the authenticated tenant, user,
 * role and branch; no browser persistence or cross-user catalogue sharing.
 */
export const POS_MENU_FRESH_MS = 12_000;
export const POS_MENU_MAX_AGE_MS = 60_000;

export type OperationalMenuSnapshot<T> = {
  value: T;
  storedAt: number;
};

export function createOperationalMenuCache<T>() {
  const entries = new Map<string, OperationalMenuSnapshot<T>>();
  const pending = new Map<string, Promise<T>>();

  return {
    get(key: string, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now - entry.storedAt < 0 || now - entry.storedAt > POS_MENU_MAX_AGE_MS) {
        entries.delete(key);
        return null;
      }
      return { ...entry, revalidate: now - entry.storedAt >= POS_MENU_FRESH_MS };
    },
    set(key: string, value: T, now = Date.now()) {
      entries.set(key, { value, storedAt: now });
    },
    clear(key: string) {
      entries.delete(key);
    },
    load(key: string, loader: () => Promise<T>) {
      const existing = pending.get(key);
      if (existing) return existing;
      const promise = loader().finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
  };
}
