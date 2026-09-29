import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const LOVABLE_SOURCE_MARKERS = [
  "@lovable.dev/",
  "ai.gateway.lovable.dev",
  "LOVABLE_API_KEY",
  "lovable-tagger",
];
export const FORBIDDEN_LOVABLE_PATHS = [
  ".lovable/project.json",
  "src/lib/document-extract.functions.ts",
];

export function checkLovableSource(files, read = (path) => readFileSync(path, "utf8")) {
  const violations = [];
  for (const path of files) {
    if (FORBIDDEN_LOVABLE_PATHS.includes(path) && existsSync(path)) {
      violations.push(`${path}: accidental Lovable integration path`);
    }
    if (
      !path.startsWith("src/") &&
      path !== "package.json" &&
      path !== "vite.config.ts"
    ) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|json)$/.test(path)) continue;
    const content = read(path);
    for (const marker of LOVABLE_SOURCE_MARKERS) {
      if (content.includes(marker)) {
        violations.push(`${path}: unexpected Lovable integration marker ${marker}`);
      }
    }
  }
  return violations;
}

if (process.argv[1]?.endsWith("assert-no-lovable-source.mjs")) {
  const files = execFileSync(
    "git", ["ls-files", "-z", "--", "src", "package.json", "vite.config.ts", ".lovable"],
    { encoding: "utf8" },
  ).split("\0").filter(Boolean);
  // Also detect untracked accidental integration when running locally.
  for (const path of FORBIDDEN_LOVABLE_PATHS) {
    if (existsSync(path) && !files.includes(path)) files.push(path);
  }
  const violations = checkLovableSource(files);
  if (violations.length) {
    console.error("BLOCK: accidental Lovable implementation is present:\n" + violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("PASS: no Lovable implementation or integration markers in active application sources");
  }
}
