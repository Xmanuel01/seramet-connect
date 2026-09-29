import { financeDefaultDates } from "@/finance/finance-business-date";

export type ScopedFinancePeriod = {
  scopeKey: string;
  from: string;
  to: string;
};

/**
 * Branch changes must not inherit the prior branch's financial period.
 * Preserve deliberate date filters within the same reporting scope.
 */
export function scopedFinancePeriod(
  previous: ScopedFinancePeriod | null,
  scopeKey: string,
  now: Date,
  timeZone: string,
  businessDayCutoffMinutes: number,
): ScopedFinancePeriod {
  return previous?.scopeKey === scopeKey
    ? previous
    : { scopeKey, ...financeDefaultDates(now, timeZone, businessDayCutoffMinutes) };
}
