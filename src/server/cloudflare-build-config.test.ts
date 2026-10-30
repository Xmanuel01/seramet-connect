import { describe, expect, it } from "vitest";
import { cloudflareBuildConfig } from "./cloudflare-build-config";

const commit = "a".repeat(40);
describe("native Cloudflare production configuration", () => {
  it("attaches the dedicated production resources only on the main build", () => {
    const config = cloudflareBuildConfig({
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: commit,
    });
    expect(config.vars.SERAMET_ENVIRONMENT).toBe("production");
    expect(config.name).toBe("seramet-connect");
    expect(config.vars.SERAMET_BUILD_ID).toBe(commit);
    expect(config.vars.SERAMET_SUPABASE_URL).toBe("https://qnhqylslyhxjcksuhgyq.supabase.co");
    expect(config.hyperdrive).toEqual([
      { binding: "SERAMET_HYPERDRIVE", id: "4538af733065451c94d47beb2028390e" },
    ]);
    expect(config.queues.producers).toEqual([
      { binding: "SERAMET_WORK_QUEUE", queue: "seramet-production-live-work" },
      { binding: "SERAMET_SCAN_QUEUE", queue: "seramet-production-file-scan" },
    ]);
    expect(config.r2_buckets).toEqual([
      { binding: "SERAMET_OBJECTS", bucket_name: "seramet-production-objects" },
    ]);
    expect(config.queues.consumers[0].dead_letter_queue).toBe("seramet-production-live-dlq");
    expect(config.preview_urls).toBe(false);
    expect(config.placement).toEqual({ region: "aws:eu-west-1" });
    expect(config.keep_vars).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/password|service_role|postgresql:\/\//);
  });
  it.each([
    {},
    { WORKERS_CI_BRANCH: "main" },
    { WORKERS_CI: "1", WORKERS_CI_BRANCH: "codex/review", WORKERS_CI_COMMIT_SHA: commit },
  ])("keeps local and preview builds disconnected from production: %j", (env) => {
    const config = cloudflareBuildConfig(env);
    expect(config.vars.SERAMET_ENVIRONMENT).toBe("development");
    expect(config.name).toBe("seramet-connect-preview");
    expect(config.keep_vars).toBe(false);
    expect(config.hyperdrive).toEqual([]);
    expect(config.placement).toBeUndefined();
    expect(config.r2_buckets).toEqual([]);
    expect(config.queues).toEqual({ producers: [], consumers: [] });
    expect(config.vars.SERAMET_SUPABASE_URL).toBeUndefined();
    expect(config.vars.SERAMET_ENABLE_DEV_AUTH).toBe("false");
  });
  it.each([undefined, "main", "development", "a".repeat(39)])(
    "rejects an unidentified production release: %s",
    (sha) => {
      expect(() =>
        cloudflareBuildConfig({
          WORKERS_CI: "1",
          WORKERS_CI_BRANCH: "main",
          WORKERS_CI_COMMIT_SHA: sha,
        }),
      ).toThrow(/immutable/);
    },
  );
});
