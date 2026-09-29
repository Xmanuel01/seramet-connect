import { z } from "zod";
import type { SerametEnv } from "@/lib/seramet-auth";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { RestaurantRegistrationService } from "@/server/registration-service";
import { verifyExternalIdentity } from "@/server/identity/supabase-identity";
import { ServerOperationError } from "@/server/errors";

const registrationSchema = z
  .object({
    idempotencyKey: z.string().min(16).max(128),
    administratorName: z.string().trim().min(2).max(100),
    slug: z.string().trim().max(500).optional(),
    legalName: z.string().trim().min(2).max(160),
    tradingName: z.string().trim().min(2).max(120),
  })
  .strict();

export async function handleRegistrationApi(request: Request, env: SerametEnv) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/seramet/public/register") return null;
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Registration database unavailable",
    );
  }
  assertSameOrigin(request, env);
  const token = bearerOrCookie(request);
  if (!token)
    throw new ServerOperationError("AUTHENTICATION_REQUIRED", 401, "Verified login required");
  let identity;
  try {
    identity = await verifyExternalIdentity(token, env);
  } catch {
    throw new ServerOperationError("AUTHENTICATION_REQUIRED", 401, "Verified login required");
  }
  await new DatabaseRateLimiter(env.SERAMET_DB).consume(
    `registration:${identity.provider}:${identity.subject}`,
    { bucket: "restaurant-registration", limit: 50, windowSeconds: 60 * 60 },
  );
  const raw = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ServerOperationError(
      "VALIDATION_FAILED",
      400,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  const { slug, ...registration } = parsed.data;
  const organisation = await new RestaurantRegistrationService(env.SERAMET_DB).register(identity, {
    ...registration,
    ...(slug ? { slug } : {}),
  });
  return Response.json({ ok: true, organisation }, { status: 201 });
}

function assertSameOrigin(request: Request, env: SerametEnv) {
  const expected = env.SERAMET_PUBLIC_ORIGIN?.replace(/\/$/, "") ?? new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== expected) {
    throw new ServerOperationError("PERMISSION_DENIED", 403, "Cross-origin registration denied");
  }
}

function bearerOrCookie(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "seramet_access") return decodeURIComponent(value.join("="));
  }
  return undefined;
}
