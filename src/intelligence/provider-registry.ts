import type { SerametEnv } from "@/lib/seramet-auth";
import { createSecretStore } from "@/server/secrets";
import { resolveRuntimeConfiguration } from "@/server/environment";
import { structuredIntelligenceAnswerSchema } from "@/intelligence/schemas";
import type {
  EvidenceFinding,
  IntelligenceProviderAdapter,
  IntelligenceProviderConfiguration,
  IntelligenceProviderRequest,
  IntelligenceProviderResult,
  StructuredIntelligenceAnswer,
} from "@/intelligence/types";

export interface AIProviderGatewayBinding {
  generate(input: {
    providerKey: string;
    modelIdentifier: string;
    secret?: string;
    request: IntelligenceProviderRequest;
  }): Promise<unknown>;
  health?(input: {
    providerKey: string;
    modelIdentifier: string;
  }): Promise<{ status: string; latencyMs?: number; code?: string }>;
}

export class IntelligenceProviderRegistry {
  private readonly factories = new Map<
    string,
    (config: IntelligenceProviderConfiguration, env: SerametEnv) => IntelligenceProviderAdapter
  >();

  register(
    key: string,
    factory: (
      config: IntelligenceProviderConfiguration,
      env: SerametEnv,
    ) => IntelligenceProviderAdapter,
  ) {
    this.factories.set(key, factory);
    return this;
  }

  resolve(config: IntelligenceProviderConfiguration, env: SerametEnv) {
    const exact = this.factories.get(config.providerKey);
    if (exact) return exact(config, env);
    if (isGateway(env.SERAMET_AI_GATEWAY)) return new ManagedGatewayProvider(config, env);
    throw new Error(`Intelligence provider ${config.providerKey} is not available`);
  }
}

export function createIntelligenceProviderRegistry(env: SerametEnv) {
  const registry = new IntelligenceProviderRegistry();
  const runtime = resolveRuntimeConfiguration(env);
  if (["development", "test"].includes(runtime.environment)) {
    registry.register(
      "DETERMINISTIC_TEST",
      (config) => new DeterministicTestIntelligenceProvider(config),
    );
  }
  return registry;
}

class ManagedGatewayProvider implements IntelligenceProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities;

  constructor(
    private readonly config: IntelligenceProviderConfiguration,
    private readonly env: SerametEnv,
  ) {
    this.key = config.providerKey;
    this.displayName = config.displayName;
    this.capabilities = config.capabilities;
  }

  async generateStructuredResponse(
    request: IntelligenceProviderRequest,
  ): Promise<IntelligenceProviderResult> {
    const gateway = this.env.SERAMET_AI_GATEWAY;
    if (!isGateway(gateway)) throw new Error("Managed AI gateway is unavailable");
    const started = Date.now();
    let secret: string | undefined;
    if (this.config.secretReference) {
      secret = (await createSecretStore(this.env).resolve(this.config.secretReference)).value;
    }
    const raw = await withTimeout(
      gateway.generate({
        providerKey: this.config.providerKey,
        modelIdentifier: this.config.modelIdentifier,
        ...(secret ? { secret } : {}),
        request,
      }),
      this.config.timeoutMs,
    );
    const record = raw as Record<string, unknown>;
    const answer = structuredIntelligenceAnswerSchema.parse(
      record["answer"] ?? raw,
    ) as StructuredIntelligenceAnswer;
    return {
      answer,
      inputUnits: safeInteger(record["inputUnits"]),
      outputUnits: safeInteger(record["outputUnits"]),
      ...(safeInteger(record["providerCostMinor"]) > 0
        ? { providerCostMinor: safeInteger(record["providerCostMinor"]) }
        : {}),
      ...(typeof record["costCurrency"] === "string"
        ? { costCurrency: record["costCurrency"] }
        : {}),
      latencyMs: Date.now() - started,
      ...(typeof record["providerRequestId"] === "string"
        ? { providerRequestId: record["providerRequestId"] }
        : {}),
    };
  }

  async health() {
    const gateway = this.env.SERAMET_AI_GATEWAY;
    if (!isGateway(gateway) || !gateway.health) return { status: "UNKNOWN" as const };
    try {
      const result = await withTimeout(
        gateway.health({
          providerKey: this.config.providerKey,
          modelIdentifier: this.config.modelIdentifier,
        }),
        Math.min(this.config.timeoutMs, 5000),
      );
      return {
        status: normalizeHealth(result.status),
        ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
        ...(result.code ? { code: result.code } : {}),
      };
    } catch {
      return { status: "UNAVAILABLE" as const, code: "PROVIDER_HEALTH_FAILED" };
    }
  }
}

export class DeterministicTestIntelligenceProvider implements IntelligenceProviderAdapter {
  readonly key = "DETERMINISTIC_TEST";
  readonly displayName: string;
  readonly capabilities = ["STRUCTURED_OUTPUT"] as const;

  constructor(private readonly config: IntelligenceProviderConfiguration) {
    this.displayName = config.displayName;
  }

  async generateStructuredResponse(
    request: IntelligenceProviderRequest,
  ): Promise<IntelligenceProviderResult> {
    const started = Date.now();
    const findings = request.evidence.findings.slice(0, 8);
    const answer: StructuredIntelligenceAnswer = {
      summary:
        findings[0]?.statement ??
        "Seramet found no supported exception for the selected scope and period.",
      keyFindings: findings.map(toAnswerFinding),
      evidenceRefs: [...new Set(findings.flatMap((finding) => finding.evidenceRefs))],
      dataQuality: request.evidence.quality,
      qualityReasons: request.evidence.qualityReasons,
      limitations: request.evidence.limitations,
      suggestedActions: deterministicActions(findings),
    };
    return {
      answer,
      inputUnits: JSON.stringify(request.evidence).length,
      outputUnits: JSON.stringify(answer).length,
      latencyMs: Date.now() - started,
      providerRequestId: `deterministic:${request.requestId}`,
    };
  }

  async health() {
    return { status: "HEALTHY" as const, latencyMs: 0 };
  }
}

function toAnswerFinding(finding: EvidenceFinding) {
  return {
    statement: finding.statement,
    classification: finding.classification,
    evidenceRefs: finding.evidenceRefs,
  };
}

function deterministicActions(findings: EvidenceFinding[]) {
  const routes = [...new Set(findings.map((finding) => finding.route).filter(Boolean))] as string[];
  return routes.slice(0, 4).map((route, index) => ({
    key: `review-${index + 1}`,
    label: routeLabel(route),
    route,
    risk: "READ_ONLY" as const,
    requiresConfirmation: false,
  }));
}

function routeLabel(route: string) {
  const label = route.split("?")[0]!.split("/").filter(Boolean).at(-1) ?? "details";
  return `Review ${label.replaceAll("-", " ")}`;
}

function isGateway(value: unknown): value is AIProviderGatewayBinding {
  return Boolean(
    value &&
    typeof value === "object" &&
    "generate" in value &&
    typeof value.generate === "function",
  );
}

function safeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function normalizeHealth(value: string) {
  if (["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNKNOWN"].includes(value)) {
    return value as "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
  }
  return "UNKNOWN" as const;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI_PROVIDER_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
