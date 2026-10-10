import type { SerametEnv } from "@/lib/seramet-auth";
import type { CleanScanEvidence } from "@/server/malware-scanner";
import { requireValidStoredCleanEvidence } from "@/server/malware-scanner";
import { verifyScannerRequest } from "@/server/scanner-auth";

const claimPath = "/api/seramet/internal/file-scanner/claim";
const verdictPath = "/api/seramet/internal/file-scanner/verdict";

type ScannerJobPayload = {
  objectId?: string;
  objectKey?: string;
  objectVersion?: string;
  fileChecksum?: string;
  originalName?: string;
  mimeType?: string;
};

type ScannerJobRow = {
  tenant_id: string;
  id: string;
  correlation_id: string;
  status: string;
  payload_json: string;
  object_id: string;
  object_key: string;
  object_version: string;
  checksum_sha256: string;
  content_type: string;
  size_bytes: number;
  object_status: string;
  scan_evidence_id: string | null;
  scan_evidence_json: string;
};

type ScanVerdict = {
  tenantId?: string;
  jobId?: string;
  correlationId?: string;
  objectId?: string;
  objectKey?: string;
  objectVersion?: string;
  sha256?: string;
  verdict?: "CLEAN" | "INFECTED" | "ERROR";
  evidenceId?: string;
  scannerId?: string;
  engine?: string;
  engineVersion?: string;
  signatureVersion?: string;
  scannedAt?: string;
  threat?: string;
  failureCode?: string;
};

