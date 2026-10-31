// Builds the one-file Windows installer/service: .seramet/print-bridge/SerametPrintBridge.exe
// A Node single executable application (SEA) carrying local-print-bridge/windows-app.mjs.
// Run on Windows with the Node version to embed (CI uses Node 24): npm run bridge:build
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { rolldown } from "rolldown";

if (process.platform !== "win32") throw new Error("Build the Windows bridge on Windows.");
const out = resolve(".seramet/print-bridge");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bundlePath = join(out, "bridge.cjs");
const blobPath = join(out, "sea-prep.blob");
const exePath = join(out, "SerametPrintBridge.exe");

const peHeader = (image) => {
  const pe = image.readUInt32LE(0x3c);
  if (image.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("Not a PE image");
  if (image.readUInt16LE(pe + 24) !== 0x20b) throw new Error("Expected a 64-bit PE image");
  return pe;
};

const bundle = await rolldown({ input: "local-print-bridge/windows-app.mjs", platform: "node" });
await bundle.write({ file: bundlePath, format: "cjs" });
await bundle.close();

writeFileSync(
  join(out, "sea-config.json"),
  JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  }),
);
execFileSync(process.execPath, ["--experimental-sea-config", join(out, "sea-config.json")], {
  stdio: "inherit",
});

copyFileSync(process.execPath, exePath);
// Injection would invalidate node.exe's Authenticode signature; remove it cleanly first.
{
  const image = readFileSync(exePath);
  const security = peHeader(image) + 24 + 112 + 4 * 8;
  const offset = image.readUInt32LE(security);
  const size = image.readUInt32LE(security + 4);
  if (size) {
    if (offset + size !== image.length) throw new Error("Unexpected certificate table position");
    image.writeUInt32LE(0, security);
    image.writeUInt32LE(0, security + 4);
    writeFileSync(exePath, image.subarray(0, offset));
  }
}
execFileSync(
  "npx",
  [
    "--yes",
    "postject@1.0.0-alpha.6",
    exePath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { stdio: "inherit", shell: true },
);

// Mark the image as a GUI application so the background service has no console window.
const image = readFileSync(exePath);
const subsystem = peHeader(image) + 24 + 68;
if (image.readUInt16LE(subsystem) !== 3) throw new Error("Expected a console-subsystem node.exe");
image.writeUInt16LE(2, subsystem);
writeFileSync(exePath, image);
console.log(`Built ${exePath} with Node ${process.version}`);
