import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI === "true" ? "line" : "list",
  use: {
    baseURL: process.env.SERAMET_E2E_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.SERAMET_E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/login",
        timeout: 120_000,
        reuseExistingServer: false,
        env: {
          SERAMET_ENVIRONMENT: "development",
          SERAMET_ENABLE_DEV_AUTH: "true",
          SERAMET_ENABLE_LOCAL_DATABASE: "true",
          SERAMET_E2E_IMPORTS: "true",
          SERAMET_IDENTITY_PROVIDER: "internal",
          CI: "true",
          SERAMET_JWT_SECRET: "seramet-e2e-disposable-jwt-secret",
          SERAMET_JWT_ISSUER: "seramet-e2e",
          SERAMET_JWT_AUDIENCE: "seramet-e2e-browser",
        },
      },
});
