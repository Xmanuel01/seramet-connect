import { useCallback, useState } from "react";

/** A panel width the user can drag, remembered on this device. */
export function usePanelWidth(storageKey: string, fallback: number, min: number, max: number) {
  const clamp = useCallback(
    (value: number) => Math.round(Math.min(max, Math.max(min, value))),
    [min, max],
  );
  const [width, setWidthState] = useState(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved > 0 ? clamp(saved) : fallback;
    } catch {
      return fallback;
    }
  });
  const setWidth = useCallback(
    (value: number) => {
      const next = clamp(value);
      setWidthState(next);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Storage can be unavailable (private mode); the width still applies for this visit.
      }
    },
    [clamp, storageKey],
  );
  const reset = useCallback(() => {
    setWidthState(fallback);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [fallback, storageKey]);
  return { width, setWidth, reset, min, max };
}
