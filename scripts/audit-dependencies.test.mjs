import test from "node:test";
import assert from "node:assert/strict";
import { advisoriesOf, evaluateAudit } from "./audit-dependencies.mjs";

const minimatch = "GHSA-g3hv-75wg-m249";
const devReport = {
  vulnerabilities: {
    minimatch: {
      severity: "moderate",
      via: [{ source: 1, url: `https://github.com/advisories/${minimatch}` }],
    },
    eslint: { severity: "moderate", via: ["minimatch", "@eslint/config-array"] },
    "@eslint/config-array": { severity: "moderate", via: ["minimatch"] },
  },
};
const exception = { id: minimatch, expires: "2026-12-31", reason: "dev-only" };
const clean = { vulnerabilities: {} };

test("transitive packages resolve to the advisory they inherit", () => {
  assert.deepEqual([...advisoriesOf(devReport, "eslint")], [minimatch]);
});

test("an active dev-only exception excuses the advisory and its dependents", () => {
  assert.deepEqual(
    evaluateAudit({ devReport, prodReport: clean, exceptions: [exception], today: "2026-10-31" }),
    [],
  );
});

test("without an exception every affected package fails", () => {
  const problems = evaluateAudit({
    devReport,
    prodReport: clean,
    exceptions: [],
    today: "2026-10-31",
  });
  assert.equal(problems.length, 3);
});

test("an expired exception fails the build", () => {
  const problems = evaluateAudit({
    devReport,
    prodReport: clean,
    exceptions: [exception],
    today: "2027-01-01",
  });
  assert.match(problems[0], /expired on 2026-12-31/);
  assert.ok(problems.some((problem) => problem.startsWith("minimatch")));
});

test("an exception never covers an advisory that reaches production dependencies", () => {
  const problems = evaluateAudit({
    devReport,
    prodReport: devReport,
    exceptions: [exception],
    today: "2026-10-31",
  });
  assert.equal(problems.length, 3);
});

test("a different moderate advisory still fails", () => {
  const other = {
    vulnerabilities: {
      ...devReport.vulnerabilities,
      lodash: {
        severity: "high",
        via: [{ url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }],
      },
    },
  };
  const problems = evaluateAudit({
    devReport: other,
    prodReport: clean,
    exceptions: [exception],
    today: "2026-10-31",
  });
  assert.deepEqual(problems, ["lodash (high): GHSA-aaaa-bbbb-cccc"]);
});
