import type { Dispatch, SetStateAction } from "react";
import type { PrintJob, ReprintLogEntry } from "@/lib/seramet-print-service";

export type DevicePrintQueueSnapshot = {
  jobs: PrintJob[];
  reprints: ReprintLogEntry[];
};

const emptySnapshot: DevicePrintQueueSnapshot = { jobs: [], reprints: [] };
const snapshots = new Map<string, DevicePrintQueueSnapshot>();
const listeners = new Map<string, Set<() => void>>();

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
    return snapshots.get(normalizedBranchKey(branchKey)) ?? emptySnapshot;
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
    const current = snapshots.get(key) ?? emptySnapshot;
    const jobs = updateList(current.jobs, update);
    snapshots.set(key, { jobs, reprints: current.reprints });
    notify(key);
  },

  setReprints(branchKey: string, update: SetStateAction<ReprintLogEntry[]>) {
    const key = normalizedBranchKey(branchKey);
    const current = snapshots.get(key) ?? emptySnapshot;
    const reprints = updateList(current.reprints, update);
    snapshots.set(key, { jobs: current.jobs, reprints });
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
