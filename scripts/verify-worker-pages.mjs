import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Exercise SSR in workerd, not Node: their module-scope I/O rules differ.
// Pin the emulator baseline supported by Wrangler 4.86.0; deployment config is untouched.
const args = [
  "dev",
  "--local",
  "--config",
  ".output/server/wrangler.json",
  "--compatibility-date",
  "2026-05-03",
  "--port",
  "9898",
  "--ip",
  "127.0.0.1",
];
const child = process.argv[2]
  ? spawn(process.execPath, [process.argv[2], ...args], { stdio: "pipe" })
  : spawn("wrangler", args, { stdio: "pipe" });
let logs = "";
let spawnError;
child.on("error", (error) => {
  spawnError = error;
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    logs = (logs + chunk).slice(-32000);
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error("Local Worker exited before readiness");
    try {
      const response = await fetch("http://127.0.0.1:9898/api/seramet/health/live", {
        signal: AbortSignal.timeout(2000),
      });
      ready = response.status === 200;
      if (ready) break;
    } catch {
      /* Wait for the local runtime to listen. */
    }
    await delay(1000);
  }
  assert.ok(ready, "Local Worker must become ready");
  for (const [path, heading] of [
    ["/", "Seramet"],
    ["/login?account=1", "Administrator sign in"],
    ["/pos-login", "Seramet"],
    ["/staff-login", "Staff account sign in"],
    ["/register", "Checking your account"],
  ]) {
    const requestedUrl = `http://127.0.0.1:9898${path}`;
    const response = await fetch(requestedUrl, {
      signal: AbortSignal.timeout(20000),
    });
    const html = await response.text();
    assert.equal(response.status, 200, `${path} must render in workerd`);
    assert.equal(response.redirected, false, `${path} must not redirect`);
    assert.equal(response.url, requestedUrl, `${path} must remain on its route`);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(
      html,
      new RegExp(`<h1[^>]*>\\s*${heading}\\s*</h1>`),
      `${path} must render its heading`,
    );
    assert.ok(
      !html.includes("This page didn&#x27;t load") && !html.includes("This page didn't load"),
      `${path} must not render the error boundary`,
    );
    console.info(`WORKER_PAGE_PASS ${path}`);
  }
  const defaultLogin = await fetch("http://127.0.0.1:9898/login", { redirect: "manual" });
  assert.ok([301, 302, 303, 307, 308].includes(defaultLogin.status));
  assert.equal(
    new URL(defaultLogin.headers.get("location"), "http://127.0.0.1:9898").pathname,
    "/pos-login",
  );
  assert.ok(
    !logs.includes("Disallowed operation called within global scope"),
    "No module-scope runtime operations",
  );
} finally {
  child.kill();
  if (child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
