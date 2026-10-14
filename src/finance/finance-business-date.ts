import { businessDateForTimestamp } from "@/lib/business-date";

/**
 * Financial periods follow the restaurant branch's business date, not UTC.
 * Most Nairobi branches close their business day at 04:00 local time.
 */
export function financeDefaultDates(
  now: Date,
  timeZone: string,
  businessDayCutoffMinutes: number = 0,
) {
  const cutoff =
    Number.isInteger(businessDayCutoffMinutes) &&
    businessDayCutoffMinutes >= 0 &&
    businessDayCutoffMinutes < 1440
      ? businessDayCutoffMinutes
      : 0;
  let businessDate: string;
  try {
    businessDate = businessDateForTimestamp(now, timeZone, cutoff);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    businessDate = businessDateForTimestamp(now, "UTC", cutoff);
  }
  return { from: businessDate.slice(0, 8) + "01", to: businessDate };
}
