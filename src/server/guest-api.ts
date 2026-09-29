import { z } from "zod";
import { GuestExperienceService } from "@/guest/guest-service";
import {
  createGuestSessionSchema,
  createReservationSchema,
  guestCartSchema,
  guestGiftCardPaymentSchema,
  guestLoyaltyRedemptionSchema,
  guestMembershipLinkSchema,
  modifyReservationSchema,
  reservationAvailabilitySchema,
  serviceRequestSchema,
  submitGuestOrderSchema,
  waitlistSchema,
} from "@/guest/schemas";
import { hashCapabilityToken } from "@/guest/security";
import { GuestDomainError } from "@/guest/types";
import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import { authenticateSerametRequest, type SerametEnv } from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { permissions } from "@/platform/permissions";
import { DatabaseRateLimiter, type RateLimitPolicy } from "@/server/rate-limit";

const publicLimits = {
  read: { bucket: "guest-read", limit: 120, windowSeconds: 60 },
  session: { bucket: "guest-session", limit: 30, windowSeconds: 60 },
  quote: { bucket: "guest-quote", limit: 30, windowSeconds: 60 },
  order: { bucket: "guest-order", limit: 12, windowSeconds: 60 },
  reservationSearch: { bucket: "reservation-search", limit: 30, windowSeconds: 60 },
  reservationCreate: { bucket: "reservation-create", limit: 8, windowSeconds: 3_600 },
  tracking: { bucket: "guest-tracking", limit: 60, windowSeconds: 60 },
  payment: { bucket: "guest-payment", limit: 15, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

const publicCapabilityTokenSchema = z.string().trim().min(24).max(256);

const paymentSchema = z
  .object({
    trackingToken: z.string().trim().min(24).max(256),
    paymentMethodId: z.string().trim().min(1).max(120),
    amountMinor: z.number().int().positive().optional(),
    operation: z.enum(["PAYMENT_PROMPT", "QR_PAYMENT"]),
    customerPhone: z.string().trim().min(5).max(40).optional(),
    idempotencyKey: z.string().trim().min(12).max(160),
  })
  .strict();

const reservationDepositPaymentSchema = z
  .object({
    operation: z.enum(["PAYMENT_PROMPT", "QR_PAYMENT"]),
    customerPhone: z.string().trim().min(5).max(40).optional(),
    idempotencyKey: z.string().trim().min(12).max(160),
  })
  .strict();

const qrRotateSchema = z
  .object({
    branchId: z.string().trim().min(1).max(120),
    tableId: z.string().trim().min(1).max(120),
    mode: z.enum(["MENU_ONLY", "ORDERING_ENABLED", "ORDER_AND_PAY", "CALL_WAITER_ONLY"]),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const reservationTransitionSchema = z
  .object({
    branchId: z.string().trim().min(1).max(120),
    reservationId: z.string().trim().min(1).max(120),
    status: z.enum([
      "PENDING",
      "CONFIRMED",
      "SEATED",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
      "WAITLISTED",
    ]),
    reason: z.string().trim().max(280).optional(),
  })
  .strict();

const walkInSchema = z
  .object({
    branchId: z.string().trim().min(1).max(120),
    tableId: z.string().trim().min(1).max(120),
    guestName: z.string().trim().min(1).max(120),
    partySize: z.number().int().min(1).max(100),
    idempotencyKey: z.string().trim().min(12).max(160),
  })
  .strict();

const operationalTransitionSchema = z
  .object({
    branchId: z.string().trim().min(1).max(120),
    id: z.string().trim().min(1).max(120),
    status: z.string().trim().min(1).max(40),
    tableId: z.string().trim().min(1).max(120).optional(),
    reason: z.string().trim().max(280).optional(),
  })
  .strict();

const tableSessionCloseSchema = z
  .object({
    branchId: z.string().trim().min(1).max(120),
    tableSessionId: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(3).max(280),
  })
  .strict();

const reservationDepositApplicationSchema = z
  .object({
    branchId: z.string().trim().min(1).max(120),
    reservationId: z.string().trim().min(1).max(120),
    depositId: z.string().trim().min(1).max(120),
    orderId: z.string().trim().min(1).max(120),
    idempotencyKey: z.string().trim().min(12).max(160),
  })
  .strict();

export async function handleGuestApi(
  request: Request,
  env: SerametEnv,
  transactions: TransactionRepository,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/guest")) return null;
  if (!env.SERAMET_DB)
    return response(
      {
        ok: false,
        code: "UNAVAILABLE",
        message: "Guest service requires the authoritative database",
      },
      503,
    );
  const runtime = createIntegrationRuntime(env, { transactions });
  const secret =
    env.SERAMET_JWT_SECRET ??
    (String(env.SERAMET_ENVIRONMENT) === "development"
      ? "seramet-explicit-development-guest-capability-secret"
      : "");
  try {
    const service = new GuestExperienceService(
      env.SERAMET_DB,
      transactions,
      secret,
      (previous, next) => runtime.captureTransactionDomainEvents(previous, next),
    );
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (parts[2] === "guest-admin") {
      return handleGuestAdmin(request, url, parts.slice(3), env, service);
    }
    if (parts[2] !== "guest") return null;
    const route = parts.slice(3);

    if (route[0] === "track" && route[1] && request.method === "GET") {
      await rateLimit(request, env, publicLimits.tracking, route[1]);
      return response({ ok: true, order: await service.trackOrder(route[1]) });
    }
    if (route[0] === "receipts" && route[1] && request.method === "GET") {
      const token = guestToken(request);
      await rateLimit(request, env, publicLimits.tracking, route[1]);
      return response({ ok: true, receipt: await service.digitalReceipt(token, route[1]) });
    }
    if (route[0] === "orders" && route[1] && request.method === "DELETE") {
      const token = guestToken(request);
      await rateLimit(request, env, publicLimits.order, token);
      const body = await optionalJson<{ reason?: string }>(request);
      return response({
        ok: true,
        ...(await service.cancelGuestOrder(token, route[1], body.reason)),
      });
    }
    if (route[0] === "reservations" && route[1]) {
      await rateLimit(request, env, publicLimits.reservationSearch, route[1]);
      if (route[2] === "deposit" && request.method === "POST") {
        await rateLimit(request, env, publicLimits.payment, route[1]);
        const body = reservationDepositPaymentSchema.parse(await readJson(request));
        const context = await service.reservationDepositContext(route[1]);
        if (context.alreadyConfirmed) {
          return response({ ok: true, payment: context });
        }
        const initiated = await runtime.initiateUnallocatedPayment({
          tenantId: context.tenantId,
          branchId: context.branchId,
          paymentMethodId: context.paymentMethodId,
          amountMinor: context.amountMinor,
          currency: context.currency,
          actor: `guest:reservation:${context.reservationId}`,
          idempotencyKey: `reservation-deposit:${context.depositId}`,
          merchantReference: `reservation:${context.reservationId}`,
          collectionCreditAccountId: context.liabilityAccountId,
          collectionPurpose: "RESERVATION_DEPOSIT",
          operation: body.operation,
          ...(body.customerPhone ? { customerPhone: body.customerPhone } : {}),
        });
        const intentId = initiated.intent?.id;
        if (!intentId)
          throw new GuestDomainError("UNAVAILABLE", 503, "Deposit payment could not be initiated");
        const reservation = await service.linkReservationDepositIntent(
          route[1],
          intentId,
          Boolean(initiated.provider?.ok || initiated.replayed),
        );
        return response(
          {
            ok: true,
            reservation,
            payment: {
              intentId,
              status: initiated.intent?.status,
              replayed: initiated.replayed,
              provider: initiated.provider?.ok ? initiated.provider.value : undefined,
            },
          },
          202,
        );
      }
      if (request.method === "GET")
        return response({ ok: true, reservation: await service.getReservation(route[1]) });
      if (request.method === "DELETE") {
        const body = await optionalJson<{ reason?: string }>(request);
        return response({ ok: true, ...(await service.cancelReservation(route[1], body.reason)) });
      }
      if (request.method === "PATCH") {
        return response({
          ok: true,
          reservation: await service.modifyReservation(
            route[1],
            modifyReservationSchema.parse(await readJson(request)),
          ),
        });
      }
    }
    if (route[0] === "service-requests" && request.method === "POST") {
      const token = guestToken(request);
      await rateLimit(request, env, publicLimits.order, token);
      return response(
        {
          ok: true,
          request: await service.createServiceRequest(
            token,
            serviceRequestSchema.parse(await readJson(request)),
          ),
        },
        201,
      );
    }
    if (route[0] === "payments" && request.method === "POST") {
      const token = guestToken(request);
      const body = paymentSchema.parse(await readJson(request));
      await rateLimit(request, env, publicLimits.payment, token);
      const context = await service.guestPaymentContext(
        token,
        body.trackingToken,
        body.paymentMethodId,
        body.amountMinor,
      );
      const initiated = await runtime.initiatePayment({
        tenantId: context.tenantId,
        branchId: context.branchId,
        invoiceId: context.invoiceId,
        paymentMethodId: context.paymentMethodId,
        amountMinor: context.amountMinor,
        currency: context.currency,
        actor: `guest:${context.guestSessionId}`,
        idempotencyKey: `guest-payment:${context.guestSessionId}:${body.idempotencyKey}`,
        operation: body.operation,
        ...(body.customerPhone ? { customerPhone: body.customerPhone } : {}),
      });
      return response(
        {
          ok: true,
          payment: {
            intentId: initiated.intent?.id,
            status: initiated.intent?.status,
            replayed: initiated.replayed,
            provider: initiated.provider?.ok ? initiated.provider.value : undefined,
          },
        },
        202,
      );
    }
    if (route[0] === "stored-value" && request.method === "POST") {
      const token = guestToken(request);
      const body = guestGiftCardPaymentSchema.parse(await readJson(request));
      await rateLimit(request, env, publicLimits.payment, token);
      return response({ ok: true, payment: await service.redeemGuestGiftCard(token, body) });
    }
    if (route[0] === "loyalty" && request.method === "POST") {
      const token = guestToken(request);
      const body = guestLoyaltyRedemptionSchema.parse(await readJson(request));
      await rateLimit(request, env, publicLimits.payment, token);
      return response({ ok: true, payment: await service.redeemGuestLoyalty(token, body) });
    }
    if (route[0] === "account" && request.method === "GET") {
      const token = guestToken(request);
      await rateLimit(request, env, publicLimits.tracking, token);
      return response({ ok: true, account: await service.guestPortalSummary(token) });
    }
    if (route[0] === "account" && route[1] === "membership" && request.method === "POST") {
      const token = guestToken(request);
      await rateLimit(request, env, publicLimits.payment, token);
      const body = guestMembershipLinkSchema.parse(await readJson(request));
      return response({
        ok: true,
        membership: await service.linkLoyaltyMembership(token, body.memberToken),
      });
    }

    if (route[0] !== "restaurants" || !route[1])
      return response({ ok: false, message: "Guest API route not found" }, 404);
    const restaurantSlug = route[1];
    const branchSlug = route[2];
    if (!branchSlug && request.method === "GET") {
      await rateLimit(request, env, publicLimits.read, restaurantSlug);
      return response({ ok: true, ...(await service.publicRestaurant(restaurantSlug)) }, 200, 60);
    }
    if (!branchSlug) return response({ ok: false, message: "Branch route is required" }, 404);
    const operation = route[3];
    if (!operation && request.method === "GET") {
      await rateLimit(request, env, publicLimits.read, `${restaurantSlug}:${branchSlug}`);
      return response(
        { ok: true, ...(await service.publicRestaurant(restaurantSlug, branchSlug)) },
        200,
        60,
      );
    }
    if (operation === "menu" && request.method === "GET") {
      await rateLimit(request, env, publicLimits.read, `${restaurantSlug}:${branchSlug}`);
      const mode = url.searchParams.get("serviceMode") as Parameters<typeof service.publicMenu>[2];
      return response(
        { ok: true, ...(await service.publicMenu(restaurantSlug, branchSlug, mode)) },
        200,
        30,
      );
    }
    if (operation === "payment-methods" && request.method === "GET") {
      await rateLimit(request, env, publicLimits.read, `${restaurantSlug}:${branchSlug}:payments`);
      return response(
        { ok: true, methods: await service.publicPaymentMethods(restaurantSlug, branchSlug) },
        200,
        30,
      );
    }
    if (operation === "sessions" && request.method === "POST") {
      await rateLimit(request, env, publicLimits.session, `${restaurantSlug}:${branchSlug}`);
      const body = createGuestSessionSchema.parse(await readJson(request));
      return response(
        {
          ok: true,
          session: await service.createSession({
            restaurantSlug,
            branchSlug,
            ...body,
            fingerprint: request.headers.get("user-agent") ?? undefined,
          }),
        },
        201,
      );
    }
    if (operation === "quotes" && request.method === "POST") {
      const token = guestToken(request);
      await rateLimit(request, env, publicLimits.quote, token);
      return response(
        {
          ok: true,
          quote: await service.createQuote(token, guestCartSchema.parse(await readJson(request))),
        },
        201,
      );
    }
    if (operation === "orders" && request.method === "POST") {
      const token = guestToken(request);
      await rateLimit(request, env, publicLimits.order, token);
      return response(
        {
          ok: true,
          order: await service.submitOrder(
            token,
            submitGuestOrderSchema.parse(await readJson(request)),
          ),
        },
        201,
      );
    }
    if (operation === "reservations" && route[4] === "availability" && request.method === "POST") {
      await rateLimit(
        request,
        env,
        publicLimits.reservationSearch,
        `${restaurantSlug}:${branchSlug}`,
      );
      const body = reservationAvailabilitySchema.parse(await readJson(request));
      return response({
        ok: true,
        availability: await service.reservationAvailability(restaurantSlug, branchSlug, body),
      });
    }
    if (operation === "reservations" && request.method === "POST") {
      await rateLimit(
        request,
        env,
        publicLimits.reservationCreate,
        `${restaurantSlug}:${branchSlug}`,
      );
      const body = createReservationSchema.parse(await readJson(request));
      return response(
        {
          ok: true,
          reservation: await service.createReservation(restaurantSlug, branchSlug, {
            ...body,
            guestSessionToken: optionalGuestToken(request),
          }),
        },
        201,
      );
    }
    if (operation === "waitlist" && request.method === "POST") {
      await rateLimit(
        request,
        env,
        publicLimits.reservationCreate,
        `${restaurantSlug}:${branchSlug}:waitlist`,
      );
      const body = waitlistSchema.parse(await readJson(request));
      return response(
        {
          ok: true,
          waitlist: await service.joinWaitlist(restaurantSlug, branchSlug, {
            ...body,
            guestSessionToken: optionalGuestToken(request),
          }),
        },
        201,
      );
    }
    return response({ ok: false, message: "Guest API route not found" }, 404);
  } catch (error) {
    if (error instanceof GuestDomainError) {
      return response({ ok: false, code: error.code, message: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      return response(
        {
          ok: false,
          code: "VALIDATION_FAILED",
          message: error.issues[0]?.message ?? "Request validation failed",
        },
        400,
      );
    }
    throw error;
  }
}

async function handleGuestAdmin(
  request: Request,
  url: URL,
  route: string[],
  env: SerametEnv,
  service: GuestExperienceService,
) {
  const actor = await authenticateSerametRequest(request, env);
  const branchId = url.searchParams.get("branchId") ?? actor.branchId;
  if (route[0] === "host" && request.method === "GET") {
    return response({
      ok: true,
      ...(await service.hostDashboard(
        actor,
        branchId,
        url.searchParams.get("businessDate") ?? undefined,
      )),
    });
  }
  if (route[0] === "reservations" && route[1] === "transition" && request.method === "POST") {
    return response({
      ok: true,
      ...(await service.staffReservationTransition(
        actor,
        reservationTransitionSchema.parse(await readJson(request)),
      )),
    });
  }
  if (route[0] === "walk-ins" && request.method === "POST") {
    return response(
      {
        ok: true,
        ...(await service.seatWalkIn(actor, walkInSchema.parse(await readJson(request)))),
      },
      201,
    );
  }
  if (route[0] === "waitlist" && route[1] === "transition" && request.method === "POST") {
    const body = operationalTransitionSchema.parse(await readJson(request));
    return response({
      ok: true,
      ...(await service.staffWaitlistTransition(actor, {
        ...body,
        status: z.enum(["NOTIFIED", "SEATED", "CANCELLED", "EXPIRED"]).parse(body.status),
        ...(body.reason ? { reason: body.reason } : {}),
      })),
    });
  }
  if (route[0] === "service-requests" && route[1] === "transition" && request.method === "POST") {
    const body = operationalTransitionSchema.parse(await readJson(request));
    return response({
      ok: true,
      ...(await service.staffServiceRequestTransition(actor, {
        ...body,
        status: z.enum(["ACKNOWLEDGED", "COMPLETED", "CANCELLED"]).parse(body.status),
        ...(body.reason ? { reason: body.reason } : {}),
      })),
    });
  }
  if (route[0] === "tables" && route[1] === "close" && request.method === "POST") {
    return response({
      ok: true,
      ...(await service.closeTableSession(
        actor,
        tableSessionCloseSchema.parse(await readJson(request)),
      )),
    });
  }
  if (route[0] === "reservation-deposits" && route[1] === "apply" && request.method === "POST") {
    return response({
      ok: true,
      ...(await service.applyReservationDeposit(
        actor,
        reservationDepositApplicationSchema.parse(await readJson(request)),
      )),
    });
  }
  if (route[0] === "qr" && request.method === "GET") {
    return response({ ok: true, tokens: await service.listQrTokens(actor, branchId) });
  }
  if (route[0] === "qr" && route[1] === "rotate" && request.method === "POST") {
    return response(
      {
        ok: true,
        qr: await service.rotateQrToken(actor, qrRotateSchema.parse(await readJson(request))),
      },
      201,
    );
  }
  if (route[0] === "qr" && route[1] && request.method === "DELETE") {
    return response({ ok: true, ...(await service.disableQrToken(actor, branchId, route[1])) });
  }
  return response({ ok: false, message: "Guest administration route not found" }, 404);
}

async function rateLimit(
  request: Request,
  env: SerametEnv,
  policy: RateLimitPolicy,
  subject: string,
) {
  if (!env.SERAMET_DB) return;
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const scopeHash = await hashCapabilityToken(`${address}:${subject}`);
  await new DatabaseRateLimiter(env.SERAMET_DB).consume(scopeHash, policy);
}

function guestToken(request: Request) {
  const value = optionalGuestToken(request);
  if (!value) throw new GuestDomainError("FORBIDDEN", 401, "Guest session token is required");
  return value;
}

function optionalGuestToken(request: Request) {
  const authorization = request.headers.get("authorization")?.match(/^Guest\s+(.+)$/i)?.[1];
  const value = authorization ?? request.headers.get("x-seramet-guest-token")?.trim();
  return value ? publicCapabilityTokenSchema.parse(value) : undefined;
}

async function readJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 131_072)
    throw new GuestDomainError("VALIDATION_FAILED", 413, "Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 131_072)
    throw new GuestDomainError("VALIDATION_FAILED", 413, "Request body is too large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GuestDomainError("VALIDATION_FAILED", 400, "Request body must be valid JSON");
  }
}

async function optionalJson<T>(request: Request) {
  if (!request.headers.get("content-length")) return {} as T;
  return (await readJson(request)) as T;
}

function response(body: unknown, status = 200, publicMaxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": publicMaxAge
        ? `public, max-age=${publicMaxAge}, stale-while-revalidate=30`
        : "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'self'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
