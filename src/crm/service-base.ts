import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import type { PermissionCode } from "@/platform/types";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

export class CrmDomainError extends Error {
  constructor(
    public readonly code:
      | "PERMISSION_DENIED"
      | "NOT_FOUND"
      | "DUPLICATE"
      | "CONFLICT"
      | "VALIDATION_FAILED"
      | "INSUFFICIENT_BALANCE"
      | "NOT_ELIGIBLE"
      | "INVALID_STATE",
    message: string,
  ) {
    super(message);
  }
}

export abstract class CrmServiceBase {
  constructor(
    protected readonly db: D1Database,
    protected readonly actor: ServerActor,
  ) {}

  protected require(permission: PermissionCode) {
    if (!this.actor.permissions.includes(permission)) {
      throw new CrmDomainError("PERMISSION_DENIED", `${permission} permission is required`);
    }
  }

  protected branch(branchId: string) {
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
  }

  protected auditStatement(input: {
    action: string;
    entityType: string;
    entityId: string;
    reason?: string;
    branchId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
    at?: string;
  }): D1PreparedStatement {
    const at = input.at ?? new Date().toISOString();
    return this.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,
           reason,correlation_id,session_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        input.branchId ?? this.actor.branchId ?? null,
        this.actor.id,
        this.actor.deviceId ?? null,
        input.action,
        input.entityType,
        input.entityId,
        input.reason ?? null,
        input.correlationId ?? crypto.randomUUID(),
        this.actor.sessionId ?? null,
        JSON.stringify(input.metadata ?? {}),
        at,
      );
  }

  protected async customerExists(customerId: string) {
    const row = await this.db
      .prepare("SELECT id FROM customers WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, customerId)
      .first<{ id: string }>();
    if (!row) throw new CrmDomainError("NOT_FOUND", "Customer was not found");
    return row;
  }
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function assertMinorAmount(value: number, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new CrmDomainError("VALIDATION_FAILED", "Money must use positive integer minor units");
  }
}

export function placeholders(count: number) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Placeholder count is invalid");
  return Array.from({ length: count }, () => "?").join(",");
}
