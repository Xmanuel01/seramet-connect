import type { IntegrationEnvironment } from "@/integrations/types";
import {
  AuthenticationError,
  AuthorizationError,
  IntegrationError,
  ProviderUnavailableError,
  RateLimitError,
  TimeoutError,
} from "@/integrations/runtime/integration-errors";
import { redactSensitive, type IntegrationLogger } from "@/integrations/runtime/redaction";

export type ProviderHttpRequest = {
  tenantId: string;
  branchId?: string;
  connectionId: string;
  providerId: string;
  environment: IntegrationEnvironment;
  operation: string;
  correlationId: string;
  baseUrls: Record<IntegrationEnvironment, string | undefined>;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  allowSharedEnvironmentUrl?: boolean;
};

export type ProviderHttpResponse<T> = {
  status: number;
  data: T;
  headers: Record<string, string>;
  durationMs: number;
};

export class ProviderHttpClient {
  constructor(
    private logger: IntegrationLogger,
    private fetcher: typeof fetch = fetch,
  ) {}

  async request<T>(input: ProviderHttpRequest): Promise<ProviderHttpResponse<T>> {
    const baseUrl = input.baseUrls[input.environment];
    if (!baseUrl)
      throw new IntegrationError(
        `${input.environment} base URL is not configured`,
        "ENVIRONMENT_URL_MISSING",
        false,
        409,
      );
    if (!input.allowSharedEnvironmentUrl)
      assertEnvironmentIsolation(input.environment, baseUrl, input.baseUrls);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
    try {
      const response = await this.fetcher(
        new URL(input.path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`),
        {
          method: input.method ?? "GET",
          headers: {
            Accept: "application/json",
            "x-correlation-id": input.correlationId,
            ...input.headers,
          },
          ...(input.body === undefined
            ? {}
            : { body: typeof input.body === "string" ? input.body : JSON.stringify(input.body) }),
          signal: controller.signal,
        },
      );
      const text = await response.text();
      const data = parseResponse(text) as T;
      const headers = Object.fromEntries(response.headers.entries());
      if (!response.ok) throw errorForResponse(response.status, headers, data);
      this.logger.write({
        ...logFields(input),
        status: "SUCCESS",
        durationMs: Date.now() - startedAt,
        metadata: { responseStatus: response.status },
      });
      return { status: response.status, data, headers, durationMs: Date.now() - startedAt };
    } catch (error) {
      const normalized =
        error instanceof DOMException && error.name === "AbortError" ? new TimeoutError() : error;
      this.logger.write({
        ...logFields(input),
        status: "FAILED",
        durationMs: Date.now() - startedAt,
        metadata: redactSensitive({
          error: normalized instanceof Error ? normalized.message : "Provider request failed",
        }),
      });
      if (normalized instanceof IntegrationError) throw normalized;
      throw new ProviderUnavailableError(
        normalized instanceof Error ? normalized.message : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function assertEnvironmentIsolation(
  environment: IntegrationEnvironment,
  baseUrl: string,
  baseUrls: ProviderHttpRequest["baseUrls"],
) {
  if (
    environment === "SANDBOX" &&
    baseUrls.PRODUCTION &&
    normalizeUrl(baseUrl) === normalizeUrl(baseUrls.PRODUCTION)
  ) {
    throw new IntegrationError(
      "Sandbox connection cannot use the production base URL",
      "ENVIRONMENT_ISOLATION",
      false,
      409,
    );
  }
}
const normalizeUrl = (value: string) => value.replace(/\/$/, "").toLowerCase();
const parseResponse = (text: string) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};
function errorForResponse(status: number, headers: Record<string, string>, data: unknown) {
  if (status === 401) return new AuthenticationError();
  if (status === 403) return new AuthorizationError();
  if (status === 429)
    return new RateLimitError(
      "Provider rate limit reached",
      parseRetryAfter(headers["retry-after"]),
    );
  if (status >= 500) return new ProviderUnavailableError(`Provider returned HTTP ${status}`);
  return new IntegrationError(`Provider returned HTTP ${status}`, `HTTP_${status}`, false, status);
}
function parseRetryAfter(value?: string) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
function logFields(input: ProviderHttpRequest) {
  return {
    tenantId: input.tenantId,
    ...(input.branchId ? { branchId: input.branchId } : {}),
    connectionId: input.connectionId,
    providerId: input.providerId,
    operation: input.operation,
    correlationId: input.correlationId,
  };
}
