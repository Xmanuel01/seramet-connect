import { z } from "zod";
import {
  authenticateSerametRequest,
  SerametHttpError,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { requireFullAuthentication } from "@/server/pos-auth-service";
import { permissions } from "@/platform/permissions";
import {
  printerConfigurationSchema,
  printerTarget,
  printerRenderingProfile,
  type PrinterConfiguration,
} from "@/printing/printer-configuration";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { SerametPrintService, type OrderForPrint } from "@/lib/seramet-print-service";
import { PlatformConfigurationError } from "@/platform/repositories/configuration-repository";
import { printablePaymentQr, type PrintPaymentQrInput } from "@/server/print-payment-qr";
import { EtimsError, fiscalizeReceipt } from "@/server/etims/etims-service";
import {
  renderApprovedInvoice,
  renderApprovedReceipt,
  renderOrderTicket,
  bannerRich,
  duplicateRich,
  type RichDocument,
} from "@/printing/documents";
import { billingRecordToPrintOrder, receiptRecordToPrintOrder } from "@/lib/print-order-adapter";
import type { D1Database } from "@/server/database/d1";
import { resolveRuntimeConfiguration } from "@/server/environment";
import { pairableBridgeId } from "@/lib/print-bridge-client-config";
import { invalidateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import {
  activeKitchenPrintBypass,
  endKitchenPrintBypass,
  startKitchenPrintBypass,
} from "@/lib/kitchen-print-bypass";
import {
  buildThermalLayout,
  LOGO_DOCUMENT_TYPES,
  validateLogo,
  validateRenderJob,
} from "../../printing-core/thermal-layout.mjs";
import {
  deleteReceiptLogoStatement,
  effectiveReceiptLogo,
  readReceiptLogos,
  saveReceiptLogoStatement,
  type ReceiptLogoScope,
} from "@/server/receipt-logo-store";

const authorizationSchema = z
  .object({
    printerId: z.string().min(1).max(160),
    documentType: z.enum([
      "FOOD_KOT",
      "BAR_TICKET",
      "DISPATCH_TICKET",
      "BILL",
      "RECEIPT",
      "INVOICE",
      "TEST",
    ]),
    recordId: z.string().min(1).max(240),
    claimToken: z.string().min(1).max(128).optional(),
    copyIndex: z.number().int().min(0).max(2).default(0),
    reprintReason: z.string().trim().min(12).max(240).optional(),
    reprintId: z.string().uuid().optional(),
    testKind: z.enum(["BILL", "RECEIPT", "FOOD_KOT"]).optional(),
    testRenderingMode: z.enum(["TEXT_ESC_POS", "RASTER_ESC_POS"]).optional(),
  })
  .strict();

function requirePermission(actor: ServerActor, permission: string) {
  if (!actor.permissions.includes(permission))
    throw new SerametHttpError(403, "Printer action is not authorized");
}
function manage(actor: ServerActor) {
  requireFullAuthentication(actor);
  requirePermission(actor, permissions.settingsHardwareManage);
}
function auditStatement(
  db: D1Database,
  actor: ServerActor,
  id: string,
  action: string,
  detail: string,
  metadata: unknown = {},
) {
  return db
    .prepare(
      `INSERT INTO audit_events
    (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,correlation_id,session_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO NOTHING`,
    )
    .bind(
      actor.tenantId,
      id,
      actor.branchId,
      actor.id,
      actor.deviceId ?? null,
      action,
      "PRINT_JOB",
      id,
      detail,
      id,
      actor.sessionId ?? null,
      JSON.stringify(metadata),
      new Date().toISOString(),
    );
}
async function parse(request: Request, limit = 16000) {
  const reader = request.body?.getReader();
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  if (reader)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SerametHttpError(413, "Printer request too large");
      }
      text += decoder.decode(value, { stream: true });
    }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new SerametHttpError(400, "Invalid printer request");
  }
}
function respond(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
export async function signPrintJob(job: Record<string, unknown>, key: string) {
  if (key.length < 32) throw new SerametHttpError(503, "Protected print signing is not configured");
  const bytes = new TextEncoder().encode(JSON.stringify(job));
  const payload = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return { payload, signature };
}
// The explicit SERAMET_PRINT_SIGNING_KEY wins. Otherwise derive a separate print
// master from the session secret every deployment already has, so printing needs no
// extra setup. The label keeps the two keys independent: a print key never signs sessions.
export async function printSigningMaster(
  env: Pick<SerametEnv, "SERAMET_PRINT_SIGNING_KEY" | "SERAMET_JWT_SECRET">,
) {
  if (env.SERAMET_PRINT_SIGNING_KEY && env.SERAMET_PRINT_SIGNING_KEY.length >= 32)
    return env.SERAMET_PRINT_SIGNING_KEY;
  if (!env.SERAMET_JWT_SECRET || env.SERAMET_JWT_SECRET.length < 32) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SERAMET_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode("seramet-print-signing-master-v1"),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function deriveBridgeSigningKey(
  master: string,
  tenantId: string,
  branchId: string,
  bridgeId: string,
) {
  if (master.length < 32)
    throw new SerametHttpError(503, "Protected print signing is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(master),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(
          JSON.stringify(["seramet-print-v1", tenantId, branchId, bridgeId]),
        ),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify(value, (_key, item) =>
            item && typeof item === "object" && !Array.isArray(item)
              ? Object.fromEntries(
                  Object.keys(item)
                    .sort()
                    .map((key) => [key, item[key]]),
                )
              : item,
          ),
        ),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
const receiptLogoSchema = z
  .object({
    scope: z.enum(["COMPANY", "BRANCH"]),
    logo: z
      .object({
        width: z.number().int(),
        height: z.number().int(),
        data: z.string().max(16000),
      })
      .strict(),
  })
  .strict();
const deliverySchema = z
  .object({
    v: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    id: z.string().min(1).max(300),
    tenantId: z.string().min(1),
    branchId: z.string().min(1),
    bridgeId: z.string().min(1),
    actorId: z.string().min(1),
    deliveryAttempt: z.number().int().min(0).max(2),
    expiresAt: z.number().int(),
    target: z.object({ id: z.string().min(1) }).passthrough(),
    recoveryId: z.string().min(1).optional(),
  })
  .passthrough();
type Delivery = z.infer<typeof deliverySchema>;
async function deliveryIdentity(job: Record<string, unknown>) {
  // The logo is branding, not the document: changing it must not block a retry.
  const {
    expiresAt: _expires,
    actorId: _actor,
    deliveryAttempt: _attempt,
    logo: _logo,
    ...stable
  } = job;
  return {
    fingerprint: await digest(stable),
    grantId: `PRINT-GRANT:${await digest([job.tenantId, job.branchId, job.id, job.recoveryId ?? "ORIGINAL"])}`,
    slotPrefix: `PRINT-DELIVERY:${await digest([job.tenantId, job.branchId, job.id])}:`,
  };
}
async function reserveDelivery(
  request: Request,
  env: SerametEnv,
  repository: TransactionRepository,
) {
  const db = env.SERAMET_DB!;
  const envelope = z
    .object({
      authorization: z.object({
        payload: z.string().max(256000),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    })
    .strict()
    .parse(await parse(request, 300000));
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(envelope.authorization.payload.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0),
        ),
      ),
    );
  } catch {
    throw new SerametHttpError(403, "Invalid delivery evidence");
  }
  const job = deliverySchema.parse(decoded);
  const now = Date.now();
  if (job.expiresAt <= now || job.expiresAt > now + 120000)
    throw new SerametHttpError(403, "Expired delivery evidence");
  const key = await deriveBridgeSigningKey(
    await printSigningMaster(env),
    job.tenantId,
    job.branchId,
    job.bridgeId,
  );
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      Uint8Array.from(envelope.authorization.signature.match(/../g)!, (v) => parseInt(v, 16)),
      new TextEncoder().encode(envelope.authorization.payload),
    ))
  )
    throw new SerametHttpError(403, "Invalid delivery evidence");
  const identity = await deliveryIdentity(job);
  const grant = await db
    .prepare(
      "SELECT metadata_json,actor_id FROM audit_events WHERE tenant_id=? AND branch_id=? AND id=? AND action='PRINT_DELIVERY_AUTHORIZED'",
    )
    .bind(job.tenantId, job.branchId, identity.grantId)
    .first<{ metadata_json: string; actor_id: string }>();
  const metadata = grant ? JSON.parse(grant.metadata_json) : null;
  if (
    !metadata ||
    metadata.fingerprint !== identity.fingerprint ||
    metadata.attempt !== job.deliveryAttempt
  )
    throw new SerametHttpError(403, "Unissued delivery evidence");
  if (["FOOD_KOT", "BAR_TICKET", "DISPATCH_TICKET"].includes(String(job.documentType))) {
    const state = await repository.loadState(job.tenantId);
    const obligation = state.kitchenPrintObligations?.find(
      (item) => item.id === job.sourceRecordId && item.branchId === job.branchId,
    );
    if (
      !obligation ||
      obligation.status !== "CLAIMED" ||
      obligation.claimToken !== job.claimToken ||
      obligation.claimedBy !== job.actorId
    )
      throw new SerametHttpError(409, "KOT claim is no longer active; reconcile before recovery");
  }
  const configured = await db
    .prepare(
      "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
    )
    .bind(job.tenantId, job.branchId, job.target.id)
    .first<{ payload_json: string }>();
  const printer = printerConfigurationSchema.safeParse(
    configured ? JSON.parse(configured.payload_json).printing : null,
  );
  if (!printer.success || !printer.data.enabled || printer.data.bridgeId !== job.bridgeId)
    throw new SerametHttpError(403, "Bridge enrollment no longer active");
  if (
    job.printerConfigurationHash &&
    job.printerConfigurationHash !== (await digest({ ...printer.data, id: job.target.id }))
  )
    throw new SerametHttpError(409, "Printer configuration changed; reconcile before recovery");
  if (job.fallbackTarget && typeof job.fallbackTarget === "object") {
    const target = job.fallbackTarget as { id?: string };
    const row = await db
      .prepare(
        "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
      )
      .bind(job.tenantId, job.branchId, target.id ?? "")
      .first<{ payload_json: string }>();
    const fallback = printerConfigurationSchema.safeParse(
      row ? JSON.parse(row.payload_json).printing : null,
    );
    if (
      !fallback.success ||
      !fallback.data.enabled ||
      fallback.data.bridgeId !== job.bridgeId ||
      job.fallbackConfigurationHash !== (await digest({ ...fallback.data, id: target.id }))
    )
      throw new SerametHttpError(409, "Fallback configuration changed; reconcile before recovery");
  }
  const actor = {
    id: grant!.actor_id,
    tenantId: job.tenantId,
    branchId: job.branchId,
  } as ServerActor;
  const consumed = await auditStatement(
    db,
    actor,
    `${identity.slotPrefix}${job.deliveryAttempt}`,
    "PRINT_DELIVERY_RESERVED",
    job.id,
    { grantId: identity.grantId },
  ).run();
  if (consumed.meta?.changes !== 1)
    throw new SerametHttpError(
      409,
      "Delivery already reserved; reconcile physical output before recovery",
    );
  return respond({ reserved: true });
}

