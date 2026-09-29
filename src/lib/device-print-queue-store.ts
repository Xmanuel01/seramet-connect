import type { Dispatch, SetStateAction } from "react";
import type { PrintJob, ReprintLogEntry } from "@/lib/seramet-print-service";

export type DevicePrintQueueSnapshot = {
  jobs: PrintJob[];
  reprints: ReprintLogEntry[];
};

const emptySnapshot: DevicePrintQueueSnapshot = { jobs: [], reprints: [] };
const snapshots = new Map<string, DevicePrintQueueSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const storagePrefix = "seramet:device-print-queue:v2:";
const storedBranches = new Set<string>();
let storageListenerRegistered = false;

function localStorageForPrint() {
  if (typeof window === "undefined") return null;
  // Without persistent local storage the device must not claim a reliable
  // dispatch. The authoritative KOT outbox remains the recovery source.
  return window.localStorage;
}

function writeSnapshot(branchKey: string, snapshot: DevicePrintQueueSnapshot) {
  const storage = localStorageForPrint();
  if (!storage) return;
  try {
    storage.setItem(storagePrefix + branchKey, JSON.stringify(snapshot));
    storedBranches.add(branchKey);
  } catch {
    throw new Error(
      "Unable to persist this device's print queue. KOT not dispatched; review the server print outbox.",
    );
  }
}

function hydratedSnapshot(branchKey: string): DevicePrintQueueSnapshot {
  const storage = localStorageForPrint();
  if (!storage) return emptySnapshot;
  let raw: string | null;
  try {
    raw = storage.getItem(storagePrefix + branchKey);
  } catch {
    throw new Error("Device print storage is inaccessible; review print delivery before retrying");
  }
  if (!raw) return emptySnapshot;
  try {
    const parsed = JSON.parse(raw) as DevicePrintQueueSnapshot;
    if (!Array.isArray(parsed.jobs) || !Array.isArray(parsed.reprints)) {
      throw new Error("Invalid persistent print snapshot");
    }
    const jobs = parsed.jobs.map((job) =>
      ["Queued", "Sending", "Retrying"].includes(job.status)
        ? {
            ...job,
            status: "Failed" as const,
            failureReason:
              "UNCONFIRMED AFTER RESTART: inspect physical output and device logs before retrying",
          }
        : job,
    );
    const restored = { jobs, reprints: parsed.reprints };
    if (jobs.some((job, index) => job !== parsed.jobs[index])) {
      writeSnapshot(branchKey, restored);
    }
    return restored;
  } catch {
    throw new Error(
      "Persistent print queue cannot be read; do not resend until a manager reconciles the KOT outbox",
    );
  }
}

function listenForOtherTabs() {
  if (storageListenerRegistered || typeof window === "undefined") return;
  storageListenerRegistered = true;
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith(storagePrefix)) return;
    const branchKey = event.key.slice(storagePrefix.length);
    if (!snapshots.has(branchKey)) return;
    // A second tab may have printed the ticket. Never automatically dispatch
    // restored jobs from a storage event.
    snapshots.delete(branchKey);
    const updated = hydratedSnapshot(branchKey);
    snapshots.set(branchKey, updated);
    notify(branchKey);
  });
}

function normalizedBranchKey(branchKey: string) {
  const key = branchKey.trim();
  if (!key) throw new Error("A branch key is required for the device print queue");
  return key;
}

function notify(branchKey: string) {
  listeners.get(branchKey)?.forEach((listener) => listener());
}

function updateList<T>(current: T[], update: SetStateAction<T[]>) {
  return typeof update === "function" ? (update as (value: T[]) => T[])(current) : update;
}

export const DevicePrintQueueStore = {
  snapshot(branchKey: string): DevicePrintQueueSnapshot {
    const key = normalizedBranchKey(branchKey);
    if (!snapshots.has(key)) snapshots.set(key, hydratedSnapshot(key));
    return snapshots.get(key)!;
  },

  subscribe(branchKey: string, listener: () => void) {
    const key = normalizedBranchKey(branchKey);
    listenForOtherTabs();
    const branchListeners = listeners.get(key) ?? new Set<() => void>();
    branchListeners.add(listener);
    listeners.set(key, branchListeners);
    return () => {
      const current = listeners.get(key);
      current?.delete(listener);
      if (current?.size === 0) listeners.delete(key);
    };
  },

  setJobs(branchKey: string, update: SetStateAction<PrintJob[]>) {
    const key = normalizedBranchKey(branchKey);
    const current = this.snapshot(key);
    const jobs = updateList(current.jobs, update);
    const next = { jobs, reprints: current.reprints };
    writeSnapshot(key, next); // Persist before callers initiate physical output.
    snapshots.set(key, next);
    notify(key);
  },

  setReprints(branchKey: string, update: SetStateAction<ReprintLogEntry[]>) {
    const key = normalizedBranchKey(branchKey);
    const current = this.snapshot(key);
    const reprints = updateList(current.reprints, update);
    const next = { jobs: current.jobs, reprints };
    writeSnapshot(key, next);
    snapshots.set(key, next);
    notify(key);
  },

  jobsSetter(branchKey: string): Dispatch<SetStateAction<PrintJob[]>> {
    return (update) => this.setJobs(branchKey, update);
  },

  reprintsSetter(branchKey: string): Dispatch<SetStateAction<ReprintLogEntry[]>> {
    return (update) => this.setReprints(branchKey, update);
  },

  resetForTests() {
    const storage = localStorageForPrint();
    if (storage) {
      for (const branch of storedBranches) storage.removeItem(storagePrefix + branch);
    }
    storedBranches.clear();
    snapshots.clear();
    listeners.clear();
  },
};
