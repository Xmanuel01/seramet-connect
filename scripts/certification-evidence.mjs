import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const command = process.argv[2];
const gate = process.argv[3];
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const repoSha = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function countsFromVitest(file) {
  const data = read(file);
  const counts = {
    files: data.testResults?.length ?? 0,
    passed: data.numPassedTests,
    failed: data.numFailedTests,
    skipped: data.numPendingTests ?? 0,
    todo: data.numTodoTests ?? 0,
    total: data.numTotalTests,
  };
  if (
    !Number.isInteger(counts.files) ||
    counts.files < 1 ||
    !Number.isInteger(counts.total) ||
    counts.total < 1 ||
    Object.values(counts).some((value) => !Number.isInteger(value))
  ) {
    throw new Error("Vitest JSON summary incomplete");
  }
  if (
    counts.failed !== 0 ||
    counts.skipped !== 0 ||
    counts.todo !== 0 ||
    counts.passed !== counts.total
  ) {
    throw new Error("Vitest had failed, skipped or todo tests");
  }
  return counts;
}

function countsFromPlaywright(file) {
  const data = read(file);
  const stats = data.stats;
  if (!stats || !Number.isInteger(stats.expected) || stats.expected < 1) {
    throw new Error("Playwright JSON statistics missing");
  }
  const counts = {
    passed: stats.expected,
    failed: stats.unexpected ?? 0,
    skipped: stats.skipped ?? 0,
    todo: 0,
    flaky: stats.flaky ?? 0,
    total: stats.expected + (stats.unexpected ?? 0) + (stats.skipped ?? 0),
  };
  if (counts.failed || counts.skipped || counts.flaky) {
    throw new Error("Playwright has unexpected, skipped or flaky tests");
  }
  return counts;
}

function record() {
  if (!["contract", "application", "browser", "postgres", "load", "staging"].includes(gate)) {
    throw new Error("Unknown certification evidence gate");
  }
  mkdirSync("cert-evidence", { recursive: true });
  const evidence = {
    gate,
    testedCommit: repoSha(),
    runId: process.env.GITHUB_RUN_ID ?? "local",
    nodeVersion: process.version,
    lockfileSha256: sha256(readFileSync("package-lock.json")),
    status: "PASS",
  };
  if (gate === "application") {
    evidence.counts = countsFromVitest("cert-evidence/vitest.json");
  }
  if (gate === "browser") {
    evidence.counts = countsFromPlaywright("cert-evidence/playwright.json");
  }
  if (gate === "load") {
    evidence.counts = countsFromVitest("cert-evidence/vitest-load.json");
    if (evidence.counts.files !== 7) {
      throw new Error("Optional load certification must run all seven suites");
    }
  }
  if (gate === "postgres") {
    evidence.postgresVersion = readFileSync("cert-evidence/postgres-version.txt", "utf8").trim();
    const probes = readFileSync("cert-evidence/postgres-probes.txt", "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const required = [
      "pos",
      "menu-catalog",
      "menu-import",
      "crm-schema",
      "crm-runtime",
      "finance",
      "lockdown",
      "schema-27-rls",
    ];
    if (
      new Set(probes).size !== required.length ||
      !required.every((name) => probes.includes(name))
    ) {
      throw new Error("PostgreSQL probe evidence incomplete or repeated");
    }
    evidence.probes = probes;
  }
  writeFileSync("cert-evidence/" + gate + ".json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(gate + " structured evidence: PASS");
}

function allFiles(path) {
  const names = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const current = join(path, entry.name);
    if (entry.isDirectory()) {
      names.push(...allFiles(current));
    } else if (entry.isFile()) {
      names.push(current);
    }
  }
  return names.sort();
}

