import type { D1Database } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

export type RateLimitPolicy = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export class DatabaseRateLimiter {
  constructor(private readonly db: D1Database) {}

  async consume(scopeKey: string, policy: RateLimitPolicy) {
    const now = Date.now();
    const windowMs = policy.windowSeconds * 1_000;
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const windowStartedAt = new Date(windowStartMs).toISOString();
    const expiresAt = new Date(windowStartMs + windowMs).toISOString();
    await this.db
      .prepare(
        `INSERT INTO rate_limit_buckets
          (scope_key, bucket, window_started_at, count, expires_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(scope_key, bucket, window_started_at)
         DO UPDATE SET count = rate_limit_buckets.count + 1`,
      )
      .bind(scopeKey, policy.bucket, windowStartedAt, expiresAt)
      .run();
    const row = await this.db
      .prepare(
        `SELECT count FROM rate_limit_buckets
         WHERE scope_key = ? AND bucket = ? AND window_started_at = ?`,
      )
      .bind(scopeKey, policy.bucket, windowStartedAt)
      .first<{ count: number }>();
    const remaining = Math.max(0, policy.limit - (row?.count ?? policy.limit));
    if ((row?.count ?? 0) > policy.limit) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        429,
        `Rate limit exceeded for ${policy.bucket}`,
      );
    }
    return { remaining, resetsAt: expiresAt };
  }
}

export const sensitiveRateLimits = {
  paymentInitiation: { bucket: "payment-initiation", limit: 30, windowSeconds: 60 },
  refund: { bucket: "refund", limit: 10, windowSeconds: 60 },
  configuration: { bucket: "configuration", limit: 20, windowSeconds: 60 },
  fileImport: { bucket: "file-import", limit: 5, windowSeconds: 300 },
  webhook: { bucket: "webhook", limit: 240, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;
