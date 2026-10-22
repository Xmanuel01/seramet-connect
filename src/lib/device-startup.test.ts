import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceStartup } from "./auth-client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded authoritative device startup", () => {
  it.each([false, true])(
    "the timeout aborts the actual pending request (parent signal: %s)",
    async (withParent) => {
      vi.useFakeTimers();
      const parent = new AbortController();
      let requestSignal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url, options) => {
          requestSignal = options.signal;
          return new Promise((_resolve, reject) => {
            requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), {
              once: true,
            });
          });
        }),
      );
      const pending = deviceStartup(withParent ? parent.signal : undefined);
      const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(requestSignal?.aborted).toBe(true);
      expect(parent.signal.aborted).toBe(false);
    },
  );
  it("does not cache device authorization and bounds the request", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const fetch = vi.fn(async () => Response.json({ ok: true, state: "UNREGISTERED" }));
    vi.stubGlobal("fetch", fetch);
    await expect(deviceStartup()).resolves.toMatchObject({ state: "UNREGISTERED" });
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(fetch).toHaveBeenCalledWith(
      "/api/seramet/public/device/startup",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("works without newer AbortSignal static helpers", async () => {
    vi.stubGlobal("AbortSignal", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, state: "UNREGISTERED" })),
    );
    await expect(deviceStartup()).resolves.toMatchObject({ state: "UNREGISTERED" });
  });

  it("never converts unavailable service into access and removes completed listeners", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        requestSignal = options.signal;
        return new Response(null, { status: 503 });
      }),
    );
    await expect(deviceStartup(controller.signal)).rejects.toThrow("temporarily unavailable");
    controller.abort();
    expect(requestSignal?.aborted).toBe(false);
  });

  it("parent cancellation rejects an in-flight fetch", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
        requestSignal = options.signal;
        return new Promise((_resolve, reject) => {
          requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), {
            once: true,
          });
        });
      }),
    );
    const pending = deviceStartup(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });
});
