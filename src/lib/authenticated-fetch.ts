let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/seramet/public/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

function isPublicAuthRequest(input: RequestInfo | URL) {
  const value =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;

  return value.includes("/api/seramet/public/auth/");
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;

  window.location.assign("/login?reason=session-expired");
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

  if (!refreshed) {
    redirectToLogin();
    return response;
  }

  return fetch(input, options);
}