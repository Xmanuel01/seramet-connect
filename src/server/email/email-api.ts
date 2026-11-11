import {
  authenticateSerametRequest,
  SerametHttpError,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { DatabaseRateLimiter, sensitiveRateLimits } from "@/server/rate-limit";
import { applyProviderEvent, deliveryStatusForBrevoEvent } from "@/server/email/delivery-log";
import {
  activeSenderIdentities,
  EMAIL_CATEGORIES,
  EMAIL_SENDERS,
  routedReplyIdentities,
  type SenderIdentity,
} from "@/server/email/senders";

const noStore = { "Cache-Control": "private, no-store" };

function constantTimeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function readLimited(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new SerametHttpError(413, "Payload too large");
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = "",
    size = 0;
  if (reader)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SerametHttpError(413, "Payload too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
  return raw + decoder.decode();
}

/**
 * Brevo transactional webhook: delivered, bounced, blocked, spam and deferred events update
 * the delivery log. Brevo is configured to send "Authorization: Bearer <token>" with the
 * protected SERAMET_BREVO_WEBHOOK_TOKEN. Events for unknown message ids are acknowledged
 * and ignored, so Brevo does not retry them forever.
 */
async function handleBrevoWebhook(request: Request, env: SerametEnv) {
  const token = env.SERAMET_BREVO_WEBHOOK_TOKEN ?? "";
  if (token.length < 32) throw new SerametHttpError(503, "Email webhook is not configured");
  const supplied = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!constantTimeEqual(supplied, token)) throw new SerametHttpError(401, "Unauthorized");
  const db = env.SERAMET_DB;
  if (!db) throw new SerametHttpError(503, "Email webhook is unavailable");
  await new DatabaseRateLimiter(db).consume("brevo-email-webhook", sensitiveRateLimits.webhook);
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readLimited(request, 256 * 1024));
  } catch (error) {
    if (error instanceof SerametHttpError) throw error;
    throw new SerametHttpError(400, "Invalid webhook payload");
  }
  const events = (Array.isArray(decoded) ? decoded : [decoded]).slice(0, 500);
  let applied = 0;
  for (const item of events) {
    if (!item || typeof item !== "object") continue;
    const event = item as Record<string, unknown>;
    const status =
      typeof event["event"] === "string" ? deliveryStatusForBrevoEvent(event["event"]) : null;
    const messageId = event["message-id"];
    if (!status || typeof messageId !== "string" || !/^<[^\s<>]{1,250}>$/.test(messageId)) continue;
    const occurred =
      typeof event["ts_event"] === "number"
        ? new Date(event["ts_event"] * 1000)
        : typeof event["date"] === "string"
          ? new Date(event["date"])
          : new Date();
    const reason = typeof event["reason"] === "string" ? event["reason"] : undefined;
    if (
      await applyProviderEvent(db, {
        providerMessageId: messageId,
        status,
        occurredAt: Number.isNaN(occurred.getTime())
          ? new Date().toISOString()
          : occurred.toISOString(),
        ...(reason ? { reason } : {}),
      })
    )
      applied++;
  }
  return Response.json({ ok: true, applied }, { headers: noStore });
}