export async function handleScannerInternalApi(request: Request, env: SerametEnv) {
  const url = new URL(request.url);
  if (![claimPath, verdictPath].includes(url.pathname)) return null;
  if (request.method !== "POST") return response(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  if (!env.SERAMET_DB) return response(503, "DATABASE_UNAVAILABLE", "Scanner state unavailable");

  const body = await request.text();
  const authenticated = await verifyScannerRequest({
    secret: env.SERAMET_SCANNER_EVIDENCE_SECRET,
    method: request.method,
    pathname: url.pathname,
    body,
    timestamp: request.headers.get("x-seramet-scanner-timestamp"),
    nonce: request.headers.get("x-seramet-scanner-nonce"),
    signature: request.headers.get("x-seramet-scanner-signature"),
  });
  if (!authenticated) {
    return response(401, "SCANNER_AUTHENTICATION_FAILED", "Scanner authentication failed");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return response(400, "INVALID_REQUEST", "Invalid scanner request");
  }
  return url.pathname === claimPath
    ? claimScannerJob(env, payload)
    : recordScannerVerdict(env, payload as ScanVerdict);
}

async function claimScannerJob(env: SerametEnv, input: Record<string, unknown>) {
  const tenantId = string(input["tenantId"]);
  const jobId = string(input["jobId"]);
  const correlationId = string(input["correlationId"]);
  if (!tenantId || !jobId || !correlationId) {
    return response(400, "INVALID_REQUEST", "Scanner job identity is required");
  }
  const row = await loadScannerJob(env, tenantId, jobId);
  if (!row || row.correlation_id !== correlationId) {
    return response(404, "SCANNER_JOB_NOT_FOUND", "Scanner job not found");
  }
  const jobPayload = parsePayload(row.payload_json);
  if (!matchesStoredIdentity(row, jobPayload)) {
    return response(409, "OBJECT_IDENTITY_MISMATCH", "Quarantined file identity has changed");
  }
  if (row.object_status === "QUARANTINED" || row.status === "DEAD_LETTER") {
    return response(409, "SCANNER_JOB_TERMINAL", "Scanner job is terminal");
  }
  if (row.object_status === "ACTIVE") {
    try {
      const evidence = requireValidStoredCleanEvidence({
        evidence: parseObject(row.scan_evidence_json),
        sha256: row.checksum_sha256,
        subject: {
          jobId: row.id,
          objectKey: row.object_key,
          objectVersion: row.object_version,
        },
        maxAgeMs: Number.POSITIVE_INFINITY,
      });
      return json(200, { ok: true, state: "CLEAN", evidenceId: evidence.evidenceId });
    } catch {
      return response(409, "CLEAN_EVIDENCE_INVALID", "Stored CLEAN evidence is invalid");
    }
  }
  if (row.object_status !== "PENDING_SCAN" || !["PENDING", "RETRY_PENDING"].includes(row.status)) {
    return response(409, "SCANNER_JOB_NOT_CLAIMABLE", "Scanner job is not claimable");
  }

  const stamp = new Date().toISOString();
  await env.SERAMET_DB!.batch([
    stateEvent(env, row, "SCAN_PENDING", {
      objectKey: row.object_key,
      objectVersion: row.object_version,
      sha256: row.checksum_sha256,
    }),
    auditEvent(env, row, "FILE_SCAN_CLAIMED", { objectId: row.object_id }),
  ]);
  return json(200, {
    ok: true,
    state: "SCAN_PENDING",
    job: {
      tenantId: row.tenant_id,
      jobId: row.id,
      correlationId: row.correlation_id,
      objectId: row.object_id,
      objectKey: row.object_key,
      objectVersion: row.object_version,
      sha256: row.checksum_sha256,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      originalName: jobPayload.originalName,
      claimedAt: stamp,
    },
  });
}

async function recordScannerVerdict(env: SerametEnv, input: ScanVerdict) {
  const tenantId = string(input.tenantId);
  const jobId = string(input.jobId);
  const correlationId = string(input.correlationId);
  if (!tenantId || !jobId || !correlationId || !input.verdict) {
    return response(400, "INVALID_REQUEST", "Scanner verdict identity is required");
  }
  const row = await loadScannerJob(env, tenantId, jobId);
  if (!row || row.correlation_id !== correlationId) {
    return response(404, "SCANNER_JOB_NOT_FOUND", "Scanner job not found");
  }
  const jobPayload = parsePayload(row.payload_json);
  if (
    !matchesStoredIdentity(row, jobPayload) ||
    input.objectId !== row.object_id ||
    input.objectKey !== row.object_key ||
    input.objectVersion !== row.object_version ||
    input.sha256 !== row.checksum_sha256
  ) {
    return response(409, "OBJECT_IDENTITY_MISMATCH", "Scanner verdict does not match the file");
  }

  if (input.verdict === "CLEAN") return recordCleanVerdict(env, row, input);
  return recordRejectedVerdict(env, row, input);
}

async function recordCleanVerdict(env: SerametEnv, row: ScannerJobRow, input: ScanVerdict) {
  const evidence: CleanScanEvidence & { engineVersion?: string } = {
    verdict: "CLEAN",
    sha256: row.checksum_sha256,
    evidenceId: string(input.evidenceId),
    scannerId: string(input.scannerId),
    engine: string(input.engine),
    signatureVersion: string(input.signatureVersion),
    scannedAt: string(input.scannedAt),
    jobId: row.id,
    objectKey: row.object_key,
    objectVersion: row.object_version,
    authenticatedOrigin: "cloudflare-service-binding+hmac-v1",
    ...(input.engineVersion ? { engineVersion: input.engineVersion } : {}),
  };
  try {
    requireValidStoredCleanEvidence({
      evidence,
      sha256: row.checksum_sha256,
      subject: { jobId: row.id, objectKey: row.object_key, objectVersion: row.object_version },
    });
  } catch {
    return response(422, "CLEAN_EVIDENCE_INVALID", "Scanner CLEAN evidence is invalid");
  }

  if (row.object_status === "QUARANTINED" || row.status === "DEAD_LETTER") {
    return response(409, "SCANNER_JOB_TERMINAL", "Scanner job is terminal");
  }
  if (row.scan_evidence_id) {
    const stored = parseObject(row.scan_evidence_json) as Partial<CleanScanEvidence>;
    if (row.scan_evidence_id !== evidence.evidenceId || stored.sha256 !== evidence.sha256) {
      return response(409, "CLEAN_EVIDENCE_CONFLICT", "Different scanner evidence already exists");
    }
    return json(202, { ok: true, state: "SCANNED_CLEAN", duplicate: true });
  }
  if (row.object_status !== "PENDING_SCAN" || !["PENDING", "RETRY_PENDING"].includes(row.status)) {
    return response(409, "SCANNER_JOB_NOT_CLAIMABLE", "Scanner job is not claimable");
  }
  const stamp = new Date().toISOString();
  try {
    await env.SERAMET_DB!.batch([
      env
        .SERAMET_DB!.prepare(
          `UPDATE stored_objects SET status='ACTIVE',scan_evidence_json=?,scan_evidence_id=?
           WHERE tenant_id=? AND id=? AND object_class='IMPORT_QUARANTINE'
             AND status IN ('PENDING_SCAN','ACTIVE')`,
        )
        .bind(JSON.stringify(evidence), evidence.evidenceId, row.tenant_id, row.object_id),
      env
        .SERAMET_DB!.prepare(
          `UPDATE worker_jobs SET status='PENDING',scheduled_at=?,last_error=NULL,updated_at=?
           WHERE tenant_id=? AND id=? AND job_type='SETUP_IMPORT_PREPARE'
             AND status IN ('PENDING','RETRY_PENDING')`,
        )
        .bind(stamp, stamp, row.tenant_id, row.id),
      stateEvent(env, row, "SCANNED_CLEAN", {
        evidenceId: evidence.evidenceId,
        scannerId: evidence.scannerId,
        engine: evidence.engine,
        engineVersion: evidence.engineVersion,
        signatureVersion: evidence.signatureVersion,
        scannedAt: evidence.scannedAt,
      }),
      auditEvent(env, row, "FILE_SCAN_CLEAN", {
        objectId: row.object_id,
        evidenceId: evidence.evidenceId,
        scannerId: evidence.scannerId,
      }),
    ]);
  } catch (error) {
    const refreshed = await loadScannerJob(env, row.tenant_id, row.id);
    if (refreshed?.scan_evidence_id !== evidence.evidenceId) throw error;
  }
  await env.SERAMET_WORK_QUEUE?.send(
    {
      kind: "worker-job",
      tenantId: row.tenant_id,
      jobId: row.id,
      correlationId: row.correlation_id,
    },
    { contentType: "json" },
  );
  return json(202, { ok: true, state: "SCANNED_CLEAN", duplicate: false });
}

async function recordRejectedVerdict(env: SerametEnv, row: ScannerJobRow, input: ScanVerdict) {
  if (row.object_status === "ACTIVE") {
    return response(409, "VERDICT_CONFLICT", "A clean file cannot be replaced by a later verdict");
  }
  const infected = input.verdict === "INFECTED";
  const stamp = new Date().toISOString();
  const failureCode = infected ? "INFECTED" : string(input.failureCode) || "SCAN_FAILED";
  await env.SERAMET_DB!.batch([
    env
      .SERAMET_DB!.prepare(
        `UPDATE stored_objects SET status='QUARANTINED',scan_evidence_json=?,scan_evidence_id=NULL
         WHERE tenant_id=? AND id=? AND object_class='IMPORT_QUARANTINE' AND status='PENDING_SCAN'`,
      )
      .bind(
        JSON.stringify({
          verdict: input.verdict,
          failureCode,
          scannerId: string(input.scannerId) || undefined,
          scannedAt: string(input.scannedAt) || stamp,
          threat: infected ? bounded(input.threat, 160) : undefined,
        }),
        row.tenant_id,
        row.object_id,
      ),
    env
      .SERAMET_DB!.prepare(
        `UPDATE worker_jobs SET status='DEAD_LETTER',last_error=?,finished_at=?,updated_at=?
         WHERE tenant_id=? AND id=? AND job_type='SETUP_IMPORT_PREPARE'
           AND status IN ('PENDING','RETRY_PENDING')`,
      )
      .bind(failureCode, stamp, stamp, row.tenant_id, row.id),
    stateEvent(env, row, infected ? "REJECTED_INFECTED" : "SCAN_FAILED", {
      failureCode,
      scannerId: string(input.scannerId) || undefined,
      scannedAt: string(input.scannedAt) || stamp,
      threat: infected ? bounded(input.threat, 160) : undefined,
    }),
    auditEvent(env, row, infected ? "FILE_SCAN_INFECTED" : "FILE_SCAN_FAILED", {
      objectId: row.object_id,
      failureCode,
    }),
  ]);
  return json(202, { ok: true, state: infected ? "REJECTED_INFECTED" : "SCAN_FAILED" });
}

async function loadScannerJob(env: SerametEnv, tenantId: string, jobId: string) {
  return env
    .SERAMET_DB!.prepare(
      `SELECT j.tenant_id,j.id,j.correlation_id,j.status,j.payload_json,
              o.id object_id,o.object_key,o.object_version,o.checksum_sha256,o.content_type,
              o.size_bytes,o.status object_status,o.scan_evidence_id,o.scan_evidence_json
       FROM worker_jobs j
       JOIN stored_objects o ON o.tenant_id=j.tenant_id
         AND o.id=json_extract(j.payload_json,'$.objectId')
       WHERE j.tenant_id=? AND j.id=? AND j.job_type='SETUP_IMPORT_PREPARE'
         AND o.object_class='IMPORT_QUARANTINE'`,
    )
    .bind(tenantId, jobId)
    .first<ScannerJobRow>();
}

function matchesStoredIdentity(row: ScannerJobRow, payload: ScannerJobPayload) {
  return (
    payload.objectId === row.object_id &&
    payload.objectKey === row.object_key &&
    payload.objectVersion === row.object_version &&
    payload.fileChecksum === row.checksum_sha256 &&
    payload.mimeType === row.content_type
  );
}

function stateEvent(
  env: SerametEnv,
  row: ScannerJobRow,
  state: "SCAN_PENDING" | "SCANNED_CLEAN" | "REJECTED_INFECTED" | "SCAN_FAILED",
  evidence: Record<string, unknown>,
) {
  return env
    .SERAMET_DB!.prepare(
      `INSERT INTO file_import_state_events
       (tenant_id,id,job_id,object_id,state,attempt,evidence_json,created_at)
       VALUES (?,?,?,?,?,1,?,?)`,
    )
    .bind(
      row.tenant_id,
      crypto.randomUUID(),
      row.id,
      row.object_id,
      state,
      JSON.stringify(evidence),
      new Date().toISOString(),
    );
}

function auditEvent(
  env: SerametEnv,
  row: ScannerJobRow,
  action: string,
  metadata: Record<string, unknown>,
) {
  return env
    .SERAMET_DB!.prepare(
      `INSERT INTO audit_events
       (tenant_id,id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
       VALUES (?,?,?,?,'WORKER_JOB',?,'Authenticated scanner service',?,?,?)`,
    )
    .bind(
      row.tenant_id,
      crypto.randomUUID(),
      "system:file-scanner",
      action,
      row.id,
      row.correlation_id,
      JSON.stringify(metadata),
      new Date().toISOString(),
    );
}

function parsePayload(value: string): ScannerJobPayload {
  try {
    return JSON.parse(value) as ScannerJobPayload;
  } catch {
    return {};
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bounded(value: unknown, limit: number) {
  return string(value).slice(0, limit);
}

function response(status: number, code: string, message: string) {
  return json(status, { ok: false, code, message });
}

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
