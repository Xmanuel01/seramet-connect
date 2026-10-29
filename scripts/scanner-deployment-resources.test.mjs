import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScannerCloudflareConfig } from "./render-scanner-cloudflare-config.mjs";
import { assertPrimaryScannerResources } from "./scanner-deployment-resources.mjs";

const environments = {
  staging: {
    SERAMET_CLOUDFLARE_WORKER_NAME: "seramet-staging",
    SERAMET_CLOUDFLARE_R2_BUCKET: "seramet-staging-objects",
    SERAMET_CLOUDFLARE_SCAN_QUEUE: "seramet-staging-file-scan",
    SERAMET_CLOUDFLARE_SCAN_DLQ: "seramet-staging-file-scan-dlq",
  },
  production: {
    SERAMET_CLOUDFLARE_WORKER_NAME: "seramet-connect",
    SERAMET_CLOUDFLARE_R2_BUCKET: "seramet-production-objects",
    SERAMET_CLOUDFLARE_SCAN_QUEUE: "seramet-production-file-scan",
    SERAMET_CLOUDFLARE_SCAN_DLQ: "seramet-production-file-scan-dlq",
    SERAMET_CLOUDFLARE_HYPERDRIVE_ID: "4538af733065451c94d47beb2028390e",
    SERAMET_CLOUDFLARE_QUEUE: "seramet-production-live-work",
    SERAMET_CLOUDFLARE_DLQ: "seramet-production-live-dlq",
    SERAMET_SUPABASE_URL: "https://qnhqylslyhxjcksuhgyq.supabase.co",
    SERAMET_PUBLIC_ORIGIN: "https://pos.seramet.co.ke",
    SERAMET_BUILD_ID: "a".repeat(40),
  },
};

for (const target of ["staging", "production"]) {
  test(`${target} scanner has private, environment-specific resources and bounded retries`, () => {
    const config = buildScannerCloudflareConfig(target, environments[target]);
    assert.equal(config.name, `seramet-file-scanner-${target}`);
    assert.equal(config.services[0].service, environments[target].SERAMET_CLOUDFLARE_WORKER_NAME);
    assert.equal(config.r2_buckets[0].bucket_name, `seramet-${target}-objects`);
    assert.equal(config.vars.SERAMET_ENVIRONMENT, target);
    assert.equal(config.vars.SERAMET_SCANNER_ID, `seramet-clamav-${target}`);
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.deepEqual(config.queues.consumers, [
      {
        queue: `seramet-${target}-file-scan`,
        max_batch_size: 1,
        max_batch_timeout: 1,
        max_retries: 3,
        retry_delay: 30,
        max_concurrency: 1,
        dead_letter_queue: `seramet-${target}-file-scan-dlq`,
      },
    ]);
    assert.equal(config.containers[0].scheduling_policy, "durable_object");
    assert.equal(config.containers[0].class_name, "DurableClamAvScanner");
    assert.equal(config.containers[0].name, `seramet-file-scanner-${target}-engine-v2`);
    assert.deepEqual(config.containers[0].images.clamav, {
      dockerfile: "../scanner-worker/Dockerfile",
      build_context: "../scanner-worker",
    });
    assert.equal(Object.hasOwn(config.containers[0], "max_instances"), false);
    assert.equal(Object.hasOwn(config.containers[0], "instance_type"), false);
    assert.deepEqual(config.durable_objects.bindings, [
      { name: "CLAMAV", class_name: "DurableClamAvScanner" },
      { name: "CLAMAV_LEGACY", class_name: "ClamAvContainer" },
    ]);
    assert.equal(JSON.stringify(config).includes("EVIDENCE_SECRET"), false);
  });
  const other = target === "production" ? "staging" : "production";
  for (const name of Object.keys(environments.staging)) {
    test(`${target} rejects ${other} ${name}`, () => {
      assert.throws(
        () =>
          buildScannerCloudflareConfig(target, {
            ...environments[target],
            [name]: environments[other][name],
          }),
        /resource mismatch/,
      );
    });
  }
  test(`${target} rejects a cross-environment scanner Worker`, () => {
    assert.throws(
      () =>
        buildScannerCloudflareConfig(target, {
          ...environments[target],
          SERAMET_CLOUDFLARE_SCANNER_WORKER_NAME: `seramet-file-scanner-${other}`,
        }),
      /selected environment/,
    );
  });
}

test("scanner image promotion accepts only an immutable image in the existing account", () => {
  const image = `registry.cloudflare.com/8ee23e839ee7d7c26ae144aeac841c88/scanner@sha256:${"a".repeat(64)}`;
  const config = buildScannerCloudflareConfig("production", {
    ...environments.production,
    SERAMET_SCANNER_IMAGE: image,
  });
  assert.deepEqual(config.containers[0].images.clamav, { image });
  for (const value of [
    "clamav/clamav:latest",
    image.replace("8ee23e839ee7d7c26ae144aeac841c88", "another-account"),
    image.replace(/@sha256:.+$/, ":latest"),
  ]) {
    assert.throws(
      () =>
        buildScannerCloudflareConfig("production", {
          ...environments.production,
          SERAMET_SCANNER_IMAGE: value,
        }),
      /digest-pinned/,
    );
  }
});

test("unknown environments and incomplete scanner resources fail closed", () => {
  assert.throws(() => buildScannerCloudflareConfig("preview", environments.staging));
  assert.throws(() => buildScannerCloudflareConfig("__proto__", {}));
  assert.throws(() => buildScannerCloudflareConfig("constructor", {}));
  assert.throws(() => buildScannerCloudflareConfig("production", {}));
});

test("production primary binds only the verified live database, queues and origin", () => {
  assert.doesNotThrow(() => assertPrimaryScannerResources("production", environments.production));
  for (const name of [
    "SERAMET_CLOUDFLARE_HYPERDRIVE_ID",
    "SERAMET_CLOUDFLARE_QUEUE",
    "SERAMET_CLOUDFLARE_DLQ",
    "SERAMET_SUPABASE_URL",
    "SERAMET_PUBLIC_ORIGIN",
    "SERAMET_BUILD_ID",
  ]) {
    assert.throws(() =>
      assertPrimaryScannerResources("production", {
        ...environments.production,
        [name]: "staging-or-unverified",
      }),
    );
  }
  assert.throws(
    () =>
      assertPrimaryScannerResources("production", {
        ...environments.production,
        SERAMET_REUSE_EXISTING_VARS: "true",
      }),
    /unpromoted preview/,
  );
  assert.throws(
    () =>
      assertPrimaryScannerResources("production", {
        ...environments.production,
        SERAMET_ALLOWED_ORIGINS: "https://staging.example.test",
      }),
    /approved POS hostname/,
  );
});
