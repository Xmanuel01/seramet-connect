import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOperationalMenuCache,
  POS_MENU_FRESH_MS,
  POS_MENU_MAX_AGE_MS,
  getOperationalMenuRevision,
  subscribeOperationalMenu,
  invalidateOperationalMenu,
  clearSavedOperationalMenus,
  getSavedMenuEpoch,
  readSavedOperationalMenu,
  removeSavedOperationalMenu,
  SAVED_MENU_MAX_AGE_MS,
  savedMenuKey,
  writeSavedOperationalMenu,
} from "./operational-menu-cache";

describe("in-tab operational menu cache", () => {
  it("invalidates after a saved edit without reusing an older in-flight request", async () => {
    const cache = createOperationalMenuCache<number>();
    const before = getOperationalMenuRevision();
    let notified = 0;
    const unsubscribe = subscribeOperationalMenu(() => notified++);
    let complete!: (value: number) => void;
    const old = cache.load(
      `scope:${before}`,
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    invalidateOperationalMenu();
    expect(notified).toBe(1);
    const currentKey = `scope:${getOperationalMenuRevision()}`;
    cache.set(currentKey, await cache.load(currentKey, async () => 1090));
    complete(900);
    cache.set(`scope:${before}`, await old);
    expect(cache.get(currentKey)?.value).toBe(1090);
    unsubscribe();
    invalidateOperationalMenu();
    expect(notified).toBe(1);
  });
  it("serves fresh scoped menu immediately and revalidates after the short freshness window", () => {
    const cache = createOperationalMenuCache<number>();
    cache.set("tenant:westlands:owner", 345, 1000);
    expect(cache.get("tenant:westlands:owner", 1000)?.value).toBe(345);
    expect(cache.get("tenant:westlands:owner", 1000)?.revalidate).toBe(false);
    expect(cache.get("tenant:westlands:owner", 1000 + POS_MENU_FRESH_MS)?.revalidate).toBe(true);
    expect(cache.get("tenant:ngong:owner", 1000)).toBeNull();
    expect(cache.get("tenant:westlands:other-user", 1000)).toBeNull();
    expect(cache.get("tenant:westlands:owner", 1000 + POS_MENU_MAX_AGE_MS + 1)).toBeNull();
  });

  it("shares concurrent remount requests and cleans failures for retry", async () => {
    const cache = createOperationalMenuCache<number>();
    let count = 0;
    const load = () => {
      count += 1;
      return Promise.resolve(20);
    };
    const [first, second] = await Promise.all([cache.load("same", load), cache.load("same", load)]);
    expect([first, second]).toEqual([20, 20]);
    expect(count).toBe(1);
    await expect(cache.load("same", () => Promise.reject(new Error("offline")))).rejects.toThrow(
      "offline",
    );
    expect(await cache.load("same", load)).toBe(20);
    expect(count).toBe(2);
  });
});

describe("menu saved on the device", () => {
  const data: Record<string, string> = {};
  const fakeStorage = {
    get length() {
      return Object.keys(data).length;
    },
    key: (index: number) => Object.keys(data)[index] ?? null,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  };
  beforeEach(() => {
    for (const key of Object.keys(data)) delete data[key];
    vi.stubGlobal("window", { localStorage: fakeStorage, sessionStorage: fakeStorage });
    vi.stubGlobal("sessionStorage", fakeStorage);
  });
  afterEach(() => vi.unstubAllGlobals());
  const scope = {
    tenantId: "t1",
    branchId: "b1",
    userId: "u1",
    role: "Cashier",
    access: "SELL" as const,
  };
  const isMenu = (value: unknown): value is { items: number } =>
    Boolean(value) && typeof (value as { items?: unknown }).items === "number";
  const save = (value: unknown, now?: number) =>
    writeSavedOperationalMenu(savedMenuKey(scope), value, getSavedMenuEpoch(), now);

  it("keeps each restaurant, branch, person, role and menu access apart", () => {
    save({ items: 3 });
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu)).toEqual({ items: 3 });
    for (const other of [
      { ...scope, tenantId: "t2" },
      { ...scope, branchId: "b2" },
      { ...scope, userId: "u2" },
      { ...scope, role: "Chef" },
      // Someone who can no longer sell never matches a priced copy.
      { ...scope, access: "KITCHEN" as const },
    ])
      expect(readSavedOperationalMenu(savedMenuKey(other), isMenu)).toBeNull();
  });

  it("keeps a menu for seven days and no longer", () => {
    const day = 24 * 60 * 60 * 1000;
    save({ items: 3 }, 1000);
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu, 1000 + 6 * day)).toEqual({
      items: 3,
    });
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu, 1000 + 7 * day + 1)).toBeNull();
    expect(SAVED_MENU_MAX_AGE_MS).toBe(7 * day);
  });

  it("is removed by a real sign-out, leaving other saved data alone", async () => {
    const { clearInteractiveSignIn } = await import("@/lib/auth-client");
    save({ items: 3 });
    data["seramet.other"] = "keep";
    clearInteractiveSignIn();
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu)).toBeNull();
    expect(data["seramet.other"]).toBe("keep");
  });

  it("never saves a menu whose request began before a sign-out", () => {
    const startedAtEpoch = getSavedMenuEpoch();
    clearSavedOperationalMenus();
    writeSavedOperationalMenu(savedMenuKey(scope), { items: 3 }, startedAtEpoch);
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu)).toBeNull();
  });

  it("ignores saved data that is unreadable or the wrong shape", () => {
    data[savedMenuKey(scope)] = "{not json";
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu)).toBeNull();
    save({ items: "lots" });
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu)).toBeNull();
  });

  it("removes one saved menu when access to it is refused", () => {
    save({ items: 3 });
    removeSavedOperationalMenu(savedMenuKey(scope));
    expect(readSavedOperationalMenu(savedMenuKey(scope), isMenu)).toBeNull();
  });
});
