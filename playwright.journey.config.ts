import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Full-day journey: a real owner sign-up through business-day close against a
// disposable local Seramet. Supabase Auth is replaced by a local HTTPS stand-in
// (scripts/e2e/fake-supabase-auth.mjs); everything else is the real app.
const directory = resolve(".seramet/journey");
const keyFile = resolve(directory, "auth-key.pem");
const certFile = resolve(directory, "auth-cert.pem");
const trustFile = resolve(directory, "trust.pem");
export const journeyAuthPort = 54329;
mkdirSync(directory, { recursive: true });
if (!existsSync(certFile))
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    keyFile,
    "-out",
    certFile,
  ]);
// The dev server trusts the stand-in's certificate as well as the usual roots.
const extra = process.env.NODE_EXTRA_CA_CERTS;
writeFileSync(
  trustFile,
  [
    extra && existsSync(extra) ? readFileSync(extra, "utf8") : "",
    readFileSync(certFile, "utf8"),
  ].join("\n"),
);

export default defineConfig({
  testDir: "./tests/journey",
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: ".seramet/journey/results.json" }]],
  globalSetup: "./tests/journey/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "off",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/login",
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      SERAMET_ENVIRONMENT: "development",
      SERAMET_ENABLE_LOCAL_DATABASE: "true",
      SERAMET_IDENTITY_PROVIDER: "supabase",
      SERAMET_SUPABASE_URL: `https://127.0.0.1:${journeyAuthPort}`,
      SERAMET_SUPABASE_PUBLISHABLE_KEY: "journey-publishable-key",
      SERAMET_JWT_SECRET: "seramet-journey-disposable-jwt-secret",
      SERAMET_JWT_ISSUER: "seramet-journey",
      SERAMET_JWT_AUDIENCE: "seramet-journey-browser",
      SERAMET_PRINT_SIGNING_KEY: "journey-print-signing-key-0123456789abcdef0123456789",
      NODE_EXTRA_CA_CERTS: trustFile,
      CI: "true",
    },
  },
});
