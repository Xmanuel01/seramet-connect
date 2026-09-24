import { type ZodTypeAny } from "zod";
import {
  prepAdjustSchema,
  prepApproveSchema,
  prepCompleteSchema,
  prepDismissSchema,
  prepStartSchema,
} from "@/prep/schemas";
import { PrepService } from "@/prep/prep-service";
import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { authoritativeBusinessDate } from "@/server/business-date";
import type { D1Database } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import { enqueueInventoryRecalculation } from "@/server/workers";

export async function handlePrepApi(request: Request, env: SerametEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/prep")) return null;
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative prep database unavailable",
    );
  }
  const service = new PrepService(env.SERAMET_DB, actor);

  if (url.pathname === "/api/seramet/prep/library" && request.method === "GET") {
    const branchId = required(url, "branchId");
    const context = await branchContext(env.SERAMET_DB, actor.tenantId, branchId);
    return json({
      ok: true,
      prep: await service.library(branchId, context.businessDate),
    });
  }

  if (url.pathname === "/api/seramet/prep/regenerate" && request.method === "POST") {
    const branchId = requiredBodyBranch(await readJson(request));
    authorizeBranchRead(actor, actor.tenantId, branchId);
    if (!actor.permissions.includes(permissions.productionPlan)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        permissions.productionPlan + " permission is required",
      );
    }
    if (!env.SERAMET_WORK_QUEUE) {
      throw new ServerOperationError(
        "QUEUE_UNAVAILABLE",
        503,
        "Durable inventory worker queue unavailable",
      );
    }
    return json(
      {
        ok: true,
        queued: await enqueueInventoryRecalculation(env, {
          tenantId: actor.tenantId,
          branchId,
          idempotencyKey:
            "prep-regenerate:" +
            actor.tenantId +
            ":" +
            branchId +
            ":" +
            new Date().toISOString().slice(0, 13),
        }),
      },
      202,
    );
  }

  const adjust = /^\/api\/seramet\/prep\/([^/]+)\/adjust$/.exec(url.pathname);
  if (adjust && request.method === "POST") {
    return json({
      ok: true,
      task: await service.adjust(
        decodeURIComponent(adjust[1]!),
        await parse(request, prepAdjustSchema),
      ),
    });
  }

  const approve = /^\/api\/seramet\/prep\/([^/]+)\/approve$/.exec(url.pathname);
  if (approve && request.method === "POST") {
    return json({
      ok: true,
      task: await service.approve(
        decodeURIComponent(approve[1]!),
        await parse(request, prepApproveSchema),
      ),
    });
  }

  const start = /^\/api\/seramet\/prep\/([^/]+)\/start$/.exec(url.pathname);
  if (start && request.method === "POST") {
    const body = await parse<{ expectedRevision: number }>(request, prepStartSchema);
    return json({
      ok: true,
      task: await service.start(decodeURIComponent(start[1]!), body.expectedRevision),
    });
  }

  const complete = /^\/api\/seramet\/prep\/([^/]+)\/complete$/.exec(url.pathname);
  if (complete && request.method === "POST") {
    return json({
      ok: true,
      task: await service.complete(
        decodeURIComponent(complete[1]!),
        await parse(request, prepCompleteSchema),
      ),
    });
  }

  const dismiss = /^\/api\/seramet\/prep\/([^/]+)\/dismiss$/.exec(url.pathname);
  if (dismiss && request.method === "POST") {
    return json({
      ok: true,
      task: await service.dismiss(
        decodeURIComponent(dismiss[1]!),
        await parse(request, prepDismissSchema),
      ),
    });
  }

  return null;
}

async function parse<T>(request: Request, schema: ZodTypeAny): Promise<T> {
  const input = await readJson(request);
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new SerametHttpError(
      400,
      result.error.issues
        .map((issue) => (issue.path.join(".") || "request") + ": " + issue.message)
        .join("; "),
    );
  }
  return result.data as T;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
}

function requiredBodyBranch(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SerametHttpError(400, "branchId is required");
  }
  const value = (input as Record<string, unknown>)["branchId"];
  if (typeof value !== "string" || !value.trim()) {
    throw new SerametHttpError(400, "branchId is required");
  }
  return value.trim();
}

function required(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  if (!value) throw new SerametHttpError(400, key + " is required");
  return value;
}

async function branchContext(db: D1Database, tenantId: string, branchId: string) {
  const branch = await db
    .prepare(
      "SELECT timezone,business_day_cutoff_minutes FROM branches WHERE tenant_id=? AND id=? AND active=1",
    )
    .bind(tenantId, branchId)
    .first<{ timezone: string; business_day_cutoff_minutes: number }>();
  if (!branch) {
    throw new SerametHttpError(403, "Branch is not available in the authenticated tenant");
  }
  return {
    businessDate: authoritativeBusinessDate({
      timezone: branch.timezone,
      cutoffMinutes: Number(branch.business_day_cutoff_minutes),
    }),
  };
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
