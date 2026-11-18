/**
 * Fast POS returns. In-tab entries are keyed by the authenticated tenant, user, role and branch.
 * The last menu each of those saw is also saved on the device (savedOperationalMenu) so a reload
 * paints it at once while the current menu loads; orders wait for the current menu, so a saved
 * price is never charged. Signing out removes the saved menus.
 */
export const POS_MENU_FRESH_MS = 12_000;
export const POS_MENU_MAX_AGE_MS = 60_000;

let menuRevision = 0;
const menuListeners = new Set<() => void>();
export const getOperationalMenuRevision = () => menuRevision;
export function subscribeOperationalMenu(listener: () => void) {
  menuListeners.add(listener);
  return () => {
    menuListeners.delete(listener);
  };
}
export function invalidateOperationalMenu() {
  // A new cache key also isolates any old request still in flight during an edit.
  menuRevision += 1;
  menuListeners.forEach((listener) => listener());
}

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

const savedMenuPrefix = "seramet.pos.menu.v1:";
/** A saved menu older than this is not shown at all, only fetched afresh. */
export const SAVED_MENU_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * The scope a saved menu belongs to; never shared across restaurants, branches, people, roles
 * or menu permissions (someone who loses sales access no longer matches a priced copy).
 */
export function savedMenuKey(scope: {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  access: "SELL" | "KITCHEN";
}) {
  return (
    savedMenuPrefix +
    JSON.stringify([scope.tenantId, scope.branchId, scope.userId, scope.role, scope.access])
  );
}

/** Moves on every sign-out, so a request started before it can never save its menu after it. */
let savedMenuEpoch = 0;
export const getSavedMenuEpoch = () => savedMenuEpoch;

function storage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSavedOperationalMenu<T>(
  key: string,
  isValid: (value: unknown) => value is T,
  now = Date.now(),
): T | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { savedAt?: unknown; value?: unknown };
    if (
      typeof saved.savedAt !== "number" ||
      !isValid(saved.value) ||
      now - saved.savedAt > SAVED_MENU_MAX_AGE_MS ||
      saved.savedAt > now + 60_000
    )
      return null;
    return saved.value;
  } catch {
    return null;
  }
}

/** Saves a menu unless someone signed out after the request that produced it began. */
export function writeSavedOperationalMenu<T>(
  key: string,
  value: T,
  startedAtEpoch: number,
  now = Date.now(),
) {
  if (startedAtEpoch !== savedMenuEpoch) return;
  try {
    storage()?.setItem(key, JSON.stringify({ savedAt: now, value }));
  } catch {
    // Full or blocked storage only costs the instant paint on the next load.
  }
}

/** Removes every saved menu on this device, e.g. when someone signs out. */
export function removeSavedOperationalMenu(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing more to do when storage is unavailable.
  }
}

export function clearSavedOperationalMenus() {
  savedMenuEpoch += 1;
  const store = storage();
  if (!store) return;
  try {
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(savedMenuPrefix)) store.removeItem(key);
    }
  } catch {
    // Nothing more to do when storage is unavailable.
  }
}
