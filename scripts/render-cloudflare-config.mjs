import { mkdir, writeFile } from "node:fs/promises";

const target = process.argv[2] ?? "staging";
if (!new Set(["staging", "production"]).has(target))
  throw new Error("Target must be staging or production");

const required = [
  "SERAMET_CLOUDFLARE_HYPERDRIVE_ID",
  "SERAMET_CLOUDFLARE_R2_BUCKET",
  "SERAMET_CLOUDFLARE_QUEUE",
  "SERAMET_CLOUDFLARE_DLQ",
  "SERAMET_MALWARE_SCANNER_SERVICE",
  "SERAMET_SUPABASE_URL",
  "SERAMET_SUPABASE_PUBLISHABLE_KEY",
  "SERAMET_PUBLIC_ORIGIN",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing deployment configuration: ${missing.join(", ")}`);

const origin = process.env.SERAMET_PUBLIC_ORIGIN.replace(/\/$/, "");
if (!origin.startsWith("https://")) throw new Error("SERAMET_PUBLIC_ORIGIN must use HTTPS");
const config = {
  $schema: "node_modules/wrangler/config-schema.json",
  name: process.env.SERAMET_CLOUDFLARE_WORKER_NAME ?? `seramet-${target}`,
  main: ".output/server/index.mjs",
  compatibility_date: "2026-09-10",
  compatibility_flags: ["nodejs_compat"],
  no_bundle: true,
  assets: { binding: "ASSETS", directory: ".output/public" },
  hyperdrive: [{ binding: "SERAMET_HYPERDRIVE", id: process.env.SERAMET_CLOUDFLARE_HYPERDRIVE_ID }],
  r2_buckets: [
    { binding: "SERAMET_OBJECTS", bucket_name: process.env.SERAMET_CLOUDFLARE_R2_BUCKET },
  ],
  queues: {
    producers: [{ binding: "SERAMET_WORK_QUEUE", queue: process.env.SERAMET_CLOUDFLARE_QUEUE }],
    consumers: [
      {
        queue: process.env.SERAMET_CLOUDFLARE_QUEUE,
        max_batch_size: 10,
        max_retries: 5,
        dead_letter_queue: process.env.SERAMET_CLOUDFLARE_DLQ,
      },
    ],
  },
  services: [
    { binding: "SERAMET_MALWARE_SCANNER", service: process.env.SERAMET_MALWARE_SCANNER_SERVICE },
  ],
  triggers: { crons: ["*/1 * * * *"] },
  vars: {
    SERAMET_ENVIRONMENT: target,
    SERAMET_DATABASE_PROVIDER: "postgres",
    SERAMET_IDENTITY_PROVIDER: "supabase",
    SERAMET_REQUIRE_BEARER: "true",
    SERAMET_SECRET_STORE: "cloudflare-worker-secrets",
    SERAMET_ALLOW_TEST_PROVIDERS: "false",
    SERAMET_ENABLE_DEV_AUTH: "false",
    SERAMET_ENABLE_LOCAL_DATABASE: "false",
    SERAMET_SUPABASE_URL: process.env.SERAMET_SUPABASE_URL,
    SERAMET_SUPABASE_PUBLISHABLE_KEY: process.env.SERAMET_SUPABASE_PUBLISHABLE_KEY,
    SERAMET_PUBLIC_ORIGIN: origin,
    SERAMET_CALLBACK_BASE_URL: origin,
    SERAMET_ALLOWED_ORIGINS: process.env.SERAMET_ALLOWED_ORIGINS ?? origin,
    SERAMET_APP_VERSION: process.env.SERAMET_APP_VERSION ?? "0.6.0",
    SERAMET_BUILD_ID: process.env.SERAMET_BUILD_ID ?? "manual",
  },
};

await mkdir(".seramet", { recursive: true });
await writeFile(".seramet/wrangler.generated.json", `${JSON.stringify(config, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${target} Cloudflare configuration\n`);
