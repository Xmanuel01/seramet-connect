#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, writeFile, unlink, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
import { PrintJobStore } from "./print-job-store.mjs";
import { PrintJobRunner } from "./job-runner.mjs";
import { verifyPrintAuthorization } from "./authorization.mjs";
import { encodeEscPos } from "./escpos-encoder.mjs";
import { sendTcp, sendWindows } from "./transports.mjs";

export async function createBridge(config, { deliver, localTest = false } = {}) {
  if (config.host && config.host !== "127.0.0.1") throw new Error("LOOPBACK_BIND_REQUIRED");
  if (
    !config.token ||
    config.token.length < 32 ||
    !config.signingKey ||
    config.signingKey.length < 32 ||
    !config.bridgeId ||
    !config.tenantId ||
    !config.branchId
  )
    throw new Error("BRIDGE_ENROLLMENT_REQUIRED");
  const dataDir = config.dataDir ?? join(homedir(), ".seramet-print-bridge");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = new PrintJobStore(join(dataDir, "print-jobs.sqlite"));
  await chmod(join(dataDir, "print-jobs.sqlite"), 0o600);
  const runner = new PrintJobRunner(
    store,
    deliver ??
      (async (job) => {
        if (job.target.transport === "TCP") {
          return sendTcp(encodeEscPos(job.content, job.profile), job.target, { localTest });
        }
        const file = join(dataDir, `${createHash("sha256").update(job.id).digest("hex")}.txt`);
        try {
          await writeFile(file, job.content, { mode: 0o600 });
          return await sendWindows(file, job.target);
        } finally {
          await unlink(file).catch(() => undefined);
        }
      }),
    config.concurrency ?? 2,
  );
  const allowed = new Set(config.allowedOrigins ?? []);
  const server = createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    const origin = request.headers.origin;
    if (origin && !allowed.has(origin)) return reply(403, { code: "ORIGIN_DENIED" });
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (request.method === "OPTIONS") return reply(204, {});
    if (request.url === "/health" && request.method === "GET")
      return reply(200, {
        ok: true,
        version: "2.0.0",
        dryRun: false,
        platform: process.platform,
        bridgeId: config.bridgeId,
        transportStatus: "UNKNOWN",
      });
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "");
    const secret = Buffer.from(config.token);
    if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret))
      return reply(401, { code: "UNAUTHORIZED" });
    try {
      if (request.method !== "POST" || request.url !== "/jobs")
        return reply(404, { code: "NOT_FOUND" });
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 300000) return reply(413, { code: "PAYLOAD_TOO_LARGE" });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const job = verifyPrintAuthorization(body.authorization, config);
      const row = store.enqueue(job);
      if (body.retry === true) store.retry(job.id, job.recoveryId);
      runner.pump();
      const current = store.get(row.id);
      return reply(202, {
        accepted: true,
        bridgeJobId: row.id,
        stage: current.stage,
        history: store.history(row.id),
        message: "Durable bridge acceptance; physical output is unconfirmed",
      });
    } catch (error) {
      const safeCodes = new Set([
        "AUTHORIZATION_REQUIRED",
        "INVALID_AUTHORIZATION",
        "AUTHORIZATION_SCOPE_DENIED",
        "ALTERED_JOB_IDENTITY",
        "QUEUE_CAPACITY_REACHED",
        "RETRY_REQUIRES_NEW_AUTHORIZATION",
        "RETRY_LIMIT_REACHED",
      ]);
      return reply(400, {
        accepted: false,
        code: safeCodes.has(error.message) ? error.message : "INVALID_PRINT_REQUEST",
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  runner.pump();
  return {
    server,
    store,
    runner,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await runner.stop();
      store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(
    readFileSync(
      process.env.SERAMET_BRIDGE_CONFIG ??
        join(process.cwd(), "local-print-bridge/config.local.json"),
      "utf8",
    ),
  );
  const bridge = await createBridge(config, {
    localTest: process.env.SERAMET_BRIDGE_MODE === "local-test",
  });
  bridge.server.listen(config.port ?? 48777, "127.0.0.1", () =>
    console.log("Seramet print bridge ready on loopback"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void bridge.close();
    });
}
