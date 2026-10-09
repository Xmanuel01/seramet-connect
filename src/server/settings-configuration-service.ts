import { z } from "zod";
import { SerametHttpError, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type {
  OrderChannelDefinition,
  PaymentMethodDefinition,
  RoleDefinition,
} from "@/platform/types";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

const code = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "Code may contain letters, numbers, dashes and underscores",
  );
const displayName = z.string().trim().min(1).max(120);
const reason = z.string().trim().min(8).max(500);

export const createRoleInputSchema = z.object({ name: displayName, reason }).strict();

export const createPaymentMethodInputSchema = z
  .object({
    displayName,
    code,
    category: z.enum([
      "CASH",
      "DIGITAL_WALLET",
      "CARD",
      "BANK_TRANSFER",
      "CREDIT",
      "VOUCHER",
      "LOYALTY",
      "EXTERNAL",
      "CUSTOM",
    ]),
    reason,
  })
  .strict();

export const updatePaymentMethodInputSchema = z.object({ enabled: z.boolean(), reason }).strict();

export const createOrderChannelInputSchema = z
  .object({
    displayName,
    code,
    channelType: z.enum([
      "DINE_IN",
      "TAKEAWAY",
      "OWN_DELIVERY",
      "MARKETPLACE",
      "WEB",
      "QR",
      "PHONE",
      "WHATSAPP",
      "KIOSK",
      "OTHER",
    ]),
    useOnlinePrice: z.boolean(),
    reason,
  })
  .strict();

export const updateOrderChannelInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    useOnlinePrice: z.boolean().optional(),
    reason,
  })
  .strict()
  .refine((value) => value.enabled !== undefined || value.useOnlinePrice !== undefined, {
    message: "At least one channel setting is required",
  });

export async function createRole(
  db: D1Database,
  actor: ServerActor,
  input: z.infer<typeof createRoleInputSchema>,
) {
  requirePermission(actor, permissions.settingsRoleManage);
  const parsed = createRoleInputSchema.parse(input);
  const roleCode = normalizeCode(parsed.name);
  const existing = await db
    .prepare("SELECT id,name,active FROM roles WHERE tenant_id=? AND code=?")
    .bind(actor.tenantId, roleCode)
    .first<{ id: string; name: string; active: number }>();
  if (existing) {
    if (Boolean(existing.active) && existing.name === parsed.name) {
      return { role: await loadRole(db, actor.tenantId, existing.id), duplicate: true };
    }
    throw new SerametHttpError(409, "A role with this code already exists");
  }

  const role: RoleDefinition = {
    id: `role-${crypto.randomUUID()}`,
    tenantId: actor.tenantId,
    code: roleCode,
    name: parsed.name,
    active: true,
    permissions: [],
  };
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,?)",
        )
        .bind(actor.tenantId, role.id, role.code, role.name, JSON.stringify(role)),
      await auditStatement(db, actor, {
        action: "ROLE_CREATED",
        entityType: "ROLE",
        entityId: role.id,
        reason: parsed.reason,
        after: role,
      }),
    ]);
  } catch (error) {
    const winner = await db
      .prepare("SELECT id,name,active FROM roles WHERE tenant_id=? AND code=?")
      .bind(actor.tenantId, roleCode)
      .first<{ id: string; name: string; active: number }>();
    if (!winner) throw error;
    if (!winner.active || winner.name !== parsed.name) {
      throw new SerametHttpError(409, "A role with this code already exists");
    }
    return { role: await loadRole(db, actor.tenantId, winner.id), duplicate: true };
  }
  return { role, duplicate: false };
}

