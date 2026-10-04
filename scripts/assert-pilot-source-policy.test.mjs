import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("production source contains no pilot bypass or embedded provider secret", () => {
  const result = spawnSync(process.execPath, ["scripts/assert-pilot-source-policy.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /passed/);
});
