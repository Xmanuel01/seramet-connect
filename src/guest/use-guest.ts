import { useCallback, useEffect, useState } from "react";

type QueryStatus = "loading" | "ready" | "error";

export async function guestRequest<T>(path: string, init?: RequestInit, guestToken?: string) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(guestToken ? { "x-seramet-guest-token": guestToken } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    code?: string;
  };
  if (!response.ok) throw new Error(body.message ?? `Guest request failed (${response.status})`);
  return body;
}

export function useGuestQuery<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<QueryStatus>("loading");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!path) return null;
    setStatus("loading");
    try {
      const value = await guestRequest<T>(path);
      setData(value);
      setError("");
      setStatus("ready");
      return value;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Guest service is unavailable");
      setStatus("error");
      return null;
    }
  }, [path]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { data, status, error, refresh };
}

export function readGuestSession(key: string) {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(`seramet.guest.session.${key}`);
}

export function writeGuestSession(key: string, token: string) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(`seramet.guest.session.${key}`, token);
  }
}

export function readGuestSessionContext(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.sessionStorage.getItem(`seramet.guest.context.${key}`) ?? "null") as {
      qrMode?: string;
      tableCode?: string;
    } | null;
  } catch {
    return null;
  }
}

export function writeGuestSessionContext(
  key: string,
  context: { qrMode?: string; tableCode?: string },
) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(`seramet.guest.context.${key}`, JSON.stringify(context));
  }
}

export function rememberGuestOrder(input: {
  restaurant: string;
  branch: string;
  reference: string;
  trackingToken: string;
}) {
  if (typeof window === "undefined") return;
  const key = `seramet.guest.orders.${input.restaurant}`;
  const current = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown[];
  window.localStorage.setItem(key, JSON.stringify([input, ...current].slice(0, 10)));
}

export function readRecentGuestOrders(restaurant: string) {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(
      window.localStorage.getItem(`seramet.guest.orders.${restaurant}`) ?? "[]",
    ) as Array<{
      restaurant: string;
      branch: string;
      reference: string;
      trackingToken: string;
    }>;
  } catch {
    return [];
  }
}
