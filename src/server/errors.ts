export type ServerErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "TENANT_SCOPE_VIOLATION"
  | "CONFLICT"
  | "DUPLICATE"
  | "INVALID_STATE_TRANSITION"
  | "DATABASE_UNAVAILABLE"
  | "EXTERNAL_SERVICE_UNAVAILABLE"
  | "QUEUE_UNAVAILABLE"
  | "OFFLINE_OPERATION_NOT_ALLOWED"
  | "VALIDATION_FAILED"
  | "SESSION_REVOKED"
  | "DEVICE_REVOKED";

export class ServerOperationError extends Error {
  constructor(
    public readonly code: ServerErrorCode,
    public readonly status: number,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
  }
}

export function publicError(error: unknown, correlationId: string) {
  if (error instanceof ServerOperationError) {
    return {
      status: error.status,
      body: { ok: false, code: error.code, message: error.message, correlationId },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      code: "DATABASE_UNAVAILABLE" as const,
      message: "The operation could not be completed",
      correlationId,
    },
  };
}
