import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleSerametApiRequest } from "./lib/seramet-api";
import type { SerametEnv } from "./lib/seramet-auth";
import type { DurableQueueBatch } from "./server/environment";
import { isPublicDevelopmentRequest, resolveRuntimeConfiguration } from "./server/environment";
import { cloudflareBindings } from "./server/cloudflare-bindings";
import { resolveEnvironmentFromBindings } from "./server/runtime-env-resolver";
import {
  handleWorkerQueue,
  scheduleDurableWork,
  type SerametWorkerMessage,
} from "./server/workers";

type ServerEntry = {
  fetch: (request: Request) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }

  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} - try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return response;
  }

  const body = await response.clone().text();

  if (!isH3SwallowedErrorBody(body)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));

  return new Response(renderErrorPage(), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as {
      unhandled?: unknown;
      message?: unknown;
    };

    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, fallbackBindings?: unknown) {
    try {
      const resolvedEnvironment = await resolveServerEnvironment(request, fallbackBindings);

      if (new URL(request.url).pathname.startsWith("/api/seramet")) {
        if (
          !isPublicDevelopmentRequest(request, resolvedEnvironment) &&
          !isAllowedBrowserOrigin(request, resolvedEnvironment)
        ) {
          return secureResponse(
            Response.json(
              {
                ok: false,
                code: "PERMISSION_DENIED",
                message: "Cross-origin mutation denied",
              },
              {
                status: 403,
              },
            ),
            resolvedEnvironment,
            true,
          );
        }

        return secureResponse(
          await handleSerametApiRequest(request, resolvedEnvironment),
          resolvedEnvironment,
          true,
        );
      }

      const handler = await getServerEntry();

      const response = await handler.fetch(request);

      return secureResponse(
        await normalizeCatastrophicSsrResponse(response),
        resolvedEnvironment,
        false,
      );
    } catch (error) {
      console.error(error);

      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }
  },

  async queue(batch: DurableQueueBatch<SerametWorkerMessage>, env: unknown) {
    await handleWorkerQueue(batch, await resolveEnvironmentFromBindings(env));
  },

  async scheduled(_controller: unknown, env: unknown) {
    await scheduleDurableWork(await resolveEnvironmentFromBindings(env));
  },
};

function isAllowedBrowserOrigin(request: Request, env: SerametEnv) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    return true;
  }

  const origin = request.headers.get("origin");

  if (!origin) return true;

  const requestOrigin = new URL(request.url).origin;

  const allowed = new Set(
    [requestOrigin, env.SERAMET_PUBLIC_ORIGIN, ...(env.SERAMET_ALLOWED_ORIGINS ?? "").split(",")]
      .map((value) => value?.trim().replace(/\/$/, ""))
      .filter((value): value is string => Boolean(value)),
  );

  return allowed.has(origin.replace(/\/$/, ""));
}

async function secureResponse(response: Response, env: SerametEnv, api: boolean) {
  const headers = new Headers(response.headers);

  const productionLike = resolveRuntimeConfiguration(env).productionLike;

  headers.set("x-content-type-options", "nosniff");

  headers.set("referrer-policy", "strict-origin-when-cross-origin");

  headers.set("x-frame-options", "SAMEORIGIN");

  // SPA navigation retains the entry document's policy. Attendance needs same-origin,
  // user-consented foreground location even when entry was through another page.
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(self), payment=()");

  if (productionLike) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");

    if (!api) {
      const contentType = headers.get("content-type")?.toLowerCase() ?? "";

      if (contentType.includes("text/html")) {
        const nonce = crypto.randomUUID().replace(/-/g, "");

        const html = await response.text();

        const securedHtml = html.replace(
          /<script(?![^>]*\bnonce=)([^>]*)>/gi,
          `<script nonce="${nonce}"$1>`,
        );

        headers.delete("content-length");

        headers.set(
          "content-security-policy",
          `default-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'; form-action 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'`,
        );

        return new Response(securedHtml, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      headers.set(
        "content-security-policy",
        "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'",
      );
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
async function resolveServerEnvironment(
  request: Request,
  fallbackBindings?: unknown,
): Promise<SerametEnv> {
  return resolveEnvironmentFromBindings(cloudflareBindings(request, fallbackBindings));
}
