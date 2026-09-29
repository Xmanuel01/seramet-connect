import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { ManagementIntelligenceService } from "@/management/management-intelligence-service";
import {
  actionTransitionSchema,
  branchTargetSchema,
  recalculationRequestSchema,
  thresholdPolicySchema,
} from "@/management/schemas";
import { ServerOperationError } from "@/server/errors";
import { enqueueManagementRecalculation } from "@/server/workers";
import type { ZodTypeAny } from "zod";

export async function handleManagementApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/management")) return null;
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative management database unavailable",
    );
  }
  const service = new ManagementIntelligenceService(env.SERAMET_DB, actor);

  if (url.pathname === "/api/seramet/management/control-centre" && request.method === "GET") {
    const periodStart = optional(url, "periodStart");
    const periodEnd = optional(url, "periodEnd");
    return json({
      ok: true,
      controlCentre: await service.controlCentre({
        branchId: required(url, "branchId"),
        ...(periodStart ? { periodStart } : {}),
        ...(periodEnd ? { periodEnd } : {}),
        limit: boundedLimit(url),
      }),
    });
  }
  if (url.pathname === "/api/seramet/management/owner" && request.method === "GET") {
    return json({
      ok: true,
      owner: await service.ownerControlCentre(
        optional(url, "periodStart"),
        optional(url, "periodEnd"),
      ),
    });
  }
  if (url.pathname === "/api/seramet/management/food-cost-bridge" && request.method === "GET") {
    return json({
      ok: true,
      bridge: await service.foodCostBridge({
        branchId: required(url, "branchId"),
        currentStart: required(url, "currentStart"),
        currentEnd: required(url, "currentEnd"),
        previousStart: required(url, "previousStart"),
        previousEnd: required(url, "previousEnd"),
      }),
    });
  }
  if (url.pathname === "/api/seramet/management/thresholds" && request.method === "POST") {
    return json(
      {
        ok: true,
        threshold: await service.upsertThreshold(await parse(request, thresholdPolicySchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/management/targets" && request.method === "POST") {
    return json(
      { ok: true, target: await service.upsertTarget(await parse(request, branchTargetSchema)) },
      201,
    );
  }
  const actionRoute = /^\/api\/seramet\/management\/actions\/([^/]+)\/transition$/.exec(
    url.pathname,
  );
  if (actionRoute && request.method === "POST") {
    const body = await parse<{
      status: Parameters<typeof service.transitionAction>[1];
      note: string;
    }>(request, actionTransitionSchema);
    return json({
      ok: true,
      action: await service.transitionAction(
        decodeURIComponent(actionRoute[1]!),
        body.status,
        body.note,
      ),
    });
  }
  if (url.pathname === "/api/seramet/management/recalculate" && request.method === "POST") {
    const body = await parse<{ branchId?: string }>(request, recalculationRequestSchema);
    if (!env.SERAMET_WORK_QUEUE) {
      throw new ServerOperationError(
        "QUEUE_UNAVAILABLE",
        503,
        "Durable management worker queue unavailable",
      );
    }
    return json(
      {
        ok: true,
        queued: await enqueueManagementRecalculation(env, {
          tenantId: actor.tenantId,
          ...(body.branchId ? { branchId: body.branchId } : {}),
          idempotencyKey: `manual-management-recalc:${actor.tenantId}:${body.branchId ?? "all"}:${new Date().toISOString().slice(0, 13)}`,
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
        }),
      },
      202,
    );
  }
  return null;
}

async function parse<T>(request: Request, schema: ZodTypeAny): Promise<T> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new SerametHttpError(
      400,
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
        .join("; "),
    );
  }
  return result.data as T;
}

function required(url: URL, key: string) {
  const value = optional(url, key);
  if (!value) throw new SerametHttpError(400, `${key} is required`);
  return value;
}

function optional(url: URL, key: string) {
  return url.searchParams.get(key)?.trim() || undefined;
}

function boundedLimit(url: URL) {
  const value = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new SerametHttpError(400, "limit must be an integer between 1 and 200");
  }
  return value;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