export async function authorizeDelivery(
  db: D1Database,
  actor: ServerActor,
  job: Record<string, unknown>,
): Promise<Delivery> {
  const identity = await deliveryIdentity(job);
  const prior = await db
    .prepare(
      "SELECT COUNT(*) n FROM audit_events WHERE tenant_id=? AND branch_id=? AND action='PRINT_DELIVERY_RESERVED' AND id IN (?,?,?)",
    )
    .bind(
      actor.tenantId,
      actor.branchId,
      `${identity.slotPrefix}0`,
      `${identity.slotPrefix}1`,
      `${identity.slotPrefix}2`,
    )
    .first<{ n: number }>();
  const attempt = job.recoveryId ? Number(prior?.n ?? 0) : 0;
  if (attempt > 2)
    throw new SerametHttpError(
      409,
      "Delivery attempt limit reached; reconcile without another automatic attempt",
    );
  await auditStatement(db, actor, identity.grantId, "PRINT_DELIVERY_AUTHORIZED", String(job.id), {
    fingerprint: identity.fingerprint,
    attempt,
  }).run();
  const saved = await db
    .prepare("SELECT metadata_json FROM audit_events WHERE tenant_id=? AND branch_id=? AND id=?")
    .bind(actor.tenantId, actor.branchId, identity.grantId)
    .first<{ metadata_json: string }>();
  const metadata = JSON.parse(saved!.metadata_json);
  if (metadata.fingerprint !== identity.fingerprint)
    throw new SerametHttpError(409, "Altered print identity; reconcile before replacement");
  return deliverySchema.parse({ ...job, deliveryAttempt: metadata.attempt });
}

