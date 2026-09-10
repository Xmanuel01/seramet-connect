const redactedKeys = /authorization|cookie|secret|token|passkey|password|pan|cvv|pin|credential/i;

export type ServerLogContext = {
  environment: string;
  operation: string;
  result: "started" | "succeeded" | "failed";
  correlationId: string;
  tenantId?: string;
  branchId?: string;
  userId?: string;
  deviceId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export function structuredServerLog(context: ServerLogContext) {
  const record = redact({ timestamp: new Date().toISOString(), ...context });
  const line = JSON.stringify(record);
  if (context.result === "failed") console.error(line);
  else console.info(line);
}

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => redact(entry)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      redactedKeys.test(key) ? "[REDACTED]" : redact(entry),
    ]),
  ) as T;
}
