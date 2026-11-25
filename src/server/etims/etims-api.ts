// KRA eTIMS settings for a branch:
//   GET  /api/seramet/etims/settings?branchId=   read (no secrets)
//   PUT  /api/seramet/etims/settings             save PIN, branch ID, device serial...
//   POST /api/seramet/etims/activate             activate the OSCU with KRA
import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { DatabaseRateLimiter, sensitiveRateLimits } from "@/server/rate-limit";
import {
  EtimsError,
  initializeEtimsDevice,
  loadEtimsSettings,
  saveEtimsSettings,
  type EtimsSettings,
  type EtimsSettingsInput,
} from "@/server/etims/etims-service";

function publicSettings(settings: EtimsSettings | undefined) {
  if (!settings) return { configured: false };
  // The communication key never leaves the secret store; only whether it exists.
  const { cmcKeyRef, ...rest } = settings;
  return { configured: true, activated: Boolean(cmcKeyRef && settings.sdcId), ...rest };
}

export async function handleEtimsApi(request: Request, env: SerametEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const route = /^\/api\/seramet\/etims\/(settings|activate)$/.exec(url.pathname);
  if (!route) return null;
  if (!env.SERAMET_DB) throw new SerametHttpError(503, "eTIMS settings are unavailable");
  const db = env.SERAMET_DB;
  const actor = await authenticateSerametRequest(request, env);
  const branchId = url.searchParams.get("branchId")?.trim() || actor.branchId;
  authorizeBranchRead(actor, actor.tenantId, branchId);
  const can = (permission: string) => actor.permissions.includes(permission);
  try {
    if (route[1] === "settings" && request.method === "GET") {
      if (!can(permissions.integrationsView) && !can(permissions.setupManage))
        throw new SerametHttpError(403, "Not allowed to view eTIMS settings");
      return Response.json(publicSettings(await loadEtimsSettings(db, actor.tenantId, branchId)));
    }
    if (!can(permissions.setupManage))
      throw new SerametHttpError(403, "Not allowed to change eTIMS settings");
    await new DatabaseRateLimiter(db).consume(
      `${actor.tenantId}:${actor.id}:etims`,
      sensitiveRateLimits.configuration,
    );
    if (route[1] === "settings" && request.method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as Partial<EtimsSettingsInput>;
      const input: EtimsSettingsInput = {
        environment: body.environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX",
        tin: String(body.tin ?? "")
          .trim()
          .toUpperCase(),
        bhfId: String(body.bhfId ?? "00").trim(),
        deviceSerial: String(body.deviceSerial ?? "").trim(),
        itemClassCode: String(body.itemClassCode ?? "").trim(),
        untaxedTaxType:
          body.untaxedTaxType === "A" || body.untaxedTaxType === "C" ? body.untaxedTaxType : "D",
        qrFormat: body.qrFormat === "SCU_DATA" ? "SCU_DATA" : "KRA_LINK",
        enabled: body.enabled === true,
      };
      return Response.json(publicSettings(await saveEtimsSettings(db, actor, branchId, input)));
    }
    if (route[1] === "activate" && request.method === "POST")
      return Response.json(publicSettings(await initializeEtimsDevice(env, db, actor, branchId)));
    throw new SerametHttpError(405, "Method not allowed");
  } catch (error) {
    if (error instanceof EtimsError) throw new SerametHttpError(error.status, error.message);
    throw error;
  }
}
