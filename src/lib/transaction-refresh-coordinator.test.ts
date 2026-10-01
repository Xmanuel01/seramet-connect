import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTransactionRefreshCoordinator,
  mayApplyRemoteSnapshot,
  shouldHydratePosOrder,
} from "./transaction-refresh-coordinator";

afterEach(() => {
  vi.useRealTimers();
});

describe("Phase 2 realtime refresh control", () => {
  it("coalesces an event storm and executes only one trailing refresh during a slow request", async () => {
    vi.useFakeTimers();
    let resolve: (() => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const coordinator = createTransactionRefreshCoordinator({
      refresh,
      now: Date.now,
      schedule: setTimeout,
      cancel: clearTimeout,
    });

    for (let i = 0; i < 100; i += 1) coordinator.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i += 1) coordinator.request();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(1); // In-flight fetch has not resolved.
    resolve?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(refresh).toHaveBeenCalledTimes(2); // Exactly one trailing refresh.
    coordinator.stop();
    resolve?.();
    await Promise.resolve();
  });

  it("never schedules new refreshes after teardown or after unmounting mid-request", async () => {
    vi.useFakeTimers();
    let resolve: (() => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const coordinator = createTransactionRefreshCoordinator({
      refresh,
      now: Date.now,
      schedule: setTimeout,
      cancel: clearTimeout,
    });
    coordinator.request();
    await vi.advanceTimersByTimeAsync(300);
    coordinator.request();
    coordinator.stop();
    resolve?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    coordinator.request();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 2 optimistic state and cashier draft safety", () => {
  const valid = {
    sameScope: true,
    inFlightMutations: 0,
    pendingLocalCommands: 0,
    sameMutationGeneration: true,
    nextRevision: 9,
    currentRevision: 8,
  };
  it("allows only same-scope nonstale reads when no local mutations or offline work remain", () => {
    expect(mayApplyRemoteSnapshot(valid)).toBe(true);
    expect(mayApplyRemoteSnapshot({ ...valid, sameScope: false })).toBe(false);
    expect(mayApplyRemoteSnapshot({ ...valid, inFlightMutations: 1 })).toBe(false);
    expect(mayApplyRemoteSnapshot({ ...valid, pendingLocalCommands: 2 })).toBe(false);
    expect(mayApplyRemoteSnapshot({ ...valid, sameMutationGeneration: false })).toBe(false);
    expect(mayApplyRemoteSnapshot({ ...valid, nextRevision: 7 })).toBe(false);
  });

  it("rejects stale multi-terminal refreshes while an offline edit is pending and after a local mutation", () => {
    const terminalOneRevision = 12;
    // Terminal B's authoritative commit is newer, but terminal A owns an
    // unacknowledged local order edit and cannot replace it automatically.
    expect(
      mayApplyRemoteSnapshot({
        ...valid,
        currentRevision: terminalOneRevision,
        nextRevision: 13,
        pendingLocalCommands: 1,
      }),
    ).toBe(false);
    // After replay acknowledgement the queued edit can be replaced only by
    // a fresh response started after the latest local mutation.
    expect(
      mayApplyRemoteSnapshot({
        ...valid,
        currentRevision: 13,
        nextRevision: 14,
        sameMutationGeneration: false,
      }),
    ).toBe(false);
    expect(
      mayApplyRemoteSnapshot({
        ...valid,
        currentRevision: 13,
        nextRevision: 14,
      }),
    ).toBe(true);
  });

  it("never rehydrates an existing cashier draft just because realtime hides and restores the row", () => {
    const selected = {
      selectedOrderId: "ORDER-1",
      availableOrderId: "ORDER-1",
      hydratedScopeOrderKey: null,
      currentScope: "tenant-1:branch-1",
    };
    expect(shouldHydratePosOrder(selected)).toBe(true);
    const hydratedScopeOrderKey = "tenant-1:branch-1:ORDER-1";
    expect(shouldHydratePosOrder({ ...selected, hydratedScopeOrderKey })).toBe(false);
    expect(
      shouldHydratePosOrder({
        ...selected,
        hydratedScopeOrderKey,
        availableOrderId: null,
      }),
    ).toBe(false);
    expect(shouldHydratePosOrder({ ...selected, hydratedScopeOrderKey })).toBe(false);
    expect(
      shouldHydratePosOrder({
        ...selected,
        hydratedScopeOrderKey,
        selectedOrderId: "ORDER-2",
        availableOrderId: "ORDER-2",
      }),
    ).toBe(true);
    expect(
      shouldHydratePosOrder({
        ...selected,
        hydratedScopeOrderKey,
        currentScope: "tenant-1:branch-2",
      }),
    ).toBe(true);
  });
});
