import { businessDateForTimestamp, shiftBusinessDate } from "./business-date";

export const transactionPeriods = [
  "Today",
  "Yesterday",
  "Last 7 Days",
  "Last 30 Days",
  "Custom Range",
  "All Time",
] as const;
export type TransactionPeriod = (typeof transactionPeriods)[number];
export type DateWindow = { from: string; to: string };

export function transactionWindow(
  period: TransactionPeriod,
  today: string,
  custom: DateWindow,
): DateWindow {
  if (period === "All Time") return { from: "", to: "" };
  if (period === "Custom Range") return custom;
  const to = period === "Yesterday" ? shiftBusinessDate(today, -1) : today;
  return {
    from: shiftBusinessDate(
      to,
      period === "Last 7 Days" ? -6 : period === "Last 30 Days" ? -29 : 0,
    ),
    to,
  };
}

export function inDateWindow(date: string, window: DateWindow) {
  return (!window.from || date >= window.from) && (!window.to || date <= window.to);
}

// Find the first instant of the local calendar date, including DST transitions.
export function calendarDateStart(date: string, timeZone: string) {
  const center = Date.parse(`${date}T00:00:00Z`);
  let low = center - 36 * 3_600_000;
  let high = center + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (businessDateForTimestamp(new Date(middle), timeZone) < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low).toISOString();
}
