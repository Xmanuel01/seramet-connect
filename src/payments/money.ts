export type MinorAmount = number;

const currencyMinorDigits: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

export function minorDigits(currency: string) {
  return currencyMinorDigits[currency.toUpperCase()] ?? 2;
}

export function assertMinorAmount(value: number, field = "amount"): asserts value is MinorAmount {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be an integer minor-unit amount`);
  }
}

export function parseMajorAmount(value: string | number, currency: string): MinorAmount {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Invalid monetary amount");
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = minorDigits(currency);
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) {
    throw new Error(`Amount has more than ${digits} decimal places for ${currency.toUpperCase()}`);
  }
  const padded = fraction.padEnd(digits, "0").slice(0, digits);
  const result = Number(BigInt(whole) * BigInt(10 ** digits) + BigInt(padded || "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Amount exceeds safe monetary range");
  return negative ? -result : result;
}

export function majorFromMinor(amountMinor: MinorAmount, currency: string) {
  assertMinorAmount(amountMinor);
  return amountMinor / 10 ** minorDigits(currency);
}

export function formatMinor(amountMinor: MinorAmount, currency: string, locale = "en") {
  assertMinorAmount(amountMinor);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minorDigits(currency),
    maximumFractionDigits: minorDigits(currency),
  }).format(majorFromMinor(amountMinor, currency));
}

export function sumMinor(values: readonly MinorAmount[]) {
  return values.reduce((total, value) => {
    assertMinorAmount(value);
    const next = total + value;
    assertMinorAmount(next, "sum");
    return next;
  }, 0);
}

export function assertSameCurrency(left: string, right: string) {
  if (left.toUpperCase() !== right.toUpperCase()) {
    throw new Error(`Cross-currency allocation is not supported: ${left} to ${right}`);
  }
}