export async function handlePrintingApi(
  request: Request,
  env: SerametEnv,
  repository: TransactionRepository,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/printing/")) return null;
  const db = env.SERAMET_DB;
  if (!db) throw new SerametHttpError(503, "Authoritative printer configuration is unavailable");
  // This endpoint consumes an issued, signed capability, not browser scope headers.
  if (url.pathname === "/api/seramet/printing/consume" && request.method === "POST")
    return reserveDelivery(request, env, repository);
  const actor = await authenticateSerametRequest(request, env);
  if (url.pathname === "/api/seramet/printing/enrollment" && request.method === "POST") {
    manage(actor);
    const input = z
      .object({ bridgeId: z.string().min(8).max(160) })
      .strict()
      .parse(await parse(request));
    const rows =
      (
        await db
          .prepare(
            "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
          )
          .bind(actor.tenantId, actor.branchId)
          .all<{ payload_json: string }>()
      ).results ?? [];
    // "Connect this PC" pairs a bridge before any printer names it, so a fresh
    // machine identity is allowed; hardware managers could create one anyway.
    if (
      !pairableBridgeId.test(input.bridgeId) &&
      !rows.some((row) => {
        const config = printerConfigurationSchema.safeParse(JSON.parse(row.payload_json).printing);
        return config.success && config.data.enabled && config.data.bridgeId === input.bridgeId;
      })
    )
      throw new SerametHttpError(403, "Configured branch bridge required");
    const signingKey = await deriveBridgeSigningKey(
      await printSigningMaster(env),
      actor.tenantId,
      actor.branchId,
      input.bridgeId,
    );
    await auditStatement(
      db,
      actor,
      `PRINT-ENROLL:${crypto.randomUUID()}`,
      "PRINT_BRIDGE_ENROLLED",
      input.bridgeId,
    ).run();
    return respond({
      bridgeId: input.bridgeId,
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      signingKey,
      authorizationEndpoint: `${url.origin}/api/seramet/printing/consume`,
    });
  }
  if (url.pathname === "/api/seramet/printing/printers" && request.method === "GET") {
    requirePermission(actor, permissions.settingsHardwareView);
    const rows = await db
      .prepare(
        "SELECT id,payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
      )
      .bind(actor.tenantId, actor.branchId)
      .all<{ id: string; payload_json: string }>();
    const printers = (rows.results ?? []).flatMap((row) => {
      const parsed = printerConfigurationSchema.safeParse(JSON.parse(row.payload_json).printing);
      return parsed.success ? [{ ...parsed.data, id: row.id }] : [];
    });
    return respond({ printers });
  }
  if (url.pathname === "/api/seramet/printing/printers" && request.method === "POST") {
    manage(actor);
    const raw = await parse(request);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new SerametHttpError(400, "Invalid printer configuration");
    const { updateBranchMode, ...configuration } = raw;
    if (updateBranchMode !== undefined && typeof updateBranchMode !== "boolean")
      throw new SerametHttpError(400, "Invalid branch mode operation");
    const result = printerConfigurationSchema.safeParse(configuration);
    if (!result.success) throw new SerametHttpError(400, "Invalid printer configuration");
    const printer = result.data;
    if (printer.branchId !== actor.branchId)
      throw new SerametHttpError(403, "Printer must belong to the active branch");
    if (
      printer.host &&
      /^(127\.|localhost$|::1$)/i.test(printer.host) &&
      resolveRuntimeConfiguration(env).environment !== "development"
    ) {
      throw new SerametHttpError(400, "Loopback printers are restricted to local development");
    }
    const id = printer.id ?? crypto.randomUUID();
    const existing = await db
      .prepare("SELECT branch_id,trust_status FROM hardware_devices WHERE tenant_id=? AND id=?")
      .bind(actor.tenantId, id)
      .first<{ branch_id: string; trust_status: string }>();
    if (existing && existing.branch_id !== actor.branchId)
      throw new SerametHttpError(403, "Cross-branch printer replacement denied");
    if (existing?.trust_status === "REVOKED")
      throw new SerametHttpError(404, "This printer was deleted. Add it again as a new printer.");
    if (printer.fallbackPrinterId) {
      const fallback = await db
        .prepare(
          "SELECT id,payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
        )
        .bind(actor.tenantId, actor.branchId, printer.fallbackPrinterId)
        .first<{ id: string; payload_json: string }>();
      if (!fallback || printer.fallbackPrinterId === id)
        throw new SerametHttpError(400, "Invalid branch fallback printer");
      const fallbackConfig = printerConfigurationSchema.safeParse(
        JSON.parse(fallback.payload_json).printing,
      );
      if (
        fallbackConfig.success &&
        [printer.renderingMode, fallbackConfig.data.renderingMode].includes("RASTER_ESC_POS") &&
        printer.paperWidth !== fallbackConfig.data.paperWidth
      )
        throw new SerametHttpError(400, "Raster fallback requires the same paper profile");
    }
    const stations =
      (
        await db
          .prepare("SELECT code,name FROM stations WHERE tenant_id=? AND branch_id=? AND active=1")
          .bind(actor.tenantId, actor.branchId)
          .all<{ code: string; name: string }>()
      ).results ?? [];
    const stationKeys = new Set<string>();
    for (const key of printer.stations) {
      const station = stations.find(
        (item) => item.code === key || item.name === key || item.name.toUpperCase() === key,
      );
      if (!station)
        throw new SerametHttpError(400, "Station is not configured in the active branch");
      for (const alias of [station.code, station.name, station.name.toUpperCase()])
        stationKeys.add(alias);
    }
    const saved = { ...printer, id, stations: [...stationKeys] };
    const configurationWrite = db
      .prepare(
        `INSERT INTO hardware_devices
      (tenant_id,id,branch_id,device_type,name,trust_status,registered_by,registered_at,payload_json)
      VALUES (?,?,?,'PRINTER',?,'ACTIVE',?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET
      name=excluded.name,payload_json=excluded.payload_json
      WHERE hardware_devices.branch_id=excluded.branch_id AND hardware_devices.trust_status<>'REVOKED'`,
      )
      .bind(
        actor.tenantId,
        id,
        actor.branchId,
        printer.name,
        actor.id,
        new Date().toISOString(),
        JSON.stringify({
          printing: saved,
          enabled: printer.enabled,
          healthStatus: "UNKNOWN",
          outputRoles: [],
        }),
      );
    const branchRow = await db
      .prepare("SELECT payload_json FROM branches WHERE tenant_id=? AND id=?")
      .bind(actor.tenantId, actor.branchId)
      .first<{ payload_json: string }>();
    if (!branchRow) throw new SerametHttpError(403, "Authoritative branch unavailable");
    const branchPayload = JSON.parse(branchRow.payload_json);
    const written = await db.batch([
      configurationWrite,
      ...(updateBranchMode === false
        ? []
        : [
            db.prepare("UPDATE branches SET payload_json=? WHERE tenant_id=? AND id=?").bind(
              JSON.stringify({
                ...branchPayload,
                metadata: { ...branchPayload.metadata, kitchenMode: printer.kitchenMode },
              }),
              actor.tenantId,
              actor.branchId,
            ),
          ]),
      auditStatement(
        db,
        actor,
        `PRINT-CONFIG:${crypto.randomUUID()}`,
        "PRINTER_CONFIGURED",
        `Printer ${id}`,
      ),
    ]);
    // A printer deleted between the checks above and this write is left as it was.
    if (written[0]?.meta?.changes === 0)
      throw new SerametHttpError(404, "This printer was deleted. Add it again as a new printer.");
    await invalidateAuthoritativeConfiguration(db, actor.tenantId);
    return respond({ printer: saved }, 201);
  }
  const printerRoute = /^\/api\/seramet\/printing\/printers\/([^/]+)$/.exec(url.pathname);
  if (printerRoute && request.method === "DELETE") {
    manage(actor);
    const id = decodeURIComponent(printerRoute[1]!);
    const rows =
      (
        await db
          .prepare(
            "SELECT id,name,payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
          )
          .bind(actor.tenantId, actor.branchId)
          .all<{ id: string; name: string; payload_json: string }>()
      ).results ?? [];
    const target = rows.find((row) => row.id === id);
    if (!target) throw new SerametHttpError(404, "Printer not found in this branch");
    const dependent = rows.find((row) => {
      if (row.id === id) return false;
      const parsed = printerConfigurationSchema.safeParse(JSON.parse(row.payload_json).printing);
      return parsed.success && parsed.data.fallbackPrinterId === id;
    });
    if (dependent)
      throw new SerametHttpError(
        409,
        `${dependent.name} uses this printer as its backup. Choose another backup there first.`,
      );
    // A route's stored payload carries its fallback too, so both are cleared.
    const fallbackRoutes =
      (
        await db
          .prepare(
            "SELECT id,payload_json FROM print_routes WHERE tenant_id=? AND fallback_device_id=?",
          )
          .bind(actor.tenantId, id)
          .all<{ id: string; payload_json: string }>()
      ).results ?? [];
    // Deleting keeps the device record so past print jobs still point at it. It is revoked,
    // which every printer lookup and the branch configuration skip, and retired, so device
    // activation cannot bring it back. Only the request that revokes it records the deletion.
    const deleted = await db.batch([
      db
        .prepare(
          "UPDATE hardware_devices SET trust_status='REVOKED',lifecycle_state='RETIRED' WHERE tenant_id=? AND branch_id=? AND id=? AND trust_status<>'REVOKED'",
        )
        .bind(actor.tenantId, actor.branchId, id),
      db
        .prepare("DELETE FROM print_routes WHERE tenant_id=? AND primary_device_id=?")
        .bind(actor.tenantId, id),
      ...fallbackRoutes.map((route) => {
        const payload = JSON.parse(route.payload_json || "{}") as Record<string, unknown>;
        delete payload["fallbackDeviceId"];
        return db
          .prepare(
            "UPDATE print_routes SET fallback_device_id=NULL,payload_json=? WHERE tenant_id=? AND id=?",
          )
          .bind(JSON.stringify(payload), actor.tenantId, route.id);
      }),
      auditStatement(
        db,
        actor,
        `PRINT-DELETE:${id}`,
        "PRINTER_DELETED",
        `Printer ${id} (${target.name})`,
      ),
    ]);
    if (deleted[0]?.meta?.changes === 0)
      throw new SerametHttpError(404, "Printer not found in this branch");
    await invalidateAuthoritativeConfiguration(db, actor.tenantId);
    return respond({ deleted: id });
  }
  if (url.pathname === "/api/seramet/printing/receipt-logo") {
    if (request.method === "GET")
      return respond(await readReceiptLogos(db, actor.tenantId, actor.branchId));
    if (request.method !== "PUT" && request.method !== "DELETE")
      return respond({ code: "NOT_FOUND" }, 404);
    manage(actor);
    const put =
      request.method === "PUT" ? receiptLogoSchema.safeParse(await parse(request, 32000)) : null;
    if (put && !put.success) throw new SerametHttpError(400, "Choose an image to use as the logo.");
    const scope: ReceiptLogoScope =
      (put?.data?.scope ?? url.searchParams.get("scope")) === "BRANCH" ? "BRANCH" : "COMPANY";
    // The company logo prints in every branch, so it also needs organisation rights.
    if (scope === "COMPANY") requirePermission(actor, permissions.settingsOrganisationManage);
    if (request.method === "DELETE") {
      await db.batch([
        deleteReceiptLogoStatement(db, actor.tenantId, actor.branchId, scope),
        auditStatement(
          db,
          actor,
          `RECEIPT-LOGO:${crypto.randomUUID()}`,
          "RECEIPT_LOGO_REMOVED",
          scope === "BRANCH" ? `Branch ${actor.branchId} logo removed` : "Company logo removed",
        ),
      ]);
      return respond(await readReceiptLogos(db, actor.tenantId, actor.branchId));
    }
    const logo = put!.data!.logo;
    try {
      validateLogo(logo);
    } catch {
      throw new SerametHttpError(
        400,
        "This image can't be printed as a receipt logo. Try another.",
      );
    }
    await db.batch([
      saveReceiptLogoStatement(db, {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        scope,
        logo,
        actorId: actor.id,
        now: new Date().toISOString(),
      }),
      auditStatement(
        db,
        actor,
        `RECEIPT-LOGO:${crypto.randomUUID()}`,
        "RECEIPT_LOGO_SAVED",
        scope === "BRANCH" ? `Branch ${actor.branchId} logo saved` : "Company logo saved",
        { width: logo.width, height: logo.height },
      ),
    ]);
    return respond(await readReceiptLogos(db, actor.tenantId, actor.branchId));
  }
  if (url.pathname === "/api/seramet/printing/dispatch-bypass") {
    // Lets the active branch send orders to the kitchen without a printer or
    // KDS route for 36 hours. Only hardware managers may turn it on or off.
    if (request.method !== "POST" && request.method !== "DELETE")
      return respond({ code: "NOT_FOUND" }, 404);
    manage(actor);
    const branchRow = await db
      .prepare("SELECT payload_json FROM branches WHERE tenant_id=? AND id=?")
      .bind(actor.tenantId, actor.branchId)
      .first<{ payload_json: string }>();
    if (!branchRow) throw new SerametHttpError(403, "Choose a branch first.");
    const branchPayload = JSON.parse(branchRow.payload_json) as {
      metadata?: Record<string, unknown>;
    };
    const metadata = branchPayload.metadata ?? {};
    const current = activeKitchenPrintBypass(metadata);
    let next: Record<string, unknown>;
    let action: string;
    let detail: string;
    if (request.method === "POST") {
      const input = z
        .object({ reason: z.string().trim().min(12).max(240) })
        .strict()
        .safeParse(await parse(request));
      if (!input.success)
        throw new SerametHttpError(400, "Give a reason of at least 12 characters.");
      if (current)
        throw new SerametHttpError(409, "The printer bypass is already on for this branch.");
      next = startKitchenPrintBypass(metadata, {
        startedBy: actor.name,
        reason: input.data.reason,
      });
      action = "KITCHEN_PRINT_BYPASS_STARTED";
      detail = input.data.reason;
    } else {
      if (!current) return respond({ bypass: null });
      next = endKitchenPrintBypass(metadata);
      action = "KITCHEN_PRINT_BYPASS_ENDED";
      detail = `Ended early; was on until ${current.until}`;
    }
    await db.batch([
      db
        .prepare("UPDATE branches SET payload_json=? WHERE tenant_id=? AND id=?")
        .bind(JSON.stringify({ ...branchPayload, metadata: next }), actor.tenantId, actor.branchId),
      auditStatement(db, actor, `PRINT-BYPASS:${crypto.randomUUID()}`, action, detail, {
        before: current,
        after: activeKitchenPrintBypass(next),
      }),
    ]);
    await invalidateAuthoritativeConfiguration(db, actor.tenantId);
    return respond(
      { bypass: activeKitchenPrintBypass(next) },
      request.method === "POST" ? 201 : 200,
    );
  }
  if (url.pathname !== "/api/seramet/printing/authorize" || request.method !== "POST")
    return respond({ code: "NOT_FOUND" }, 404);
  const parsed = authorizationSchema.safeParse(await parse(request));
  if (!parsed.success) throw new SerametHttpError(400, "Invalid print authorization request");
  const input = parsed.data;
  const row = await db
    .prepare(
      "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
    )
    .bind(actor.tenantId, actor.branchId, input.printerId)
    .first<{ payload_json: string }>();
  const parsedConfig = printerConfigurationSchema.safeParse(
    row ? JSON.parse(row.payload_json).printing : null,
  );
  if (!parsedConfig.success || !parsedConfig.data.enabled)
    throw new SerametHttpError(403, "Enabled branch printer required");
  const printer = { ...parsedConfig.data, id: input.printerId };
  let fallback: (PrinterConfiguration & { id: string }) | undefined;
  if (printer.fallbackPrinterId) {
    const row = await db
      .prepare(
        "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER' AND trust_status<>'REVOKED'",
      )
      .bind(actor.tenantId, actor.branchId, printer.fallbackPrinterId)
      .first<{ payload_json: string }>();
    const parsed = printerConfigurationSchema.safeParse(
      row ? JSON.parse(row.payload_json).printing : null,
    );
    if (parsed.success && parsed.data.enabled && parsed.data.bridgeId === printer.bridgeId)
      fallback = { ...parsed.data, id: printer.fallbackPrinterId };
  }
  if (input.copyIndex >= printer.copies)
    throw new SerametHttpError(400, "Printer copy limit exceeded");
  const state = await repository.loadState(actor.tenantId);
  let content: string;
  // The typeset approved document, printed by raster (image) printers.
  let rich: RichDocument | undefined;
  let id: string;
  let recoveryId: string | undefined;
  if (["FOOD_KOT", "BAR_TICKET", "DISPATCH_TICKET"].includes(input.documentType)) {
    requirePermission(actor, permissions.ordersUpdate);
    const obligation = state.kitchenPrintObligations?.find(
      (item) => item.id === input.recordId && item.branchId === actor.branchId,
    );
    if (
      !obligation ||
      obligation.status !== "CLAIMED" ||
      obligation.claimToken !== input.claimToken ||
      obligation.claimedBy !== actor.id
    ) {
      throw new SerametHttpError(409, "An active authoritative KOT claim is required");
    }
    const profile = SerametPrintService.getBranchHardwareProfile(actor.branchId, actor.tenantId);
    for (const route of Object.values(profile.documentRoutes)) route.template = printer.paperWidth;
    if (!printer.stations.includes(obligation.station))
      throw new SerametHttpError(403, "Printer is not assigned to this station");
    const order = state.orders.find(
      (item) => item.id === obligation.orderId && item.branchId === actor.branchId,
    );
    if (!order) throw new SerametHttpError(404, "Authoritative order unavailable");
    const printOrder: OrderForPrint = {
      orderId: order.id,
      branch: order.branch,
      terminalId: actor.deviceId ?? "authorized-terminal",
      kitchenObligationId: obligation.id,
      orderType: order.channel,
      requestedBy: obligation.kind === "REPRINT" ? actor.name : order.cashier,
      cashier: order.cashier,
      waiter: order.waiter ?? order.cashier,
      createdAt: obligation.createdAt,
      ...(order.table ? { table: order.table } : {}),
      ...(order.customer ? { customer: order.customer } : {}),
      ...(order.kitchenNote ? { kitchenNote: order.kitchenNote } : {}),
      lines: obligation.lines.map((line) => ({
        ...line,
        productionStation: line.productionStation ?? "NONE",
      })),
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
    };
    const plan = SerametPrintService.createProductionTicketJobs(
      profile,
      printOrder,
      [],
      obligation.kind === "REPRINT"
        ? "REPRINT"
        : obligation.kind === "ORIGINAL"
          ? "NEW"
          : "ADDITION",
    );
    const document = plan.jobs.find(
      (job) => job.kitchenDelivery !== "KDS_DISPLAY" && job.printerId === input.printerId,
    );
    if (!document)
      throw new SerametHttpError(403, "Printer is not the authoritative station route");
    content = document.content;
    rich = document.rich;
    id = `${obligation.id}:${input.copyIndex}`;
    if (obligation.reviewReason) recoveryId = obligation.claimToken;
  } else if (input.documentType === "TEST") {
    manage(actor);
    content = diagnosticContent(actor, input.testKind ?? "BILL", printer.paperWidth);
    const sample = diagnosticDocument(actor, input.testKind ?? "BILL", printer.paperWidth).rich;
    if (sample) rich = bannerRich(sample, "PRINTER TEST - NOT A SALE");
    id = `TEST:${actor.id}:${input.recordId}:${input.copyIndex}`;
  } else {
    requirePermission(actor, permissions.invoicesManage);
    const profile = SerametPrintService.getBranchHardwareProfile(actor.branchId, actor.tenantId);
    for (const template of Object.values(profile.templateSettings))
      template.width = printer.paperWidth;
    const receipt =
      input.documentType === "RECEIPT"
        ? state.receipts.find(
            (item) => item.id === input.recordId && item.branchId === actor.branchId,
          )
        : undefined;
    const bill = state.bills.find(
      (item) => item.id === input.recordId && item.branchId === actor.branchId,
    );
    const printOrder = receipt
      ? receiptRecordToPrintOrder(receipt, state)
      : bill && input.documentType !== "RECEIPT"
        ? billingRecordToPrintOrder(bill, state.payments, state.orders)
        : null;
    if (!printOrder) throw new SerametHttpError(404, "Authoritative document unavailable");
    if (!printer.roles.some((role) => role === input.documentType))
      throw new SerametHttpError(403, "Printer is not assigned to this document");
    printOrder.taxRatesBps = await activeVatRatesBps(db, actor.tenantId, actor.branchId);
    // KRA eTIMS: a receipt is signed by the OSCU before it prints (TIS
    // specification, Article 10). Reprints reuse the stored signature.
    if (receipt) {
      const source = state.bills.find((item) => item.id === receipt.invoiceId);
      const order = state.orders.find((item) => item.id === receipt.orderId);
      const lines = source?.lines ?? order?.lines ?? [];
      try {
        const etims = await fiscalizeReceipt(env, db, actor, actor.branchId, {
          receiptId: receipt.id,
          receiptNumber: printOrder.receiptNumber ?? receipt.id,
          issuedAt: receipt.issuedAt,
          timeZone: profile.printIdentity.timeZone,
          lines: lines.map((line) => ({
            ...(line.productId ? { productId: line.productId } : {}),
            name: line.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
          serviceCharge: printOrder.serviceCharge ?? 0,
          deliveryCharge: printOrder.deliveryCharge ?? 0,
          discount: printOrder.discount ?? 0,
          total: printOrder.total,
          paymentMethods: receipt.paymentBreakdown.map((payment) => String(payment.method)),
          customerName: receipt.customer,
          cashier: { id: actor.id, name: receipt.cashier || actor.name },
          tradeName: profile.printIdentity.businessName,
          address: profile.printIdentity.address,
        });
        if (etims) printOrder.etims = etims;
      } catch (error) {
        if (error instanceof EtimsError) throw new SerametHttpError(error.status, error.message);
        throw error;
      }
    }
    // Image printers print a real M-Pesa scan-to-pay QR on bills with an amount due.
    if (bill && input.documentType !== "RECEIPT" && printer.renderingMode === "RASTER_ESC_POS") {
      const modules = await billPaymentQr(env, repository, db, actor, {
        billId: bill.id,
        branchId: actor.branchId,
        amountDue: printOrder.total - (printOrder.paid ?? 0),
        currency: profile.printIdentity.currency ?? "KES",
      });
      if (modules) printOrder.mpesaQrModules = modules;
    }
    const job = SerametPrintService.createDocumentJob(
      profile,
      printOrder,
      input.documentType as "BILL" | "RECEIPT" | "INVOICE",
    );
    content = job.content;
    rich = job.rich;
    id = `${input.documentType}:${input.recordId}:${input.copyIndex}`;
    if (input.reprintId) {
      if (!input.reprintReason)
        throw new SerametHttpError(400, "A specific reprint reason is required");
      id += `:REPRINT:${input.reprintId}`;
      if (input.documentType === "RECEIPT" && input.copyIndex === 0) {
        const payload = { receiptId: input.recordId, reason: input.reprintReason };
        const requestHash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify(payload)),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        await repository.commitMutation({
          actor,
          action: "recordReceiptReprint",
          payload,
          idempotencyKey: `PRINT-REPRINT:${input.reprintId}`,
          requestHash,
          correlationId: input.reprintId,
          expectedRevision: await repository.revision(actor.tenantId),
        });
      }
      await auditStatement(db, actor, id, "PRINT_REPRINT_AUTHORIZED", input.reprintReason).run();
      content = SerametPrintService.formatDuplicateCopy(content, printer.paperWidth);
      if (rich) rich = duplicateRich(rich);
    }
  }
  const signingMaster = await printSigningMaster(env);
  if (signingMaster.length < 32)
    throw new SerametHttpError(503, "Protected print signing is not configured");
  if (input.testRenderingMode && input.documentType !== "TEST")
    throw new SerametHttpError(400, "Rendering overrides are diagnostic-only");
  const profile = printerRenderingProfile(
    printer,
    input.testRenderingMode ?? printer.renderingMode,
  );
  const fallbackProfile = fallback ? printerRenderingProfile(fallback) : undefined;
  const hasRaster = [profile, fallbackProfile].some((p) => p?.renderingMode === "RASTER_ESC_POS");
  // Raster printers print the approved typeset layout when the document has one.
  const typeset = hasRaster && rich?.paper === printer.paperWidth ? rich : undefined;
  const version = typeset ? 3 : hasRaster ? 2 : 1;
  if (hasRaster && fallback && fallback.paperWidth !== printer.paperWidth)
    throw new SerametHttpError(400, "Raster fallback requires the same paper profile");
  let document: ReturnType<typeof buildThermalLayout> | undefined;
  // Bills, receipts and invoices (and their test prints) carry the branch's logo.
  const logoKind = input.documentType === "TEST" ? (input.testKind ?? "BILL") : input.documentType;
  // The approved layout's header is the business name, address and phone, so a
  // typeset document carries no separate logo image.
  let logo =
    !typeset && LOGO_DOCUMENT_TYPES.includes(logoKind)
      ? await effectiveReceiptLogo(db, actor.tenantId, actor.branchId)
      : undefined;
  try {
    document = hasRaster && !typeset ? buildThermalLayout(content, printer.paperWidth) : undefined;
    const renderJob = {
      v: version,
      content,
      ...(document ? { document } : {}),
      ...(typeset ? { rich: typeset } : {}),
      target: printerTarget(printer),
      profile,
      ...(fallback ? { fallbackTarget: printerTarget(fallback), fallbackProfile } : {}),
    };
    if (logo) {
      try {
        validateRenderJob({ ...renderJob, logo });
      } catch {
        // A logo too big for this printer's image limits is left off; the document still prints.
        logo = undefined;
      }
    }
    validateRenderJob(renderJob);
  } catch {
    throw new SerametHttpError(400, "Unsupported or oversized document rendering profile");
  }
  const delivery = await authorizeDelivery(db, actor, {
    v: version,
    id,
    bridgeId: printer.bridgeId,
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    actorId: actor.id,
    sourceRecordId: input.recordId,
    claimToken: input.claimToken ?? null,
    reprintReason: input.reprintReason ?? null,
    reprintId: input.reprintId ?? null,
    documentType: input.documentType,
    content,
    ...(document ? { document } : {}),
    ...(typeset ? { rich: typeset } : {}),
    ...(logo ? { logo } : {}),
    target: printerTarget(printer),
    printerConfigurationHash: await digest(printer),
    ...(fallback
      ? {
          fallbackTarget: printerTarget(fallback),
          fallbackConfigurationHash: await digest(fallback),
          fallbackProfile,
        }
      : {}),
    profile,
    expiresAt: Date.now() + 90000,
    localTest:
      resolveRuntimeConfiguration(env).environment === "development" &&
      ["localhost", "127.0.0.1"].includes(url.hostname),
    ...(recoveryId ? { recoveryId } : {}),
  });
  const authorization = await signPrintJob(
    delivery,
    await deriveBridgeSigningKey(signingMaster, actor.tenantId, actor.branchId, printer.bridgeId),
  );
  return respond({ authorization, retry: Boolean(recoveryId) });
}

/**
 * A test print renders the same templates as real documents, at the printer's
 * paper width and with the branch header, so a test shows exactly how bills,
 * receipts and kitchen tickets will print. Amounts are zero and nothing is stored.
 */
function diagnosticContent(
  actor: ServerActor,
  kind: "BILL" | "RECEIPT" | "FOOD_KOT",
  paperWidth: "58mm" | "80mm",
) {
  const width = paperWidth === "58mm" ? 32 : 42;
  const banner = "PRINTER TEST - NOT A SALE";
  return [
    " ".repeat(Math.floor((width - banner.length) / 2)) + banner,
    diagnosticDocument(actor, kind, paperWidth).content,
  ]
    .join("\n")
    .trimEnd();
}

/**
 * The M-Pesa QR for a bill and amount, issued once and then reused, so a
 * reprint or a retried delivery prints the identical code (and the signed
 * print identity does not change).
 */
async function billPaymentQr(
  env: SerametEnv,
  repository: TransactionRepository,
  db: D1Database,
  actor: ServerActor,
  input: PrintPaymentQrInput,
): Promise<string[] | undefined> {
  const id = `PRINT-QR:${input.billId}:${Math.round(input.amountDue * 100)}`;
  const stored = async () => {
    const row = await db
      .prepare("SELECT metadata_json FROM audit_events WHERE tenant_id=? AND branch_id=? AND id=?")
      .bind(actor.tenantId, actor.branchId, id)
      .first<{ metadata_json: string }>();
    const modules = row
      ? (JSON.parse(row.metadata_json) as { modules?: unknown }).modules
      : undefined;
    return Array.isArray(modules) && modules.every((r) => typeof r === "string")
      ? (modules as string[])
      : undefined;
  };
  try {
    const existing = await stored();
    if (existing) return existing;
    const issued = await printablePaymentQr(env, repository, actor, input);
    if (!issued.ok) return undefined;
    await auditStatement(db, actor, id, "PRINT_PAYMENT_QR_ISSUED", input.billId, {
      modules: issued.modules,
      paymentMethodId: issued.paymentMethodId,
    }).run();
    return await stored();
  } catch {
    // The bill still prints, with the till and amount and no QR.
    return undefined;
  }
}

/** Rates of the branch's active VAT rules, for the "VAT (16%)" label on bills and receipts. */
async function activeVatRatesBps(db: D1Database, tenantId: string, branchId: string) {
  const now = new Date().toISOString();
  try {
    const rows = await db
      .prepare(
        `SELECT rate_bps FROM tax_service_rules
         WHERE tenant_id=? AND rule_type='TAX' AND active=1 AND (branch_id=? OR branch_id IS NULL)
           AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`,
      )
      .bind(tenantId, branchId, now, now)
      .all<{ rate_bps: number }>();
    return (rows.results ?? []).map((row) => Number(row.rate_bps)).filter(Number.isFinite);
  } catch {
    // The rate only labels the VAT row; without it the row prints as "VAT".
    return [];
  }
}

const DIAGNOSTIC_LINE = {
  name: "Printer diagnostic",
  quantity: 1,
  unitPrice: 0,
  modifiers: ["Check the borders and columns"],
};

/**
 * The test document in both forms: ruled text for text printers and the
 * approved typeset layout for image printers. A branch without print settings
 * gets the same approved layouts under a plain header.
 */
function diagnosticDocument(
  actor: ServerActor,
  kind: "BILL" | "RECEIPT" | "FOOD_KOT",
  paperWidth: "58mm" | "80mm",
): { content: string; rich?: RichDocument } {
  let profile: ReturnType<typeof SerametPrintService.getBranchHardwareProfile> | undefined;
  try {
    profile = SerametPrintService.getBranchHardwareProfile(actor.branchId, actor.tenantId);
  } catch (error) {
    if (!(error instanceof PlatformConfigurationError)) throw error;
  }
  if (profile) {
    const job = diagnosticJob(actor, kind, paperWidth, profile);
    return { content: job?.content ?? "", ...(job?.rich ? { rich: job.rich } : {}) };
  }
  const ctx = { paper: paperWidth, currency: "KES" };
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const time = now.slice(11, 16);
  const business = { name: "Seramet" };
  const lines = [DIAGNOSTIC_LINE];
  const totals = { subtotal: 0, total: 0 };
  const document =
    kind === "FOOD_KOT"
      ? renderOrderTicket(
          {
            station: "KITCHEN",
            status: "NEW",
            orderNumber: "TEST",
            date,
            time,
            customer: "Printer test",
            table: "T1",
            lines,
            requestedBy: actor.name,
          },
          ctx,
        )
      : kind === "RECEIPT"
        ? renderApprovedReceipt(
            {
              business,
              receiptNumber: "RCPT-TEST",
              date,
              time,
              lines,
              totals,
              payments: [{ method: "Cash", amount: 0 }],
              paid: 0,
            },
            ctx,
          )
        : renderApprovedInvoice(
            { business, invoiceNumber: "INV-TEST", date, time, lines, totals },
            ctx,
            "BILL",
          );
  return { content: document.content, ...(document.rich ? { rich: document.rich } : {}) };
}

function diagnosticJob(
  actor: ServerActor,
  kind: "BILL" | "RECEIPT" | "FOOD_KOT",
  paperWidth: "58mm" | "80mm",
  profile = SerametPrintService.getBranchHardwareProfile(actor.branchId, actor.tenantId),
) {
  for (const template of Object.values(profile.templateSettings)) template.width = paperWidth;
  for (const route of Object.values(profile.documentRoutes)) route.template = paperWidth;
  profile.kitchenMode = "PRINTER_ONLY";
  const line = DIAGNOSTIC_LINE;
  const order: OrderForPrint = {
    orderId: "#TEST",
    branch: profile.branch,
    terminalId: "printer-test",
    requestedBy: "Printer test",
    cashier: "Printer test",
    waiter: "Printer test",
    createdAt: new Date().toISOString(),
    orderType: "Printer test",
    table: "T1",
    receiptNumber: "RCP-TEST",
    invoiceNumber: "INV-TEST",
    paymentMethod: "Cash",
    subtotal: 0,
    tax: 0,
    total: 0,
    paid: 0,
    lines: [
      {
        ...line,
        id: "printer-test-line",
        category: "Test",
        productionStation: "MAIN KITCHEN",
      },
    ],
  };
  return kind === "FOOD_KOT"
    ? SerametPrintService.createProductionTicketJobs(profile, order, []).jobs.find(
        (job) => job.kitchenDelivery !== "KDS_DISPLAY",
      )
    : SerametPrintService.createDocumentJob(profile, order, kind);
}
