import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { BRIDGE_VERSION, createBridge } from "./server.mjs";

// Only these Seramet origins may pair an unpaired bridge. The enrollment must
// also name that same origin's consume endpoint, so a page can only bind the
// bridge to its own server.
export const DEFAULT_PAIRING_ORIGINS = ["https://pos.seramet.co.ke"];
const MAX_PAIRING_BODY = 16_384;

export function readBridgeConfig(configPath) {
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, "utf8").replace(/^﻿/, ""));
}

async function writeBridgeConfig(configPath, config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
  await rename(temporary, configPath);
}

const text = (value, min, max) =>
  typeof value === "string" && value.length >= min && value.length <= max;

export function pairingConfig(body, origin, { port, dataDir }) {
  if (
    !body ||
    typeof body !== "object" ||
    !text(body.bridgeId, 8, 160) ||
    !text(body.tenantId, 1, 200) ||
    !text(body.branchId, 1, 200) ||
    !text(body.signingKey, 32, 512) ||
    !text(body.token, 32, 256) ||
    !/^[\x21-\x7e]+$/.test(body.token) ||
    body.authorizationEndpoint !== `${origin}/api/seramet/printing/consume`
  )
    throw new Error("INVALID_PAIRING");
  return {
    host: "127.0.0.1",
    port,
    token: body.token,
    signingKey: body.signingKey,
    bridgeId: body.bridgeId,
    tenantId: body.tenantId,
    branchId: body.branchId,
    authorizationEndpoint: body.authorizationEndpoint,
    concurrency: 2,
    dataDir,
    allowedOrigins: [origin],
  };
}

function tokenMatches(request, token) {
  const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "");
  const secret = Buffer.from(token);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

/**
 * Runs the bridge from `configPath`, or waits unpaired until a Seramet page
 * pairs it. Pairing swaps the bridge in place; the listening port never changes.
 */
export async function startBridgeService({
  configPath,
  dataDir,
  port = 48777,
  pairingOrigins = DEFAULT_PAIRING_ORIGINS,
  localTest = false,
  bridgeOptions = {},
  log = () => undefined,
}) {
  const origins = new Set(pairingOrigins);
  const open = (config) => createBridge(config, { localTest, ...bridgeOptions });
  let config = readBridgeConfig(configPath);
  let bridge = config ? await open(config) : null;
  let pairing = Promise.resolve();

  const pair = async (body, origin) => {
    const next = pairingConfig(body, origin, { port, dataDir });
    const previous = { bridge, config };
    // One bridge owns the job store at a time: close the old one before opening the new.
    if (bridge) await bridge.close();
    bridge = null;
    try {
      bridge = await open(next);
    } catch (error) {
      if (previous.config) bridge = await open(previous.config).catch(() => null);
      throw error;
    }
    await writeBridgeConfig(configPath, next);
    config = next;
    log(`Paired as ${next.bridgeId} for ${origin}`);
  };

  const server = createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    const isPairing = request.url === "/pair";
    if (bridge && !isPairing) return bridge.server.emit("request", request, response);

    const origin = request.headers.origin;
    if (!origin || !origins.has(origin)) return reply(403, { code: "ORIGIN_DENIED" });
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (request.headers["access-control-request-private-network"] === "true")
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    if (request.method === "OPTIONS") return reply(204, {});
    if (request.method === "GET" && request.url === "/health")
      return reply(200, {
        ok: true,
        paired: false,
        machineName: hostname(),
        version: BRIDGE_VERSION,
        platform: process.platform,
      });
    if (!isPairing || request.method !== "POST") return reply(503, { code: "BRIDGE_NOT_PAIRED" });
    // A paired bridge only re-pairs for whoever holds its current token.
    if (config && !tokenMatches(request, config.token))
      return reply(409, { code: "ALREADY_PAIRED" });
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_PAIRING_BODY) return reply(413, { code: "PAYLOAD_TOO_LARGE" });
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply(400, { code: "INVALID_PAIRING" });
    }
    const attempt = pairing.then(() => pair(body, origin));
    pairing = attempt.catch(() => undefined);
    try {
      await attempt;
      return reply(200, { paired: true, bridgeId: config.bridgeId, machineName: hostname() });
    } catch (error) {
      log(`Pairing rejected: ${error.message}`);
      return reply(400, {
        code: error.message === "INVALID_PAIRING" ? "INVALID_PAIRING" : "PAIRING_FAILED",
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  return {
    server,
    get paired() {
      return Boolean(bridge);
    },
    get config() {
      return config;
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          log(`Seramet print bridge ${BRIDGE_VERSION} ready on 127.0.0.1:${port}`);
          resolve();
        });
      });
    },
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
      if (bridge) await bridge.close();
    },
  };
}
