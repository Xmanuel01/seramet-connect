import {
  authenticateSerametRequest,
  authorizeBranchRead,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { ServerOperationError } from "@/server/errors";
import { listRealtimeEvents } from "@/server/realtime";

export async function handleRealtimeApi(request: Request, env: SerametEnv) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/seramet/realtime/events") return null;
  if (request.method !== "GET") return new Response(null, { status: 405 });
  if (!env.SERAMET_DB)
    throw new ServerOperationError("DATABASE_UNAVAILABLE", 503, "Real-time database unavailable");
  const actor = await authenticateSerametRequest(request, env);
  const requestedTenant = url.searchParams.get("tenant");
  if (requestedTenant && requestedTenant !== actor.tenantId) {
    throw new ServerOperationError(
      "TENANT_SCOPE_VIOLATION",
      403,
      "Cross-tenant real-time access denied",
    );
  }
  const branchId = url.searchParams.get("branchId")?.trim() || undefined;
  if (branchId) authorizeBranchRead(actor, actor.tenantId, branchId);
  await new DatabaseRateLimiter(env.SERAMET_DB).consume(`realtime:${actor.tenantId}:${actor.id}`, {
    bucket: "realtime-connect",
    limit: 30,
    windowSeconds: 60,
  });

  const database = env.SERAMET_DB;
  const encoder = new TextEncoder();
  let after =
    validTimestamp(url.searchParams.get("after")) ?? new Date(Date.now() - 5_000).toISOString();
  let afterId = "";
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      try {
        while (Date.now() - started < 25_000) {
          const events = await listRealtimeEvents(database, {
            tenantId: actor.tenantId,
            ...(branchId ? { branchId } : {}),
            after,
            afterId,
          });
          for (const event of events) {
            controller.enqueue(
              encoder.encode(`id: ${event.id}\nevent: seramet\ndata: ${JSON.stringify(event)}\n\n`),
            );
            after = event.createdAt;
            afterId = event.id;
          }
          if (!events.length) controller.enqueue(encoder.encode(": keepalive\n\n"));
          await delay(1_500);
        }
      } catch {
        controller.enqueue(encoder.encode("event: unavailable\ndata: {}\n\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function validTimestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
