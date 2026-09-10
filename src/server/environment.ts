import type { D1Database } from "@/server/database/d1";
import type { HyperdriveBinding } from "@/server/database/postgres-database";
import type { ExternalIdentityVerifier } from "@/server/identity/supabase-identity";

export type DeploymentEnvironment = "development" | "test" | "staging" | "production";

export type DurableQueueMessage<T = unknown> = {
  id: string;
  timestamp: Date;
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type DurableQueueBatch<T = unknown> = {
  queue: string;
  messages: DurableQueueMessage<T>[];
};

export type DurableQueue<T = unknown> = {
  send(message: T, options?: { contentType?: "json"; delaySeconds?: number }): Promise<void>;
  sendBatch?(
    messages: Array<{ body: T; contentType?: "json"; delaySeconds?: number }>,
  ): Promise<void>;
};

export type ObjectStoreBinding = {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{
    body?: ReadableStream<Uint8Array>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
};

export type MalwareScanner = {
  scan(input: {
    bytes: ArrayBuffer;
    contentType: string;
    fileName: string;
  }): Promise<{ status: "CLEAN" | "INFECTED" | "ERROR"; reference?: string }>;
};

export type ProductionRuntimeEnv = {
  SERAMET_ENVIRONMENT?: string;
  NODE_ENV?: string;
  SERAMET_DB?: D1Database;
  SERAMET_HYPERDRIVE?: HyperdriveBinding;
  SERAMET_WORK_QUEUE?: DurableQueue;
  SERAMET_OBJECTS?: ObjectStoreBinding;
  SERAMET_MALWARE_SCANNER?: MalwareScanner;
  SERAMET_DATABASE_PROVIDER?: string;
  SERAMET_IDENTITY_PROVIDER?: string;
  SERAMET_SUPABASE_URL?: string;
  SERAMET_SUPABASE_PUBLISHABLE_KEY?: string;
  SERAMET_IDENTITY_VERIFIER?: ExternalIdentityVerifier;
  SERAMET_PUBLIC_ORIGIN?: string;
  SERAMET_ALLOWED_ORIGINS?: string;
  SERAMET_JWT_SECRET?: string;
  SERAMET_JWT_ISSUER?: string;
  SERAMET_JWT_AUDIENCE?: string;
  SERAMET_CALLBACK_BASE_URL?: string;
  SERAMET_ENABLE_DEV_AUTH?: string;
  SERAMET_ENABLE_LOCAL_DATABASE?: string;
  SERAMET_REQUIRE_BEARER?: string;
  SERAMET_SECRET_STORE?: string;
  SERAMET_MANAGED_SECRET_STORE?: unknown;
  SERAMET_AI_GATEWAY?: unknown;
  SERAMET_ALLOW_TEST_PROVIDERS?: string;
  SERAMET_BUILD_ID?: string;
  SERAMET_APP_VERSION?: string;
};

export type RuntimeConfiguration = {
  environment: DeploymentEnvironment;
  productionLike: boolean;
  authoritativeDatabase: boolean;
  databaseProvider: "none" | "d1" | "sqlite" | "postgres";
  durableQueue: boolean;
  objectStorage: boolean;
  bearerRequired: boolean;
  devAuthEnabled: boolean;
  callbackBaseUrl?: string;
  jwtSecret?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  appVersion: string;
  buildId: string;
};

const allowedEnvironments = new Set<DeploymentEnvironment>([
  "development",
  "test",
  "staging",
  "production",
]);

export function resolveRuntimeConfiguration(env: ProductionRuntimeEnv): RuntimeConfiguration {
  const inferred = env.SERAMET_DB ? "production" : "development";
  const value = String(env.SERAMET_ENVIRONMENT ?? env.NODE_ENV ?? inferred).toLowerCase();
  if (!allowedEnvironments.has(value as DeploymentEnvironment)) {
    throw new Error(`Unsupported SERAMET_ENVIRONMENT ${value}`);
  }
  const environment = value as DeploymentEnvironment;
  const productionLike = environment === "production" || environment === "staging";
  const configuredDatabaseProvider = String(
    env.SERAMET_DATABASE_PROVIDER ??
      (env.SERAMET_HYPERDRIVE
        ? "postgres"
        : (env.SERAMET_DB?.provider ?? (env.SERAMET_DB ? "d1" : "none"))),
  ).toLowerCase();
  if (!["none", "d1", "sqlite", "postgres"].includes(configuredDatabaseProvider)) {
    throw new Error(`Unsupported SERAMET_DATABASE_PROVIDER ${configuredDatabaseProvider}`);
  }
  return {
    environment,
    productionLike,
    authoritativeDatabase: Boolean(env.SERAMET_DB),
    databaseProvider: configuredDatabaseProvider as RuntimeConfiguration["databaseProvider"],
    durableQueue: Boolean(env.SERAMET_WORK_QUEUE),
    objectStorage: Boolean(env.SERAMET_OBJECTS),
    bearerRequired: productionLike || env.SERAMET_REQUIRE_BEARER === "true",
    devAuthEnabled: environment === "development" && env.SERAMET_ENABLE_DEV_AUTH === "true",
    ...(env.SERAMET_CALLBACK_BASE_URL
      ? { callbackBaseUrl: env.SERAMET_CALLBACK_BASE_URL.replace(/\/$/, "") }
      : {}),
    ...(env.SERAMET_JWT_SECRET ? { jwtSecret: env.SERAMET_JWT_SECRET } : {}),
    ...(env.SERAMET_JWT_ISSUER ? { jwtIssuer: env.SERAMET_JWT_ISSUER } : {}),
    ...(env.SERAMET_JWT_AUDIENCE ? { jwtAudience: env.SERAMET_JWT_AUDIENCE } : {}),
    appVersion: env.SERAMET_APP_VERSION ?? "0.5.0",
    buildId: env.SERAMET_BUILD_ID ?? "development",
  };
}

export type ReadinessIssue = {
  code: string;
  message: string;
};

export function validateRuntimeConfiguration(
  env: ProductionRuntimeEnv,
  options: { allowMissingQueue?: boolean } = {},
): ReadinessIssue[] {
  const config = resolveRuntimeConfiguration(env);
  const issues: ReadinessIssue[] = [];
  if (!config.productionLike) return issues;
  if (!env.SERAMET_DB) {
    issues.push({
      code: "DATABASE_REQUIRED",
      message: "Authoritative database binding is required",
    });
  }
  if (config.databaseProvider !== "postgres" || !env.SERAMET_HYPERDRIVE) {
    issues.push({
      code: "POSTGRES_HYPERDRIVE_REQUIRED",
      message: "Production requires PostgreSQL through a Cloudflare Hyperdrive binding",
    });
  }
  if (!env.SERAMET_WORK_QUEUE && !options.allowMissingQueue) {
    issues.push({ code: "QUEUE_REQUIRED", message: "Durable worker queue is required" });
  }
  if (!env.SERAMET_JWT_SECRET || env.SERAMET_JWT_SECRET.length < 32) {
    issues.push({
      code: "JWT_SECRET_REQUIRED",
      message: "A non-default JWT signing secret is required",
    });
  }
  if (
    env.SERAMET_IDENTITY_PROVIDER !== "supabase" &&
    (!env.SERAMET_JWT_ISSUER || !env.SERAMET_JWT_AUDIENCE)
  ) {
    issues.push({
      code: "IDENTITY_CONFIG_REQUIRED",
      message: "JWT issuer and audience are required",
    });
  }
  if (env.SERAMET_ENABLE_DEV_AUTH === "true") {
    issues.push({ code: "DEV_AUTH_FORBIDDEN", message: "Development authentication is forbidden" });
  }
  if (env.SERAMET_ENABLE_LOCAL_DATABASE === "true") {
    issues.push({
      code: "LOCAL_DATABASE_FORBIDDEN",
      message: "The local development database is forbidden",
    });
  }
  if (env.SERAMET_ALLOW_TEST_PROVIDERS === "true") {
    issues.push({ code: "TEST_PROVIDER_FORBIDDEN", message: "Test providers cannot be active" });
  }
  if (!config.callbackBaseUrl || !config.callbackBaseUrl.startsWith("https://")) {
    issues.push({
      code: "HTTPS_CALLBACK_REQUIRED",
      message: "Trusted HTTPS callback URL is required",
    });
  }
  if (!env.SERAMET_SECRET_STORE && !env.SERAMET_MANAGED_SECRET_STORE) {
    issues.push({
      code: "SECRET_STORE_REQUIRED",
      message: "A server-side secret store is required",
    });
  }
  if (!env.SERAMET_OBJECTS) {
    issues.push({
      code: "OBJECT_STORAGE_REQUIRED",
      message: "Production R2 object storage is required",
    });
  }
  if (!env.SERAMET_MALWARE_SCANNER) {
    issues.push({
      code: "MALWARE_SCANNER_REQUIRED",
      message: "Production uploads require a configured malware scanner",
    });
  }
  if (env.SERAMET_IDENTITY_PROVIDER !== "supabase") {
    issues.push({
      code: "IDENTITY_PROVIDER_REQUIRED",
      message: "Production identity provider must be explicitly configured",
    });
  }
  if (!env.SERAMET_SUPABASE_URL || !env.SERAMET_SUPABASE_PUBLISHABLE_KEY) {
    issues.push({
      code: "SUPABASE_AUTH_CONFIG_REQUIRED",
      message: "Supabase Auth URL and publishable key are required",
    });
  }
  if (env.SERAMET_SUPABASE_URL && !env.SERAMET_SUPABASE_URL.startsWith("https://")) {
    issues.push({
      code: "SUPABASE_HTTPS_REQUIRED",
      message: "Supabase Auth URL must use HTTPS",
    });
  }
  if (!env.SERAMET_PUBLIC_ORIGIN?.startsWith("https://")) {
    issues.push({
      code: "PUBLIC_HTTPS_ORIGIN_REQUIRED",
      message: "Production public origin must be an explicit HTTPS URL",
    });
  }
  return issues;
}

export function assertProductionReady(env: ProductionRuntimeEnv) {
  const issues = validateRuntimeConfiguration(env);
  if (issues.length > 0) {
    const error = new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    error.name = "ProductionConfigurationError";
    throw error;
  }
}

export function isLocalDevelopmentRequest(request: Request, env: ProductionRuntimeEnv) {
  const config = resolveRuntimeConfiguration(env);
  if (config.environment !== "development") return false;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function trustedCallbackUrl(env: ProductionRuntimeEnv, path: string) {
  const config = resolveRuntimeConfiguration(env);
  if (!config.callbackBaseUrl) {
    if (config.productionLike) throw new Error("Trusted callback base URL is not configured");
    return path;
  }
  return `${config.callbackBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
