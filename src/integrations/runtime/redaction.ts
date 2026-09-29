const sensitiveKey =
  /authorization|cookie|password|secret|token|private.?key|client.?secret|api.?key|passkey/i;

export function redactSensitive<T>(value: T): T {
  return redact(value, new WeakSet()) as T;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redact(entry, seen),
    ]),
  );
}

export type IntegrationLogEntry = {
  tenantId: string;
  branchId?: string;
  connectionId: string;
  providerId: string;
  operation: string;
  correlationId: string;
  status: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
};

export interface IntegrationLogger {
  write(entry: IntegrationLogEntry): void;
}

export class StructuredIntegrationLogger implements IntegrationLogger {
  constructor(private sink: (entry: IntegrationLogEntry) => void = () => undefined) {}

  write(entry: IntegrationLogEntry) {
    this.sink(redactSensitive(entry));
  }
}
