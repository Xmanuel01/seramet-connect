import { z } from "zod";
import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { requireFullAuthentication } from "@/server/pos-auth-service";
import type { D1Database } from "@/server/database/d1";
import {
  KITCHEN_OUTBOX_ENTITY,
  publicKitchenObligation,
  type KitchenPrintObligation,
  type KitchenObligationStatus,
} from "@/server/kitchen-print-outbox";

type OutboxRow = {
  entity_id: string;
  branch_id: string;
  status: KitchenObligationStatus;
  version: number;
  payload_json: string;
};

const ackSchema = z
  .object({
    branchId: z.string().trim().min(1).max(160),
    claimToken: z.string().uuid(),
    status: z.enum(["DELIVERED", "FAILED", "UNCERTAIN"]),
    evidence: z.enum([
      "PRINT_BRIDGE_ACK",
      "KDS_RENDER_ACK",
      "PRE_SUBMIT_FAILURE",
      "AMBIGUOUS_TRANSPORT",
    ]),
    reason: z.string().trim().max(280).optional(),
  })
  .strict();
const claimSchema = z.object({ branchId: z.string().trim().min(1).max(160) }).strict();
const reviewSchema = z
  .object({
    branchId: z.string().trim().min(1).max(160),
    action: z.enum(["REQUEUE", "CONFIRM_DELIVERED"]),
    reason: z.string().trim().min(12).max(500),
  })
  .strict();

const noCache = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: noCache });

function assertPrinterPermission(actor: ServerActor) {
  if (
    ![
      permissions.ordersUpdate,
      permissions.kitchenOperate,
      permissions.settingsHardwareManage,
    ].some((permission) => actor.permissions.includes(permission))
  ) {
    throw new SerametHttpError(
      403,
      "An authorized cashier, kitchen operator or printer manager is required",
    );
  }
}

function deviceIdentity(actor: ServerActor) {
  const device = actor.deviceId ?? actor.sessionId;
  if (!device)
    throw new SerametHttpError(403, "A verified device or authenticated session is required");
  return device;
}

async function findOutboxRow(db: D1Database, actor: ServerActor, branchId: string, id: string) {
  const row = await db
    .prepare(
      `SELECT entity_id,branch_id,status,version,payload_json
       FROM authoritative_records
       WHERE tenant_id=? AND entity_type=? AND entity_id=? AND branch_id=?`,
    )
    .bind(actor.tenantId, KITCHEN_OUTBOX_ENTITY, id, branchId)
    .first<OutboxRow>();
  if (!row)
    throw new SerametHttpError(404, "The requested kitchen ticket was not found in this branch");
  return row;
}

async function updateOutbox(
  db: D1Database,
  actor: ServerActor,
  row: OutboxRow,
  obligation: KitchenPrintObligation,
  previousStatus: KitchenObligationStatus,
  action: string,
  reason: string,
) {
  const now = new Date().toISOString();
  const transitionId = crypto.randomUUID();
  const payload = { ...obligation, transitionId };
  const update = db
    .prepare(
      `UPDATE authoritative_records
       SET status=?,payload_json=?,version=version+1,updated_at=?
       WHERE tenant_id=? AND entity_type=? AND entity_id=? AND branch_id=?
         AND status=? AND version=?`,
    )
    .bind(
      obligation.status,
      JSON.stringify(payload),
      now,
      actor.tenantId,
      KITCHEN_OUTBOX_ENTITY,
      row.entity_id,
      row.branch_id,
      previousStatus,
      row.version,
    );
  const audit = db
    .prepare(
      `INSERT INTO audit_events
        (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,
         reason,correlation_id,metadata_json,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,? FROM authoritative_records
        WHERE tenant_id=? AND entity_type=? AND entity_id=? AND branch_id=?
          AND version=? AND payload_json LIKE ?`,
    )
    .bind(
      actor.tenantId,
      crypto.randomUUID(),
      row.branch_id,
      actor.id,
      actor.deviceId ?? null,
      action,
      "KITCHEN_PRINT_OBLIGATION",
      row.entity_id,
      reason,
      crypto.randomUUID(),
      JSON.stringify({
        from: previousStatus,
        to: obligation.status,
        reviewCount: obligation.reviewCount,
      }),
      now,
      actor.tenantId,
      KITCHEN_OUTBOX_ENTITY,
      row.entity_id,
      row.branch_id,
      row.version + 1,
      `%"transitionId":"${transitionId}"%`,
    );
  // A single optimistic update and its audit are committed atomically.
  // A lost race is a conflict, never an additional print authorization.
  const result = await db.batch([update, audit]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) {
    throw new SerametHttpError(409, "Kitchen ticket changed on another terminal; refresh first");
  }
}

