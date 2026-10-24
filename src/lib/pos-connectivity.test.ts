import { afterEach, describe, expect, it, vi } from "vitest";
import { PosConnectivity } from "./pos-connectivity";
import { serializeOfflineReplay } from "@/offline/replay-coordinator";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("central POS connectivity", () => {
  it("releases the in-flight guard when verification begins while disconnected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    const state = new PosConnectivity();
    state.verified();
    let online = false;
    const verify = vi.fn(async () => undefined);
    const stop = state.start(verify, {
      visible: () => true,
      online: () => online,
      random: () => 0.5,
    });
    await state.requestVerification();
    expect(verify).not.toHaveBeenCalled();
    online = true;
    await vi.advanceTimersByTimeAsync(5000);
    await state.requestVerification();
    expect(verify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.getSnapshot().state).toBe("ONLINE");
    stop();
  });
  it("queues a rapid reconnect check at the existing cooldown boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    const state = new PosConnectivity();
    state.verified();
    const verify = vi.fn(async () => undefined);
    const stop = state.start(verify, {
      visible: () => true,
      online: () => true,
      random: () => 0.5,
    });
    await state.requestVerification();
    await vi.advanceTimersByTimeAsync(1000);
    state.failure(undefined, true);
    await state.requestVerification();
    await vi.advanceTimersByTimeAsync(4000);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(state.getSnapshot().state).toBe("RECONNECTING");
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.getSnapshot().state).toBe("ONLINE");
    stop();
  });
  it("imports and constructs without request-only randomness during Worker startup", async () => {
    vi.resetModules();
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("Randomness is unavailable during Worker module evaluation");
    });
    const module = await import("./pos-connectivity");
    const state = new module.PosConnectivity();
    expect(state.getSnapshot().state).toBe("RECONNECTING");
    expect(module.posConnectivity.getSnapshot().generation).toBe(0);
    expect(randomUUID).not.toHaveBeenCalled();
    randomUUID.mockRestore();
    const id = state.id;
    expect(state.id).toBe(id);
    expect(module.posConnectivity.id).not.toBe(id);
  });
  it("a minimum-jitter reconnect cannot strand its verification timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    const state = new PosConnectivity();
    state.verified();
    state.failure(undefined, true);
    const verify = vi.fn(async () => undefined);
    const stop = state.start(verify, { visible: () => true, online: () => true, random: () => 0 });
    await state.requestVerification();
    expect(state.getSnapshot().state).toBe("RECONNECTING");
    await vi.advanceTimersByTimeAsync(5000);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(state.getSnapshot().state).toBe("ONLINE");
    stop();
  });
  it("requires hysteresis for transport failures and recovery, not Wi-Fi association", () => {
    const state = new PosConnectivity();
    state.verified();
    expect(state.getSnapshot().state).toBe("ONLINE");
    state.failure();
    expect(state.getSnapshot().state).toBe("DEGRADED");
    state.failure();
    state.failure();
    expect(state.getSnapshot().state).toBe("OFFLINE");
    state.verified();
    expect(state.getSnapshot().state).toBe("RECONNECTING");
    state.verified();
    expect(state.getSnapshot().state).toBe("ONLINE");
    for (let i = 0; i < 20; i++) state.failure(503);
    expect(state.getSnapshot().state).toBe("DEGRADED");
  });
  it("has one active monitor/check and bounded focus retries, including 15 minutes idle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    const state = new PosConnectivity();
    state.verified();
    const verify = vi.fn(async () => undefined);
    const stop = state.start(verify, {
      visible: () => true,
      online: () => true,
      random: () => 0.5,
    });
    expect(() => state.start(verify, { visible: () => true, online: () => true })).toThrow();
    await Promise.all(Array.from({ length: 100 }, () => state.requestVerification()));
    expect(verify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(verify).toHaveBeenCalledTimes(16);
    expect(state.getSnapshot().state).toBe("ONLINE");
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(verify).toHaveBeenCalledTimes(16);
  });
  it("backs off service failures without treating them as offline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    const state = new PosConnectivity();
    state.verified();
    const verify = vi.fn(async () => {
      throw { httpStatus: 503 };
    });
    const stop = state.start(verify, {
      visible: () => true,
      online: () => true,
      random: () => 0.5,
    });
    await state.requestVerification();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(verify.mock.calls.length).toBeLessThanOrEqual(4);
    expect(state.getSnapshot().state).toBe("DEGRADED");
    stop();
  });
  it("serializes replay across hook instances and releases after a crash/error", async () => {
    let finish!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const one = serializeOfflineReplay("disposable-scope", run);
    const two = serializeOfflineReplay("disposable-scope", run);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(one).toBe(two);
    finish();
    await one;
    await expect(
      serializeOfflineReplay("disposable-scope", async () => {
        throw new Error("fixture");
      }),
    ).rejects.toThrow();
    await expect(
      serializeOfflineReplay("disposable-scope", async () => undefined),
    ).resolves.toBeUndefined();
  });
});
