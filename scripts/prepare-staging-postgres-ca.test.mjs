import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tls from "node:tls";
import { prepareStagingRoot, validateStagingRoot } from "./prepare-staging-postgres-ca.mjs";

const directory = mkdtempSync(join(tmpdir(), "seramet-ca-test-"));
const openssl =
  process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
function generate(name, ca) {
  const args = [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-addext",
    `basicConstraints=critical,CA:${ca ? "TRUE" : "FALSE"}`,
    "-keyout",
    join(directory, `${name}.key`),
    "-out",
    join(directory, `${name}.crt`),
  ];
  const result = spawnSync(openssl, args, { windowsHide: true, stdio: "ignore" });
  assert.equal(result.status, 0, "OpenSSL must generate isolated test certificates");
  return readFileSync(join(directory, `${name}.crt`), "utf8");
}
const root = generate("root", true);
const nonRoot = generate("leaf", false);
const certificate = new X509Certificate(root);
const pin = certificate.fingerprint256.replaceAll(":", "");
test.after(() => rmSync(directory, { recursive: true, force: true }));

test("requires one valid, pinned, unexpired self-signed CA", () => {
  assert.equal(validateStagingRoot(root, pin), certificate.toString());
  for (const [pem, fingerprint, now] of [
    [undefined, pin],
    [root, undefined],
    [root + root, pin],
    ["secret-password", pin],
    [root, "0".repeat(64)],
    [nonRoot, new X509Certificate(nonRoot).fingerprint256.replaceAll(":", "")],
    [root, pin, Date.parse(certificate.validFrom) - 1],
    [root, pin, Date.parse(certificate.validTo)],
    [root, pin, Number.NaN],
  ]) {
    assert.throws(() => validateStagingRoot(pem, fingerprint, now), /^Error: STAGING_CA_/);
  }
});

test("preparation fails closed before file creation and exports only fixed runner paths", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    SERAMET_ENVIRONMENT: "staging",
    RUNNER_TEMP: directory,
    GITHUB_ENV: join(directory, "github-env"),
    SERAMET_STAGING_POSTGRES_CA_PEM: root,
    SERAMET_STAGING_POSTGRES_CA_SHA256: pin,
  };
  const path = join(directory, "seramet-staging-postgres-root.crt");
  assert.throws(() => prepareStagingRoot({ ...env, SERAMET_ENVIRONMENT: "production" }));
  assert.throws(() => prepareStagingRoot({ ...env, SERAMET_STAGING_POSTGRES_CA_SHA256: "bad" }));
  assert.throws(() => prepareStagingRoot({ ...env, RUNNER_TEMP: "relative" }));
  assert.equal(existsSync(path), false);
  prepareStagingRoot(env);
  assert.equal(readFileSync(path, "utf8"), certificate.toString());
  assert.equal(
    readFileSync(env.GITHUB_ENV, "utf8"),
    `NODE_EXTRA_CA_CERTS=${path}\nPGSSLROOTCERT=${path}\n`,
  );
  assert.throws(() => prepareStagingRoot(env), /EEXIST/);
});

test("Node startup trust accepts the pinned root but still rejects wrong trust and hostname", async (t) => {
  const server = tls.createServer(
    {
      key: readFileSync(join(directory, "root.key")),
      cert: root,
    },
    (socket) => socket.end(),
  );
  server.on("tlsClientError", () => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const probe = async (caPath, servername) => {
    const source = `const tls=require('node:tls');const s=tls.connect({host:'127.0.0.1',port:${port},servername:${JSON.stringify(servername)},rejectUnauthorized:true});s.setTimeout(3000,()=>s.destroy());s.on('secureConnect',()=>{s.end();process.exitCode=s.authorized?0:1});s.on('error',e=>{console.log(e.code);process.exitCode=1});`;
    const child = spawn(process.execPath, ["-e", source], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath, NODE_TLS_REJECT_UNAUTHORIZED: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
  };
  assert.equal((await probe(join(directory, "root.crt"), "localhost")).code, 0);
  assert.notEqual((await probe(join(directory, "leaf.crt"), "localhost")).code, 0);
  const wrongHost = await probe(join(directory, "root.crt"), "wrong.invalid");
  assert.equal(wrongHost.code, 1);
  assert.match(wrongHost.output, /ERR_TLS_CERT_ALTNAME_INVALID/);
});

test("CLI failure reports no certificate, URI, path or raw exception", () => {
  const result = spawnSync(process.execPath, ["scripts/prepare-staging-postgres-ca.mjs"], {
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      SERAMET_ENVIRONMENT: "staging",
      RUNNER_TEMP: directory,
      GITHUB_ENV: join(directory, "redacted-env"),
      SERAMET_STAGING_POSTGRES_CA_PEM: "postgresql://secret:password@private-host",
      SERAMET_STAGING_POSTGRES_CA_SHA256: pin,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "STAGING_CA_CONFIGURATION_INVALID");
  assert.equal(result.stdout, "");
});

test("all protected consumers prepare trust before connection without changing existing guards", () => {
  for (const [file, connection] of [
    ["staging-connectivity-diagnostic.yml", "node scripts/staging-connectivity-diagnostic.mjs"],
    ["staging-migration-27.yml", "node scripts/staging-migration-27-gate.mjs pre"],
    ["staging-incident-recovery.yml", "node scripts/create-staging-backup.mjs"],
  ]) {
    const workflow = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    const prepare = workflow.indexOf("run: node scripts/prepare-staging-postgres-ca.mjs");
    assert.ok(prepare > 0 && prepare < workflow.indexOf(connection));
    assert.match(workflow, /secrets\.SERAMET_STAGING_POSTGRES_CA_PEM/);
    assert.match(workflow, /vars\.SERAMET_STAGING_POSTGRES_CA_SHA256/);
    assert.match(workflow, /group: seramet-staging\s/);
    assert.doesNotMatch(workflow, /NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized: false/);
  }
});
