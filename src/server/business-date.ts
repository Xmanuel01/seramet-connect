export function authoritativeBusinessDate(input: {
  occurredAt?: string;
  timezone: string;
  cutoffMinutes: number;
}) {
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("Invalid authoritative timestamp");
  if (
    !Number.isInteger(input.cutoffMinutes) ||
    input.cutoffMinutes < 0 ||
    input.cutoffMinutes >= 1_440
  ) {
    throw new Error("Business-day cutoff must be between 0 and 1439 minutes");
  }
  const local = zonedParts(occurredAt, input.timezone);
  const minutes = local.hour * 60 + local.minute;
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (minutes < input.cutoffMinutes) localDate.setUTCDate(localDate.getUTCDate() - 1);
  return localDate.toISOString().slice(0, 10);
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}
