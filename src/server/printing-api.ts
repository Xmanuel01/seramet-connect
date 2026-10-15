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
  type PrinterConfiguration,
} from "@/printing/printer-configuration";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { SerametPrintService, type OrderForPrint } from "@/lib/seramet-print-service";
import { billingRecordToPrintOrder, receiptRecordToPrintOrder } from "@/lib/print-order-adapter";
import type { D1Database } from "@/server/database/d1";
import { resolveRuntimeConfiguration } from "@/server/environment";
import { invalidateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";

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
      "{}",
      new Date().toISOString(),
    );
}
async function parse(request: Request) {
  const reader = request.body?.getReader();
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  if (reader)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16000) {
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

export async function handlePrintingApi(
  request: Request,
  env: SerametEnv,
  repository: TransactionRepository,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/printing/")) return null;
  const actor = await authenticateSerametRequest(request, env);
  const db = env.SERAMET_DB;
  if (!db) throw new SerametHttpError(503, "Authoritative printer configuration is unavailable");
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
          "SELECT id FROM hardware_devices WHERE tenant_id=? AND branch_id=? AND id=? AND device_type='PRINTER'",
        )
        .bind(actor.tenantId, actor.branchId, printer.fallbackPrinterId)
        .first();
      if (!fallback || printer.fallbackPrinterId === id)
        throw new SerametHttpError(400, "Invalid branch fallback printer");
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
      requestedBy: order.cashier,
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
    content = `SERAMET\n*** TEST ${input.testKind ?? "BILL"} ***\n1 x Printer diagnostic\n  Modifier: no salt\nTOTAL KES 0.00\nNOT A SALE`;
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
      content = `*** DUPLICATE COPY ***\n${content}`;
    }
  }
  if (!env.SERAMET_PRINT_SIGNING_KEY || env.SERAMET_PRINT_SIGNING_KEY.length < 32)
    throw new SerametHttpError(503, "Protected print signing is not configured");
  const authorization = await signPrintJob(
    {
      v: 1,
      id,
      bridgeId: printer.bridgeId,
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      documentType: input.documentType,
      content,
      target: printerTarget(printer),
      ...(fallback
        ? {
            fallbackTarget: printerTarget(fallback),
            fallbackProfile: {
              paperWidth: fallback.paperWidth,
              encoding: fallback.encoding,
              cutter: fallback.cutter,
              emphasis: fallback.emphasis,
            },
          }
        : {}),
      profile: {
        paperWidth: printer.paperWidth,
        encoding: printer.encoding,
        cutter: printer.cutter,
        emphasis: printer.emphasis,
      },
      expiresAt: Date.now() + 90000,
      localTest:
        resolveRuntimeConfiguration(env).environment === "development" &&
        ["localhost", "127.0.0.1"].includes(url.hostname),
      ...(recoveryId ? { recoveryId } : {}),
    },
    await deriveBridgeSigningKey(
      env.SERAMET_PRINT_SIGNING_KEY,
      actor.tenantId,
      actor.branchId,
      printer.bridgeId,
    ),
  );
  return respond({ authorization, retry: Boolean(recoveryId) });
}
