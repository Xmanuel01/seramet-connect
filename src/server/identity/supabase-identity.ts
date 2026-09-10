import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import type { ProductionRuntimeEnv } from "@/server/environment";

export type VerifiedExternalIdentity = {
  provider: "supabase";
  subject: string;
  sessionId: string;
  email?: string;
  phone?: string;
  emailVerified: boolean;
  issuedAt: number;
  expiresAt: number;
  tokenId?: string;
};

export type ExternalIdentityVerifier = {
  verify(token: string): Promise<VerifiedExternalIdentity>;
};

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
  email_confirmed_at?: string | null;
};

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyExternalIdentity(
  token: string,
  env: ProductionRuntimeEnv & { SERAMET_IDENTITY_VERIFIER?: ExternalIdentityVerifier },
) {
  if (env.SERAMET_IDENTITY_VERIFIER) return env.SERAMET_IDENTITY_VERIFIER.verify(token);
  if (env.SERAMET_IDENTITY_PROVIDER !== "supabase") {
    throw new Error("External identity provider is not configured");
  }
  const baseUrl = normalizedSupabaseUrl(env.SERAMET_SUPABASE_URL);
  const publishableKey = env.SERAMET_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) throw new Error("Supabase publishable key is not configured");
  const issuer = `${baseUrl}/auth/v1`;

  try {
    const jwks = remoteJwks(issuer);
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: "authenticated",
      algorithms: ["RS256", "ES256"],
    });
    const user = await fetchSupabaseUser(token, baseUrl, publishableKey);
    if (user.id !== payload.sub) throw new Error("Supabase identity mismatch");
    return mapIdentity(payload, user);
  } catch (error) {
    const header = decodeProtectedHeaderSafely(token);
    if (header !== "HS256") throw error;
    return verifyLegacySupabaseToken(token, baseUrl, publishableKey);
  }
}

function remoteJwks(issuer: string) {
  const existing = jwksByIssuer.get(issuer);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    cooldownDuration: 20_000,
    cacheMaxAge: 10 * 60_000,
    timeoutDuration: 5_000,
  });
  jwksByIssuer.set(issuer, created);
  return created;
}

async function verifyLegacySupabaseToken(token: string, baseUrl: string, publishableKey: string) {
  const user = await fetchSupabaseUser(token, baseUrl, publishableKey);
  const payload = decodeJwt(token);
  if (!user.id || payload.sub !== user.id) throw new Error("Supabase identity mismatch");
  return mapIdentity(payload, user);
}

async function fetchSupabaseUser(token: string, baseUrl: string, publishableKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_500);
  try {
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Supabase session is invalid or expired");
    return (await response.json()) as SupabaseUserResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function mapIdentity(payload: JWTPayload, user?: SupabaseUserResponse): VerifiedExternalIdentity {
  if (!payload.sub || !payload.exp || !payload.iat) {
    throw new Error("Supabase access token claims are incomplete");
  }
  const sessionId = stringClaim(payload, "session_id") ?? payload.jti;
  if (!sessionId) throw new Error("Supabase access token has no stable session identifier");
  const email = user?.email ?? stringClaim(payload, "email");
  const phone = user?.phone ?? stringClaim(payload, "phone");
  return {
    provider: "supabase",
    subject: payload.sub,
    sessionId: `supabase:${sessionId}`,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    emailVerified: Boolean(user?.email_confirmed_at),
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    ...(payload.jti ? { tokenId: payload.jti } : {}),
  };
}

function normalizedSupabaseUrl(value?: string) {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:") throw new Error("Supabase Auth URL must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

function stringClaim(payload: JWTPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" && value ? value : undefined;
}

function decodeProtectedHeaderSafely(token: string) {
  try {
    const encoded = token.split(".")[0];
    if (!encoded) return undefined;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    ) as {
      alg?: string;
    };
    return decoded.alg;
  } catch {
    return undefined;
  }
}
