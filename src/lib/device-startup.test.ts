import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceStartup } from "./auth-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded authoritative device startup", () => {
  it("does not cache device authorization and bounds the request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn(async () => Response.json({ ok: true, state: "UNREGISTERED" }));
    vi.stubGlobal("fetch", fetch);
    await expect(deviceStartup()).resolves.toMatchObject({ state: "UNREGISTERED" });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetch).toHaveBeenCalledWith(
      "/api/seramet/public/device/startup",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("propagates cancellation and never converts unavailable service into active access", async () => {
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
    expect(requestSignal?.aborted).toBe(true);
  });
});
