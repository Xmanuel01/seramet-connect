import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseStagingRecoveryMode } from "./staging-recovery-cli-args.mjs";

test("a no-flag invocation stays read-only", () => {
  assert.equal(parseStagingRecoveryMode([]), "plan");
});

test("a GitHub Actions node script --plan invocation succeeds", () => {
  const argv = ["/opt/node", "/runner/scripts/reconcile-staging-management-backlog.mjs", "--plan"];
  assert.equal(parseStagingRecoveryMode(argv.slice(2)), "plan");
});

test("import and management CLIs both accept their explicit plan command", () => {
  for (const filename of [
    "reconcile-staging-menu-imports.mjs",
    "reconcile-staging-management-backlog.mjs",
  ]) {
    assert.equal(parseStagingRecoveryMode(["node", filename, "--plan"].slice(2)), "plan");
  }
});

test("one explicit --apply is required for mutation mode", () => {
  assert.equal(parseStagingRecoveryMode(["--apply"]), "apply");
});

test("rejects combined, repeated and arbitrary arguments", () => {
  for (const args of [
    ["--plan", "--apply"],
    ["--apply", "--apply"],
    ["--plan", "--plan"],
    ["--unsafe"],
    ["--apply", "anything"],
    ["node", "script.mjs", "--plan"],
    ["/path/to/node", "/path/to/script.mjs"],
  ]) {
    assert.throws(() => parseStagingRecoveryMode(args), /Use --plan OR --apply/);
  }
});

test("both complete scripts reach staging configuration checks with valid --plan", () => {
  const scripts = [
    {
      filename: "reconcile-staging-menu-imports.mjs",
      expected: /Staging Postgres connection is required/,
    },
    { filename: "reconcile-staging-management-backlog.mjs", expected: /STAGING ONLY:/ },
  ];
  for (const { filename, expected } of scripts) {
    const command = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(filename, import.meta.url)), "--plan"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SERAMET_ENVIRONMENT: "staging",
          SERAMET_POSTGRES_URL: "",
        },
      },
    );
    assert.notEqual(command.status, 0);
    assert.match(command.stderr, expected);
    assert.doesNotMatch(command.stderr, /Use --plan OR --apply/);
  }
});