export async function deactivateRole(
  db: D1Database,
  actor: ServerActor,
  roleId: string,
  input: { reason: string },
) {
  requirePermission(actor, permissions.settingsRoleManage);
  const parsed = z.object({ reason }).strict().parse(input);
  const role = await loadRole(db, actor.tenantId, roleId);
  if (!role) throw new SerametHttpError(404, "Role was not found");
  if (!role.active) return { role, duplicate: true };
  const assigned = await db
    .prepare(
      `SELECT COUNT(*) count FROM user_roles ur
       JOIN users u ON u.tenant_id=ur.tenant_id AND u.id=ur.user_id
       WHERE ur.tenant_id=? AND ur.role_id=? AND u.active=1`,
    )
    .bind(actor.tenantId, roleId)
    .first<{ count: number }>();
  if (Number(assigned?.count ?? 0) > 0) {
    throw new SerametHttpError(409, "Reassign active users before disabling this role");
  }
  const next = { ...role, active: false };
  await db.batch([
    db
      .prepare("UPDATE roles SET active=0,payload_json=? WHERE tenant_id=? AND id=? AND active=1")
      .bind(JSON.stringify(next), actor.tenantId, roleId),
    await auditStatement(db, actor, {
      action: "ROLE_DISABLED",
      entityType: "ROLE",
      entityId: roleId,
      reason: parsed.reason,
      before: role,
      after: next,
    }),
  ]);
  return { role: next, duplicate: false };
}

