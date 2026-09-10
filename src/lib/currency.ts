export function formatMoney(amount: number, currency = activeCurrency(), locale = activeLocale()) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function activeCurrency() {
  if (typeof document === "undefined") return "XXX";
  return document.documentElement.dataset["currency"] || "XXX";
}

export function activeLocale() {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang || "en";
}

export function activeTimeZone() {
  if (typeof document === "undefined") return "UTC";
  return document.documentElement.dataset["timeZone"] || "UTC";
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale = activeLocale(),
) {
  return new Intl.NumberFormat(locale, options).format(Number.isFinite(value) ? value : 0);
}

export function formatDate(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale = activeLocale(),
  timeZone = activeTimeZone(),
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date);
}

export function formatTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale = activeLocale(),
  timeZone = activeTimeZone(),
) {
  return formatDate(value, { hour: "2-digit", minute: "2-digit", ...options }, locale, timeZone);
}

export function formatDateTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale = activeLocale(),
  timeZone = activeTimeZone(),
) {
  return formatDate(
    value,
    { dateStyle: "medium", timeStyle: "short", ...options },
    locale,
    timeZone,
  );
}

export function currentDateKey(value = new Date(), timeZone = activeTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

/** Compatibility alias for existing screens while currency is resolved from tenant context. */
export const ksh = formatMoney;
