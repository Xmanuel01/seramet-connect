import { z } from "zod";
import { authenticateSerametRequest, type SerametEnv } from "@/lib/seramet-auth";
import { resolveRuntimeConfiguration } from "@/server/environment";
import { ServerOperationError } from "@/server/errors";
import {
  clearPosSessionCookie,
  PosIdentityService,
  posSessionCookie,
  readCookie,
} from "@/server/pos-auth-service";
import { DatabaseRateLimiter } from "@/server/rate-limit";

const employeeLoginSchema = z
  .object({
    identifier: z.string().trim().min(2).max(254),
    pin: z.string().regex(/^\d{4}(?:\d{2})?$/),
  })
  .strict();

const employeeCreateSchema = z
  .object({
    idempotencyKey: z.string().trim().min(16).max(160),
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254).optional(),
    employeeCode: z.string().trim().min(2).max(40),
    phone: z.string().trim().max(40).optional(),
    jobTitle: z.string().trim().min(2).max(100),
    roleId: z.string().trim().min(1).max(120),
    assignedBranchIds: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
    primaryBranchId: z.string().trim().min(1).max(120),
    pin: z.string().regex(/^\d{4}(?:\d{2})?$/),
    pinConfirmation: z.string().regex(/^\d{4}(?:\d{2})?$/),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveUntil: z.string().datetime({ offset: true }).optional(),
    temporaryPin: z.boolean().optional(),
  })
  .strict();

const resetPinSchema = z
  .object({
    pin: z.string().regex(/^\d{4}(?:\d{2})?$/),
    pinConfirmation: z.string().regex(/^\d{4}(?:\d{2})?$/),
    reason: z.string().trim().min(8).max(500),
    temporary: z.boolean().optional(),
  })
  .strict();

const ownershipTransferSchema = z
  .object({
    targetUserId: z.string().trim().min(1).max(120),
    confirmation: z.literal("TRANSFER OWNERSHIP"),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export async function handleIdentityDeviceApi(request: Request, env: SerametEnv) {
  const url = new URL(request.url);
  if (!isHandledPath(url.pathname)) return null;
  if (
    url.pathname === "/api/seramet/public/device/startup" &&
    request.method === "GET" &&
    !readCookie(request, "seramet_device")
  ) {
    return Response.json({ ok: true, state: "UNREGISTERED" }, { headers: noStore() });
  }
  if (!env.SERAMET_DB)
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative identity store unavailable",
    );
  const service = new PosIdentityService(env.SERAMET_DB);
  const secure = resolveRuntimeConfiguration(env).productionLike;

  if (url.pathname === "/api/seramet/public/device/startup" && request.method === "GET") {
    const startup = await service.deviceStartup(readCookie(request, "seramet_device"));
    return Response.json({ ok: true, ...startup }, { headers: noStore() });
  }

  if (url.pathname === "/api/seramet/public/employee/login" && request.method === "POST") {
    assertSameOrigin(request, env);
    const body = parse(employeeLoginSchema, await request.json().catch(() => null));
    const deviceCredential = readCookie(request, "seramet_device");
    const networkHash = await hashNetworkSignal(request);
    await new DatabaseRateLimiter(env.SERAMET_DB).consume(
      `pos-login:${await digest(`${deviceCredential?.slice(0, 80) ?? "unknown"}:${body.identifier.toLowerCase()}:${networkHash}`)}`,
      { bucket: "pos-login", limit: 15, windowSeconds: 15 * 60 },
    );
    const login = await service.loginEmployee(
      deviceCredential,
      body.identifier,
      body.pin,
      networkHash,
    );
    const headers = noStore();
    headers.append("set-cookie", posSessionCookie(login.token, secure));
    return Response.json(
      {
        ok: true,
        employee: login.employee,
        mustChangePin: login.mustChangePin,
        expiresAt: login.expiresAt,
        nextPath: "/pos",
      },
      { headers },
    );
  }

  if (url.pathname === "/api/seramet/public/employee/logout" && request.method === "POST") {
    assertSameOrigin(request, env);
    const token = readCookie(request, "seramet_pos_session");
    if (token) await service.logoutPosSession(token);
    const headers = noStore();
    headers.append("set-cookie", clearPosSessionCookie(secure));
    return Response.json({ ok: true }, { headers });
  }

  if (url.pathname === "/api/seramet/employees" && request.method === "GET") {
    const actor = await authenticateSerametRequest(request, env);
    return Response.json(
      { ok: true, employees: await service.listEmployees(actor) },
      { headers: noStore() },
    );
  }

  if (url.pathname === "/api/seramet/employees" && request.method === "POST") {
    assertSameOrigin(request, env);
    const actor = await authenticateSerametRequest(request, env);
    const body = parse(employeeCreateSchema, await request.json().catch(() => null));
    const employee = await service.createEmployee(actor, body);
    return Response.json({ ok: true, employee }, { status: 201, headers: noStore() });
  }

  const pinReset = /^\/api\/seramet\/employees\/([^/]+)\/pin-reset$/.exec(url.pathname);
  if (pinReset && request.method === "POST") {
    assertSameOrigin(request, env);
    const actor = await authenticateSerametRequest(request, env);
    const body = parse(resetPinSchema, await request.json().catch(() => null));
    await service.resetPin(actor, decodeURIComponent(pinReset[1]!), body);
    return Response.json({ ok: true }, { headers: noStore() });
  }

  if (url.pathname === "/api/seramet/owners/transfer" && request.method === "POST") {
    assertSameOrigin(request, env);
    const actor = await authenticateSerametRequest(request, env);
    const body = parse(ownershipTransferSchema, await request.json().catch(() => null));
    const result = await service.transferOwnership(actor, body);
    return Response.json({ ok: true, transfer: result }, { headers: noStore() });
  }

  return new Response(null, { status: 405 });
}

function isHandledPath(pathname: string) {
  return (
    pathname === "/api/seramet/public/device/startup" ||
    pathname === "/api/seramet/public/employee/login" ||
    pathname === "/api/seramet/public/employee/logout" ||
    pathname === "/api/seramet/employees" ||
    pathname === "/api/seramet/owners/transfer" ||
    /^\/api\/seramet\/employees\/[^/]+\/pin-reset$/.test(pathname)
  );
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ServerOperationError("VALIDATION_FAILED", 400, "Invalid request");
  return result.data;
}

function assertSameOrigin(request: Request, env: SerametEnv) {
  const actual = request.headers.get("origin");
  const expected = resolveRuntimeConfiguration(env).productionLike
    ? env.SERAMET_PUBLIC_ORIGIN?.replace(/\/$/, "")
    : new URL(request.url).origin;
  if (!expected || (actual && actual !== expected))
    throw new ServerOperationError("PERMISSION_DENIED", 403, "Cross-origin request denied");
}

async function hashNetworkSignal(request: Request) {
  const value =
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  return digest(value.split(",")[0]!.trim());
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function noStore() {
  return new Headers({ "cache-control": "no-store", "content-type": "application/json" });
}
