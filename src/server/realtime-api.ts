import {
  authenticateSerametRequest,
  authorizeBranchRead,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { ServerOperationError } from "@/server/errors";
import { listRealtimeEvents } from "@/server/realtime";
import { permissions } from "@/platform/permissions";
import {
  connectToRealtimeHub,
  REALTIME_REPLAY_LIMIT,
  REALTIME_SOCKET_PATH,
  type RealtimeReplay,
  type RealtimeSocketScope,
} from "@/server/realtime-hub";

/** Catch-up older than this may already be pruned from the log: reload a snapshot instead. */
const REPLAY_RETENTION_MS = 23 * 60 * 60 * 1_000;
/** How far before the client's cursor a replay re-reads, to catch late-committing events. */
const REPLAY_OVERLAP_MS = 5_000;

export async function handleRealtimeApi(request: Request, env: SerametEnv) {
  const url = new URL(request.url);
  if (url.pathname === REALTIME_SOCKET_PATH) return handleRealtimeSocket(request, env, url);
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
  // A 25-second SSE reconnect resumes from the last delivered event rather than
  // replaying an arbitrary five-second window (or missing a longer outage).
  const resume = parseRealtimeCursor(request.headers.get("last-event-id"));
  let after =
    resume?.after ??
    validTimestamp(url.searchParams.get("after")) ??
    new Date(Date.now() - 5_000).toISOString();
  let afterId = resume?.afterId ?? "";
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
              encoder.encode(
                `id: ${event.createdAt}|${event.id}\nevent: seramet\ndata: ${JSON.stringify(event)}\n\n`,
              ),
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

/**
 * WebSocket upgrade: authenticate once, fix the socket's scope, replay what the client missed
 * with one query, then hand the socket to the restaurant's hibernating Durable Object. The
 * client falls back to the SSE stream above when this answers anything but 101.
 */
async function handleRealtimeSocket(request: Request, env: SerametEnv, url: URL) {
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  const hub = env.SERAMET_REALTIME_HUB;
  if (!hub || !env.SERAMET_DB) {
    throw new ServerOperationError("DATABASE_UNAVAILABLE", 503, "Real-time push unavailable");
  }
  // Browsers send session cookies with cross-site WebSocket handshakes, so the origin check
  // that guards mutations must guard the upgrade too.
  if (!isAllowedSocketOrigin(request, env)) {
    throw new ServerOperationError(
      "PERMISSION_DENIED",
      403,
      "Cross-origin real-time access denied",
    );
  }
  const actor = await authenticateSerametRequest(request, env);
  const scope = realtimeSocketScope(actor, url);
  await new DatabaseRateLimiter(env.SERAMET_DB).consume(`realtime:${actor.tenantId}:${actor.id}`, {
    bucket: "realtime-connect",
    limit: 30,
    windowSeconds: 60,
  });
  const replay = await realtimeReplay(env.SERAMET_DB, scope, url.searchParams.get("cursor"));
  return connectToRealtimeHub(hub, request, scope, replay);
}

/** The same tenant and branch checks as the SSE stream, fixed for the socket's lifetime. */
export function realtimeSocketScope(
  actor: Awaited<ReturnType<typeof authenticateSerametRequest>>,
  url: URL,
): RealtimeSocketScope {
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
  const branches =
    actor.branchScope.type === "ALL"
      ? ("ALL" as const)
      : [
          ...new Set([
            actor.branchId,
            ...(actor.permissions.includes(permissions.branchSwitch)
              ? actor.assignedBranchIds
              : []),
          ]),
        ];
  return {
    tenantId: actor.tenantId,
    actorId: actor.id,
    ...(branchId ? { branchId } : {}),
    branches,
    ...(actor.kitchenStationIds !== undefined
      ? { kitchenStationIds: actor.kitchenStationIds }
      : {}),
  };
}

export async function realtimeReplay(
  database: NonNullable<SerametEnv["SERAMET_DB"]>,
  scope: RealtimeSocketScope,
  cursorValue: string | null,
): Promise<RealtimeReplay> {
  const resume = parseRealtimeCursor(cursorValue);
  if (!resume) return { events: [], truncated: false };
  const cursor = `${resume.after}|${resume.afterId}`;
  if (Date.now() - Date.parse(resume.after) > REPLAY_RETENTION_MS) {
    return { events: [], truncated: true, cursor };
  }
  // Resume a little before the cursor, not exactly after it. An event is stamped before its
  // transaction commits, so one with an earlier stamp (or the same millisecond and a lower
  // id) can become visible after the client's last event. The client drops repeats by id.
  const events = await listRealtimeEvents(database, {
    tenantId: scope.tenantId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
    after: new Date(Date.parse(resume.after) - REPLAY_OVERLAP_MS).toISOString(),
    afterId: "",
    limit: REALTIME_REPLAY_LIMIT + 1,
  });
  const truncated = events.length > REALTIME_REPLAY_LIMIT;
  return { events: events.slice(0, REALTIME_REPLAY_LIMIT), truncated, cursor };
}

function isAllowedSocketOrigin(request: Request, env: SerametEnv) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set(
    [
      new URL(request.url).origin,
      env.SERAMET_PUBLIC_ORIGIN,
      ...(env.SERAMET_ALLOWED_ORIGINS ?? "").split(","),
    ]
      .map((value) => value?.trim().replace(/\/$/, ""))
      .filter((value): value is string => Boolean(value)),
  );
  return allowed.has(origin.replace(/\/$/, ""));
}

function validTimestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/** Reject malformed/untrusted Last-Event-ID values before using a SQL cursor. */
export function parseRealtimeCursor(value: string | null) {
  if (!value || value.length > 128) return null;
  const separator = value.indexOf("|");
  if (separator < 1) return null;
  const after = validTimestamp(value.slice(0, separator));
  const afterId = value.slice(separator + 1);
  if (!after || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(afterId)) {
    return null;
  }
  return { after, afterId };
}
