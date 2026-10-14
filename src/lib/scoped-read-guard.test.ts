import { describe, expect, it } from "vitest";
import { createScopedReadGuard } from "./scoped-read-guard";

describe("scoped read completion", () => {
  it("reproduces and blocks an older response arriving after a newer scope", async () => {
    let scope = "tenant-a:branch-a";
    const guard = createScopedReadGuard(() => scope);
    let release!: () => void;
    const old = guard.begin(scope);
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let displayed = "";
    const oldRead = pending.then(() => {
      if (old.isCurrent()) displayed = "branch-a";
    });
    scope = "tenant-b:branch-b";
    const next = guard.begin(scope);
    if (next.isCurrent()) displayed = "branch-b";
    release();
    await oldRead;
    expect(displayed).toBe("branch-b");
    expect(old.signal.aborted).toBe(true);
    expect(next.isCurrent()).toBe(true);
  });

  it("rejects a changed scope even before a new read starts", () => {
    let scope = "first";
    const guard = createScopedReadGuard(() => scope);
    const old = guard.begin(scope);
    scope = "second";
    expect(old.isCurrent()).toBe(false);
  });

  it("rejects out-of-order same-scope refreshes and completion after unmount", () => {
    const guard = createScopedReadGuard(() => "scope");
    const first = guard.begin("scope");
    const second = guard.begin("scope");
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    guard.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(false);
  });
});
