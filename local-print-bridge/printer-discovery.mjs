import { execFile } from "node:child_process";

const command =
  "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; Get-Printer -ErrorAction Stop | Select-Object Name,DriverName,PrinterStatus | ConvertTo-Json -Compress";

export function createPrinterDiscovery({
  platform = process.platform,
  execute = execFile,
  now = Date.now,
} = {}) {
  let pending;
  let cached;
  let checkedAt = 0;
  return async () => {
    if (platform !== "win32") throw new Error("WINDOWS_PRINTER_DISCOVERY_UNAVAILABLE");
    if (cached && now() - checkedAt < 5000) return cached;
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      execute(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 5000, maxBuffer: 131072, shell: false },
        (error, stdout) => {
          if (error) {
            reject(new Error("PRINTER_DISCOVERY_UNAVAILABLE"));
            return;
          }
          try {
            const value = String(stdout)
              .replace(/^\uFEFF/, "")
              .trim();
            const parsed = value ? JSON.parse(value) : [];
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            if (rows.length > 256) throw new Error("Inventory too large");
            const printers = rows.map((row) => {
              if (
                typeof row?.Name !== "string" ||
                !row.Name.trim() ||
                row.Name.length > 512 ||
                /[\x00-\x1f\x7f]/.test(row.Name)
              )
                throw new Error("Invalid printer name");
              return {
                name: row.Name,
                driver: typeof row.DriverName === "string" ? row.DriverName.slice(0, 512) : "",
                reportedStatus: String(row.PrinterStatus ?? "UNKNOWN"),
                physicalStatus: "UNKNOWN",
              };
            });
            cached = printers;
            checkedAt = now();
            resolve(printers);
          } catch {
            reject(new Error("PRINTER_DISCOVERY_UNAVAILABLE"));
          }
        },
      );
    }).finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
