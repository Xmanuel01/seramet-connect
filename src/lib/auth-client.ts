import { permissions } from "@/platform/permissions";
import { clearPosDrafts } from "@/lib/pos-draft";
export type AuthRestaurant = { tenantId: string; slug: string; name: string };

export type AuthStatus = {
  ok: true;
  authenticated: boolean;
  identity?: { email: string | null; phone: string | null };
  restaurants: AuthRestaurant[];
};

export type DeviceStartup = {
  ok: true;
  state: "UNREGISTERED" | "ACTIVATION_PENDING" | "ACTIVE" | "LOCKED" | "REVOKED" | "RETIRED";
  device?: { id: string; name: string; tenantName: string; branchId: string; branchName: string };
  policy?: { pinLength: 4 | 6; allowEmployeeTiles: boolean; inactivityLockMinutes: number };
  employees?: Array<{ employeeCode: string; displayName: string }>;
};

export async function deviceStartup(signal?: AbortSignal): Promise<DeviceStartup> {
  const response = await fetch("/api/seramet/public/device/startup", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Device status is temporarily unavailable");
  return response.json() as Promise<DeviceStartup>;
}

export async function employeePinLogin(identifier: string, pin: string) {
  const response = await fetch("/api/seramet/public/employee/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, pin }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    nextPath?: string;
    mustChangePin?: boolean;
    employee?: { tenantId?: string };
  };
  if (!response.ok) throw new Error(payload.message ?? "Employee identifier or PIN is incorrect");
  return payload;
}

export async function authStatus(): Promise<AuthStatus> {
  const response = await fetch("/api/seramet/public/auth/status", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Authentication service is unavailable");
  return response.json() as Promise<AuthStatus>;
}

export async function authMutation(
  action: "login" | "signup" | "logout" | "refresh",
  body?: unknown,
) {
  const response = await fetch(`/api/seramet/public/auth/${action}`, {
    method: "POST",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    authenticated?: boolean;
    verificationRequired?: boolean;
  };
  if (!response.ok) throw new Error(payload.message ?? "The request could not be completed");
  return payload;
}

export async function enterRestaurant(tenantId: string, path?: string) {
  window.localStorage.setItem("seramet.session.tenant-id", tenantId);
  if (path) {
    window.location.assign(path);
    return;
  }
  try {
    const response = await fetch("/api/seramet/auth/session", {
      credentials: "same-origin",
      headers: { "x-seramet-tenant-id": tenantId },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Session access could not be verified");
    const result = (await response.json()) as { actor: { permissions: string[] } };
    const allowed = result.actor.permissions;
    window.location.assign(
      !allowed.includes(permissions.dashboardView) &&
        (allowed.includes(permissions.attendanceUse) || allowed.includes(permissions.staffManage))
        ? "/attendance"
        : "/",
    );
  } catch {
    // The protected entry point will enforce authentication; no cached access is granted.
    window.location.assign("/");
  }
}

// This is only a browser navigation gate. Authorization always happens on the server.
const interactiveSignInKey = "seramet.session.interactive-sign-in";

export function markInteractiveSignIn() {
  window.sessionStorage.setItem(interactiveSignInKey, "1");
}

export function hasInteractiveSignIn() {
  return (
    typeof window !== "undefined" && window.sessionStorage.getItem(interactiveSignInKey) === "1"
  );
}

export function clearInteractiveSignIn() {
  clearPosDrafts();
  if (typeof window !== "undefined") window.sessionStorage?.removeItem(interactiveSignInKey);
}

/** Revoke both account and device-PIN sessions; never treat a failed request as success. */
export async function revokeAllBrowserSessions() {
  const endpoints = ["/api/seramet/public/auth/logout", "/api/seramet/public/employee/logout"];
  const results = await Promise.allSettled(
    endpoints.map((url) => fetch(url, { method: "POST", credentials: "same-origin" })),
  );
  if (results.some((result) => result.status === "rejected" || !result.value.ok)) {
    throw new Error("Could not confirm that all sessions were revoked. Check your connection.");
  }
  try {
    for (const key of Object.keys(window.sessionStorage))
      if (key.startsWith("seramet.attendance.")) window.sessionStorage.removeItem(key);
  } catch {
    /* Storage may be disabled; server revocation remains authoritative. */
  }
}
