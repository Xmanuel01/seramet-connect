import type { SerametEnv } from "@/lib/seramet-auth";
import type {
  DurableQueueMessage,
  MalwareScannerBinding,
  ObjectStoreBinding,
} from "@/server/environment";
import { handleWorkerQueue, type SerametWorkerMessage } from "@/server/workers";

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

const scanner: MalwareScannerBinding = {
  async fetch(_input, init) {
    const headers = new Headers(init?.headers);
    const fileName = decodeURIComponent(headers.get("x-seramet-file-name") ?? "");
    const sha256 = headers.get("x-seramet-content-sha256") ?? "";
    const jobId = headers.get("x-seramet-scan-job-id") ?? "";
    const objectKey = headers.get("x-seramet-object-key") ?? "";
    const objectVersion = headers.get("x-seramet-object-version") ?? "";
    if (fileName.startsWith("scanner-unavailable")) throw new Error("scanner unavailable");
    if (fileName.startsWith("scanner-timeout")) {
      throw new DOMException("scanner timed out", "AbortError");
    }
    if (fileName.startsWith("scanner-auth-failure")) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (fileName.startsWith("scanner-infected")) {
      return Response.json({ verdict: "INFECTED" });
    }
    if (fileName.startsWith("scanner-malformed")) {
      return Response.json({ verdict: "CLEAN", sha256 });
    }
    const evidence = {
      verdict: "CLEAN",
      sha256: fileName.startsWith("scanner-wrong-sha") ? `wrong-${sha256}` : sha256,
      evidenceId: `e2e-evidence:${crypto.randomUUID()}`,
      scannerId: "e2e-authenticated-scanner",
      engine: "e2e-scanner",
      signatureVersion: "e2e-v1",
      scannedAt: fileName.startsWith("scanner-expired")
        ? new Date(Date.now() - 10 * 60_000).toISOString()
        : new Date().toISOString(),
      jobId,
      objectKey: fileName.startsWith("scanner-replay") ? `${objectKey}:another-file` : objectKey,
      objectVersion,
    };
    return Response.json(evidence);
  },
};

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

/** Installs deterministic local bindings only behind the explicit CI E2E gate. */
export function installE2EImportBindings(env: SerametEnv) {
  activeEnvironment = env;
  env.SERAMET_OBJECTS = objectStore;
  env.SERAMET_MALWARE_SCANNER = scanner;
  env.SERAMET_WORK_QUEUE = queue;
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
