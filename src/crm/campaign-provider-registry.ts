import type { CampaignCapability, CampaignMessage, CampaignProviderResult } from "@/crm/types";

export interface CampaignProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<CampaignCapability>;
  health(): Promise<"CONFIGURED" | "DEGRADED" | "UNKNOWN">;
  send(message: CampaignMessage): Promise<CampaignProviderResult>;
}

export class CampaignProviderRegistry {
  private readonly adapters = new Map<string, CampaignProviderAdapter>();

  register(adapter: CampaignProviderAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`Campaign provider ${adapter.key} exists`);
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new Error(`Campaign provider ${key} is not registered`);
    return adapter;
  }

  metadata() {
    return [...this.adapters.values()].map((adapter) => ({
      key: adapter.key,
      displayName: adapter.displayName,
      capabilities: [...adapter.capabilities],
    }));
  }
}

let activeRegistry = new CampaignProviderRegistry();

export function getCampaignProviderRegistry() {
  return activeRegistry;
}

export function setCampaignProviderRegistryForTests(registry: CampaignProviderRegistry) {
  activeRegistry = registry;
}

/** Deterministic test-only adapter. Production startup must not configure this provider. */
export class TestCampaignProvider implements CampaignProviderAdapter {
  readonly key = "TEST_COMMUNICATION_PROVIDER";
  readonly displayName = "Test communication provider";
  readonly capabilities = new Set<CampaignCapability>([
    "SEND_EMAIL",
    "SEND_SMS",
    "SEND_WHATSAPP",
    "SEND_PUSH",
  ]);
  private readonly sent = new Map<string, CampaignProviderResult>();

  constructor(private readonly failureMode: "NONE" | "TRANSIENT" | "PERMANENT" = "NONE") {}

  async health() {
    return "CONFIGURED" as const;
  }

  async send(message: CampaignMessage): Promise<CampaignProviderResult> {
    const existing = this.sent.get(message.idempotencyKey);
    if (existing) return existing;
    if (this.failureMode !== "NONE") {
      return {
        status: "FAILED",
        errorCode: this.failureMode === "TRANSIENT" ? "PROVIDER_RETRYABLE" : "PROVIDER_REJECTED",
      };
    }
    const result = { status: "SENT" as const, providerMessageId: `test:${message.deliveryId}` };
    this.sent.set(message.idempotencyKey, result);
    return result;
  }
}

export function capabilityForChannel(channel: CampaignMessage["channel"]): CampaignCapability {
  return `SEND_${channel}` as CampaignCapability;
}
