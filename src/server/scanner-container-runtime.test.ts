import { afterEach, describe, expect, it, vi } from "vitest";
import { ScannerContainerRuntime } from "./scanner-container-runtime";

const image = `registry.cloudflare.com/8ee23e839ee7d7c26ae144aeac841c88/clamav@sha256:${"a".repeat(64)}`;

function fixture(singleton = true) {
  const stored = new Map<string, number>();
  const background: Promise<unknown>[] = [];
  let stopped!: () => void;
  const lifetime = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const port = {
    fetch: vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      new URL(String(input)).pathname === "/health"
        ? Response.json({ ok: true })
        : Response.json({ verdict: "CLEAN", engine: "ClamAV" }),
    ),
  };
  const container = {
    running: false,
    images: { clamav: image },
    start: vi.fn(() => {
      container.running = true;
    }),
    monitor: vi.fn(() => lifetime),
    getTcpPort: vi.fn(() => port),
    destroy: vi.fn(async () => {
      container.running = false;
      stopped();
    }),
  };
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      return stored.get(key) as T | undefined;
    },
    put: vi.fn(async (key: string, value: number) => {
      stored.set(key, value);
    }),
    setAlarm: vi.fn(async (_timestamp: number) => {}),
  };
  const state = {
    container,
    storage,
    waitUntil: vi.fn((pending: Promise<unknown>) => {
      background.push(pending);
    }),
  };
  return {
    runtime: new ScannerContainerRuntime(state, singleton),
    container,
    storage,
    port,
    state,
    background,
  };
}

