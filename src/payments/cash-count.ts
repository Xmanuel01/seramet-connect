import { majorFromMinor, parseMajorAmount, sumMinor } from "./money";

export function cashCount(value: unknown, expected: number, currency: string) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Enter the physical cash count");
  }
  const count = parseMajorAmount(value, currency);
  if (count < 0) throw new Error("Physical cash count cannot be negative");
  const variance = sumMinor([count, -parseMajorAmount(expected, currency)]);
  const physicalCount = majorFromMinor(count, currency);
  const varianceAmount = majorFromMinor(variance, currency);
  if (
    parseMajorAmount(physicalCount, currency) !== count ||
    parseMajorAmount(varianceAmount, currency) !== variance
  ) {
    throw new Error("Cash count exceeds supported monetary precision");
  }
  return {
    physicalCount,
    variance: varianceAmount,
    varianceMinor: variance,
  };
}