async function bodyJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4_096) throw new SerametHttpError(413, "Kitchen ticket request is too large");
  let text: string;
  try {
    text = await request.text();
    if (text.length > 4_096) throw new SerametHttpError(413, "Kitchen ticket request is too large");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SerametHttpError) throw error;
    throw new SerametHttpError(400, "Invalid kitchen ticket JSON request");
  }
}

async function authenticatedContext(request: Request, env: SerametEnv, branchId: string) {
  const actor = await authenticateSerametRequest(request, env);
  assertPrinterPermission(actor);
  authorizeBranchRead(actor, actor.tenantId, branchId);
  const db = env.SERAMET_DB;
  if (!db) throw new SerametHttpError(503, "Authoritative kitchen ticket store is unavailable");
  return { actor, db };
}

export async function handleKitchenPrintApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const base = "/api/seramet/kitchen/print-obligations";
  if (url.pathname === base && request.method === "GET") {
    const branchId = url.searchParams.get("branchId")?.trim() ?? "";
    if (!branchId) throw new SerametHttpError(400, "Select a branch for kitchen printing");
    const { actor, db } = await authenticatedContext(request, env, branchId);
    const rows = await db
      .prepare(
        `SELECT entity_id,branch_id,status,version,payload_json
         FROM authoritative_records
         WHERE tenant_id=? AND entity_type=? AND branch_id=? AND status <> 'DELIVERED'
         ORDER BY CASE WHEN status='QUEUED' THEN 0 ELSE 1 END, created_at ASC LIMIT 100`,
      )
      .bind(actor.tenantId, KITCHEN_OUTBOX_ENTITY, branchId)
      .all<OutboxRow>();
    const obligations = (rows.results ?? []).map((row) => {
      const record = JSON.parse(row.payload_json) as KitchenPrintObligation;
      if (record.status === "CLAIMED" && record.claimExpiresAt) {
        if (Date.parse(record.claimExpiresAt) <= Date.now()) {
          record.status = "UNCERTAIN";
          record.failureReason =
            "The device claim expired; inspect printer output before an audited reprint";
        }
      }
      return publicKitchenObligation(record);
    });
    return respond({ ok: true, obligations });
  }

  const match =
    /^\/api\/seramet\/kitchen\/print-obligations\/(kot-[0-9a-f]{64})\/(claim|ack|review)$/.exec(
      url.pathname,
    );
  if (!match || request.method !== "POST") return null;
  const id = match[1]!;
  const operation = match[2]!;
  const parsed = bodyJson(request);
  const schema =
    operation === "claim" ? claimSchema : operation === "ack" ? ackSchema : reviewSchema;
  const result = schema.safeParse(await parsed);
  if (!result.success) {
    throw new SerametHttpError(400, result.error.issues.map((issue) => issue.message).join("; "));
  }
  const data = result.data;
  const { actor, db } = await authenticatedContext(request, env, data.branchId);
  const row = await findOutboxRow(db, actor, data.branchId, id);
  const current = JSON.parse(row.payload_json) as KitchenPrintObligation;
  const now = new Date().toISOString();

  if (operation === "claim") {
    if (row.status !== "QUEUED") {
      throw new SerametHttpError(
        409,
        row.status === "CLAIMED"
          ? "Ticket is already claimed. If the device failed, review printer output before retry"
          : "Ticket is not available for automatic printing",
      );
    }
    const token = crypto.randomUUID();
    const claimed: KitchenPrintObligation = {
      ...current,
      status: "CLAIMED",
      claimedBy: deviceIdentity(actor),
      claimToken: token,
      claimExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      updatedAt: now,
    };
    await updateOutbox(db, actor, row, claimed, "QUEUED", "KOT_CLAIMED", "Authorized device claim");
    return respond({ ok: true, obligation: publicKitchenObligation(claimed), claimToken: token });
  }

  if (operation === "ack") {
    const ack = data as z.infer<typeof ackSchema>;
    if (current.claimToken !== ack.claimToken || current.claimedBy !== deviceIdentity(actor)) {
      throw new SerametHttpError(403, "This device does not hold the ticket's claim");
    }
    if (current.status === ack.status) return respond({ ok: true, duplicate: true });
    if (row.status !== "CLAIMED") {
      throw new SerametHttpError(409, "Ticket is no longer in an active claim");
    }
    if (
      (ack.status === "DELIVERED" &&
        !["PRINT_BRIDGE_ACK", "KDS_RENDER_ACK"].includes(ack.evidence)) ||
      (ack.status === "FAILED" && ack.evidence !== "PRE_SUBMIT_FAILURE") ||
      (ack.status === "UNCERTAIN" && ack.evidence !== "AMBIGUOUS_TRANSPORT")
    ) {
      throw new SerametHttpError(400, "Ticket acknowledgement evidence does not match status");
    }
    const updated: KitchenPrintObligation = {
      ...current,
      status: ack.status,
      updatedAt: now,
      ...(ack.status === "DELIVERED" ? { deliveredAt: now } : {}),
      ...(ack.reason ? { failureReason: ack.reason } : {}),
    };
    await updateOutbox(
      db,
      actor,
      row,
      updated,
      "CLAIMED",
      `KOT_${ack.status}`,
      `Authenticated device reported ${ack.evidence}`,
    );
    return respond({ ok: true, obligation: publicKitchenObligation(updated) });
  }

  const review = data as z.infer<typeof reviewSchema>;
  if (!actor.permissions.includes(permissions.settingsHardwareManage)) {
    throw new SerametHttpError(403, "Printer management permission is required");
  }
  requireFullAuthentication(actor);
  const leaseExpired =
    row.status === "CLAIMED" &&
    !!current.claimExpiresAt &&
    Date.parse(current.claimExpiresAt) <= Date.now();
  if (!["FAILED", "UNCERTAIN", "NEEDS_ROUTING"].includes(row.status) && !leaseExpired) {
    throw new SerametHttpError(409, "Only failed, unresolved or expired tickets can be reviewed");
  }
  const updated: KitchenPrintObligation = {
    ...current,
    status: review.action === "REQUEUE" ? "QUEUED" : "DELIVERED",
    updatedAt: now,
    reviewCount: current.reviewCount + 1,
    reviewReason: review.reason,
    reviewedBy: actor.id,
    ...(review.action === "CONFIRM_DELIVERED" ? { deliveredAt: now } : {}),
  };
  // A manual requeue generates a new attempt for the SAME logical KOT,
  // with an explicit manager reason, never a second automatic obligation.
  delete updated.claimToken;
  delete updated.claimedBy;
  delete updated.claimExpiresAt;
  await updateOutbox(
    db,
    actor,
    row,
    updated,
    row.status,
    review.action === "REQUEUE" ? "KOT_MANUAL_REQUEUE" : "KOT_MANUALLY_VERIFIED",
    review.reason,
  );
  return respond({ ok: true, obligation: publicKitchenObligation(updated) });
}
