import { businessDateForTimestamp } from "@/lib/business-date";

export function authoritativeBusinessDate(input: {
  occurredAt?: string;
  timezone: string;
  cutoffMinutes: number;
}) {
  return businessDateForTimestamp(
    input.occurredAt ?? new Date(),
    input.timezone,
    input.cutoffMinutes,
  );
}
