import { mkdir, writeFile } from "node:fs/promises";

const target = process.argv[2] ?? "staging";
if (target !== "staging") {
  throw new Error("The file scanner may only be generated for protected staging");
}

const required = [
  "SERAMET_CLOUDFLARE_R2_BUCKET",
  "SERAMET_CLOUDFLARE_SCAN_QUEUE",
  "SERAMET_CLOUDFLARE_SCAN_DLQ",
  "SERAMET_CLOUDFLARE_WORKER_NAME",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing scanner configuration: ${missing.join(", ")}`);

const config = {
  $schema: "../node_modules/wrangler/config-schema.json",
  name: process.env.SERAMET_CLOUDFLARE_SCANNER_WORKER_NAME ?? "seramet-file-scanner-staging",
  main: "../scanner-worker/src/index.ts",
  compatibility_date: "2026-10-08",
  compatibility_flags: ["nodejs_compat"],
  r2_buckets: [
    {
      binding: "SERAMET_OBJECTS",
      bucket_name: process.env.SERAMET_CLOUDFLARE_R2_BUCKET,
    },
  ],
  services: [
    {
      binding: "SERAMET_APP",
      service: process.env.SERAMET_CLOUDFLARE_WORKER_NAME,
    },
  ],
  queues: {
    consumers: [
      {
        queue: process.env.SERAMET_CLOUDFLARE_SCAN_QUEUE,
        max_batch_size: 1,
        max_batch_timeout: 1,
        max_retries: 3,
        retry_delay: 30,
        max_concurrency: 1,
        dead_letter_queue: process.env.SERAMET_CLOUDFLARE_SCAN_DLQ,
      },
    ],
  },
  durable_objects: {
    bindings: [{ name: "CLAMAV", class_name: "ClamAvContainer" }],
  },
  exports: {
    ClamAvContainer: { type: "durable-object", storage: "sqlite" },
  },
  containers: [
    {
      class_name: "ClamAvContainer",
      scheduling_policy: "default",
      image: "../scanner-worker/Dockerfile",
      image_build_context: "../scanner-worker",
      instance_type: "standard-1",
      max_instances: 1,
    },
  ],
  observability: { enabled: true },
  vars: {
    SERAMET_ENVIRONMENT: "staging",
    SERAMET_SCANNER_ID: "seramet-clamav-staging",
    SERAMET_MAX_UPLOAD_BYTES: "10485760",
  },
};

await mkdir(".seramet", { recursive: true });
await writeFile(
  ".seramet/scanner.wrangler.generated.json",
  `${JSON.stringify(config, null, 2)}\n`,
  "utf8",
);
process.stdout.write("Generated protected staging scanner configuration\n");
