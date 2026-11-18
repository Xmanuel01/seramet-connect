import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOperationalMenuCache,
  POS_MENU_FRESH_MS,
  POS_MENU_MAX_AGE_MS,
  getOperationalMenuRevision,
  subscribeOperationalMenu,
  invalidateOperationalMenu,
  clearSavedOperationalMenus,
  readSavedOperationalMenu,
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
    vi.stubGlobal("window", { localStorage: fakeStorage });
  });
  afterEach(() => vi.unstubAllGlobals());
  const scope = { tenantId: "t1", branchId: "b1", userId: "u1", role: "Cashier" };

  it("keeps each restaurant, branch, person and role apart", () => {
    writeSavedOperationalMenu(savedMenuKey(scope), { items: 3 });
    expect(readSavedOperationalMenu(savedMenuKey(scope))).toEqual({ items: 3 });
    for (const other of [
      { ...scope, tenantId: "t2" },
      { ...scope, branchId: "b2" },
      { ...scope, userId: "u2" },
      { ...scope, role: "Chef" },
    ])
      expect(readSavedOperationalMenu(savedMenuKey(other))).toBeNull();
  });

  it("ignores a menu saved too long ago", () => {
    writeSavedOperationalMenu(savedMenuKey(scope), { items: 3 }, 1000);
    expect(
      readSavedOperationalMenu(savedMenuKey(scope), 1000 + SAVED_MENU_MAX_AGE_MS + 1),
    ).toBeNull();
  });

  it("is removed on sign-out, leaving other saved data alone", () => {
    writeSavedOperationalMenu(savedMenuKey(scope), { items: 3 });
    data["seramet.other"] = "keep";
    clearSavedOperationalMenus();
    expect(readSavedOperationalMenu(savedMenuKey(scope))).toBeNull();
    expect(data["seramet.other"]).toBe("keep");
  });

  it("reads nothing when storage holds something unreadable", () => {
    data[savedMenuKey(scope)] = "{not json";
    expect(readSavedOperationalMenu(savedMenuKey(scope))).toBeNull();
  });
});
