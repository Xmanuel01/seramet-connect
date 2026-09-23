import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevicePrintQueueStore } from "@/lib/device-print-queue-store";
import type { PrintJob, ReprintLogEntry } from "@/lib/seramet-print-service";

function job(id: string, branch = "branch-westlands"): PrintJob {
  return {
    id,
    branch,
    orderId: "ORD-1",
    documentType: "FOOD_KOT",
    destination: "KITCHEN",
    printerId: "PRINTER-1",
    createdAt: "2026-09-23T12:00:00.000Z",
    requestedBy: "Cashier",
    copies: 1,
    status: "Queued",
    retryCount: 0,
    template: "kot",
    content: "KOT",
    duplicateKey: `PRINT:${id}`,
    productionStation: "MAIN KITCHEN",
    kitchenDelivery: "PRODUCTION_PRINT",
  };
}

function reprint(id: string): ReprintLogEntry {
  return {
    id,
    jobId: "PJ-2",
    originalJobId: "PJ-1",
    orderId: "ORD-1",
    branch: "branch-westlands",
    documentType: "FOOD_KOT",
    requestedBy: "Kitchen Manager",
    reason: "Ticket damaged",
    createdAt: "2026-09-23T12:05:00.000Z",
    status: "Logged",
  };
}

beforeEach(() => DevicePrintQueueStore.resetForTests());

describe("device print queue store", () => {
  it("shares one live queue snapshot across consumers on the same branch", () => {
    DevicePrintQueueStore.setJobs("branch-westlands", [job("PJ-1")]);
    DevicePrintQueueStore.setJobs("branch-westlands", (current) => [
      job("PJ-2"),
      ...current,
    ]);

    expect(DevicePrintQueueStore.snapshot("branch-westlands").jobs.map((row) => row.id)).toEqual([
      "PJ-2",
      "PJ-1",
    ]);
  });

  it("keeps branch print queues isolated", () => {
    DevicePrintQueueStore.setJobs("branch-westlands", [job("PJ-W")]);
    DevicePrintQueueStore.setJobs("branch-ngong", [job("PJ-N", "branch-ngong")]);

    expect(DevicePrintQueueStore.snapshot("branch-westlands").jobs[0]?.id).toBe("PJ-W");
    expect(DevicePrintQueueStore.snapshot("branch-ngong").jobs[0]?.id).toBe("PJ-N");
  });

  it("notifies other mounted consumers when print status changes", () => {
    const listener = vi.fn();
    const unsubscribe = DevicePrintQueueStore.subscribe("branch-westlands", listener);
    DevicePrintQueueStore.setJobs("branch-westlands", [job("PJ-1")]);
    DevicePrintQueueStore.setJobs("branch-westlands", (current) =>
      current.map((row) => (row.id === "PJ-1" ? { ...row, status: "Failed" as const } : row)),
    );

    expect(listener).toHaveBeenCalledTimes(2);
    expect(DevicePrintQueueStore.snapshot("branch-westlands").jobs[0]?.status).toBe("Failed");
    unsubscribe();
  });

  it("shares reprint audit entries with the same branch queue", () => {
    DevicePrintQueueStore.setReprints("branch-westlands", [reprint("RPL-1")]);
    expect(DevicePrintQueueStore.snapshot("branch-westlands").reprints).toHaveLength(1);
    expect(DevicePrintQueueStore.snapshot("branch-westlands").reprints[0]?.reason).toBe(
      "Ticket damaged",
    );
  });
});
