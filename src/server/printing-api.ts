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
import { billingRecordToPrintOrder, receiptRecordToPrintOrder } from "@/lib/print-order-adapter";
import type { D1Database } from "@/server/database/d1";
import { resolveRuntimeConfiguration } from "@/server/environment";
import { invalidateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { buildThermalLayout, validateRenderJob } from "../../printing-core/thermal-layout.mjs";

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
const deliverySchema = z
  .object({
    v: z.union([z.literal(1), z.literal(2)]),
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
  const { expiresAt: _expires, actorId: _actor, deliveryAttempt: _attempt, ...stable } = job;
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
    env.SERAMET_PRINT_SIGNING_KEY ?? "",
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
      "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER'",
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
        "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER'",
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
            "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND device_type='PRINTER'",
          )
          .bind(actor.tenantId, actor.branchId)
          .all<{ payload_json: string }>()
      ).results ?? [];
    if (
      !rows.some((row) => {
        const config = printerConfigurationSchema.safeParse(JSON.parse(row.payload_json).printing);
        return config.success && config.data.enabled && config.data.bridgeId === input.bridgeId;
      })
    )
      throw new SerametHttpError(403, "Configured branch bridge required");
    const signingKey = await deriveBridgeSigningKey(
      env.SERAMET_PRINT_SIGNING_KEY ?? "",
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
        "SELECT id,payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND device_type='PRINTER'",
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
      .prepare("SELECT branch_id FROM hardware_devices WHERE tenant_id=? AND id=?")
      .bind(actor.tenantId, id)
      .first<{ branch_id: string }>();
    if (existing && existing.branch_id !== actor.branchId)
      throw new SerametHttpError(403, "Cross-branch printer replacement denied");
    if (printer.fallbackPrinterId) {
      const fallback = await db
        .prepare(
          "SELECT id,payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER'",
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
      name=excluded.name,payload_json=excluded.payload_json WHERE hardware_devices.branch_id=excluded.branch_id`,
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
    await db.batch([
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
    invalidateAuthoritativeConfiguration(db);
    return respond({ printer: saved }, 201);
  }
  if (url.pathname !== "/api/seramet/printing/authorize" || request.method !== "POST")
    return respond({ code: "NOT_FOUND" }, 404);
  const parsed = authorizationSchema.safeParse(await parse(request));
  if (!parsed.success) throw new SerametHttpError(400, "Invalid print authorization request");
  const input = parsed.data;
  const row = await db
    .prepare(
      "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER'",
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
        "SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER'",
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
    id = `${obligation.id}:${input.copyIndex}`;
    if (obligation.reviewReason) recoveryId = obligation.claimToken;
  } else if (input.documentType === "TEST") {
    manage(actor);
    content = `SERAMET\n*** TEST ${input.testKind ?? "BILL"} ***\n+---+--------------------------+\n|QTY|ITEM                      |\n+---+--------------------------+\n|  1|Printer diagnostic        |\n+---+--------------------------+\nTOTAL KES 0.00\nNOT A SALE`;
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
    content = SerametPrintService.createDocumentJob(
      profile,
      printOrder,
      input.documentType as "BILL" | "RECEIPT" | "INVOICE",
    ).content;
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
    }
  }
  if (!env.SERAMET_PRINT_SIGNING_KEY || env.SERAMET_PRINT_SIGNING_KEY.length < 32)
    throw new SerametHttpError(503, "Protected print signing is not configured");
  if (input.testRenderingMode && input.documentType !== "TEST")
    throw new SerametHttpError(400, "Rendering overrides are diagnostic-only");
  const profile = printerRenderingProfile(
    printer,
    input.testRenderingMode ?? printer.renderingMode,
  );
  const fallbackProfile = fallback ? printerRenderingProfile(fallback) : undefined;
  const hasRaster = [profile, fallbackProfile].some((p) => p?.renderingMode === "RASTER_ESC_POS");
  if (hasRaster && fallback && fallback.paperWidth !== printer.paperWidth)
    throw new SerametHttpError(400, "Raster fallback requires the same paper profile");
  let document: ReturnType<typeof buildThermalLayout> | undefined;
  try {
    document = hasRaster ? buildThermalLayout(content, printer.paperWidth) : undefined;
    validateRenderJob({
      v: hasRaster ? 2 : 1,
      content,
      document,
      target: printerTarget(printer),
      profile,
      ...(fallback ? { fallbackTarget: printerTarget(fallback), fallbackProfile } : {}),
    });
  } catch {
    throw new SerametHttpError(400, "Unsupported or oversized document rendering profile");
  }
  const delivery = await authorizeDelivery(db, actor, {
    v: hasRaster ? 2 : 1,
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
    await deriveBridgeSigningKey(
      env.SERAMET_PRINT_SIGNING_KEY,
      actor.tenantId,
      actor.branchId,
      printer.bridgeId,
    ),
  );
  return respond({ authorization, retry: Boolean(recoveryId) });
}