/** Platform administrators: listed in SERAMET_PLATFORM_ADMINS *and* holding the permission. */
export function isPlatformEmailAdmin(
  env: Pick<SerametEnv, "SERAMET_PLATFORM_ADMINS">,
  actor: ServerActor,
) {
  const listed = (env.SERAMET_PLATFORM_ADMINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return (
    listed.includes(`${actor.tenantId}:${actor.id}`) &&
    actor.permissions.includes(permissions.platformEmailView)
  );
}

const statuses = new Set([
  "SENDING",
  "ACCEPTED",
  "DELIVERED",
  "DEFERRED",
  "BOUNCED",
  "BLOCKED",
  "COMPLAINED",
  "RATE_LIMITED",
  "REJECTED",
  "UNKNOWN",
]);

async function handleDeliveries(url: URL, env: SerametEnv) {
  const db = env.SERAMET_DB!;
  const where: string[] = [];
  const binds: unknown[] = [];
  const param = (name: string) => url.searchParams.get(name)?.trim() || undefined;
  const status = param("status");
  if (status) {
    if (!statuses.has(status)) throw new SerametHttpError(400, "Unknown status");
    where.push("status=?");
    binds.push(status);
  }
  const category = param("category");
  if (category) {
    if (category !== "UNCATEGORISED" && !Object.hasOwn(EMAIL_CATEGORIES, category))
      throw new SerametHttpError(400, "Unknown category");
    where.push("category=?");
    binds.push(category);
  }
  const tenant = param("tenant");
  if (tenant) {
    if (!/^[\w:-]{1,128}$/.test(tenant)) throw new SerametHttpError(400, "Invalid tenant");
    where.push("tenant_id=?");
    binds.push(tenant);
  }
  for (const [name, op] of [
    ["from", ">="],
    ["to", "<"],
  ] as const) {
    const value = param(name);
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value)))
      throw new SerametHttpError(400, `Invalid ${name} date`);
    where.push(`created_at${op}?`);
    binds.push(new Date(value).toISOString());
  }
  const search = param("q");
  if (search) {
    if (search.length > 200) throw new SerametHttpError(400, "Search too long");
    where.push("(recipient_email LIKE ? OR subject LIKE ? OR provider_message_id=? OR job_id=?)");
    const like = `%${search.toLowerCase().replace(/[%_]/g, "")}%`;
    binds.push(like, `%${search.replace(/[%_]/g, "")}%`, search, search);
  }
  const limit = Math.min(Math.max(Number(param("limit") ?? 50) || 50, 1), 200);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, counts] = await Promise.all([
    db
      .prepare(
        `SELECT tenant_id,job_id,category,sender_identity,sender_email,recipient_email,subject,
           provider_message_id,status,attempt_count,created_at,last_attempt_at,accepted_at,
           delivered_at,last_event,last_event_at,failure_reason
         FROM email_delivery_log ${clause} ORDER BY created_at DESC LIMIT ${limit}`,
      )
      .bind(...binds)
      .all<Record<string, unknown>>(),
    db
      .prepare(`SELECT status,COUNT(*) AS count FROM email_delivery_log ${clause} GROUP BY status`)
      .bind(...binds)
      .all<{ status: string; count: number }>(),
  ]);
  return Response.json(
    {
      deliveries: rows.results ?? [],
      counts: Object.fromEntries((counts.results ?? []).map((r) => [r.status, Number(r.count)])),
    },
    { headers: noStore },
  );
}

function handleSenders(env: SerametEnv) {
  const active = activeSenderIdentities(env);
  const routed = routedReplyIdentities(env);
  return Response.json(
    {
      senders: (Object.keys(EMAIL_SENDERS) as SenderIdentity[]).map((identity) => ({
        identity,
        ...EMAIL_SENDERS[identity],
        sendingActive: active.has(identity),
        replyRouteActive: routed.has(identity),
      })),
      categories: Object.entries(EMAIL_CATEGORIES).map(([category, route]) => ({
        category,
        ...route,
      })),
    },
    { headers: noStore },
  );
}

/**
 * Routes:
 *   POST /api/seramet/email/brevo-webhook        Brevo delivery events (bearer token)
 *   GET  /api/seramet/platform/email/deliveries  delivery log with filters (platform admins)
 *   GET  /api/seramet/platform/email/senders     sender and category inventory (platform admins)
 */
export async function handleEmailApi(request: Request, env: SerametEnv) {
  const url = new URL(request.url);
  if (url.pathname === "/api/seramet/email/brevo-webhook") {
    if (request.method !== "POST") throw new SerametHttpError(405, "Method not allowed");
    return handleBrevoWebhook(request, env);
  }
  const route = /^\/api\/seramet\/platform\/email\/(deliveries|senders)$/.exec(url.pathname);
  if (!route) return null;
  if (request.method !== "GET") throw new SerametHttpError(405, "Method not allowed");
  if (!env.SERAMET_DB) throw new SerametHttpError(503, "Email records are unavailable");
  const actor = await authenticateSerametRequest(request, env);
  if (!isPlatformEmailAdmin(env, actor))
    throw new SerametHttpError(403, "Platform administrator access required");
  return route[1] === "deliveries" ? handleDeliveries(url, env) : handleSenders(env);
}
