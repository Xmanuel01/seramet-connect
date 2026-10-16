import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerQueue } from "./workers";
import { installE2EImportBindings } from "./e2e-import-bindings";
import type { SerametEnv } from "@/lib/seramet-auth";

vi.mock("./workers", () => ({ handleWorkerQueue: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
describe("disposable import queue fidelity", () => {
  it("honors a worker retry instead of abandoning the publication job", async () => {
    vi.useFakeTimers();
    const env: SerametEnv = {};
    installE2EImportBindings(env);
    vi.mocked(handleWorkerQueue).mockImplementation(async (batch) => {
      const message = batch.messages[0]!;
      if (message.attempts === 1) message.retry({ delaySeconds: 5 });
      else message.ack();
    });
    await env.SERAMET_WORK_QUEUE!.send({
      kind: "worker-job",
      tenantId: "disposable",
      jobId: "publication",
      correlationId: "test",
    });
    await vi.advanceTimersByTimeAsync(5);
    expect(handleWorkerQueue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(handleWorkerQueue).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(handleWorkerQueue).toHaveBeenCalledTimes(2);
  });
  it("bounds repeated deliveries and handles a failed consumer bootstrap without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const env: SerametEnv = {};
    installE2EImportBindings(env);
    vi.mocked(handleWorkerQueue).mockRejectedValue(new Error("disposable bootstrap failure"));
    await env.SERAMET_WORK_QUEUE!.send({
      kind: "worker-job",
      tenantId: "disposable",
      jobId: "publication",
      correlationId: "test",
    });
    await vi.runAllTimersAsync();
    expect(handleWorkerQueue).toHaveBeenCalledTimes(8);
    expect(log).toHaveBeenCalledExactlyOnceWith("E2E_QUEUE_RETRY_LIMIT");
    log.mockRestore();
  });
});
