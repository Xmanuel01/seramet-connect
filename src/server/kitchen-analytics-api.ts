import {
  KitchenAnalyticsService,
  parseKitchenAnalyticsPeriod,
} from "@/kitchen/kitchen-analytics-service";
import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { ServerOperationError } from "@/server/errors";

export async function handleKitchenAnalyticsApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/kitchen-analytics")) return null;

  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative kitchen analytics database unavailable",
    );
  }

  const service = new KitchenAnalyticsService(env.SERAMET_DB, actor);

  if (url.pathname === "/api/seramet/kitchen-analytics/overview" && request.method === "GET") {
    const branchId = url.searchParams.get("branchId")?.trim();
    if (!branchId) throw new SerametHttpError(400, "branchId is required");
    return json({
      ok: true,
      overview: await service.overview(
        branchId,
        parseKitchenAnalyticsPeriod(url.searchParams.get("periodDays")),
      ),
    });
  }

  return null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
