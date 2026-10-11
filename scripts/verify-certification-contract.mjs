import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

// Cheap, deterministic repository contract (no npm install, network, secrets or DB).
// Route/API inventory must be updated when adding a route or *-api.ts module.
const manifest = JSON.parse(readFileSync("certification/coverage-manifest.json", "utf8"));
const posix = (file) => file.split(sep).join("/");
const collect = (folder, accept) => {
  const discovered = [];
  const visit = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        visit(path);
      } else if (item.isFile() && accept(path)) {
        discovered.push(posix(path));
      }
    }
  };
  visit(folder);
  return discovered.sort();
};
const exact = (actual, expected, label) => {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
};

assert.equal(manifest.schemaVersion, 1);
const routePaths = collect("src/routes", (file) => /\.tsx?$/.test(file));
const apiPaths = collect("src/server", (file) => /-api\.ts$/.test(file));
exact(routePaths, Object.keys(manifest.routes), "Route inventory changed; classify route evidence");
exact(apiPaths, Object.keys(manifest.apis), "Server API inventory changed; classify API evidence");
for (const [path, item] of Object.entries(manifest.routes)) {
  assert.ok(["LOCAL_FIXTURE", "NOT_VERIFIED"].includes(item.directBrowser), path);
}
for (const [path, item] of Object.entries(manifest.apis)) {
  assert.equal(item.directHttp, "NOT_VERIFIED", "No deployed HTTP acceptance was performed");
  assert.ok(["FINANCE", "CRM", "MENU", "NOT_VERIFIED"].includes(item.servicePostgres), path);
}
const load = collect("src", (path) => /-load\.test\.ts$/.test(path));
exact(load, manifest.expectedLoadSuites, "Seven explicit load suites must be tracked");
assert.equal(load.length, 7, "Expected exactly seven opt-in load suites");
assert.match(readFileSync("vitest.config.ts", "utf8"), /exclude:.*-load\.test\.ts/);
assert.match(readFileSync("vitest.load.config.ts", "utf8"), /include:.*-load\.test\.ts/);

const testFiles = [
  ...collect("src", (file) => /\.test\.[cm]?[jt]sx?$/.test(file)),
  ...collect("tests/e2e", (file) => /\.spec\.[cm]?[jt]sx?$/.test(file)),
];
const seen = {};
for (const file of testFiles) {
  // Limit directive scanning to tests; strip comments so documented examples
  // cannot hide a focused, skipped or TODO test.
  const source = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const directives = [
    ...source.matchAll(/\b(?:test|it|describe)\s*\.\s*(only|skip|todo|fixme)\s*\(/g),
  ];
  if (directives.length) {
    const categories = directives.map((match) => match[1]);
    assert.ok(
      categories.every((name) => name === "skip"),
      "Unexpected focused, TODO or fixme test in " + file,
    );
    const allowed = manifest.permittedConditionalSkips[file];
    assert.equal(
      directives.length,
      allowed ?? 0,
      "Unexpected conditional skipped tests in " + file,
    );
    seen[file] = directives.length;
  }
}
for (const [file, count] of Object.entries(manifest.permittedConditionalSkips)) {
  assert.equal(seen[file] ?? 0, count, "Conditional skip baseline changed: " + file);
}
console.log(
  "Certification contract: PASS " +
    routePaths.length +
    " UI routes, " +
    apiPaths.length +
    " server API modules, seven opt-in load files, " +
    testFiles.length +
    " test files, no unexpected skip/todo/only",
);
