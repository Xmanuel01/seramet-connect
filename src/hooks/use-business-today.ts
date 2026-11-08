import { useEffect, useState } from "react";
import { branchBusinessToday } from "@/lib/pos-workflow";

/**
 * The branch's current business day, rechecked every minute so a page left open across
 * the cutoff moves on to the new day.
 */
export function useBusinessToday(cutoffMinutes: unknown, resolvedTimeZone: string) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return branchBusinessToday(cutoffMinutes, resolvedTimeZone, now);
}
