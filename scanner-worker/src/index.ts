import { Container, getContainer } from "@cloudflare/containers";
import type { FileScanQueueMessage } from "../../src/server/environment";
import { scannerAuthRequestHeaders, signScannerRequest } from "../../src/server/scanner-auth";

type QueueMessage<T> = {
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

type QueueBatch<T> = { messages: QueueMessage<T>[] };

type R2Object = {
  body?: ReadableStream<Uint8Array>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  version?: string;
  etag?: string;
  customMetadata?: Record<string, string>;
};

type ScannerEnv = {
  SERAMET_APP: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  SERAMET_OBJECTS: { get(key: string): Promise<R2Object | null> };
  SERAMET_SCANNER_EVIDENCE_SECRET: string;
  SERAMET_SCANNER_ID?: string;
  CLAMAV: DurableObjectNamespace<ClamAvContainer>;
};

type ClaimedJob = {
  tenantId: string;
  jobId: string;
  correlationId: string;
  objectId: string;
  objectKey: string;
  objectVersion: string;
  sha256: string;
  contentType: string;
  sizeBytes: number;
  originalName: string;
};

type ClaimResponse = {
  ok?: boolean;
  state?: "SCAN_PENDING" | "CLEAN";
  job?: ClaimedJob;
};

type ClamAvResponse = {
  verdict?: "CLEAN" | "INFECTED" | "ERROR";
  engine?: string;
  engineVersion?: string;
  signatureVersion?: string;
  threat?: string;
  scannedAt?: string;
};

const maxUploadBytes = 10 * 1024 * 1024;
const maxAttempts = 3;

export class ClamAvContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "2m";
}

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },

  async queue(batch: QueueBatch<FileScanQueueMessage>, env: ScannerEnv) {
    for (const message of batch.messages) {
      await processMessage(message, env);
    }
  },
};

async function processMessage(message: QueueMessage<FileScanQueueMessage>, env: ScannerEnv) {
  const identity = message.body;
  if (
    identity?.kind !== "file-scan" ||
    !identity.tenantId ||
    !identity.jobId ||
    !identity.correlationId
  ) {
    message.ack();
    return;
  }

  try {
    const claim = await callMain<ClaimResponse>(env, "/api/seramet/internal/file-scanner/claim", {
      tenantId: identity.tenantId,
      jobId: identity.jobId,
      correlationId: identity.correlationId,
    });
    if (claim.state === "CLEAN") {
      message.ack();
      return;
    }
    if (!claim.job) throw new RetryableScanError("CLAIM_INVALID");
    const bytes = await readAndVerifyObject(env, claim.job);
    const result = await scanWithClamAv(env, bytes, claim.job.contentType);
    if (result.verdict === "ERROR") throw new RetryableScanError("ENGINE_ERROR");
    const verdict = {
      tenantId: claim.job.tenantId,
      jobId: claim.job.jobId,
      correlationId: claim.job.correlationId,
      objectId: claim.job.objectId,
      objectKey: claim.job.objectKey,
      objectVersion: claim.job.objectVersion,
      sha256: claim.job.sha256,
      verdict: result.verdict,
      evidenceId: crypto.randomUUID(),
      scannerId: env.SERAMET_SCANNER_ID ?? "seramet-clamav-staging",
      engine: result.engine ?? "ClamAV",
      engineVersion: result.engineVersion,
      signatureVersion: result.signatureVersion,
      scannedAt: result.scannedAt ?? new Date().toISOString(),
      threat: result.verdict === "INFECTED" ? result.threat : undefined,
    };
    await callMain(env, "/api/seramet/internal/file-scanner/verdict", verdict);
    message.ack();
  } catch (error) {
    if (error instanceof TerminalScanError) {
      await reportTerminalFailure(env, identity, error.code).catch(() => undefined);
      message.ack();
      return;
    }
    if (message.attempts >= maxAttempts) {
      const code = error instanceof RetryableScanError ? error.code : "SCANNER_UNAVAILABLE";
      await reportTerminalFailure(env, identity, code).catch(() => undefined);
      message.ack();
      return;
    }
    message.retry({ delaySeconds: Math.min(300, 30 * 2 ** Math.max(0, message.attempts - 1)) });
  }
}

