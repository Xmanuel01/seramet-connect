import { useCallback, useEffect, useState } from "react";

/**
 * A panel width the user can drag, remembered on this device.
 *
 * The POS is server-rendered, so the first render always uses `fallback` (the server
 * cannot read localStorage); the saved width is applied right after hydration.
 */
export function usePanelWidth(storageKey: string, fallback: number, min: number, max: number) {
  const clamp = useCallback(
    (value: number) => Math.round(Math.min(max, Math.max(min, value))),
    [min, max],
  );
  const [width, setWidthState] = useState(fallback);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) setWidthState(clamp(saved));
    } catch {
      // Storage can be unavailable (private mode); keep the default width.
    }
  }, [clamp, storageKey]);
  const setWidth = useCallback(
    (value: number) => {
      const next = clamp(value);
      setWidthState(next);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // The width still applies for this visit.
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
