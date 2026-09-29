import type { ProviderCredentials } from "@/integrations/types";

export interface CredentialResolver {
  getSecret(reference: string): Promise<ProviderCredentials>;
  hasSecret(reference: string): Promise<boolean>;
}

export type SecretEnvironment = Record<string, unknown> & {
  SERAMET_SECRET_STORE?: string;
};

export class EnvironmentCredentialResolver implements CredentialResolver {
  constructor(private env: SecretEnvironment) {}

  async hasSecret(reference: string) {
    try {
      await this.getSecret(reference);
      return true;
    } catch {
      return false;
    }
  }

  async getSecret(reference: string) {
    if (!reference.trim()) throw new Error("Secret reference is required");
    const configured = parseSecretStore(this.env.SERAMET_SECRET_STORE);
    const secret = configured[reference];
    if (secret) return { ...secret };

    const envPrefix = reference.startsWith("env://") ? reference.slice(6) : undefined;
    if (envPrefix) {
      const value = this.env[envPrefix];
      if (typeof value === "string" && value) return parseSecretValue(value);
    }
    throw new Error("Referenced provider credentials are unavailable");
  }
}

export class StaticCredentialResolver implements CredentialResolver {
  constructor(private secrets: Record<string, ProviderCredentials>) {}
  async hasSecret(reference: string) {
    return Boolean(this.secrets[reference]);
  }
  async getSecret(reference: string) {
    const secret = this.secrets[reference];
    if (!secret) throw new Error("Referenced provider credentials are unavailable");
    return { ...secret };
  }
}

export class ChainedCredentialResolver implements CredentialResolver {
  constructor(private resolvers: CredentialResolver[]) {}
  async hasSecret(reference: string) {
    for (const resolver of this.resolvers) if (await resolver.hasSecret(reference)) return true;
    return false;
  }
  async getSecret(reference: string) {
    for (const resolver of this.resolvers) {
      if (await resolver.hasSecret(reference)) return resolver.getSecret(reference);
    }
    throw new Error("Referenced provider credentials are unavailable");
  }
}

function parseSecretStore(raw?: string) {
  if (!raw) return {} as Record<string, ProviderCredentials>;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, ProviderCredentials] =>
        Boolean(entry[1]) && typeof entry[1] === "object" && !Array.isArray(entry[1]),
    ),
  );
}

function parseSecretValue(value: string) {
  try {
    const parsed = JSON.parse(value) as ProviderCredentials;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // A single opaque value is still valid for adapters expecting `value`.
  }
  return { value };
}
