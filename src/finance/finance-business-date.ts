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
  let businessDate: string;
  try {
    businessDate = businessDateForTimestamp(now, timeZone, businessDayCutoffMinutes);
  } catch (error) {
    if (!(error instanceof RangeError)) {
      businessDate = businessDateForTimestamp(now, "UTC", 0);
    } else {
      businessDate = businessDateForTimestamp(now, "UTC", businessDayCutoffMinutes);
    }
  }
  return { from: businessDate.slice(0, 8) + "01", to: businessDate };
}
