import { z } from "zod";
import type { SerametEnv } from "@/lib/seramet-auth";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { ServerOperationError } from "@/server/errors";
import { verifyExternalIdentity } from "@/server/identity/supabase-identity";
import { resolveRuntimeConfiguration } from "@/server/environment";
import { structuredServerLog } from "@/server/logging";

const credentialsSchema = z
  .object({ email: z.string().trim().email().max(254), password: z.string().min(10).max(200) })
  .strict();
const signupSchema = credentialsSchema.extend({ name: z.string().trim().min(2).max(100) }).strict();

type SupabaseSessionPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string; email_confirmed_at?: string | null };
};

export async function handleSupabaseAuthApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/public/auth")) return null;
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const availability = publicAuthAvailability(env);
  const databaseAvailable = Boolean(env.SERAMET_DB);
  if (url.pathname === "/api/seramet/public/auth/config" && request.method === "GET") {
    return Response.json({
      ok: true,
      provider: env.SERAMET_IDENTITY_PROVIDER ?? "unconfigured",
      enabled: env.SERAMET_IDENTITY_PROVIDER === "supabase" && Boolean(env.SERAMET_SUPABASE_URL),
    });
  }
  assertSameOrigin(request, env);

  if (url.pathname === "/api/seramet/public/auth/signup" && request.method === "POST") {
    const body = parse(signupSchema, await request.json().catch(() => null));
    if (databaseAvailable) {
      await throttle(env, request, `signup:${body.email.toLowerCase()}`, 5, 60 * 60);
    }
    const redirect = `${trustedOrigin(request, env)}/login?verified=1`;
    const response = await supabaseRequest<SupabaseSessionPayload>(
      env,
      `/auth/v1/signup?redirect_to=${encodeURIComponent(redirect)}`,
      { email: body.email, password: body.password, data: { display_name: body.name } },
    );
    const headers = sessionCookies(response, env);
    return Response.json(
      {
        ok: true,
        verificationRequired: !response.access_token,
        authenticated: Boolean(response.access_token),
      },
      { status: 202, headers },
    );
  }

  if (url.pathname === "/api/seramet/public/auth/login" && request.method === "POST") {
    let stage: PublicAuthLoginStage = "request-validation";
    structuredServerLog({
      environment: resolveRuntimeConfiguration(env).environment,
      operation: "public-auth-login",
      result: "started",
      correlationId,
      metadata: {
        route: url.pathname,
        stage,
        databaseAvailability: availability.databaseAvailability,
        requiredConfigAvailability: availability.requiredConfigAvailability,
      },
    });
    try {
      const body = parse(credentialsSchema, await request.json().catch(() => null));
      stage = "rate-limit";
      if (databaseAvailable) {
        await throttle(env, request, `login:${body.email.toLowerCase()}`, 10, 15 * 60);
      }
      stage = "supabase-auth";
      const response = await supabaseRequest<SupabaseSessionPayload>(
        env,
        "/auth/v1/token?grant_type=password",
        body,
        undefined,
        "Email or password is incorrect",
      );
      stage = "session-cookie";
      if (!response.access_token || !response.refresh_token) {
        throw new ServerOperationError(
          "AUTHENTICATION_REQUIRED",
          401,
          "Email or password is incorrect",
        );
      }
      structuredServerLog({
        environment: resolveRuntimeConfiguration(env).environment,
        operation: "public-auth-login",
        result: "succeeded",
        correlationId,
        metadata: {
          route: url.pathname,
          stage,
          databaseAvailability: availability.databaseAvailability,
          requiredConfigAvailability: availability.requiredConfigAvailability,
        },
      });
      return Response.json(
        { ok: true, authenticated: true },
        { headers: sessionCookies(response, env) },
      );
    } catch (error) {
      logPublicAuthFailure({
        env,
        route: url.pathname,
        stage,
        correlationId,
        availability,
        error,
      });
      if (error instanceof ServerOperationError && error.status < 500) {
        return Response.json(publicError(error, correlationId).body, { status: error.status });
      }
      return Response.json({ ok: false, message: "Seramet API failure" }, { status: 500 });
    }
  }

  if (url.pathname === "/api/seramet/public/auth/refresh" && request.method === "POST") {
    const refreshToken = readCookie(request, "seramet_refresh");
    if (!refreshToken)
      throw new ServerOperationError("AUTHENTICATION_REQUIRED", 401, "Session expired");
    if (databaseAvailable) {
      await throttle(env, request, "refresh", 30, 60);
    }
    const response = await supabaseRequest<SupabaseSessionPayload>(
      env,
      "/auth/v1/token?grant_type=refresh_token",
      { refresh_token: refreshToken },
      undefined,
      "Session expired",
    );
    if (!response.access_token || !response.refresh_token) {
      throw new ServerOperationError("AUTHENTICATION_REQUIRED", 401, "Session expired");
    }
    return Response.json(
      { ok: true, authenticated: true },
      { headers: sessionCookies(response, env) },
    );
  }

  if (url.pathname === "/api/seramet/public/auth/logout" && request.method === "POST") {
    const accessToken = readCookie(request, "seramet_access");
    if (accessToken) {
      const identity = await verifyExternalIdentity(accessToken, env).catch(() => undefined);
      if (identity) {
        await env.SERAMET_DB.prepare(
          `UPDATE auth_sessions SET revoked_at=?
           WHERE id=? AND revoked_at IS NULL AND tenant_id IN (
             SELECT tenant_id FROM identity_accounts WHERE provider=? AND subject=?
           )`,
        )
          .bind(new Date().toISOString(), identity.sessionId, identity.provider, identity.subject)
          .run();
      }
      await supabaseRequest(env, "/auth/v1/logout", undefined, accessToken, "Logout failed").catch(
        () => undefined,
      );
    }
    return Response.json({ ok: true }, { headers: clearSessionCookies(env) });
  }

  if (url.pathname === "/api/seramet/public/auth/status" && request.method === "GET") {
    const token =
      request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ??
      readCookie(request, "seramet_access");
    if (!token) return Response.json({ ok: true, authenticated: false, restaurants: [] });
    let identity;
    try {
      identity = await verifyExternalIdentity(token, env);
    } catch {
      return Response.json(
        { ok: true, authenticated: false, restaurants: [] },
        { headers: clearSessionCookies(env) },
      );
    }
    const result = await env.SERAMET_DB.prepare(
      `SELECT i.tenant_id,t.slug,t.trading_name
       FROM identity_accounts i JOIN tenants t ON t.id=i.tenant_id AND t.active=1
       WHERE i.provider=? AND i.subject=? ORDER BY t.trading_name,t.id LIMIT 50`,
    )
      .bind(identity.provider, identity.subject)
      .all<{ tenant_id: string; slug: string; trading_name: string }>();
    return Response.json({
      ok: true,
      authenticated: true,
      identity: { email: identity.email ?? null, phone: identity.phone ?? null },
      restaurants: (result.results ?? []).map((row) => ({
        tenantId: row.tenant_id,
        slug: row.slug,
        name: row.trading_name,
      })),
    });
  }

  return new Response(null, { status: 404 });
}

