import { z, type ZodTypeAny } from "zod";
import { CookbookService } from "@/cookbook/cookbook-service";
import {
  cookbookCopyPreviousSchema,
  cookbookDraftSchema,
  cookbookPublishSchema,
} from "@/cookbook/schemas";
import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { ServerOperationError } from "@/server/errors";

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

  if (url.pathname === "/api/seramet/cookbook/library" && request.method === "GET") {
    return json({
      ok: true,
      library: await service.library(required(url, "branchId")),
    });
  }

  const historyRoute = /^\/api\/seramet\/cookbook\/recipe-versions\/([^/]+)\/history$/.exec(
    url.pathname,
  );
  if (historyRoute && request.method === "GET") {
    return json({
      ok: true,
      history: await service.history(decodeURIComponent(historyRoute[1]!)),
    });
  }

  if (url.pathname === "/api/seramet/cookbook/drafts" && request.method === "POST") {
    return json(
      {
        ok: true,
        draft: await service.saveDraft(await parse(request, cookbookDraftSchema)),
      },
      201,
    );
  }

  if (url.pathname === "/api/seramet/cookbook/publish" && request.method === "POST") {
    return json(
      {
        ok: true,
        published: await service.publish(await parse(request, cookbookPublishSchema)),
      },
      201,
    );
  }

  if (url.pathname === "/api/seramet/cookbook/copy-previous" && request.method === "POST") {
    return json(
      {
        ok: true,
        draft: await service.copyPreviousPublished(
          await parse(request, cookbookCopyPreviousSchema),
        ),
      },
      201,
    );
  }

  return null;
}

async function parse<T>(request: Request, schema: ZodTypeAny): Promise<T> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new SerametHttpError(
      400,
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
        .join("; "),
    );
  }
  return result.data as T;
}

function required(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  if (!value) throw new SerametHttpError(400, `${key} is required`);
  return value;
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
