import type { Dispatch, SetStateAction } from "react";
import type { PrintJob, ReprintLogEntry } from "@/lib/seramet-print-service";

export type DevicePrintQueueSnapshot = {
  jobs: PrintJob[];
  reprints: ReprintLogEntry[];
};

const emptySnapshot: DevicePrintQueueSnapshot = { jobs: [], reprints: [] };
const snapshots = new Map<string, DevicePrintQueueSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const hydrated = new Set<string>();
const storageKey = (branchKey: string) => `seramet.print-queue.v1:${branchKey}`;

function hydrate(branchKey: string) {
  if (hydrated.has(branchKey) || typeof window === "undefined") return;
  hydrated.add(branchKey);
  try {
    const raw = window.localStorage.getItem(storageKey(branchKey));
    if (!raw) return;
    const parsed = JSON.parse(raw) as DevicePrintQueueSnapshot;
    if (Array.isArray(parsed.jobs) && Array.isArray(parsed.reprints)) {
      snapshots.set(branchKey, parsed);
    }
  } catch {
    // Corrupt device-local queue must not crash POS startup.
  }
}

function persist(branchKey: string, snapshot: DevicePrintQueueSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(branchKey), JSON.stringify(snapshot));
  } catch {
    // Authoritative print obligations remain the recovery source if local storage is unavailable.
  }
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
    hydrate(key);
    return snapshots.get(key) ?? emptySnapshot;
  },

  subscribe(branchKey: string, listener: () => void) {
    const key = normalizedBranchKey(branchKey);
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
    hydrate(key);
    const current = snapshots.get(key) ?? emptySnapshot;
    const jobs = updateList(current.jobs, update);
    const next = { jobs, reprints: current.reprints };
    snapshots.set(key, next);
    persist(key, next);
    notify(key);
  },

  setReprints(branchKey: string, update: SetStateAction<ReprintLogEntry[]>) {
    const key = normalizedBranchKey(branchKey);
    hydrate(key);
    const current = snapshots.get(key) ?? emptySnapshot;
    const reprints = updateList(current.reprints, update);
    const next = { jobs: current.jobs, reprints };
    snapshots.set(key, next);
    persist(key, next);
    notify(key);
  },

  jobsSetter(branchKey: string): Dispatch<SetStateAction<PrintJob[]>> {
    return (update) => this.setJobs(branchKey, update);
  },

  reprintsSetter(branchKey: string): Dispatch<SetStateAction<ReprintLogEntry[]>> {
    return (update) => this.setReprints(branchKey, update);
  },

  resetForTests() {
    snapshots.clear();
    listeners.clear();
  },
};