async function supabaseRequest<T = Record<string, unknown>>(
  env: SerametEnv,
  path: string,
  body?: unknown,
  bearer?: string,
  publicError = "Identity provider request failed",
) {
  const baseUrl = normalizedSupabaseUrl(env.SERAMET_SUPABASE_URL);
  const apiKey = env.SERAMET_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!apiKey) {
    throw new ServerOperationError(
      "EXTERNAL_SERVICE_UNAVAILABLE",
      503,
      "Identity provider is unavailable",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "content-type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ServerOperationError("AUTHENTICATION_REQUIRED", 401, publicError);
    return (await response.json().catch(() => ({}))) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function throttle(
  env: SerametEnv,
  request: Request,
  action: string,
  limit: number,
  windowSeconds: number,
) {
  const ip =
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const scope = await sha256(`${action}:${ip.split(",")[0]?.trim()}`);
  await new DatabaseRateLimiter(env.SERAMET_DB!).consume(`public-auth:${scope}`, {
    bucket: action.split(":", 1)[0] ?? "public-auth",
    limit,
    windowSeconds,
  });
}

function sessionCookies(payload: SupabaseSessionPayload, env: SerametEnv) {
  const headers = new Headers({ "cache-control": "no-store" });
  if (!payload.access_token || !payload.refresh_token) return headers;
  const secure = resolveRuntimeConfiguration(env).productionLike ? "; Secure" : "";
  const accessSeconds = Math.max(60, Math.min(payload.expires_in ?? 3600, 3600));
  headers.append(
    "set-cookie",
    `seramet_access=${encodeURIComponent(payload.access_token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${accessSeconds}${secure}`,
  );
  headers.append(
    "set-cookie",
    `seramet_refresh=${encodeURIComponent(payload.refresh_token)}; HttpOnly; Path=/api/seramet/public/auth; SameSite=Strict; Max-Age=2592000${secure}`,
  );
  return headers;
}

function clearSessionCookies(env: SerametEnv) {
  const headers = new Headers({ "cache-control": "no-store" });
  const secure = resolveRuntimeConfiguration(env).productionLike ? "; Secure" : "";
  headers.append(
    "set-cookie",
    `seramet_access=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  );
  headers.append(
    "set-cookie",
    `seramet_refresh=; HttpOnly; Path=/api/seramet/public/auth; SameSite=Strict; Max-Age=0${secure}`,
  );
  return headers;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

function assertSameOrigin(request: Request, env: SerametEnv) {
  const origin = request.headers.get("origin");
  if (origin && origin !== trustedOrigin(request, env)) {
    throw new ServerOperationError("PERMISSION_DENIED", 403, "Cross-origin authentication denied");
  }
}

function trustedOrigin(request: Request, env: SerametEnv) {
  return (env.SERAMET_PUBLIC_ORIGIN ?? new URL(request.url).origin).replace(/\/$/, "");
}

function normalizedSupabaseUrl(value?: string) {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:") {
    throw new ServerOperationError(
      "EXTERNAL_SERVICE_UNAVAILABLE",
      503,
      "Identity provider is unavailable",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ServerOperationError("VALIDATION_FAILED", 400, "Invalid request");
  return result.data;
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type PublicAuthLoginStage = "request-validation" | "rate-limit" | "supabase-auth" | "session-cookie";

type PublicAuthAvailability = {
  databaseAvailability: "available" | "missing";
  requiredConfigAvailability: {
    identityProvider: "supabase" | "other" | "unconfigured";
    supabaseUrl: "configured" | "missing";
    publishableKey: "configured" | "missing";
    publicOrigin: "configured" | "missing";
  };
};

function publicAuthAvailability(env: SerametEnv): PublicAuthAvailability {
  return {
    databaseAvailability: env.SERAMET_DB ? "available" : "missing",
    requiredConfigAvailability: {
      identityProvider:
        env.SERAMET_IDENTITY_PROVIDER === "supabase"
          ? "supabase"
          : env.SERAMET_IDENTITY_PROVIDER
            ? "other"
            : "unconfigured",
      supabaseUrl: env.SERAMET_SUPABASE_URL?.trim() ? "configured" : "missing",
      publishableKey: env.SERAMET_SUPABASE_PUBLISHABLE_KEY?.trim() ? "configured" : "missing",
      publicOrigin: env.SERAMET_PUBLIC_ORIGIN?.trim() ? "configured" : "missing",
    },
  };
}

function logPublicAuthFailure(input: {
  env: SerametEnv;
  route: string;
  stage: PublicAuthLoginStage;
  correlationId: string;
  availability: PublicAuthAvailability;
  error: unknown;
}) {
  structuredServerLog({
    environment: resolveRuntimeConfiguration(input.env).environment,
    operation: "public-auth-login",
    result: "failed",
    correlationId: input.correlationId,
    metadata: {
      route: input.route,
      stage: input.stage,
      errorName: input.error instanceof Error ? input.error.name : typeof input.error,
      safeErrorCode:
        input.error instanceof ServerOperationError ? input.error.code : "INTERNAL_ERROR",
      databaseAvailability: input.availability.databaseAvailability,
      requiredConfigAvailability: input.availability.requiredConfigAvailability,
      stack: input.error instanceof Error ? input.error.stack : undefined,
    },
  });
}
