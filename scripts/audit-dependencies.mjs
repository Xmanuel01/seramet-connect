// CI dependency audit: fails on any moderate+ advisory except time-boxed
// exceptions listed in scripts/audit-exceptions.json. An ordinary exception is
// dev-only and never applies once the advisory reaches the production dependency
// tree. A "buildOnly" exception may cover a production-tree package that is used
// only while building: it must name bundleMarkers, and the production bundle audit
// (scripts/audit-production-bundle.mjs) fails if any of them appears in what is
// deployed. An expired exception of either kind fails the build.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
// An unknown severity is treated as the worst case.
const atLeastModerate = (severity) =>
  (severityRank[severity] ?? severityRank.critical) >= severityRank.moderate;

/**
 * Advisories (GHSA id -> advisory severity) a vulnerable package is affected by,
 * following `via` chains down to the advisories themselves.
 */
export function advisoriesOf(report, name, seen = new Set()) {
  const found = new Map();
  if (seen.has(name)) return found;
  seen.add(name);
  for (const via of report.vulnerabilities?.[name]?.via ?? []) {
    if (typeof via === "string") {
      for (const [id, severity] of advisoriesOf(report, via, seen)) found.set(id, severity);
    } else {
      const id = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(via.url ?? "")?.[0];
      found.set(id ?? `${via.source ?? via.name}`, via.severity);
    }
  }
  return found;
}

/**
 * The packages an advisory is actually filed against, reached from a vulnerable package
 * through its `via` chain (for vite -> picomatch, picomatch).
 */
export function advisoryOrigins(report, name, id, seen = new Set()) {
  const origins = new Set();
  if (seen.has(name)) return origins;
  seen.add(name);
  for (const via of report.vulnerabilities?.[name]?.via ?? []) {
    if (typeof via === "string") {
      for (const origin of advisoryOrigins(report, via, id, seen)) origins.add(origin);
    } else if (/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(via.url ?? "")?.[0] === id) {
      origins.add(via.name ?? name);
    }
  }
  return origins;
}

const isReport = (report) =>
  Boolean(report) &&
  typeof report === "object" &&
  !report.error &&
  Boolean(report.vulnerabilities) &&
  typeof report.vulnerabilities === "object" &&
  !Array.isArray(report.vulnerabilities);

const isCalendarDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function evaluateAudit({ devReport, prodReport, exceptions, today }) {
  if (!isReport(devReport) || !isReport(prodReport))
    return ["npm audit did not produce a vulnerability report; the audit is incomplete."];
  const problems = [];
  const active = new Map();
  for (const exception of exceptions) {
    if (!isCalendarDate(exception.expires))
      problems.push(`Audit exception ${exception.id} needs an expires date as YYYY-MM-DD.`);
    else if (exception.expires < today)
      problems.push(
        `Audit exception ${exception.id} expired on ${exception.expires}; fix or renew it.`,
      );
    else if (
      exception.buildOnly === true &&
      (typeof exception.package !== "string" ||
        !exception.package ||
        !Array.isArray(exception.bundleMarkers) ||
        !exception.bundleMarkers.length ||
        exception.bundleMarkers.some((marker) => typeof marker !== "string" || marker.length < 6))
    )
      problems.push(
        `Build-only audit exception ${exception.id} needs its package and bundleMarkers the bundle audit can check.`,
      );
    else active.set(exception.id, exception);
  }
  const prodAdvisories = new Set(
    Object.keys(prodReport.vulnerabilities).flatMap((name) => [
      ...advisoriesOf(prodReport, name).keys(),
    ]),
  );
  // A build-only exception excuses only its own package's advisory, wherever it is reached from.
  const excused = (name, id) => {
    const exception = active.get(id);
    if (!exception) return false;
    if (!prodAdvisories.has(id)) return true;
    if (exception.buildOnly !== true) return false;
    const origins = [...advisoryOrigins(devReport, name, id)];
    return origins.length > 0 && origins.every((origin) => origin === exception.package);
  };
  for (const name of Object.keys(devReport.vulnerabilities)) {
    const unexcused = [...advisoriesOf(devReport, name)]
      .filter(([, severity]) => atLeastModerate(severity))
      .filter(([id]) => !excused(name, id))
      .map(([id, severity]) => `${id} (${severity})`);
    if (unexcused.length) problems.push(`${name}: ${unexcused.join(", ")}`);
  }
  return problems;
}

function audit(args) {
  let output;
  try {
    output = execFileSync("npm", ["audit", "--json", ...args], {
      encoding: "utf8",
      shell: true,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; its JSON report is still on stdout.
    if (!error.stdout) throw error;
    output = error.stdout;
  }
  const report = JSON.parse(output);
  if (!isReport(report))
    throw new Error(
      `npm audit ${args.join(" ")} failed: ${JSON.stringify(report?.error ?? report)}`,
    );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exceptions = JSON.parse(
    readFileSync(new URL("./audit-exceptions.json", import.meta.url), "utf8"),
  );
  const problems = evaluateAudit({
    devReport: audit(["--include=dev"]),
    prodReport: audit(["--omit=dev"]),
    exceptions,
    today: new Date().toISOString().slice(0, 10),
  });
  for (const exception of exceptions)
    console.log(`Allowed until ${exception.expires}: ${exception.id} (${exception.reason})`);
  if (problems.length) {
    console.error(`Dependency audit failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Dependency audit passed (moderate and above).");
}
