import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SerametEnv } from "@/lib/seramet-auth";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { handleScannerInternalApi } from "@/server/scanner-internal-api";
import { scannerAuthRequestHeaders, signScannerRequest } from "@/server/scanner-auth";

const secret = "scanner-internal-api-test-secret-at-least-32-bytes";
const tenantId = "tenant-scanner-api";

describe.sequential("isolated file scanner boundary", () => {
  let db: SqliteD1TestDatabase;
  let workMessages: unknown[];
  let env: SerametEnv;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    db.sqlite
      .prepare(
        `INSERT INTO tenants
         (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
      )
      .run(
        tenantId,
        "scanner-api",
        "Scanner API Limited",
        "Scanner API",
        "2026-10-09T06:00:00.000Z",
        "2026-10-09T06:00:00.000Z",
      );
    workMessages = [];
    env = {
      SERAMET_ENVIRONMENT: "test",
      SERAMET_DB: db,
      SERAMET_SCANNER_EVIDENCE_SECRET: secret,
      SERAMET_WORK_QUEUE: {
        async send(message) {
          workMessages.push(message);
        },
      },
    };
  });

  afterEach(() => db.close());

  it("rejects unauthenticated and body-tampered scanner calls", async () => {
    seedJob(db, "job-auth", "object-auth");
    const body = JSON.stringify(identity("job-auth"));
    const unauthenticated = await handleScannerInternalApi(
      new Request("https://seramet.test/api/seramet/internal/file-scanner/claim", {
        method: "POST",
        body,
      }),
      env,
    );
    expect(unauthenticated?.status).toBe(401);

    const auth = await signScannerRequest({
      secret,
      method: "POST",
      pathname: "/api/seramet/internal/file-scanner/claim",
      body,
    });
    const tampered = await handleScannerInternalApi(
      new Request("https://seramet.test/api/seramet/internal/file-scanner/claim", {
        method: "POST",
        headers: scannerAuthRequestHeaders(auth),
        body: JSON.stringify({ ...identity("job-auth"), jobId: "different" }),
      }),
      env,
    );
    expect(tampered?.status).toBe(401);
  });

  it("unlocks parsing only for exact authenticated CLEAN evidence and rejects altered reuse", async () => {
    seedJob(db, "job-clean", "object-clean");
    const claim = await scannerCall("claim", identity("job-clean"));
    expect(claim.status).toBe(200);
    const claimBody = (await claim.json()) as { job: Record<string, unknown> };
    const verdict = {
      ...claimBody.job,
      verdict: "CLEAN",
      evidenceId: "evidence-clean-1",
      scannerId: "clamav-staging",
      engine: "ClamAV",
      engineVersion: "1.4",
      signatureVersion: "27800",
      scannedAt: new Date().toISOString(),
    };
    expect((await scannerCall("verdict", verdict)).status).toBe(202);
    expect(
      await db
        .prepare("SELECT status FROM stored_objects WHERE tenant_id=? AND id='object-clean'")
        .bind(tenantId)
        .first("status"),
    ).toBe("ACTIVE");
    const job = await db
      .prepare("SELECT status,scheduled_at FROM worker_jobs WHERE tenant_id=? AND id='job-clean'")
      .bind(tenantId)
      .first<{ status: string; scheduled_at: string }>();
    expect(job?.status).toBe("PENDING");
    expect(Date.parse(job!.scheduled_at)).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(workMessages).toHaveLength(1);

    expect((await scannerCall("verdict", verdict)).status).toBe(202);
    expect(workMessages).toHaveLength(1);
    expect(
      (
        await scannerCall("verdict", {
          ...verdict,
          evidenceId: "evidence-altered",
          sha256: "b".repeat(64),
        })
      ).status,
    ).toBe(409);
  });

  it("keeps infected and failed files quarantined and never schedules the parser", async () => {
    for (const [jobId, objectId, verdict] of [
      ["job-infected", "object-infected", "INFECTED"],
      ["job-failed", "object-failed", "ERROR"],
    ] as const) {
      seedJob(db, jobId, objectId);
      const claim = await scannerCall("claim", identity(jobId));
      const claimBody = (await claim.json()) as { job: Record<string, unknown> };
      const result = await scannerCall("verdict", {
        ...claimBody.job,
        verdict,
        scannerId: "clamav-staging",
        scannedAt: new Date().toISOString(),
        ...(verdict === "INFECTED"
          ? { threat: "Eicar-Signature" }
          : { failureCode: "ENGINE_TIMEOUT" }),
      });
      expect(result.status).toBe(202);
      expect(
        await db
          .prepare("SELECT status FROM stored_objects WHERE tenant_id=? AND id=?")
          .bind(tenantId, objectId)
          .first("status"),
      ).toBe("QUARANTINED");
      expect(
        await db
          .prepare("SELECT status FROM worker_jobs WHERE tenant_id=? AND id=?")
          .bind(tenantId, jobId)
          .first("status"),
      ).toBe("DEAD_LETTER");
      expect(
        (
          await scannerCall("verdict", {
            ...claimBody.job,
            verdict: "CLEAN",
            evidenceId: `late-clean-${jobId}`,
            scannerId: "clamav-staging",
            engine: "ClamAV",
            engineVersion: "1.4",
            signatureVersion: "27800",
            scannedAt: new Date().toISOString(),
          })
        ).status,
      ).toBe(409);
    }
    expect(workMessages).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*) count FROM setup_imports").first("count")).toBe(0);
  });

  async function scannerCall(kind: "claim" | "verdict", payload: Record<string, unknown>) {
    const pathname = `/api/seramet/internal/file-scanner/${kind}`;
    const body = JSON.stringify(payload);
    const auth = await signScannerRequest({ secret, method: "POST", pathname, body });
    const result = await handleScannerInternalApi(
      new Request(`https://seramet.test${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...scannerAuthRequestHeaders(auth) },
        body,
      }),
      env,
    );
    if (!result) throw new Error("Scanner request was not handled");
    return result;
  }
});

function seedJob(db: SqliteD1TestDatabase, jobId: string, objectId: string) {
  const checksum = "a".repeat(64);
  const correlationId = `correlation-${jobId}`;
  const objectKey = `${tenantId}/private/${objectId}.csv`;
  const objectVersion = `sha256:${checksum}`;
  const stamp = "2026-10-09T06:00:00.000Z";
  db.sqlite
    .prepare(
      `INSERT INTO stored_objects
       (tenant_id,id,object_key,object_class,content_type,size_bytes,checksum_sha256,status,
        created_by,created_at,metadata_json,object_version,scan_evidence_json)
       VALUES (?,?,?,'IMPORT_QUARANTINE','text/csv',64,?,'PENDING_SCAN','test',?,'{}',?,'{}')`,
    )
    .run(tenantId, objectId, objectKey, checksum, stamp, objectVersion);
  db.sqlite
    .prepare(
      `INSERT INTO worker_jobs
       (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,
        max_attempts,scheduled_at,created_at,updated_at,result_json)
       VALUES (?,?,'SETUP_IMPORT_PREPARE',?,?,?,'PENDING',0,8,'9999-12-31T23:59:59.999Z',?,?,'{}')`,
    )
    .run(
      tenantId,
      jobId,
      JSON.stringify({
        objectId,
        objectKey,
        objectVersion,
        fileChecksum: checksum,
        originalName: "menu.csv",
        mimeType: "text/csv",
      }),
      `key-${jobId}`,
      correlationId,
      stamp,
      stamp,
    );
}

function identity(jobId: string) {
  return { tenantId, jobId, correlationId: `correlation-${jobId}` };
}
