import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scannerDeploymentResources } from "./scanner-deployment-resources.mjs";

export function buildScannerCloudflareConfig(target, env) {
  const selected = scannerDeploymentResources(target, env);
  const image = env.SERAMET_SCANNER_IMAGE;
  if (
    image &&
    !/^registry\.cloudflare\.com\/8ee23e839ee7d7c26ae144aeac841c88\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(
      image,
    )
  ) {
    throw new Error(
      "Scanner image must be digest-pinned in the existing account's private registry",
    );
  }
  return {
    $schema: "../node_modules/wrangler/config-schema.json",
    name: selected.scanner,
    main: "../scanner-worker/src/index.ts",
    compatibility_date: "2026-10-08",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    r2_buckets: [
      {
        binding: "SERAMET_OBJECTS",
        bucket_name: selected.bucket,
      },
    ],
    services: [
      {
        binding: "SERAMET_APP",
        service: selected.worker,
      },
    ],
    queues: {
      consumers: [
        {
          queue: selected.scanQueue,
          max_batch_size: 1,
          max_batch_timeout: 1,
          max_retries: 3,
          retry_delay: 30,
          max_concurrency: 1,
          dead_letter_queue: selected.scanDlq,
        },
      ],
    },
    durable_objects: {
      bindings: [
        { name: "CLAMAV", class_name: "DurableClamAvScanner" },
        { name: "CLAMAV_LEGACY", class_name: "ClamAvContainer" },
      ],
    },
    exports: {
      ClamAvContainer: { type: "durable-object", storage: "sqlite" },
      DurableClamAvScanner: { type: "durable-object", storage: "sqlite" },
    },
    containers: [
      {
        class_name: "DurableClamAvScanner",
        name: `${selected.scanner}-engine-v2`,
        scheduling_policy: "durable_object",
        images: {
          clamav: image
            ? { image }
            : { dockerfile: "../scanner-worker/Dockerfile", build_context: "../scanner-worker" },
        },
      },
    ],
    observability: { enabled: true },
    vars: {
      SERAMET_ENVIRONMENT: target,
      SERAMET_SCANNER_ID: `seramet-clamav-${target}`,
      SERAMET_MAX_UPLOAD_BYTES: "10485760",
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = process.argv[2] ?? "staging";
  const config = buildScannerCloudflareConfig(target, process.env);
  await mkdir(".seramet", { recursive: true });
  await writeFile(
    ".seramet/scanner.wrangler.generated.json",
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`Generated protected ${target} scanner configuration\n`);
}
