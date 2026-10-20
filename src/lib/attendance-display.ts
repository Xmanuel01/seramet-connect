// A corrupt historical value must not bring down timekeeping or imply a new instant.
export function attendanceTime(
  value: string | null | undefined,
  timeZone: string,
  withDate = false,
) {
  if (!value) return withDate ? "Open" : "Not recorded";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "Invalid recorded time";
  try {
    return new Intl.DateTimeFormat("en-KE", {
      timeZone,
      ...(withDate
        ? { dateStyle: "short" as const, timeStyle: "short" as const }
        : {
            hour: "2-digit" as const,
            minute: "2-digit" as const,
          }),
      hourCycle: "h23",
    }).format(instant);
  } catch {
    return "Invalid branch timezone";
  }
}

export function attendanceCollection<T>(
  value: unknown,
  key: string,
  stringFields: string[] = [],
): T[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as Record<string, unknown>)[key])
  )
    throw new Error("Attendance response is incomplete. Refresh or contact your supervisor.");
  const rows = (value as Record<string, unknown>)[key] as unknown[];
  if (
    rows.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        stringFields.some((field) => typeof (row as Record<string, unknown>)[field] !== "string"),
    )
  )
    throw new Error("Attendance response is incomplete. Refresh or contact your supervisor.");
  return rows as T[];
}
