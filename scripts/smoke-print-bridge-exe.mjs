// Installs, pairs, queries and uninstalls the built SerametPrintBridge.exe on a
// disposable Windows CI runner. It writes HKCU auto-start keys, so CI only.
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

if (process.platform !== "win32" || process.env.CI !== "true")
  throw new Error("Run the print bridge installer smoke test on a disposable Windows CI runner.");
const exe = resolve(".seramet/print-bridge/SerametPrintBridge.exe");
const localAppData = mkdtempSync(join(tmpdir(), "seramet-bridge-smoke-"));
const env = { ...process.env, LOCALAPPDATA: localAppData };
const installed = join(localAppData, "Seramet", "PrintBridge", "SerametPrintBridge.exe");
const origin = "https://pos.seramet.co.ke";
const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const base = "http://127.0.0.1:48777";

const runExe = (path, args) =>
  new Promise((resolvePromise, reject) =>
    execFile(path, args, { env, timeout: 60000 }, (error) =>
      error ? reject(error) : resolvePromise(),
    ),
  );
const call = (path, init = {}) =>
  fetch(base + path, { ...init, headers: { Origin: origin, ...init.headers } });
const autoStart = () => {
  try {
    return execFileSync("reg.exe", ["query", runKey, "/v", "SerametPrintBridge"], {
      encoding: "utf8",
    });
  } catch {
    return "";
  }
};

await runExe(exe, ["--silent"]);
assert.ok(existsSync(installed), "installed exe");
assert.match(autoStart(), /SerametPrintBridge\.exe" --service/);
const health = await (await call("/health")).json();
assert.equal(health.paired, false);
assert.equal((await call("/health", { headers: { Origin: "https://evil.example" } })).status, 403);

const token = randomBytes(32).toString("hex");
const pair = await call("/pair", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    bridgeId: "ci-smoke-bridge",
    tenantId: "tenant",
    branchId: "branch",
    signingKey: randomBytes(32).toString("hex"),
    authorizationEndpoint: `${origin}/api/seramet/printing/consume`,
    token,
  }),
});
assert.equal(pair.status, 200);
const printers = await call("/printers", { headers: { Authorization: `Bearer ${token}` } });
assert.equal(printers.status, 200);
console.log("Printers visible to the bridge:", (await printers.json()).printers.length);

// Installing again (an update) keeps the pairing.
await runExe(exe, ["--silent"]);
assert.equal((await (await call("/health")).json()).bridgeId, "ci-smoke-bridge");

await runExe(installed, ["--uninstall", "--silent"]);
assert.equal(autoStart(), "");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
await assert.rejects(call("/health"));
console.log("Print bridge install, pair, update and uninstall passed");
