type CloudflareRuntimeRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: unknown;
    };
  };
};

type NitroCloudflareGlobal = typeof globalThis & {
  __env__?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Nitro exposes Cloudflare bindings on the request in some execution paths and on
 * globalThis.__env__ in its module-worker adapter. Merge both so the application
 * receives the same authoritative bindings for SSR and direct Worker requests.
 */
export function cloudflareBindings(
  request: Request,
  fallbackBindings?: unknown,
): Record<string, unknown> {
  const runtimeRequest = request as CloudflareRuntimeRequest;
  const globalBindings = record((globalThis as NitroCloudflareGlobal).__env__);
  const fallback = record(fallbackBindings);
  const requestBindings = record(runtimeRequest.runtime?.cloudflare?.env);

  return {
    ...globalBindings,
    ...fallback,
    ...requestBindings,
  };
}
