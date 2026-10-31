import test from "node:test";
import assert from "node:assert/strict";
import { advisoriesOf, evaluateAudit } from "./audit-dependencies.mjs";

const minimatch = "GHSA-g3hv-75wg-m249";
const advisory = (id, severity) => ({
  source: 1,
  severity,
  url: `https://github.com/advisories/${id}`,
});
const devReport = {
  vulnerabilities: {
    minimatch: { severity: "moderate", via: [advisory(minimatch, "moderate")] },
    eslint: { severity: "moderate", via: ["minimatch", "@eslint/config-array"] },
    "@eslint/config-array": { severity: "moderate", via: ["minimatch"] },
  },
};
const exception = { id: minimatch, expires: "2026-12-31", reason: "dev-only" };
const clean = { vulnerabilities: {} };
const evaluate = (overrides) =>
  evaluateAudit({
    devReport,
    prodReport: clean,
    exceptions: [exception],
    today: "2026-10-31",
    ...overrides,
  });

test("transitive packages resolve to the advisory they inherit", () => {
  assert.deepEqual([...advisoriesOf(devReport, "eslint")], [[minimatch, "moderate"]]);
});

test("an active dev-only exception excuses the advisory and its dependents", () => {
  assert.deepEqual(evaluate({}), []);
});

test("without an exception every affected package fails", () => {
  assert.equal(evaluate({ exceptions: [] }).length, 3);
});

test("an expired exception fails the build", () => {
  const problems = evaluate({ today: "2027-01-01" });
  assert.match(problems[0], /expired on 2026-12-31/);
  assert.ok(problems.some((problem) => problem.startsWith("minimatch")));
});

test("a malformed expiry never keeps an exception active", () => {
  for (const expires of ["2026-13-01", "9999-99-99", "2026-12-31T00:00", "next year", undefined]) {
    const problems = evaluate({ exceptions: [{ ...exception, expires }] });
    assert.match(problems[0], /needs an expires date/);
    assert.ok(problems.some((problem) => problem.startsWith("minimatch")));
  }
});

test("an exception never covers an advisory that reaches production dependencies", () => {
  assert.equal(evaluate({ prodReport: devReport }).length, 3);
});

test("a different moderate advisory still fails beside an active exception", () => {
  const problems = evaluate({
    devReport: {
      vulnerabilities: {
        ...devReport.vulnerabilities,
        lodash: { severity: "moderate", via: [advisory("GHSA-aaaa-bbbb-cccc", "moderate")] },
      },
    },
  });
  assert.deepEqual(problems, ["lodash: GHSA-aaaa-bbbb-cccc (moderate)"]);
});

test("the moderate threshold applies to each advisory, not to the package", () => {
  const problems = evaluate({
    devReport: {
      vulnerabilities: {
        ...devReport.vulnerabilities,
        minimatch: {
          severity: "moderate",
          via: [advisory(minimatch, "moderate"), advisory("GHSA-low0-low0-low0", "low")],
        },
      },
    },
  });
  assert.deepEqual(problems, []);
});

test("a missing or failed audit report fails instead of passing as clean", () => {
  for (const broken of [{}, { error: { code: "ENOLOCK" } }, null, { vulnerabilities: [] }]) {
    assert.match(evaluate({ devReport: broken })[0], /did not produce a vulnerability report/);
    assert.match(evaluate({ prodReport: broken })[0], /did not produce a vulnerability report/);
  }
});
