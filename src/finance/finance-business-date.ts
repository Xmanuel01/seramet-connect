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
  const effective = new Date(now.getTime() - cutoff * 60_000);
  const formatDate = (zone: string): string => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(effective);
    const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
    return [part("year"), part("month"), part("day")].join("-");
  };
  let businessDate: string;
  try {
    businessDate = formatDate(timeZone);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    businessDate = formatDate("UTC");
  }
  return { from: businessDate.slice(0, 8) + "01", to: businessDate };
}
