export type D1ResultMeta = {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
};

export type D1Result<T = unknown> = {
  success?: boolean;
  results?: T[];
  meta?: D1ResultMeta;
};

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>(column?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<D1Result<T>>;
  run: <T = unknown>() => Promise<D1Result<T>>;
};

export type D1Database = {
  readonly provider?: "d1" | "sqlite" | "postgres";
  prepare: (query: string) => D1PreparedStatement;
  batch: <T = unknown>(statements: D1PreparedStatement[]) => Promise<D1Result<T>[]>;
  exec?: (query: string) => Promise<D1Result>;
};

export async function assertDatabaseAvailable(db: D1Database) {
  const result = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  if (result?.ok !== 1) throw new Error("Authoritative database health check failed");
}
