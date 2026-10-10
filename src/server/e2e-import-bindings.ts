import type { SerametEnv } from "@/lib/seramet-auth";
import type {
  DurableQueueMessage,
  FileScanQueueMessage,
  ObjectStoreBinding,
} from "@/server/environment";
import { handleWorkerQueue, type SerametWorkerMessage } from "@/server/workers";
import { handleScannerInternalApi } from "@/server/scanner-internal-api";
import { scannerAuthRequestHeaders, signScannerRequest } from "@/server/scanner-auth";

type StoredValue = {
  bytes: Uint8Array;
  version: string;
  contentType?: string;
  customMetadata?: Record<string, string>;
};

const objects = new Map<string, StoredValue>();
let activeEnvironment: SerametEnv | undefined;

const objectStore: ObjectStoreBinding = {
  async head(key) {
    const stored = objects.get(key);
    return stored ? { version: stored.version, customMetadata: stored.customMetadata } : null;
  },
  async get(key) {
    const stored = objects.get(key);
    if (!stored) return null;
    return {
      version: stored.version,
      httpMetadata: { contentType: stored.contentType },
      customMetadata: stored.customMetadata,
      arrayBuffer: async () => stored.bytes.slice().buffer as ArrayBuffer,
    };
  },
  async put(key, value, options) {
    const bytes = await valueBytes(value);
    const version = `e2e:${crypto.randomUUID()}`;
    objects.set(key, {
      bytes,
      version,
      contentType: options?.httpMetadata?.contentType,
      customMetadata: options?.customMetadata,
    });
    return { version };
  },
  async delete(key) {
    for (const item of Array.isArray(key) ? key : [key]) objects.delete(item);
  },
};

const scannerSecret = "seramet-e2e-scanner-evidence-secret-at-least-32-bytes";

const queue = {
  async send(message: SerametWorkerMessage) {
    const env = activeEnvironment;
    if (!env) throw new Error("E2E worker environment is unavailable");
    setTimeout(() => {
      const queued: DurableQueueMessage<SerametWorkerMessage> = {
        id: `e2e-message:${crypto.randomUUID()}`,
        timestamp: new Date(),
        body: message,
        attempts: 1,
        ack() {},
        retry() {},
      };
      void handleWorkerQueue({ queue: "seramet-e2e", messages: [queued] }, env);
    }, 5);
  },
};

const scanQueue = {
  async send(message: FileScanQueueMessage) {
    const env = activeEnvironment;
    if (!env) throw new Error("E2E scanner environment is unavailable");
    setTimeout(() => void simulateScan(env, message), 5);
  },
};

/** Installs deterministic local bindings only behind the explicit CI E2E gate. */
export function installE2EImportBindings(env: SerametEnv) {
  activeEnvironment = env;
  env.SERAMET_OBJECTS = objectStore;
  env.SERAMET_WORK_QUEUE = queue;
  env.SERAMET_SCAN_QUEUE = scanQueue;
  env.SERAMET_SCANNER_EVIDENCE_SECRET = scannerSecret;
}

async function simulateScan(env: SerametEnv, identity: FileScanQueueMessage) {
  const claim = await scannerCall(env, "claim", identity);
  if (!claim.ok) return;
  const claimBody = (await claim.json()) as { job?: Record<string, unknown> };
  const job = claimBody.job;
  if (!job) return;
  const fileName = String(job["originalName"] ?? "");
  if (fileName.startsWith("scanner-infected")) {
    await scannerCall(env, "verdict", {
      ...job,
      verdict: "INFECTED",
      scannerId: "e2e-clamav",
      threat: "Eicar-Signature",
      scannedAt: new Date().toISOString(),
    });
    return;
  }
  const negative = [
    "scanner-unavailable",
    "scanner-timeout",
    "scanner-auth-failure",
    "scanner-malformed",
    "scanner-wrong-sha",
    "scanner-expired",
    "scanner-replay",
  ].some((prefix) => fileName.startsWith(prefix));
  if (negative) {
    await scannerCall(env, "verdict", {
      ...job,
      verdict: "ERROR",
      scannerId: "e2e-clamav",
      failureCode: `E2E_${fileName.split(".")[0]?.toUpperCase().replaceAll("-", "_")}`,
      scannedAt: new Date().toISOString(),
    });
    return;
  }
  await scannerCall(env, "verdict", {
    ...job,
    verdict: "CLEAN",
    evidenceId: `e2e-evidence:${crypto.randomUUID()}`,
    scannerId: "e2e-clamav",
    engine: "ClamAV",
    engineVersion: "e2e",
    signatureVersion: "e2e-v1",
    scannedAt: new Date().toISOString(),
  });
}

async function scannerCall(
  env: SerametEnv,
  kind: "claim" | "verdict",
  payload: Record<string, unknown>,
) {
  const pathname = `/api/seramet/internal/file-scanner/${kind}`;
  const body = JSON.stringify(payload);
  const auth = await signScannerRequest({
    secret: scannerSecret,
    method: "POST",
    pathname,
    body,
  });
  const response = await handleScannerInternalApi(
    new Request(`https://scanner.e2e${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...scannerAuthRequestHeaders(auth) },
      body,
    }),
    env,
  );
  if (!response) throw new Error("E2E scanner route was not handled");
  return response;
}

async function valueBytes(
  value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  return new Uint8Array(await new Response(value).arrayBuffer());
}
