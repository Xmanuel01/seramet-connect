export const QUANTITY_SCALE = 1_000_000;
export const BASIS_POINTS_SCALE = 10_000;

export function assertScaledInteger(value: number, label: string, allowNegative = false) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  if (!allowNegative && value < 0) throw new Error(`${label} cannot be negative`);
  return value;
}

export function multiplyDivide(
  value: number,
  numerator: number,
  denominator: number,
  label = "scaled value",
) {
  assertScaledInteger(value, label, true);
  assertScaledInteger(numerator, "conversion numerator");
  assertScaledInteger(denominator, "conversion denominator");
  if (numerator <= 0 || denominator <= 0) throw new Error("Conversion factors must be positive");
  const product = BigInt(value) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const sign = product < 0n ? -1n : 1n;
  const absolute = product < 0n ? -product : product;
  const rounded = (absolute + divisor / 2n) / divisor;
  return safeBigIntToNumber(rounded * sign, label);
}

export function quantityCostMinor(quantityMicro: number, unitCostMinor: number) {
  assertScaledInteger(quantityMicro, "quantity", true);
  assertScaledInteger(unitCostMinor, "unit cost");
  return multiplyDivide(quantityMicro, unitCostMinor, QUANTITY_SCALE, "quantity cost");
}

export function weightedAverageUnitCostMinor(
  existingQuantityMicro: number,
  existingValueMinor: number,
  incomingQuantityMicro: number,
  incomingValueMinor: number,
) {
  assertScaledInteger(existingQuantityMicro, "existing quantity");
  assertScaledInteger(existingValueMinor, "existing value");
  assertScaledInteger(incomingQuantityMicro, "incoming quantity");
  assertScaledInteger(incomingValueMinor, "incoming value");
  const quantity = existingQuantityMicro + incomingQuantityMicro;
  if (quantity <= 0) return 0;
  return multiplyDivide(
    existingValueMinor + incomingValueMinor,
    QUANTITY_SCALE,
    quantity,
    "weighted average unit cost",
  );
}

export function ratioBasisPoints(numerator: number, denominator: number) {
  assertScaledInteger(numerator, "ratio numerator", true);
  assertScaledInteger(denominator, "ratio denominator", true);
  if (denominator === 0) return 0;
  return multiplyDivide(numerator, BASIS_POINTS_SCALE, denominator, "basis-point ratio");
}

export function normalizeRational(numerator: number, denominator: number) {
  assertScaledInteger(numerator, "conversion numerator");
  assertScaledInteger(denominator, "conversion denominator");
  if (numerator <= 0 || denominator <= 0) throw new Error("Conversion factors must be positive");
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function gcd(left: number, right: number) {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function safeBigIntToNumber(value: bigint, label: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the supported integer range`);
  }
  return Number(value);
}
