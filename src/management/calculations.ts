import type {
  AnalyticsQuality,
  BranchHealthStatus,
  FinancialQuality,
  ManagementSeverity,
} from "@/management/types";

const BASIS_POINTS = 10_000n;

export function safeIntegerRatio(numerator: number, denominator: number, scale = 10_000) {
  assertSafeInteger(numerator, "ratio numerator");
  assertSafeInteger(denominator, "ratio denominator");
  assertSafeInteger(scale, "ratio scale");
  if (denominator === 0) return 0;
  const value = (BigInt(numerator) * BigInt(scale)) / BigInt(denominator);
  return toSafeNumber(value, "ratio result");
}

export function basisPoints(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return safeIntegerRatio(numerator, denominator, Number(BASIS_POINTS));
}

export function multiplyRatio(value: number, numerator: number, denominator: number) {
  assertSafeInteger(value, "ratio value");
  assertSafeInteger(numerator, "ratio numerator");
  assertSafeInteger(denominator, "ratio denominator");
  if (denominator === 0) throw new Error("ratio denominator must not be zero");
  return toSafeNumber((BigInt(value) * BigInt(numerator)) / BigInt(denominator), "ratio result");
}

export function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return Math.trunc(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

export function average(values: number[]) {
  if (values.length === 0) return null;
  return Math.trunc(values.reduce((total, value) => total + value, 0) / values.length);
}

export function evaluateThreshold(
  value: number,
  comparison: "GREATER_THAN" | "LESS_THAN" | "ABSOLUTE_GREATER_THAN",
  threshold: number,
) {
  if (comparison === "LESS_THAN") return value < threshold;
  if (comparison === "ABSOLUTE_GREATER_THAN") return Math.abs(value) > threshold;
  return value > threshold;
}

export function qualityFromReasons(
  reasons: string[],
  options: { hasPrimaryFacts: boolean; criticalReasonCount?: number } = { hasPrimaryFacts: true },
): AnalyticsQuality {
  if (!options.hasPrimaryFacts) return "INSUFFICIENT_DATA";
  if ((options.criticalReasonCount ?? 0) > 0 || reasons.length >= 3) return "LOW";
  if (reasons.length > 0) return "MEDIUM";
  return "HIGH";
}

export function financialQuality(hasSales: boolean, reasons: string[]): FinancialQuality {
  if (!hasSales) return "INSUFFICIENT_DATA";
  return reasons.length === 0 ? "COMPLETE" : "PARTIAL";
}

export function healthFromSeverities(severities: ManagementSeverity[]): BranchHealthStatus {
  const critical = severities.filter((severity) => severity === "CRITICAL").length;
  const high = severities.filter((severity) => severity === "HIGH").length;
  if (critical > 0) return "CRITICAL";
  if (high >= 2) return "CRITICAL";
  if (high === 1) return "AT_RISK";
  if (severities.some((severity) => severity === "MEDIUM" || severity === "LOW")) {
    return "WATCH";
  }
  return "HEALTHY";
}

export function menuClassification(input: {
  quality: AnalyticsQuality;
  contributionMinor: number;
  contributionMedianMinor: number;
  salesMixBps: number;
  popularityMedianBps: number;
}) {
  if (input.quality === "INSUFFICIENT_DATA") return "INSUFFICIENT_DATA" as const;
  const profitable = input.contributionMinor >= input.contributionMedianMinor;
  const popular = input.salesMixBps >= input.popularityMedianBps;
  if (profitable && popular) return "STAR" as const;
  if (!profitable && popular) return "WORKHORSE" as const;
  if (profitable) return "PUZZLE" as const;
  return "LOW_PERFORMER" as const;
}

export function assertSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
}

function toSafeNumber(value: bigint, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds safe integer range`);
  return result;
}
