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

export async function deviceStartup(): Promise<DeviceStartup> {
  const response = await fetch("/api/seramet/public/device/startup", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
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

export function enterRestaurant(tenantId: string, path = "/") {
  window.localStorage.setItem("seramet.session.tenant-id", tenantId);
  window.location.assign(path);
}