async function readAndVerifyObject(env: ScannerEnv, job: ClaimedJob) {
  if (job.sizeBytes < 1 || job.sizeBytes > maxUploadBytes) {
    throw new TerminalScanError("FILE_SIZE_INVALID");
  }
  const object = await env.SERAMET_OBJECTS.get(job.objectKey);
  if (!object) throw new TerminalScanError("OBJECT_MISSING");
  if (
    object.customMetadata?.["tenantId"] !== job.tenantId ||
    object.customMetadata?.["objectId"] !== job.objectId ||
    object.customMetadata?.["checksum"] !== job.sha256
  ) {
    throw new TerminalScanError("OBJECT_METADATA_MISMATCH");
  }
  const remoteVersion = object.version ?? object.etag;
  if (remoteVersion && job.objectVersion !== remoteVersion) {
    throw new TerminalScanError("OBJECT_VERSION_MISMATCH");
  }
  const source = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : undefined);
  if (!source) throw new TerminalScanError("OBJECT_BODY_MISSING");
  const buffer = source instanceof ArrayBuffer ? source : await new Response(source).arrayBuffer();
  if (buffer.byteLength !== job.sizeBytes || buffer.byteLength > maxUploadBytes) {
    throw new TerminalScanError("OBJECT_SIZE_MISMATCH");
  }
  if ((await sha256(buffer)) !== job.sha256) {
    throw new TerminalScanError("OBJECT_HASH_MISMATCH");
  }
  return buffer;
}

async function scanWithClamAv(env: ScannerEnv, bytes: ArrayBuffer, contentType: string) {
  const container = getContainer(env.CLAMAV, "scanner");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await container.fetch("http://container/scan", {
      method: "POST",
      headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
      body: bytes,
      signal: controller.signal,
    });
    if (!response.ok) throw new RetryableScanError("ENGINE_UNAVAILABLE");
    const result = (await response.json()) as ClamAvResponse;
    if (!result.verdict || !["CLEAN", "INFECTED", "ERROR"].includes(result.verdict)) {
      throw new RetryableScanError("ENGINE_RESPONSE_INVALID");
    }
    return result;
  } catch (error) {
    if (error instanceof RetryableScanError) throw error;
    throw new RetryableScanError(
      error instanceof Error && error.name === "AbortError"
        ? "ENGINE_TIMEOUT"
        : "ENGINE_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function reportTerminalFailure(
  env: ScannerEnv,
  identity: FileScanQueueMessage,
  failureCode: string,
) {
  const claim = await callMain<ClaimResponse>(env, "/api/seramet/internal/file-scanner/claim", {
    tenantId: identity.tenantId,
    jobId: identity.jobId,
    correlationId: identity.correlationId,
  });
  if (!claim.job) return;
  await callMain(env, "/api/seramet/internal/file-scanner/verdict", {
    tenantId: claim.job.tenantId,
    jobId: claim.job.jobId,
    correlationId: claim.job.correlationId,
    objectId: claim.job.objectId,
    objectKey: claim.job.objectKey,
    objectVersion: claim.job.objectVersion,
    sha256: claim.job.sha256,
    verdict: "ERROR",
    failureCode,
    scannerId: env.SERAMET_SCANNER_ID ?? "seramet-clamav-staging",
    scannedAt: new Date().toISOString(),
  });
}

async function callMain<T = Record<string, unknown>>(
  env: ScannerEnv,
  pathname: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const body = JSON.stringify(payload);
  const auth = await signScannerRequest({
    secret: env.SERAMET_SCANNER_EVIDENCE_SECRET,
    method: "POST",
    pathname,
    body,
  });
  const response = await env.SERAMET_APP.fetch(`https://seramet.internal${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...scannerAuthRequestHeaders(auth),
    },
    body,
  });
  if (response.status === 404 || response.status === 409 || response.status === 422) {
    throw new TerminalScanError(`MAIN_${response.status}`);
  }
  if (!response.ok) throw new RetryableScanError(`MAIN_${response.status}`);
  return (await response.json()) as T;
}

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class RetryableScanError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

class TerminalScanError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
