import { cookbookDraftSchema, cookbookPublishSchema } from "@/cookbook/schemas";
import { CookbookService } from "@/cookbook/cookbook-service";
import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { ServerOperationError } from "@/server/errors";
import type { z, ZodTypeAny } from "zod";

export async function handleCookbookApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/cookbook")) return null;

  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative cookbook database unavailable",
    );
  }
  const service = new CookbookService(env.SERAMET_DB, actor);

  if (url.pathname === "/api/seramet/cookbook" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, cookbook: await service.overview(branchId) });
  }

  const recipeRoute = /^\/api\/seramet\/cookbook\/recipes\/([^/]+)$/.exec(url.pathname);
  if (recipeRoute && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({
      ok: true,
      cookbook: await service.detail(branchId, decodeURIComponent(recipeRoute[1]!)),
    });
  }

  if (url.pathname === "/api/seramet/cookbook/drafts" && request.method === "POST") {
    const draft = await service.saveDraft(await parse(request, cookbookDraftSchema));
    return json({ ok: true, draft }, draft.duplicate ? 200 : 201);
  }

  if (url.pathname === "/api/seramet/cookbook/publish" && request.method === "POST") {
    const published = await service.publish(await parse(request, cookbookPublishSchema));
    return json({ ok: true, published }, published.duplicate ? 200 : 201);
  }

  return null;
}

function requiredQuery(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  if (!value) throw new SerametHttpError(400, `${key} is required`);
  return value;
}

async function parse<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new SerametHttpError(
      400,
      result.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return result.data;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
