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

// Receipt printers expect ESC/POS bytes. Handing them to the spooler as RAW keeps the
// printer's own monospace font, columns, bold and cutter, instead of letting a Windows
// driver typeset the text in a large proportional font. Exit code 2 means nothing
// reached the spooler, so a text fallback cannot duplicate the ticket.
const RAW_SPOOL_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class SerametRawSpool {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static int Send(string printer, byte[] bytes) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) return 2;
    try {
      if (StartDocPrinter(handle, 1, new DocInfo { pDocName = "Seramet", pDataType = "RAW" }) == 0) return 2;
      try {
        StartPagePrinter(handle);
        int written;
        if (!WritePrinter(handle, bytes, bytes.Length, out written) || written != bytes.Length)
          throw new Win32Exception();
        EndPagePrinter(handle);
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
    return 0;
  }
}
'@
exit ([SerametRawSpool]::Send($env:SERAMET_PRINTER_NAME, [IO.File]::ReadAllBytes($env:SERAMET_PRINT_FILE)))`;

export function sendWindowsRaw(filePath, target, options = {}) {
  if (target.transport !== "WINDOWS" || !target.osPrinterName?.trim()) {
    throw new Error("INVALID_OS_PRINTER");
  }
  return new Promise((resolve) => {
    (options.exec ?? execFile)(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", RAW_SPOOL_SCRIPT],
      {
        windowsHide: true,
        // Compiling the spooler helper adds a few seconds on a cold PC.
        timeout: options.overallMs ?? 30000,
        maxBuffer: 64000,
        // Names and paths travel as environment values, never as script text.
        env: {
          ...process.env,
          SERAMET_PRINTER_NAME: target.osPrinterName,
          SERAMET_PRINT_FILE: filePath,
        },
      },
      (error) =>
        resolve(
          !error
            ? { stage: "SPOOL_ACCEPTED", code: "SPOOL_SUBMITTED", printerStatus: "UNKNOWN" }
            : error.code === 2
              ? { stage: "NOT_SENT", code: "RAW_SPOOL_UNAVAILABLE", printerStatus: "UNKNOWN" }
              : {
                  stage: "UNCERTAIN",
                  code: "SPOOL_SUBMISSION_UNCONFIRMED",
                  printerStatus: "UNKNOWN",
                },
        ),
    );
  });
}
