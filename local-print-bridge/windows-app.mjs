// Entry point of the packaged SerametPrintBridge.exe (a GUI-subsystem Node SEA).
//   (no arguments)  install or update for the signed-in Windows user, then start
//   --service       run the bridge in the background (started at sign-in)
//   --uninstall     stop, remove auto-start and delete the installed files
//   --silent        with install/uninstall: no message box or browser (automation)
import { execFile, spawn } from "node:child_process";
import { appendFileSync, renameSync, statSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_VERSION } from "./server.mjs";
import { DEFAULT_PAIRING_ORIGINS, startBridgeService } from "./service.mjs";

const APP_NAME = "Seramet Print Bridge";
const EXE_NAME = "SerametPrintBridge.exe";
const PORT = 48777;
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const UNINSTALL_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SerametPrintBridge";
const SERAMET_PRINTERS_URL = "https://pos.seramet.co.ke/seramet-printers";

const installDir = join(process.env.LOCALAPPDATA ?? process.cwd(), "Seramet", "PrintBridge");
const installedExe = join(installDir, EXE_NAME);
const logPath = join(installDir, "bridge.log");
const silent = process.argv.includes("--silent");

function log(message) {
  try {
    if (statSync(logPath, { throwIfNoEntry: false })?.size > 1_000_000)
      renameSync(logPath, `${logPath}.1`);
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* Logging must never stop printing. */
  }
}

const run = (file, args) =>
  new Promise((resolve) =>
    execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout) =>
      resolve({ ok: !error, stdout: String(stdout ?? "") }),
    ),
  );

// The exe has no console window, so the installer talks through message boxes.
function messageBox(text, icon = "Information") {
  if (silent) return Promise.resolve({ ok: true, stdout: "" });
  const quoted = (value) => `'${value.replace(/'/g, "''")}'`;
  return run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${quoted(text)}, ${quoted(APP_NAME)}, 'OK', '${icon}') | Out-Null`,
  ]);
}

const regAdd = (key, name, value, type = "REG_SZ") =>
  run("reg.exe", ["add", key, "/v", name, "/t", type, "/d", value, "/f"]);

async function stopOtherInstances() {
  await run("taskkill.exe", ["/F", "/IM", EXE_NAME, "/FI", `PID ne ${process.pid}`]);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function bridgeHealthy() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    // An unpaired bridge refuses origin-less callers it cannot vouch for; any answer means it runs.
    return response.status === 200 || response.status === 403;
  } catch {
    return false;
  }
}

async function install() {
  await mkdir(installDir, { recursive: true });
  if (process.execPath.toLowerCase() !== installedExe.toLowerCase()) {
    await stopOtherInstances();
    let copied = false;
    for (let attempt = 0; attempt < 5 && !copied; attempt += 1) {
      try {
        await copyFile(process.execPath, installedExe);
        copied = true;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  const command = `"${installedExe}" --service`;
  const registered = [
    await regAdd(RUN_KEY, "SerametPrintBridge", command),
    await regAdd(UNINSTALL_KEY, "DisplayName", APP_NAME),
    await regAdd(UNINSTALL_KEY, "DisplayVersion", BRIDGE_VERSION),
    await regAdd(UNINSTALL_KEY, "Publisher", "Seramet"),
    await regAdd(UNINSTALL_KEY, "DisplayIcon", installedExe),
    await regAdd(UNINSTALL_KEY, "InstallLocation", installDir),
    await regAdd(UNINSTALL_KEY, "UninstallString", `"${installedExe}" --uninstall`),
    await regAdd(UNINSTALL_KEY, "NoModify", "1", "REG_DWORD"),
    await regAdd(UNINSTALL_KEY, "NoRepair", "1", "REG_DWORD"),
  ];
  if (registered.some((result) => !result.ok))
    throw new Error("Windows did not accept the auto-start setting.");
  if (!(await bridgeHealthy())) {
    spawn(installedExe, ["--service"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    let healthy = false;
    for (let attempt = 0; attempt < 20 && !healthy; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      healthy = await bridgeHealthy();
    }
    if (!healthy) throw new Error(`The bridge did not start. Details are in ${logPath}.`);
  }
  log(`Installed ${BRIDGE_VERSION}`);
  if (!silent) await run("cmd.exe", ["/c", "start", "", SERAMET_PRINTERS_URL]);
  await messageBox(
    `${APP_NAME} ${BRIDGE_VERSION} is installed and running. It starts automatically when you sign in to Windows.\n\n` +
      `Next: in Seramet open Printers & devices and click "Connect this PC".`,
  );
}

async function uninstall() {
  await stopOtherInstances();
  await run("reg.exe", ["delete", RUN_KEY, "/v", "SerametPrintBridge", "/f"]);
  await run("reg.exe", ["delete", UNINSTALL_KEY, "/f"]);
  await messageBox(`${APP_NAME} was removed from this computer.`);
  // A running exe cannot delete itself; remove the folder once this process exits.
  spawn("cmd.exe", ["/c", `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${installDir}"`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

async function service() {
  await mkdir(installDir, { recursive: true });
  const extraOrigins = (process.env.SERAMET_BRIDGE_PAIRING_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const bridge = await startBridgeService({
    configPath: join(installDir, "config.json"),
    dataDir: join(installDir, "data"),
    port: PORT,
    pairingOrigins: [...DEFAULT_PAIRING_ORIGINS, ...extraOrigins],
    log,
  });
  try {
    await bridge.listen();
  } catch (error) {
    // Already running for this user (e.g. started twice at sign-in): nothing to do.
    log(`Not started: ${error.code ?? error.message}`);
    await bridge.close().catch(() => undefined);
    process.exit(0);
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => void bridge.close().finally(() => process.exit(0)));
}

export async function main(args = process.argv.slice(1)) {
  try {
    if (process.platform !== "win32") throw new Error(`${APP_NAME} runs on Windows only.`);
    if (args.includes("--service")) return await service();
    if (args.includes("--uninstall")) return await uninstall();
    return await install();
  } catch (error) {
    log(`Failed: ${error.stack ?? error.message}`);
    await messageBox(`${APP_NAME} could not finish.\n\n${error.message}`, "Error");
    process.exitCode = 1;
  }
}

void main();
