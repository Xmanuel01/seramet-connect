import type { ProductionRuntimeEnv } from "@/server/environment";
import { ServerOperationError } from "@/server/errors";

export type SecretValue = {
  value: string;
  version: string;
  resolvedAt: string;
};

export interface SecretStore {
  readonly kind: "environment" | "managed";
  resolve(reference: string): Promise<SecretValue>;
  store?(reference: string, value: string): Promise<{ version: string; storedAt: string }>;
}

export interface ManagedSecretStoreBinding {
  get(reference: string): Promise<{ value: string; version?: string } | null>;
  put?(reference: string, value: string): Promise<{ version?: string } | null | undefined>;
}

export class EnvironmentSecretStore implements SecretStore {
  readonly kind = "environment" as const;

  constructor(private readonly values: Record<string, unknown>) {}

  async resolve(reference: string): Promise<SecretValue> {
    const key = environmentKey(reference);
    const value = this.values[key];
    if (typeof value !== "string" || !value) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        503,
        `Secret reference ${reference} is unavailable`,
      );
    }
    return { value, version: "environment", resolvedAt: new Date().toISOString() };
  }
}

export class ManagedSecretStore implements SecretStore {
  readonly kind = "managed" as const;

  constructor(private readonly binding: ManagedSecretStoreBinding) {}

  async resolve(reference: string): Promise<SecretValue> {
    const secret = await this.binding.get(reference);
    if (!secret?.value) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        503,
        `Secret reference ${reference} is unavailable`,
      );
    }
    return {
      value: secret.value,
      version: secret.version ?? "managed",
      resolvedAt: new Date().toISOString(),
    };
  }

  async store(reference: string, value: string) {
    if (!this.binding.put) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        503,
        "Managed secret store is not writable",
      );
    }
    const result = await this.binding.put(reference, value);
    return {
      version: result?.version ?? "managed",
      storedAt: new Date().toISOString(),
    };
  }
}

export function createSecretStore(env: ProductionRuntimeEnv): SecretStore {
  if (isManagedStore(env.SERAMET_MANAGED_SECRET_STORE)) {
    return new ManagedSecretStore(env.SERAMET_MANAGED_SECRET_STORE);
  }
  if (env.SERAMET_SECRET_STORE === "environment") {
    return new EnvironmentSecretStore(env as Record<string, unknown>);
  }
  throw new ServerOperationError("VALIDATION_FAILED", 503, "Server secret store is not configured");
}

function environmentKey(reference: string) {
  if (reference.startsWith("env://")) return reference.slice("env://".length);
  if (/^[A-Z][A-Z0-9_]+$/.test(reference)) return reference;
  throw new ServerOperationError(
    "VALIDATION_FAILED",
    400,
    "Environment secret reference is invalid",
  );
}

function isManagedStore(value: unknown): value is ManagedSecretStoreBinding {
  return Boolean(
    value && typeof value === "object" && "get" in value && typeof value.get === "function",
  );
}