function summarize() {
  const source = "certification-download";
  const expected = [
    ["contract", process.env.CONTRACT_RESULT, true],
    ["application", process.env.APPLICATION_RESULT, true],
    ["browser", process.env.BROWSER_RESULT, true],
    ["postgres", process.env.POSTGRES_RESULT, true],
    ["load", process.env.LOAD_RESULT, process.env.INCLUDE_LOAD === "true"],
    ["staging", process.env.STAGING_RESULT, process.env.CHECK_STAGING_HEALTH === "true"],
  ];
  const summaries = [];
  const failures = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let todo = 0;
  for (const [name, result, required] of expected) {
    if (!required) {
      summaries.push([name, "NOT REQUESTED"]);
      continue;
    }
    const file = join(source, name + ".json");
    let record;
    try {
      record = read(file);
      if (record.testedCommit !== process.env.GITHUB_SHA || record.status !== "PASS") {
        throw new Error("Incorrect commit or evidence state");
      }
    } catch {
      failures.push(name + ": evidence missing or invalid");
    }
    if (result !== "success") {
      failures.push(name + ": job " + result);
    }
    summaries.push([name, result]);
    if (record?.counts) {
      passed += record.counts.passed ?? 0;
      failed += record.counts.failed ?? 0;
      skipped += record.counts.skipped ?? 0;
      todo += record.counts.todo ?? 0;
    }
  }
  const checksums = allFiles(source).map((file) => [
    file.replace(source + "/", ""),
    sha256(readFileSync(file)),
  ]);
  const row = (cells) => "| " + cells.join(" | ") + " |";
  const base = process.env.CERT_MAIN_SHA || "NOT VERIFIED";
  const summary = [
    "# Seramet Lite engineering certification",
    "",
    "- Tested commit: `" + process.env.GITHUB_SHA + "`",
    "- Base main SHA (recorded at report time): `" + base + "`",
    "- Run: https://github.com/" +
      process.env.GITHUB_REPOSITORY +
      "/actions/runs/" +
      process.env.GITHUB_RUN_ID,
    "- Optional load: " + (process.env.INCLUDE_LOAD === "true" ? "REQUESTED" : "NOT REQUESTED"),
    "- Optional staging health: " +
      (process.env.CHECK_STAGING_HEALTH === "true" ? "REQUESTED" : "NOT REQUESTED"),
    "- Lockfile SHA256: `" + sha256(readFileSync("package-lock.json")) + "`",
    "- Runtime Node: `" + process.version + "`",
    "- Verified PostgreSQL version: `" + (read(join(source, "postgres.json"))?.postgresVersion ?? "NOT VERIFIED") + "`",
    "",
    "| Certification gate | Job status |",
    "| --- | --- |",
    ...summaries.map(row),
    "",
    "## Machine-readable evidence",
    "",
    "Recorded non-load/load/browser assertions: passed=" +
      passed +
      ", failed=" +
      failed +
      ", skipped=" +
      skipped +
      ", todo=" +
      todo,
    "",
    "| Evidence file | SHA256 (unpacked artifact content) |",
    "| --- | --- |",
    ...checksums.map(row),
    "",
    "## Unverified live integrations",
    "",
    "- Protected staging owner/device authentication: NOT VERIFIED by this workflow.",
    "- Deployed tenant menu-to-POS-to-kitchen-to-payment-to-EOD: NOT VERIFIED.",
    "- External M-Pesa/marketplace provider settlement and callbacks: NOT VERIFIED.",
    "- Physical printer, real scanner, Cloudflare Queues/Hyperdrive: NOT VERIFIED.",
    "- Existing public-schema staging security exposure: NOT VERIFIED as resolved.",
    "",
    failures.length
      ? "**ENGINEERING CERTIFICATION: FAILED/BLOCKED.** " + failures.join("; ")
      : "**ISOLATED ENGINEERING CERTIFICATION: PASS; NOT a staging release approval.**",
    "",
  ].join("\n");
  writeFileSync("certification-summary.md", summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = awaitImportNotNeeded();
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  console.log(failures.length ? "Certification FAILED" : "Engineering gates PASS");
  if (failures.length || failed || skipped || todo) process.exitCode = 1;
}
function awaitImportNotNeeded() {
  return { appendFileSync: (path, data) => writeFileSync(path, data, { flag: "a" }) };
}
try {
  if (command === "record") {
    record();
  } else if (command === "summarize") {
    summarize();
  } else {
    throw new Error("Use record <gate> or summarize");
  }
} catch (error) {
  console.error("Certification evidence failure: " + error.message);
  process.exitCode = 1;
}
