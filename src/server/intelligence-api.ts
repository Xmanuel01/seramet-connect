import { z, type ZodTypeAny } from "zod";
import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { IntelligenceService } from "@/intelligence/intelligence-service";
import {
  askIntelligenceSchema,
  briefRequestSchema,
  confirmActionSchema,
  feedbackSchema,
  providerConfigSchema,
} from "@/intelligence/schemas";
import type { AskIntelligenceInput } from "@/intelligence/types";
import { ServerOperationError } from "@/server/errors";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { enqueueIntelligenceBrief } from "@/server/workers";

const actionProposalSchema = z.object({ actionId: z.string().min(1).max(160) }).strict();

export async function handleIntelligenceApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/intelligence")) return null;
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative intelligence database unavailable",
    );
  }
  await new DatabaseRateLimiter(env.SERAMET_DB).consume(`${actor.tenantId}:${actor.id}`, {
    bucket: "intelligence-api",
    limit: 120,
    windowSeconds: 60,
  });
  const service = new IntelligenceService(env.SERAMET_DB, actor, env);

  if (url.pathname === "/api/seramet/intelligence/ask" && request.method === "POST") {
    return json({
      ok: true,
      response: await service.ask(
        await parse<AskIntelligenceInput>(request, askIntelligenceSchema),
      ),
    });
  }
  if (url.pathname === "/api/seramet/intelligence/tools" && request.method === "GET") {
    return json({ ok: true, tools: service.listAuthorizedTools() });
  }
  if (url.pathname === "/api/seramet/intelligence/sessions" && request.method === "GET") {
    return json({ ok: true, sessions: await service.listSessions(boundedLimit(url, 30)) });
  }
  const sessionMessages = /^\/api\/seramet\/intelligence\/sessions\/([^/]+)\/messages$/.exec(
    url.pathname,
  );
  if (sessionMessages && request.method === "GET") {
    return json({
      ok: true,
      messages: await service.listSessionMessages(
        decodeURIComponent(sessionMessages[1]!),
        boundedLimit(url, 100),
      ),
    });
  }
  if (url.pathname === "/api/seramet/intelligence/briefs" && request.method === "GET") {
    return json({ ok: true, briefs: await service.listBriefs(boundedLimit(url, 30)) });
  }
  if (url.pathname === "/api/seramet/intelligence/briefs" && request.method === "POST") {
    if (!env.SERAMET_WORK_QUEUE) {
      throw new ServerOperationError(
        "QUEUE_UNAVAILABLE",
        503,
        "Durable intelligence worker queue unavailable",
      );
    }
    const brief = await service.prepareBrief(await parse(request, briefRequestSchema));
    if (!brief.id) throw new SerametHttpError(500, "Brief preparation returned no identity");
    const queued = await enqueueIntelligenceBrief(env, {
      tenantId: actor.tenantId,
      briefId: String(brief.id),
      ...(brief.branch_id ? { branchId: String(brief.branch_id) } : {}),
      idempotencyKey: `intelligence-brief:${String(brief.id)}`,
      correlationId: String(brief.correlation_id),
    });
    return json({ ok: true, brief, queued }, 202);
  }
  if (url.pathname === "/api/seramet/intelligence/feedback" && request.method === "POST") {
    return json(
      { ok: true, feedback: await service.recordFeedback(await parse(request, feedbackSchema)) },
      201,
    );
  }
  if (url.pathname === "/api/seramet/intelligence/admin" && request.method === "GET") {
    return json({ ok: true, admin: await service.providerAdminSummary() });
  }
  if (url.pathname === "/api/seramet/intelligence/admin/provider" && request.method === "PUT") {
    return json({
      ok: true,
      provider: await service.upsertProviderConfiguration(
        await parse(request, providerConfigSchema),
      ),
    });
  }
  if (url.pathname === "/api/seramet/intelligence/actions/propose" && request.method === "POST") {
    const body = await parse<{ actionId: string }>(request, actionProposalSchema);
    return json({ ok: true, proposal: await service.proposeManagementAction(body.actionId) }, 201);
  }
  if (url.pathname === "/api/seramet/intelligence/actions/confirm" && request.method === "POST") {
    const body = await parse<{
      proposalId: string;
      confirmationToken: string;
      note: string;
    }>(request, confirmActionSchema);
    return json({
      ok: true,
      result: await service.confirmAction(body.proposalId, body.confirmationToken, body.note),
    });
  }
  return null;
}

async function parse<T>(request: Request, schema: ZodTypeAny): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 64 * 1024) throw new SerametHttpError(413, "Request body is too large");
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

function boundedLimit(url: URL, fallback: number) {
  const value = Number(url.searchParams.get("limit") ?? fallback);
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
      "x-content-type-options": "nosniff",
    },
  });
}
