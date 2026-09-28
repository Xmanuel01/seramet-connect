import { describe, expect, it } from "vitest";
import { createOperationalMenuCache, POS_MENU_FRESH_MS, POS_MENU_MAX_AGE_MS } from "./operational-menu-cache";

describe("in-tab operational menu cache", () => {
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
    const load = () => { count += 1; return Promise.resolve(20); };
    const [first, second] = await Promise.all([
      cache.load("same", load), cache.load("same", load),
    ]);
    expect([first, second]).toEqual([20, 20]);
    expect(count).toBe(1);
    await expect(cache.load("same", () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    expect(await cache.load("same", load)).toBe(20);
    expect(count).toBe(2);
  });
});
