type BuildEnvironment = Record<string, string | undefined>;

/** Preview builds must never inherit the production database or durable resources. */
export function cloudflareBuildConfig(env: BuildEnvironment) {
  const production = env.WORKERS_CI === "1" && env.WORKERS_CI_BRANCH === "main";
  const buildId = env.WORKERS_CI_COMMIT_SHA;
  if (production && !/^[a-f0-9]{40}$/.test(buildId ?? "")) {
    throw new Error("Production deployment requires an immutable main-branch commit");
  }
  const vars: Record<string, string> = {
    SERAMET_ENVIRONMENT: production ? "production" : "development",
    SERAMET_ENABLE_DEV_AUTH: "false",
    SERAMET_ENABLE_LOCAL_DATABASE: "false",
    SERAMET_ALLOW_TEST_PROVIDERS: "false",
    SERAMET_REQUIRE_BEARER: "true",
    SERAMET_BUILD_ID: buildId ?? "preview",
  };
  if (production) {
    Object.assign(vars, {
      SERAMET_DATABASE_PROVIDER: "postgres",
      SERAMET_IDENTITY_PROVIDER: "supabase",
      SERAMET_SECRET_STORE: "cloudflare-worker-secrets",
      SERAMET_SUPABASE_URL: "https://qnhqylslyhxjcksuhgyq.supabase.co",
      SERAMET_PUBLIC_ORIGIN: "https://pos.seramet.co.ke",
      SERAMET_CALLBACK_BASE_URL: "https://pos.seramet.co.ke",
      SERAMET_ALLOWED_ORIGINS: "https://pos.seramet.co.ke",
    });
  }
  return {
    name: production ? "seramet-connect" : "seramet-connect-preview",
    keep_vars: production,
    preview_urls: false,
    // Run requests next to the production database (Supabase eu-west-1, Ireland) instead of
    // next to each visitor: a request makes many database round trips, and from Nairobi each
    // one crossed to Europe and back.
    ...(production ? { placement: { region: "aws:eu-west-1" } } : {}),
    vars,
    hyperdrive: production
      ? [{ binding: "SERAMET_HYPERDRIVE", id: "4538af733065451c94d47beb2028390e" }]
      : [],
    r2_buckets: production
      ? [{ binding: "SERAMET_OBJECTS", bucket_name: "seramet-production-objects" }]
      : [],
    queues: {
      // Every automatic main deploy replaces the Worker's bindings, so the file-scan producer
      // must be declared here too; without it all file imports are refused in production.
      producers: production
        ? [
            { binding: "SERAMET_WORK_QUEUE", queue: "seramet-production-live-work" },
            { binding: "SERAMET_SCAN_QUEUE", queue: "seramet-production-file-scan" },
          ]
        : [],
      consumers: production
        ? [
            {
              queue: "seramet-production-live-work",
              max_batch_size: 10,
              max_retries: 5,
              max_concurrency: 2,
              dead_letter_queue: "seramet-production-live-dlq",
            },
          ]
        : [],
    },
  };
}
