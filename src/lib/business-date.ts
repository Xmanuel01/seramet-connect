export type BusinessDatePeriod = "Today" | "Yesterday" | "Week" | "Month";

export function businessDateForTimestamp(
  timestamp: Date | string,
  timeZone: string,
  cutoffMinutes = 0,
) {
  const occurredAt = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("Invalid business timestamp");
  if (!Number.isInteger(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes >= 1_440) {
    throw new Error("Business-day cutoff must be between 0 and 1439 minutes");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(occurredAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const localDate = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  if (value("hour") * 60 + value("minute") < cutoffMinutes) {
    localDate.setUTCDate(localDate.getUTCDate() - 1);
  }
  return localDate.toISOString().slice(0, 10);
}

export function shiftBusinessDate(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isInteger(days)) {
    throw new Error("Invalid business date shift");
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid business date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function businessDatePeriod(
  period: BusinessDatePeriod,
  now: Date,
  timeZone: string,
  cutoffMinutes = 0,
) {
  const current = businessDateForTimestamp(now, timeZone, cutoffMinutes);
  if (period === "Yesterday") {
    const previous = shiftBusinessDate(current, -1);
    return { from: previous, to: previous };
  }
  if (period === "Week") return { from: shiftBusinessDate(current, -6), to: current };
  if (period === "Month") return { from: current.slice(0, 8) + "01", to: current };
  return { from: current, to: current };
}

export function enumerateBusinessDates(from: string, to: string) {
  if (from > to) throw new Error("Business date range is reversed");
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftBusinessDate(date, 1)) dates.push(date);
  return dates;
}
