import { Socket } from "node:net";
import { execFile } from "node:child_process";
import { resolvePrinterTarget } from "./printer-target.mjs";

export async function deliverWithFallback(job, send) {
  const primary = await send(job.target, job.profile);
  if (primary.stage !== "NOT_SENT" || !job.fallbackTarget) return primary;
  const fallback = await send(job.fallbackTarget, job.fallbackProfile);
  return { ...fallback, code: `FALLBACK_${fallback.code}` };
}

export async function sendTcp(bytes, target, options = {}) {
  let timer;
  let endpoint;
  try {
    endpoint = await Promise.race([
      resolvePrinterTarget(target, options),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("RESOLUTION_TIMEOUT")),
          options.connectMs ?? 3000,
        );
      }),
    ]);
  } catch {
    return { stage: "NOT_SENT", code: "DESTINATION_OR_DNS_FAILED", printerStatus: "UNKNOWN" };
  } finally {
    clearTimeout(timer);
  }
  return new Promise((resolve) => {
    const socket = options.socketFactory?.() ?? new Socket();
    let submitted = false;
    let done = false;
    const finish = (stage, code) => {
      if (done) return;
      done = true;
      clearTimeout(overall);
      clearTimeout(connectTimer);
      socket.destroy();
      resolve({ stage, code, printerStatus: "UNKNOWN" });
    };
    const fail = (code) => finish(submitted ? "UNCERTAIN" : "NOT_SENT", code);
    const overall = setTimeout(() => fail("OVERALL_TIMEOUT"), options.overallMs ?? 15000);
    const connectTimer = setTimeout(() => fail("CONNECT_TIMEOUT"), options.connectMs ?? 3000);
    socket.setTimeout(options.writeMs ?? 5000);
    socket.on("timeout", () => fail("WRITE_TIMEOUT"));
    socket.on("error", () => fail("CONNECTION_FAILED"));
    socket.on("close", () => {
      if (!done) fail("CONNECTION_CLOSED");
    });
    socket.connect(endpoint, () => {
      clearTimeout(connectTimer);
      submitted = true;
      // end(buffer) handles writable backpressure and sends FIN after the buffer.
      socket.end(bytes, () => finish("BYTES_SUBMITTED", "WRITE_COMPLETE"));
    });
  });
}

export function sendWindows(filePath, target, options = {}) {
  if (target.transport !== "WINDOWS" || !target.osPrinterName?.trim()) {
    throw new Error("INVALID_OS_PRINTER");
  }
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  return new Promise((resolve) => {
    (options.exec ?? execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-Content -Raw -LiteralPath ${quote(filePath)} | Out-Printer -Name ${quote(target.osPrinterName)}`,
      ],
      { windowsHide: true, timeout: options.overallMs ?? 15000, maxBuffer: 64000 },
      (error) =>
        resolve({
          stage: error ? "UNCERTAIN" : "SPOOL_ACCEPTED",
          code: error ? "SPOOL_SUBMISSION_UNCONFIRMED" : "SPOOL_SUBMITTED",
          printerStatus: "UNKNOWN",
        }),
    );
  });
}