export async function createPaymentMethod(
  db: D1Database,
  actor: ServerActor,
  input: z.infer<typeof createPaymentMethodInputSchema>,
) {
  requirePermission(actor, permissions.settingsPaymentManage);
  const parsed = createPaymentMethodInputSchema.parse(input);
  const methodCode = parsed.code.toUpperCase();
  const existing = await findPayload<PaymentMethodDefinition>(
    db,
    "payment_methods",
    actor.tenantId,
    "code",
    methodCode,
  );
  if (existing) {
    if (
      existing.enabled &&
      existing.displayName === parsed.displayName &&
      existing.category === parsed.category
    ) {
      return { paymentMethod: existing, duplicate: true };
    }
    throw new SerametHttpError(409, "A payment method with this code already exists");
  }
  const sortOrder = await nextSortOrder(db, "payment_methods", actor.tenantId);
  const paymentMethod: PaymentMethodDefinition = {
    id: `payment-${crypto.randomUUID()}`,
    tenantId: actor.tenantId,
    code: methodCode,
    displayName: parsed.displayName,
    category: parsed.category,
    enabled: true,
    sortOrder,
    requiresReference: parsed.category !== "CASH",
    requiresCustomer: parsed.category === "CREDIT",
    supportsRefund: true,
    supportsSplit: true,
    metadata: {},
  };
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO payment_methods
            (tenant_id,id,code,category,active,payload_json) VALUES (?,?,?,?,1,?)`,
        )
        .bind(
          actor.tenantId,
          paymentMethod.id,
          paymentMethod.code,
          paymentMethod.category,
          JSON.stringify(paymentMethod),
        ),
      await auditStatement(db, actor, {
        action: "PAYMENT_METHOD_CREATED",
        entityType: "PAYMENT_METHOD",
        entityId: paymentMethod.id,
        reason: parsed.reason,
        after: paymentMethod,
      }),
    ]);
  } catch (error) {
    const winner = await findPayload<PaymentMethodDefinition>(
      db,
      "payment_methods",
      actor.tenantId,
      "code",
      methodCode,
    );
    if (!winner) throw error;
    if (
      !winner.enabled ||
      winner.displayName !== parsed.displayName ||
      winner.category !== parsed.category
    ) {
      throw new SerametHttpError(409, "A payment method with this code already exists");
    }
    return { paymentMethod: winner, duplicate: true };
  }
  return { paymentMethod, duplicate: false };
}

export async function updatePaymentMethod(
  db: D1Database,
  actor: ServerActor,
  paymentMethodId: string,
  input: z.infer<typeof updatePaymentMethodInputSchema>,
) {
  requirePermission(actor, permissions.settingsPaymentManage);
  const parsed = updatePaymentMethodInputSchema.parse(input);
  const current = await findPayloadById<PaymentMethodDefinition>(
    db,
    "payment_methods",
    actor.tenantId,
    paymentMethodId,
  );
  if (!current) throw new SerametHttpError(404, "Payment method was not found");
  if (current.enabled === parsed.enabled) return { paymentMethod: current, duplicate: true };
  const next = { ...current, enabled: parsed.enabled };
  await db.batch([
    db
      .prepare("UPDATE payment_methods SET active=?,payload_json=? WHERE tenant_id=? AND id=?")
      .bind(parsed.enabled ? 1 : 0, JSON.stringify(next), actor.tenantId, paymentMethodId),
    await auditStatement(db, actor, {
      action: parsed.enabled ? "PAYMENT_METHOD_ENABLED" : "PAYMENT_METHOD_DISABLED",
      entityType: "PAYMENT_METHOD",
      entityId: paymentMethodId,
      reason: parsed.reason,
      before: current,
      after: next,
    }),
  ]);
  return { paymentMethod: next, duplicate: false };
}

export async function createOrderChannel(
  db: D1Database,
  actor: ServerActor,
  input: z.infer<typeof createOrderChannelInputSchema>,
) {
  requirePermission(actor, permissions.settingsChannelManage);
  const parsed = createOrderChannelInputSchema.parse(input);
  const channelCode = parsed.code.toUpperCase();
  const existing = await findPayload<OrderChannelDefinition>(
    db,
    "order_channels",
    actor.tenantId,
    "code",
    channelCode,
  );
  if (existing) {
    if (
      existing.enabled &&
      existing.displayName === parsed.displayName &&
      existing.channelType === parsed.channelType &&
      existing.metadata["useOnlinePrice"] === parsed.useOnlinePrice
    ) {
      return { orderChannel: existing, duplicate: true };
    }
    throw new SerametHttpError(409, "An order channel with this code already exists");
  }
  const sortOrder = await nextSortOrder(db, "order_channels", actor.tenantId);
  const orderChannel: OrderChannelDefinition = {
    id: `channel-${crypto.randomUUID()}`,
    tenantId: actor.tenantId,
    code: channelCode,
    displayName: parsed.displayName,
    channelType: parsed.channelType,
    enabled: true,
    requiresCustomer: ["OWN_DELIVERY", "PHONE", "WHATSAPP"].includes(parsed.channelType),
    requiresTable: parsed.channelType === "DINE_IN",
    requiresAddress: parsed.channelType === "OWN_DELIVERY",
    isExternallyPaid: parsed.channelType === "MARKETPLACE",
    sortOrder,
    metadata: { useOnlinePrice: parsed.useOnlinePrice },
  };
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO order_channels (tenant_id,id,code,channel_type,active,payload_json) VALUES (?,?,?,?,1,?)",
        )
        .bind(
          actor.tenantId,
          orderChannel.id,
          orderChannel.code,
          orderChannel.channelType,
          JSON.stringify(orderChannel),
        ),
      await auditStatement(db, actor, {
        action: "ORDER_CHANNEL_CREATED",
        entityType: "ORDER_CHANNEL",
        entityId: orderChannel.id,
        reason: parsed.reason,
        after: orderChannel,
      }),
    ]);
  } catch (error) {
    const winner = await findPayload<OrderChannelDefinition>(
      db,
      "order_channels",
      actor.tenantId,
      "code",
      channelCode,
    );
    if (!winner) throw error;
    if (
      !winner.enabled ||
      winner.displayName !== parsed.displayName ||
      winner.channelType !== parsed.channelType ||
      winner.metadata["useOnlinePrice"] !== parsed.useOnlinePrice
    ) {
      throw new SerametHttpError(409, "An order channel with this code already exists");
    }
    return { orderChannel: winner, duplicate: true };
  }
  return { orderChannel, duplicate: false };
}

export async function updateOrderChannel(
  db: D1Database,
  actor: ServerActor,
  orderChannelId: string,
  input: z.infer<typeof updateOrderChannelInputSchema>,
) {
  requirePermission(actor, permissions.settingsChannelManage);
  const parsed = updateOrderChannelInputSchema.parse(input);
  const current = await findPayloadById<OrderChannelDefinition>(
    db,
    "order_channels",
    actor.tenantId,
    orderChannelId,
  );
  if (!current) throw new SerametHttpError(404, "Order channel was not found");
  const next: OrderChannelDefinition = {
    ...current,
    enabled: parsed.enabled ?? current.enabled,
    metadata: {
      ...current.metadata,
      ...(parsed.useOnlinePrice === undefined ? {} : { useOnlinePrice: parsed.useOnlinePrice }),
    },
  };
  if (JSON.stringify(current) === JSON.stringify(next)) {
    return { orderChannel: current, duplicate: true };
  }
  await db.batch([
    db
      .prepare("UPDATE order_channels SET active=?,payload_json=? WHERE tenant_id=? AND id=?")
      .bind(next.enabled ? 1 : 0, JSON.stringify(next), actor.tenantId, orderChannelId),
    await auditStatement(db, actor, {
      action: next.enabled ? "ORDER_CHANNEL_UPDATED" : "ORDER_CHANNEL_DISABLED",
      entityType: "ORDER_CHANNEL",
      entityId: orderChannelId,
      reason: parsed.reason,
      before: current,
      after: next,
    }),
  ]);
  return { orderChannel: next, duplicate: false };
}

async function loadRole(db: D1Database, tenantId: string, roleId: string) {
  const row = await db
    .prepare("SELECT id,code,name,active FROM roles WHERE tenant_id=? AND id=?")
    .bind(tenantId, roleId)
    .first<{ id: string; code: string; name: string; active: number }>();
  if (!row) return null;
  const permissions = await db
    .prepare(
      "SELECT permission_code FROM role_permissions WHERE tenant_id=? AND role_id=? ORDER BY permission_code",
    )
    .bind(tenantId, roleId)
    .all<{ permission_code: string }>();
  return {
    id: row.id,
    tenantId,
    code: row.code,
    name: row.name,
    active: Boolean(row.active),
    permissions: (permissions.results ?? []).map((item) => item.permission_code),
  } satisfies RoleDefinition;
}

async function findPayload<T>(
  db: D1Database,
  table: "payment_methods" | "order_channels",
  tenantId: string,
  column: "code",
  value: string,
) {
  const row = await db
    .prepare(`SELECT payload_json FROM ${table} WHERE tenant_id=? AND ${column}=?`)
    .bind(tenantId, value)
    .first<{ payload_json: string }>();
  return row ? (JSON.parse(row.payload_json) as T) : null;
}

async function findPayloadById<T>(
  db: D1Database,
  table: "payment_methods" | "order_channels",
  tenantId: string,
  id: string,
) {
  const row = await db
    .prepare(`SELECT payload_json FROM ${table} WHERE tenant_id=? AND id=?`)
    .bind(tenantId, id)
    .first<{ payload_json: string }>();
  return row ? (JSON.parse(row.payload_json) as T) : null;
}

async function nextSortOrder(
  db: D1Database,
  table: "payment_methods" | "order_channels",
  tenantId: string,
) {
  const rows = await db
    .prepare(`SELECT payload_json FROM ${table} WHERE tenant_id=?`)
    .bind(tenantId)
    .all<{ payload_json: string }>();
  const highest = Math.max(
    0,
    ...(rows.results ?? []).map((row) => {
      const value = JSON.parse(row.payload_json) as { sortOrder?: unknown };
      return typeof value.sortOrder === "number" && Number.isFinite(value.sortOrder)
        ? value.sortOrder
        : 0;
    }),
  );
  return highest + 10;
}

async function auditStatement(
  db: D1Database,
  actor: ServerActor,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<D1PreparedStatement> {
  const stamp = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO audit_events
        (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,before_hash,
         after_hash,reason,correlation_id,session_id,metadata_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      actor.tenantId,
      crypto.randomUUID(),
      actor.branchId ?? null,
      actor.id,
      actor.deviceId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.before === undefined ? null : await sha256(JSON.stringify(input.before)),
      input.after === undefined ? null : await sha256(JSON.stringify(input.after)),
      input.reason,
      crypto.randomUUID(),
      actor.sessionId ?? null,
      JSON.stringify({ source: "SETTINGS" }),
      stamp,
    );
}

function requirePermission(actor: ServerActor, permission: string) {
  if (!actor.permissions.includes(permission)) {
    throw new SerametHttpError(403, "Settings permission is required");
  }
}

function normalizeCode(value: string) {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!normalized) throw new SerametHttpError(400, "A valid role name is required");
  return normalized;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
