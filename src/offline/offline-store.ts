import type { TransactionState } from "@/lib/transaction-engine";
import type { OfflineCommand } from "@/offline/types";

const databaseName = "seramet-pos-offline-v1";
const databaseVersion = 1;

/** A branch-filtered snapshot must never be reused by another branch. */
export const transactionCacheKey = (tenantId: string, branchId: string) =>
  `transaction-state:${tenantId}:${branchId}`;

/** Missing and unsuccessful per-command acknowledgements are not successful syncs. */
export function acknowledgedSyncStatus(status: string | undefined): OfflineCommand["syncStatus"] {
  if (status === "accepted" || status === "duplicate") return "SYNCED";
  if (status === "conflict") return "CONFLICT";
  return "FAILED";
}

export class OfflineStore {
  async cacheState(
    tenantId: string,
    branchId: string,
    state: TransactionState,
    revision: number,
    actorDeviceScope?: string,
  ) {
    await this.put("read-cache", {
      id:
        transactionCacheKey(tenantId, branchId) + (actorDeviceScope ? `:${actorDeviceScope}` : ""),
      tenantId,
      branchId,
      revision,
      state,
      cachedAt: new Date().toISOString(),
    });
  }

  async readCachedState(tenantId: string, branchId: string, actorDeviceScope?: string) {
    const record = await this.get<{
      state: TransactionState;
      revision: number;
      cachedAt: string;
    }>(
      "read-cache",
      transactionCacheKey(tenantId, branchId) + (actorDeviceScope ? `:${actorDeviceScope}` : ""),
    );
    return record ?? null;
  }

  async enqueue(command: OfflineCommand) {
    await this.put("pending-commands", command);
  }

  async updateCommand(command: OfflineCommand) {
    await this.put("pending-commands", command);
  }

  async pending(tenantId: string, deviceId: string) {
    const records = await this.all<OfflineCommand>("pending-commands");
    return records
      .filter(
        (command) =>
          command.tenantId === tenantId &&
          command.deviceId === deviceId &&
          ["PENDING", "SYNCING", "FAILED", "CONFLICT"].includes(command.syncStatus),
      )
      .sort((a, b) => a.clientSequence - b.clientSequence);
  }

  async replayable(tenantId: string, deviceId: string) {
    const unresolved = await this.pending(tenantId, deviceId);
    // Conflicts require review; an automatic retry would repeatedly replay stale writes.
    return unresolved.filter((command) => ["PENDING", "SYNCING"].includes(command.syncStatus));
  }

  async nextSequence(deviceId: string) {
    const key = `sequence:${deviceId}`;
    const current =
      (await this.get<{ id: string; value: number }>("device-state", key))?.value ?? 0;
    const next = current + 1;
    await this.put("device-state", { id: key, value: next });
    return next;
  }

  async setPreference(id: string, value: unknown) {
    await this.put("preferences", { id, value });
  }

  async getPreference<T>(id: string) {
    return (await this.get<{ id: string; value: T }>("preferences", id))?.value;
  }

  private async put(storeName: StoreName, value: unknown) {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(storeName, "readwrite");
      const completed = transactionPromise(transaction);
      transaction.objectStore(storeName).put(value);
      await completed;
    } finally {
      db.close();
    }
  }

  private async get<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const db = await openDatabase();
    const value = await requestPromise<T | undefined>(
      db.transaction(storeName).objectStore(storeName).get(key),
    );
    db.close();
    return value;
  }

  private async all<T>(storeName: StoreName): Promise<T[]> {
    const db = await openDatabase();
    const value = await requestPromise<T[]>(
      db.transaction(storeName).objectStore(storeName).getAll(),
    );
    db.close();
    return value;
  }
}

type StoreName = "read-cache" | "pending-commands" | "preferences" | "device-state";

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(new Error("IndexedDB open timed out"));
    }, 3000);
    const failed = () => {
      clearTimeout(timeout);
      expired = true;
      reject(new Error("IndexedDB unavailable"));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [
        "read-cache",
        "pending-commands",
        "preferences",
        "device-state",
      ] as StoreName[]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) request.result.close();
      else resolve(request.result);
    };
    request.onerror = failed;
    request.onblocked = failed;
  });
}

function requestPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error("Offline storage transaction aborted"));
    transaction.onerror = () => reject(new Error("Offline storage transaction failed"));
  });
}

export const offlineStore = new OfflineStore();
