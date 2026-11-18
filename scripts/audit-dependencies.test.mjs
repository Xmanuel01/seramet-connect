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

const picomatch = "GHSA-fc5q-39xc-vjpf";
const buildToolReport = {
  vulnerabilities: {
    picomatch: { severity: "high", via: [{ ...advisory(picomatch, "high"), name: "picomatch" }] },
    vite: { severity: "high", via: ["picomatch"] },
  },
};
const buildOnly = {
  id: picomatch,
  package: "picomatch",
  expires: "2026-12-31",
  buildOnly: true,
  bundleMarkers: ["POSIX_REGEX_SOURCE"],
  reason: "build tooling only",
};
const evaluateBuildTool = (overrides) =>
  evaluateAudit({
    devReport: buildToolReport,
    prodReport: buildToolReport,
    exceptions: [buildOnly],
    today: "2026-11-18",
    ...overrides,
  });

test("a build-only exception covers a production-tree build tool", () => {
  assert.deepEqual(evaluateBuildTool({}), []);
});

test("a build-only exception without bundle markers is refused", () => {
  for (const bundleMarkers of [undefined, [], ["abc"]]) {
    const problems = evaluateBuildTool({ exceptions: [{ ...buildOnly, bundleMarkers }] });
    assert.match(problems[0], /bundleMarkers the bundle audit can check/);
    assert.ok(problems.some((problem) => problem.startsWith("picomatch")));
  }
});

test("a build-only exception expires like any other", () => {
  const problems = evaluateBuildTool({ today: "2027-01-01" });
  assert.match(problems[0], /expired on 2026-12-31/);
  assert.ok(problems.some((problem) => problem.startsWith("picomatch")));
});

test("an ordinary exception still never covers a production-tree advisory", () => {
  const { buildOnly: _ignored, ...ordinary } = buildOnly;
  assert.equal(evaluateBuildTool({ exceptions: [ordinary] }).length, 2);
});

test("a build-only exception excuses only its own package's advisory", () => {
  const shared = {
    vulnerabilities: {
      ...buildToolReport.vulnerabilities,
      "other-glob": {
        severity: "high",
        via: [{ ...advisory(picomatch, "high"), name: "other-glob" }],
      },
    },
  };
  const named = (report) => ({
    vulnerabilities: Object.fromEntries(
      Object.entries(report.vulnerabilities).map(([name, row]) => [
        name,
        {
          ...row,
          via: row.via.map((via) => (typeof via === "string" || via.name ? via : { ...via, name })),
        },
      ]),
    ),
  });
  const problems = evaluateBuildTool({ devReport: named(shared), prodReport: named(shared) });
  assert.deepEqual(problems, [`other-glob: ${picomatch} (high)`]);
  // Without a package the exception is refused outright.
  const { package: _none, ...unbound } = buildOnly;
  assert.match(evaluateBuildTool({ exceptions: [unbound] })[0], /needs its package/);
});