function request(signal?: AbortSignal) {
  return new Request("https://private-scanner/scan", {
    method: "POST",
    body: "code,name\nQA,Test meal",
    headers: { "content-type": "text/csv" },
    signal,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("private Durable Object scanner runtime", () => {
  it("holds the container lifetime outside the request until the idle alarm stops it", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.runtime.fetch(request());
    expect(f.container.monitor).toHaveBeenCalledTimes(1);
    expect(f.state.waitUntil).toHaveBeenCalledTimes(1);
    let settled = false;
    void f.background[0]!.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(120_001);
    await f.runtime.alarm();
    await f.background[0];
    expect(settled).toBe(true);
  });

  it("reattaches lifecycle monitoring to a running container after an object restart", async () => {
    const f = fixture();
    f.container.running = true;
    await f.runtime.fetch(request());
    await f.runtime.fetch(request());
    expect(f.container.start).not.toHaveBeenCalled();
    expect(f.container.monitor).toHaveBeenCalledTimes(1);
    expect(f.state.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("records a process exit without leaking request data or an unhandled rejection", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture();
    f.container.monitor.mockRejectedValueOnce(
      Object.assign(new Error("private runtime detail"), { exitCode: 2 }),
    );
    f.port.fetch.mockImplementation(async () => new Response(null, { status: 503 }));
    const controller = new AbortController();
    const pending = f.runtime.fetch(request(controller.signal));
    setTimeout(() => controller.abort(), 1);
    await vi.advanceTimersByTimeAsync(251);
    expect((await pending).status).toBe(503);
    await f.background[0];
    expect(logged).toHaveBeenCalledExactlyOnceWith("SCANNER_CONTAINER_EXIT", { exitCode: 2 });
    expect(
      f.port.fetch.mock.calls.every(([url]) => new URL(String(url)).pathname === "/health"),
    ).toBe(true);
  });

  it("keeps a slow cold engine for the next bounded retry without accepting it early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T02:00:00Z"));
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
    const began = Date.now();
    const f = fixture();
    f.port.fetch.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      return path === "/health"
        ? Response.json({ ok: f.container.running && Date.now() - began >= 96_000 })
        : Response.json({ verdict: "CLEAN", engine: "ClamAV" });
    });
    const first = f.runtime.fetch(request());
    await vi.advanceTimersByTimeAsync(85_001);
    expect((await first).status).toBe(503);
    expect(
      f.port.fetch.mock.calls.every(([url]) => new URL(String(url)).pathname === "/health"),
    ).toBe(true);
    // Model request-only eviction: native monitoring must keep the boot alive.
    if (!f.background.length) f.container.running = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await f.runtime.fetch(request())).status).toBe(200);
    expect(f.container.start).toHaveBeenCalledTimes(1);
    expect(f.container.monitor).toHaveBeenCalledTimes(1);
    expect(f.state.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("selects the named immutable image and existing instance size before proxying", async () => {
    const f = fixture();
    const response = await f.runtime.fetch(request());
    expect(await response.json()).toEqual({ verdict: "CLEAN", engine: "ClamAV" });
    expect(f.container.start).toHaveBeenCalledExactlyOnceWith({
      image,
      instance: "standard-1",
      enableInternet: true,
    });
    expect(f.container.getTcpPort).toHaveBeenCalledWith(8080);
    expect(f.port.fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/health",
      "/scan",
    ]);
    const forwarded = f.port.fetch.mock.calls[1]![1]!;
    expect(await new Response(forwarded.body).text()).toBe("code,name\nQA,Test meal");
    expect(new Headers(forwarded.headers).get("content-type")).toBe("text/csv");
  });

  it("refuses every non-singleton object without starting or scheduling a container", async () => {
    const f = fixture(false);
    expect((await f.runtime.fetch(request())).status).toBe(404);
    await f.runtime.alarm();
    expect(f.container.start).not.toHaveBeenCalled();
    expect(f.storage.put).not.toHaveBeenCalled();
    expect(f.container.destroy).not.toHaveBeenCalled();
  });

  it.each([
    new Request("https://private-scanner/scan"),
    new Request("https://private-scanner/admin", { method: "POST" }),
  ])("does not expose health, administrative, or arbitrary proxy routes", async (input) => {
    const f = fixture();
    expect((await f.runtime.fetch(input)).status).toBe(404);
    expect(f.container.start).not.toHaveBeenCalled();
  });

  it("fails closed without a configured image", async () => {
    const f = fixture();
    f.container.images.clamav = "";
    const response = await f.runtime.fetch(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ verdict: "ERROR" });
    expect(f.container.start).not.toHaveBeenCalled();
  });

  it("does not restart an already running engine", async () => {
    const f = fixture();
    f.container.running = true;
    expect((await f.runtime.fetch(request())).status).toBe(200);
    expect(f.container.start).not.toHaveBeenCalled();
  });

  it("shares one cold startup across concurrent requests", async () => {
    const f = fixture();
    const first = f.runtime.fetch(request());
    const second = f.runtime.fetch(request());
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(f.container.start).toHaveBeenCalledTimes(1);
    expect(
      f.port.fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/scan"),
    ).toHaveLength(2);
  });

  it("waits for real engine readiness rather than trusting a running VM", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.port.fetch.mockResolvedValueOnce(Response.json({ ok: false }));
    const pending = f.runtime.fetch(request());
    await vi.advanceTimersByTimeAsync(251);
    expect((await pending).status).toBe(200);
    expect(f.port.fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/health",
      "/health",
      "/scan",
    ]);
  });

  it("returns ERROR after the bounded startup deadline and never invokes the parser or scanner endpoint", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
    const f = fixture();
    f.port.fetch.mockImplementation(async () => new Response(null, { status: 503 }));
    const pending = f.runtime.fetch(request());
    await vi.advanceTimersByTimeAsync(85_001);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ verdict: "ERROR" });
    expect(
      f.port.fetch.mock.calls.every(([url]) => new URL(String(url)).pathname === "/health"),
    ).toBe(true);
  });

  it("honors an aborted queue request without starting the engine", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect((await f.runtime.fetch(request(controller.signal))).status).toBe(503);
    expect(f.container.start).not.toHaveBeenCalled();
  });

  it("preserves INFECTED verdicts without manufacturing CLEAN evidence", async () => {
    const f = fixture();
    f.port.fetch
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({ verdict: "INFECTED", threat: "Eicar-Test-Signature" }),
      );
    expect(await (await f.runtime.fetch(request())).json()).toEqual({
      verdict: "INFECTED",
      threat: "Eicar-Test-Signature",
    });
  });

  it("preserves engine failures for the existing queue retry handler", async () => {
    const f = fixture();
    f.port.fetch
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ verdict: "ERROR" }, { status: 503 }));
    expect((await f.runtime.fetch(request())).status).toBe(503);
  });

  it("fails closed on a startup exception", async () => {
    const f = fixture();
    f.container.start.mockImplementation(() => {
      throw new Error("capacity unavailable");
    });
    expect((await f.runtime.fetch(request())).status).toBe(503);
    expect(f.port.fetch).not.toHaveBeenCalled();
  });

  it("destroys the idle container after two minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T20:00:00Z"));
    const f = fixture();
    await f.runtime.fetch(request());
    expect(f.storage.setAlarm).toHaveBeenLastCalledWith(Date.now() + 120_000);
    await vi.advanceTimersByTimeAsync(120_001);
    await f.runtime.alarm();
    expect(f.container.destroy).toHaveBeenCalledTimes(1);
  });

  it("reschedules stale alarms when there has been recent activity", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.runtime.fetch(request());
    await vi.advanceTimersByTimeAsync(30_000);
    await f.runtime.alarm();
    expect(f.container.destroy).not.toHaveBeenCalled();
    expect(f.storage.setAlarm).toHaveBeenLastCalledWith(Date.now() + 90_000);
  });

  it("shuts down instead of leaking running capacity when an alarm cannot be persisted", async () => {
    const f = fixture();
    f.storage.setAlarm.mockRejectedValue(new Error("storage unavailable"));
    expect((await f.runtime.fetch(request())).status).toBe(503);
    expect(f.container.start).not.toHaveBeenCalled();
    expect(f.container.destroy).toHaveBeenCalledTimes(1);
  });
});
