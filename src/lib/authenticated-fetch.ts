import { clearInteractiveSignIn } from "@/lib/auth-client";
let refreshPromise: Promise<"OK" | "REJECTED" | "UNAVAILABLE"> | null = null;

async function refreshSession(): Promise<"OK" | "REJECTED" | "UNAVAILABLE"> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/seramet/public/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    })
      .then((response) =>
        response.ok
          ? ("OK" as const)
          : [401, 403].includes(response.status)
            ? ("REJECTED" as const)
            : ("UNAVAILABLE" as const),
      )
      .catch(() => "UNAVAILABLE" as const)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

function isPublicAuthRequest(input: RequestInfo | URL) {
  const value =
    typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;

  return value.includes("/api/seramet/public/auth/");
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  clearInteractiveSignIn();
  if (["/login", "/pos-login", "/register"].includes(window.location.pathname)) return;

  window.location.replace("/pos-login?reason=session-expired");
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const options: RequestInit = {
    ...init,
    credentials: init.credentials ?? "same-origin",
  };

  const response = await fetch(input, options);

  if (response.status !== 401 || isPublicAuthRequest(input)) {
    return response;
  }

  const refreshed = await refreshSession();

  if (refreshed === "UNAVAILABLE") {
    throw Object.assign(new Error("Session refresh is temporarily unavailable"), {
      httpStatus: 503,
    });
  }
  if (refreshed === "REJECTED") {
    redirectToLogin();
    return response;
  }

  return fetch(input, options);
}
