export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly statusCode = 500,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationError extends IntegrationError {
  constructor(message = "Provider authentication failed") {
    super(message, "AUTHENTICATION", false, 401);
  }
}
export class AuthorizationError extends IntegrationError {
  constructor(message = "Provider operation is not authorized") {
    super(message, "AUTHORIZATION", false, 403);
  }
}
export class MappingError extends IntegrationError {
  constructor(message = "Required external mapping is missing") {
    super(message, "MAPPING", false, 409);
  }
}
export class IntegrationValidationError extends IntegrationError {
  constructor(message = "Provider payload is invalid") {
    super(message, "VALIDATION", false, 400);
  }
}
export class RateLimitError extends IntegrationError {
  constructor(message = "Provider rate limit reached", retryAfterMs?: number) {
    super(message, "RATE_LIMITED", true, 429, retryAfterMs);
  }
}
export class ProviderUnavailableError extends IntegrationError {
  constructor(message = "Provider is temporarily unavailable") {
    super(message, "PROVIDER_UNAVAILABLE", true, 503);
  }
}
export class TimeoutError extends IntegrationError {
  constructor(message = "Provider request timed out") {
    super(message, "TIMEOUT", true, 504);
  }
}
export class UnsupportedCapabilityError extends IntegrationError {
  constructor(message = "Provider capability is unsupported") {
    super(message, "UNSUPPORTED_CAPABILITY", false, 409);
  }
}
export class WebhookVerificationError extends IntegrationError {
  constructor(message = "Webhook verification failed") {
    super(message, "WEBHOOK_VERIFICATION", false, 401);
  }
}
export class CircuitOpenError extends IntegrationError {
  constructor(retryAfterMs: number) {
    super("Provider circuit is temporarily open", "CIRCUIT_OPEN", true, 503, retryAfterMs);
  }
}

export function normalizeIntegrationError(error: unknown) {
  if (error instanceof IntegrationError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new TimeoutError();
  return new ProviderUnavailableError(error instanceof Error ? error.message : "Provider failed");
}
