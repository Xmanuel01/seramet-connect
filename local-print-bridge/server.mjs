#!/usr/bin/env node
import { createServer } from "node:http";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const configPath =
  process.env.SERAMET_BRIDGE_CONFIG ||
  join(process.cwd(), "local-print-bridge", "config.local.json");
const config = loadConfig(configPath);
const host = process.env.SERAMET_BRIDGE_HOST || config.host || "127.0.0.1";
const port = Number(process.env.SERAMET_BRIDGE_PORT || config.port || 48777);
const token = process.env.SERAMET_BRIDGE_TOKEN || config.token;
const dataDir =
  process.env.SERAMET_BRIDGE_DATA_DIR || config.dataDir || join(homedir(), ".seramet-print-bridge");
const dryRun = String(process.env.SERAMET_BRIDGE_DRY_RUN ?? config.dryRun ?? "false") === "true";
const allowedOrigins = new Set(
  (
    config.allowedOrigins ?? [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:5178",
      "http://localhost:5178",
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ]
  ).map((origin) => String(origin).replace(/\/$/, "")),
);

if (!token || token.length < 16) {
  console.error("SERAMET_BRIDGE_TOKEN must be set to a secret value of at least 16 characters.");
  process.exit(1);
}

await mkdir(dataDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    setCors(request, response);
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }
    if (request.url === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        id: "SERAMET-BRIDGE-LOCAL",
        ok: true,
        dryRun,
        platform: platform(),
        version: "1.0.0",
      });
      return;
    }
    if (!isAuthorized(request)) {
      await logEvent("rejected", { reason: "unauthorized", remote: request.socket.remoteAddress });
      sendJson(response, 401, { accepted: false, message: "Unauthorized bridge request" });
      return;
    }
    if (request.url === "/printers" && request.method === "GET") {
      sendJson(response, 200, { printers: await discoverPrinters() });
      return;
    }
    if (request.url === "/jobs" && request.method === "POST") {
      const body = await readJson(request);
      const validation = validateJob(body);
      if (!validation.valid) {
        await logEvent("rejected", {
          reason: validation.message,
          jobId: body?.id,
          orderId: body?.orderId,
          documentType: body?.documentType,
        });
        sendJson(response, 400, { accepted: false, message: validation.message });
        return;
      }
      const bridgeJobId = randomUUID();
      const spoolPath = join(dataDir, `${bridgeJobId}.txt`);
      await writeFile(spoolPath, body.content, "utf8");
      const result = dryRun
        ? { printed: true, command: "dry-run", message: "Job spooled but not sent to OS printer" }
        : await printSpoolFile(spoolPath, body.printerName || body.printerId);
      await logEvent(result.printed ? "printed" : "failed", {
        bridgeJobId,
        printer: body.printerName || body.printerId,
        documentType: body.documentType,
        orderId: body.orderId,
        spoolPath,
        result,
      });
      sendJson(response, result.printed ? 202 : 502, {
        accepted: result.printed,
        bridgeJobId,
        spoolPath,
        message: result.message,
      });
      return;
    }
    sendJson(response, 404, { accepted: false, message: "Unknown Seramet bridge endpoint" });
  } catch (error) {
    await logEvent("error", { message: error instanceof Error ? error.message : String(error) });
    sendJson(response, 500, { accepted: false, message: "Seramet bridge internal error" });
  }
});

server.listen(port, host, () => {
  console.log(`Seramet Print Bridge listening on http://${host}:${port}`);
});

function loadConfig(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function isAuthorized(request) {
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  return bearer === token || request.headers["x-seramet-bridge-token"] === token;
}

function validateJob(job) {
  if (!job || typeof job !== "object") return { valid: false, message: "Invalid JSON print job" };
  if (!job.id || !job.orderId || !job.documentType)
    return { valid: false, message: "Missing job identity fields" };
  if (!job.printerId && !job.printerName)
    return { valid: false, message: "Missing printer target" };
  if (typeof job.content !== "string" || !job.content.trim())
    return { valid: false, message: "Missing printable content" };
  if (job.content.length > 128_000)
    return { valid: false, message: "Print job content is too large" };
  return { valid: true, message: "Ready" };
}

async function discoverPrinters() {
  if (platform() === "win32") {
    const output = await exec("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Printer | Select-Object Name,PrinterStatus,WorkOffline | ConvertTo-Json -Compress",
    ]);
    const parsed = JSON.parse(output || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map((printer) => ({
      name: printer.Name,
      status: printer.WorkOffline ? "Offline" : "Available",
      rawStatus: printer.PrinterStatus,
    }));
  }
  const output = await exec("lpstat", ["-e"]).catch(() => "");
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((name) => ({ name, status: "Available" }));
}

async function printSpoolFile(filePath, printerName) {
  try {
    if (platform() === "win32") {
      if (printerName) {
        await exec("powershell.exe", [
          "-NoProfile",
          "-Command",
          `Get-Content -Raw -LiteralPath ${quotePs(filePath)} | Out-Printer -Name ${quotePs(printerName)}`,
        ]);
        return {
          printed: true,
          command: "Out-Printer -Name",
          message: `Sent to Windows printer ${printerName}`,
        };
      }
      await exec("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath ${quotePs(filePath)} -Verb Print -WindowStyle Hidden`,
      ]);
      return {
        printed: true,
        command: "Start-Process -Verb Print",
        message: "Sent to the Windows default printer",
      };
    }
    const args = printerName ? ["-d", printerName, filePath] : [filePath];
    await exec("lp", args);
    return { printed: true, command: "lp", message: "Sent to CUPS print spooler" };
  } catch (error) {
    return {
      printed: false,
      command: platform() === "win32" ? "powershell" : "lp",
      message: error.message,
    };
  }
}

function exec(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 256_000) throw new Error("Print job request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(status === 204 ? "" : JSON.stringify(payload));
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin.replace(/\/$/, ""))) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Seramet-Bridge-Token",
  );
}

async function logEvent(type, payload) {
  await appendFile(
    join(dataDir, "bridge-events.jsonl"),
    JSON.stringify({ type, at: new Date().toISOString(), ...payload }) + "\n",
  );
}

function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
