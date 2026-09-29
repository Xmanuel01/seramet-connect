import {
  normalizeIntegrationError,
  type IntegrationError,
} from "@/integrations/runtime/integration-errors";

export type RetryPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
};

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 4,
  initialDelayMs: 250,
  maxDelayMs: 15_000,
  jitterRatio: 0.2,
};

export class RetryService {
  constructor(
    private policy: RetryPolicy = defaultRetryPolicy,
    private sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private random: () => number = Math.random,
  ) {}

  async execute<T>(
    operation: (attempt: number) => Promise<T>,
    onFailure?: (
      error: IntegrationError,
      attempt: number,
      nextDelayMs?: number,
    ) => Promise<void> | void,
  ) {
    let lastError: IntegrationError | undefined;
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = normalizeIntegrationError(error);
        if (!lastError.retryable || attempt >= this.policy.maxAttempts) {
          await onFailure?.(lastError, attempt);
          throw lastError;
        }
        const delay = lastError.retryAfterMs ?? this.delayFor(attempt);
        await onFailure?.(lastError, attempt, delay);
        await this.sleep(delay);
      }
    }
    throw lastError!;
  }

  nextDelay(attempt: number, retryAfterMs?: number) {
    return retryAfterMs ?? this.delayFor(attempt);
  }

  get maxAttempts() {
    return this.policy.maxAttempts;
  }

  private delayFor(attempt: number) {
    const exponential = Math.min(
      this.policy.maxDelayMs,
      this.policy.initialDelayMs * 2 ** Math.max(0, attempt - 1),
    );
    const jitter = exponential * this.policy.jitterRatio * (this.random() * 2 - 1);
    return Math.max(0, Math.round(exponential + jitter));
  }
}
