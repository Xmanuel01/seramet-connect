import type { IntegrationRepository } from "@/integrations/runtime/integration-repository";

export class IdempotencyService {
  constructor(private repository: IntegrationRepository) {}

  async claim(tenantId: string, connectionId: string, key: string, eventId: string) {
    const now = new Date().toISOString();
    return this.repository.claimIdempotency({
      id: `${connectionId}:${key}`,
      tenantId,
      connectionId,
      key,
      eventId,
      status: "PROCESSING",
      createdAt: now,
      updatedAt: now,
    });
  }

  complete(tenantId: string, connectionId: string, key: string, result: unknown) {
    return this.repository.completeIdempotency(tenantId, connectionId, key, result);
  }
}

export async function stableHash(value: unknown) {
  const bytes =
    value instanceof Uint8Array ? value : new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
