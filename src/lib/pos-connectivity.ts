import { useSyncExternalStore } from "react";
import { tracePos } from "@/lib/pos-lifecycle-trace";

export type ConnectionState = "ONLINE" | "DEGRADED" | "OFFLINE" | "RECONNECTING" | "SYNC_CONFLICT";
type Snapshot = { state: ConnectionState; verifiedAt: number; generation: number };
export class PosConnectivity {
  private snapshot: Snapshot = { state: "RECONNECTING", verifiedAt: 0, generation: 0 };
  private listeners = new Set<() => void>();
  private failures = 0;
  private transportFailures = 0;
  private recoverySuccesses = 0;
  private verify: (() => Promise<void>) | undefined;
  readonly id = crypto.randomUUID();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: ConnectionState, verifiedAt = this.snapshot.verifiedAt) {
    this.snapshot = { state, verifiedAt, generation: this.snapshot.generation + 1 };
    tracePos("CONNECTIVITY", this.id, state);
    this.listeners.forEach((listener) => listener());
  }
  failure(status?: number, disconnected = false) {
    this.failures++;
    this.recoverySuccesses = 0;
    this.transportFailures = status === undefined ? this.transportFailures + 1 : 0;
    const next = disconnected || this.transportFailures >= 3 ? "OFFLINE" : "DEGRADED";
    if (this.snapshot.state !== next) this.publish(next);
  }
  verified() {
    this.failures = 0;
    this.transportFailures = 0;
    this.recoverySuccesses++;
    const recovering =
      ["OFFLINE", "RECONNECTING"].includes(this.snapshot.state) && this.snapshot.verifiedAt > 0;
    this.publish(recovering && this.recoverySuccesses < 2 ? "RECONNECTING" : "ONLINE", Date.now());
  }
  requestVerification() {
    return this.verify?.();
  }
  /** One owner, one request, bounded retries. Focus storms cannot multiply checks. */
  start(
    verify: () => Promise<void>,
    options: { visible: () => boolean; online: () => boolean; random?: () => number },
  ) {
    if (this.verify) throw new Error("Connectivity monitor already started");
    let stopped = false;
    let running: Promise<void> | undefined;
    let lastStarted = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      if (running) return running;
      if (stopped || Date.now() - lastStarted < 5000) return Promise.resolve();
      clearTimeout(timer);
      lastStarted = Date.now();
      running = (async () => {
        try {
          if (!options.online()) {
            this.failure(undefined, true);
            return;
          }
          if (this.snapshot.state === "OFFLINE") this.publish("RECONNECTING");
          tracePos("AUTH_CHECK", this.id);
          await verify();
          if (!stopped) {
            this.verified();
            tracePos("AUTH_OK", this.id);
          }
        } catch (error) {
          if (!stopped)
            this.failure((error as { httpStatus?: number }).httpStatus, !options.online());
        } finally {
          running = undefined;
          if (!stopped) {
            const delay =
              this.snapshot.state === "ONLINE"
                ? 60_000
                : Math.min(60_000, 5000 * 2 ** Math.min(this.failures, 4));
            const jitter = 0.9 + (options.random ?? Math.random)() * 0.2;
            timer = setTimeout(
              () => {
                if (options.visible()) void run();
                else timer = setTimeout(() => void run(), 60_000);
              },
              Math.max(5000, delay * jitter),
            );
          }
        }
      })();
      return running;
    };
    this.verify = run;
    timer = setTimeout(() => void run(), 60_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      this.verify = undefined;
    };
  }
}
export const posConnectivity = new PosConnectivity();
const serverSnapshot: Snapshot = { state: "RECONNECTING", verifiedAt: 0, generation: 0 };
export const usePosConnectivity = () =>
  useSyncExternalStore(
    posConnectivity.subscribe,
    posConnectivity.getSnapshot,
    () => serverSnapshot,
  );
