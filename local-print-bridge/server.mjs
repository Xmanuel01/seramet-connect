#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, writeFile, unlink, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { isSea } from "node:sea";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
import { PrintJobStore } from "./print-job-store.mjs";
import { PrintJobRunner } from "./job-runner.mjs";
import { verifyPrintAuthorization } from "./authorization.mjs";
import { encodePrintDocument } from "./raster-renderer.mjs";
import { sendTcp, sendWindows, sendWindowsRaw, deliverWithFallback } from "./transports.mjs";
import { createPrinterDiscovery } from "./printer-discovery.mjs";

export const BRIDGE_VERSION = "3.3.0";

export async function createBridge(
  config,
  { deliver, localTest = false, consume, discoverPrinters = createPrinterDiscovery() } = {},
) {
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
  if (!consume) {
    const endpoint = new URL(config.authorizationEndpoint);
    if (
      endpoint.pathname !== "/api/seramet/printing/consume" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !(
        endpoint.protocol === "https:" ||
        (localTest &&
          endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(endpoint.hostname))
      )
    )
      throw new Error("AUTHORITY_ENDPOINT_REQUIRED");
    consume = async (authorization) => {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization }),
      });
      if (!response.ok || (await response.json()).reserved !== true)
        throw new Error("DELIVERY_REQUIRES_RECONCILIATION");
    };
  }
  const scope = createHash("sha256")
    .update(JSON.stringify([config.tenantId, config.branchId, config.bridgeId]))
    .digest("hex");
  const dataDir = join(config.dataDir ?? join(homedir(), ".seramet-print-bridge"), scope);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = new PrintJobStore(join(dataDir, "print-jobs.sqlite"));
  await chmod(join(dataDir, "print-jobs.sqlite"), 0o600);
  const runner = new PrintJobRunner(
    store,
    async (job) => {
      const verified = verifyPrintAuthorization(job.authorization, config);
      await consume(job.authorization);
      return (
        deliver ??
        ((job) =>
          deliverWithFallback(job, async (target, profile) => {
            if (target.transport === "TCP") {
              return sendTcp(encodePrintDocument(job, profile), target, {
                localTest: localTest && job.localTest === true,
              });
            }
            const base = join(dataDir, createHash("sha256").update(job.id).digest("hex"));
            // Thermal printers get ESC/POS bytes through the RAW spooler; only when that
            // path is unavailable (nothing spooled) does the driver print plain text.
            if (profile && ["58mm", "80mm"].includes(profile.paperWidth)) {
              try {
                await writeFile(`${base}.bin`, encodePrintDocument(job, profile), { mode: 0o600 });
                const raw = await sendWindowsRaw(`${base}.bin`, target);
                if (raw.stage !== "NOT_SENT") return raw;
              } finally {
                await unlink(`${base}.bin`).catch(() => undefined);
              }
            }
            try {
              await writeFile(`${base}.txt`, job.content, { mode: 0o600 });
              return await sendWindows(`${base}.txt`, target);
            } finally {
              await unlink(`${base}.txt`).catch(() => undefined);
            }
          }))
      )({ ...verified, authorization: job.authorization });
    },
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
    // Chrome asks before a public HTTPS page may reach a loopback service.
    if (request.headers["access-control-request-private-network"] === "true")
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    if (request.method === "OPTIONS") return reply(204, {});
    if (request.url === "/health" && request.method === "GET")
      return reply(200, {
        ok: true,
        paired: true,
        machineName: hostname(),
        version: BRIDGE_VERSION,
        authorizationVersions: [1, 2],
        renderingModes: ["TEXT_ESC_POS", "RASTER_ESC_POS"],
        rasterCommands: ["GS_V_0"],
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
      if (request.method === "GET" && request.url === "/jobs")
        return reply(200, { jobs: store.list() });
      if (request.method === "GET" && request.url === "/printers") {
        try {
          const printers = await discoverPrinters();
          return reply(200, {
            bridgeId: config.bridgeId,
            tenantId: config.tenantId,
            branchId: config.branchId,
            printers,
          });
        } catch {
          return reply(503, { code: "PRINTER_DISCOVERY_UNAVAILABLE" });
        }
      }
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
      const job = {
        ...verifyPrintAuthorization(body.authorization, config),
        authorization: body.authorization,
      };
      const row = store.enqueue(job);
      if (
        body.retry === true &&
        ["NOT_SENT", "UNCERTAIN"].includes(row.stage) &&
        row.recovery_id !== job.recoveryId
      )
        store.retry(job.id, job.recoveryId, job);
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

async function runFromConfigFile() {
  const config = JSON.parse(
    readFileSync(
      process.env.SERAMET_BRIDGE_CONFIG ??
        join(process.cwd(), "local-print-bridge/config.local.json"),
      "utf8",
    ).replace(/^\uFEFF/, ""),
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

// The packaged Windows bridge bundles this module; only a direct `node server.mjs` runs it.
if (!isSea() && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void runFromConfigFile();
