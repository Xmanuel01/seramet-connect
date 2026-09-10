import { Pool, types as postgresTypes, type QueryResultRow } from "pg";
import type { D1Database, D1PreparedStatement, D1Result } from "@/server/database/d1";

export type HyperdriveBinding = {
  connectionString: string;
};

type QueryExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

/**
 * Compatibility adapter used while domain repositories retain the small D1-style statement
 * contract. SQL is executed by PostgreSQL through Hyperdrive; browser code never receives the
 * connection string.
 */
export class PostgresD1Database implements D1Database {
  readonly provider = "postgres" as const;

  constructor(private readonly pool: Pool) {}

  static fromHyperdrive(binding: HyperdriveBinding) {
    if (!binding.connectionString?.startsWith("postgres")) {
      throw new Error("Hyperdrive PostgreSQL connection string is missing or invalid");
    }
    postgresTypes.setTypeParser(20, (value) => {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed))
        throw new Error("PostgreSQL integer exceeds Seramet safe range");
      return parsed;
    });
    return new PostgresD1Database(
      new Pool({
        connectionString: binding.connectionString,
        max: 5,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        allowExitOnIdle: true,
      }),
    );
  }

  prepare(query: string): D1PreparedStatement {
    return new PostgresPreparedStatement(this.pool, normalizePostgresSql(query), []);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        if (!(statement instanceof PostgresPreparedStatement)) {
          throw new Error("PostgreSQL batch received a statement from another database adapter");
        }
        results.push(await statement.runWith<T>(client));
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exec(query: string): Promise<D1Result> {
    const result = await this.pool.query(normalizePostgresSql(query));
    return { success: true, meta: { changes: result.rowCount ?? 0 } };
  }

  async close() {
    await this.pool.end();
  }
}

class PostgresPreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly query: string,
    private readonly values: unknown[],
  ) {}

  bind(...values: unknown[]) {
    return new PostgresPreparedStatement(this.executor, this.query, values);
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const result = await this.executor.query(this.query, this.values);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? (row[column] ?? null) : row) as T | null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const result = await this.executor.query(this.query, this.values);
    return {
      success: true,
      results: result.rows as T[],
      meta: { rows_read: result.rows.length },
    };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.runWith<T>(this.executor);
  }

  async runWith<T = unknown>(executor: QueryExecutor): Promise<D1Result<T>> {
    const result = await executor.query(this.query, this.values);
    return {
      success: true,
      results: result.rows as T[],
      meta: { changes: result.rowCount ?? 0, rows_written: result.rowCount ?? 0 },
    };
  }
}

export function normalizePostgresSql(sql: string) {
  const normalized = sql
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;?/gim, "")
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO")
    .replace(
      /datetime\(([^,]+),\s*'\+'\s*\|\|\s*([^|]+)\|\|\s*' minutes'\)/gi,
      "to_char((($1)::timestamptz + (($2)::text || ' minutes')::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    )
    .replace(
      /datetime\(\s*'now'\s*,\s*'([+-])\s*(\d+)\s+(minutes?|hours?|days?)'\s*\)/gi,
      (_match, sign: string, amount: string, unit: string) =>
        `to_char((CURRENT_TIMESTAMP ${sign} INTERVAL '${amount} ${unit}') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    )
    .replace(
      /datetime\(\s*'now'\s*\)/gi,
      "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    );
  const withConflictHandling = /INSERT\s+OR\s+IGNORE/i.test(sql)
    ? `${normalized.trim().replace(/;$/, "")} ON CONFLICT DO NOTHING`
    : normalized;
  return replaceQuestionMarkParameters(withConflictHandling);
}

/** Rewrites D1 `?` placeholders without touching quoted SQL text. */
export function replaceQuestionMarkParameters(sql: string) {
  let output = "";
  let parameter = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[index + 1] === quote) {
          output += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
      continue;
    }
    if (character === "?") {
      parameter += 1;
      output += `$${parameter}`;
      continue;
    }
    output += character;
  }
  return output;
}
