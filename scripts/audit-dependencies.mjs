// CI dependency audit: fails on any moderate+ advisory except time-boxed
// dev-only exceptions listed in scripts/audit-exceptions.json. An exception
// never applies once the advisory reaches the production dependency tree, and
// an expired exception fails the build.
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
    else active.set(exception.id, exception);
  }
  const prodAdvisories = new Set(
    Object.keys(prodReport.vulnerabilities).flatMap((name) => [
      ...advisoriesOf(prodReport, name).keys(),
    ]),
  );
  for (const name of Object.keys(devReport.vulnerabilities)) {
    const unexcused = [...advisoriesOf(devReport, name)]
      .filter(([, severity]) => atLeastModerate(severity))
      .filter(([id]) => !active.has(id) || prodAdvisories.has(id))
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
