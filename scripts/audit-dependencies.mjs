// CI dependency audit: fails on any moderate+ advisory except time-boxed
// dev-only exceptions listed in scripts/audit-exceptions.json. An exception
// never applies once the advisory reaches the production dependency tree, and
// an expired exception fails the build.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/** Advisory ids (GHSA-...) a vulnerable package is affected by, following `via` chains. */
export function advisoriesOf(report, name, seen = new Set()) {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const found = new Set();
  for (const via of report.vulnerabilities?.[name]?.via ?? []) {
    if (typeof via === "string") {
      for (const id of advisoriesOf(report, via, seen)) found.add(id);
    } else {
      const id = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(via.url ?? "")?.[0];
      found.add(id ?? `${via.source ?? via.name}`);
    }
  }
  return found;
}

export function evaluateAudit({ devReport, prodReport, exceptions, today }) {
  const problems = [];
  const active = new Map();
  for (const exception of exceptions) {
    if (!(exception.expires >= today))
      problems.push(
        `Audit exception ${exception.id} expired on ${exception.expires}; fix or renew it.`,
      );
    else active.set(exception.id, exception);
  }
  const prodAdvisories = new Set(
    Object.keys(prodReport.vulnerabilities ?? {}).flatMap((name) => [
      ...advisoriesOf(prodReport, name),
    ]),
  );
  for (const [name, vulnerability] of Object.entries(devReport.vulnerabilities ?? {})) {
    if (severityRank[vulnerability.severity] < severityRank.moderate) continue;
    const unexcused = [...advisoriesOf(devReport, name)].filter(
      (id) => !active.has(id) || prodAdvisories.has(id),
    );
    if (unexcused.length)
      problems.push(`${name} (${vulnerability.severity}): ${unexcused.join(", ")}`);
  }
  return problems;
}

function audit(args) {
  try {
    return JSON.parse(
      execFileSync("npm", ["audit", "--json", ...args], { encoding: "utf8", shell: true }),
    );
  } catch (error) {
    // npm audit exits non-zero when it finds anything; its JSON is still on stdout.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
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
