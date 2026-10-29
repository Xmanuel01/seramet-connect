type ScannerContainer = {
  readonly running: boolean;
  readonly images: Record<string, string>;
  start(options: { image: string; instance: "standard-1"; enableInternet: boolean }): void;
  monitor(): Promise<void>;
  getTcpPort(port: number): {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  destroy(): Promise<void>;
};

type ScannerContainerState = {
  readonly container?: ScannerContainer;
  waitUntil(promise: Promise<unknown>): void;
  readonly storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: number): Promise<void>;
    setAlarm(timestamp: number): Promise<void>;
  };
};

const idleMilliseconds = 120_000;
const activityKey = "scanner-last-activity";

/** The only permitted object identity is the private scanner singleton. */
export class ScannerContainerRuntime {
  private activeRequests = 0;
  private startup?: Promise<void>;
  private monitoring?: Promise<void>;

  constructor(
    private readonly state: ScannerContainerState,
    private readonly singleton: boolean,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (!this.singleton) return new Response("Not found", { status: 404 });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/scan") {
      return new Response("Not found", { status: 404 });
    }
    const container = this.state.container;
    if (!container?.images.clamav) return unavailable();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(85_000)]);
    this.activeRequests++;
    try {
      signal.throwIfAborted();
      await this.touch();
      const port = container.getTcpPort(8080);
      if (!this.startup) {
        this.startup = (async () => {
          if (!container.running) {
            container.start({
              image: container.images.clamav,
              instance: "standard-1",
              enableInternet: true,
            });
          }
          this.observeLifetime(container);
          await this.waitForEngine(port, signal);
        })();
      }
      const startup = this.startup;
      try {
        await startup;
      } finally {
        if (this.startup === startup) this.startup = undefined;
      }
      return await port.fetch("http://container/scan", {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal,
      });
    } catch {
      return unavailable();
    } finally {
      this.activeRequests--;
      try {
        await this.touch();
      } catch {
        // A lost shutdown alarm must not leave a billable scanner running.
        await container.destroy();
      }
    }
  }

  async alarm(): Promise<void> {
    if (!this.singleton || !this.state.container) return;
    const lastActivity = await this.state.storage.get<number>(activityKey);
    const expires = (lastActivity ?? 0) + idleMilliseconds;
    if (this.activeRequests > 0 || Date.now() < expires) {
      await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, expires));
      return;
    }
    await this.state.container.destroy();
  }

  private async touch() {
    const now = Date.now();
    await this.state.storage.put(activityKey, now);
    await this.state.storage.setAlarm(now + idleMilliseconds);
  }

  private observeLifetime(container: ScannerContainer) {
    if (this.monitoring) return;
    // Keep cold initialization alive across bounded queue retries. The durable
    // idle alarm, not the end of an HTTP request, owns container shutdown.
    const observation = container
      .monitor()
      .catch((error: unknown) => {
        const exitCode =
          error && typeof error === "object" && "exitCode" in error ? error.exitCode : undefined;
        console.error("SCANNER_CONTAINER_EXIT", {
          exitCode: typeof exitCode === "number" ? exitCode : null,
        });
      })
      .finally(() => {
        if (this.monitoring === observation) this.monitoring = undefined;
      });
    this.monitoring = observation;
    this.state.waitUntil(observation);
  }

  private async waitForEngine(
    port: ReturnType<ScannerContainer["getTcpPort"]>,
    signal: AbortSignal,
  ) {
    while (!signal.aborted) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
        });
        if (response.ok) {
          const health = (await response.json()) as { ok?: boolean };
          if (health.ok === true) return;
        }
      } catch {
        signal.throwIfAborted();
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    signal.throwIfAborted();
  }
}

function unavailable() {
  return Response.json({ verdict: "ERROR" }, { status: 503 });
}
