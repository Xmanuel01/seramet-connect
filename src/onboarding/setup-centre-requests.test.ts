import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool as PostgresPool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SerametEnv } from "@/lib/seramet-auth";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import type { D1Database, D1PreparedStatement, D1Result } from "@/server/database/d1";
import { PostgresD1Database } from "@/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import {
  createMigratedTestDatabase,
  migrationFiles,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { RestaurantRegistrationService } from "@/server/registration-service";
import { resetSchemaCheckForTests } from "@/server/database/schema-check-cache";

const jwtSecret = "setup-centre-load-signing-secret-32-bytes!";
const jwtIssuer = "https://identity.seramet.test";
const jwtAudience = "seramet-setup-load";

/** The reads Setup Centre sent before the bootstrap endpoint: one request per section. */
const legacySectionPaths = (branchQuery: string) => [
  `/api/seramet/setup/centre${branchQuery}`,
  "/api/seramet/setup/integration-health",
  "/api/seramet/setup/device-health",
  "/api/seramet/setup/providers",
  "/api/seramet/setup/organisation-structure",
  "/api/seramet/setup/business-profile",
  `/api/seramet/setup/options${branchQuery}`,
  "/api/seramet/setup/provider-mappings",
  `/api/seramet/setup/opening-stock${branchQuery}`,
  `/api/seramet/setup/menu-catalog${branchQuery}`,
  "/api/seramet/setup/diagnostics",
  "/api/seramet/setup/onboarding",
  "/api/seramet/setup/reference/location-currency",
  "/api/seramet/setup/historical-sales",
  "/api/seramet/setup/imports/capability",
];

// Production runs Postgres through Hyperdrive. Each request opens its own pool of at most five
// connections (postgres-database.ts; Workers allow six open connections per request), every
// statement is a round trip, and all requests share the origin's fifteen connections. The test
// database answers instantly, so this model charges a round trip per statement and a setup cost
// per connection a request opens, and enforces both pool limits: the critical path, connection
// churn and pool queueing then show up as wall-clock time.
type NetworkProfile = { name: string; roundTripMs: number; connectMs: number };
// The Worker is placed beside the database (aws:eu-west-1), so a round trip is short and
// opening a connection costs more; "remote" shows the same requests with slow round trips.
const placed: NetworkProfile = { name: "placed", roundTripMs: 2, connectMs: 15 };
const remote: NetworkProfile = { name: "remote", roundTripMs: 20, connectMs: 0 };

class Pool {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly size: number) {}
  get busy() {
    return this.active;
  }
  async acquire() {
    if (this.active >= this.size) await new Promise<void>((done) => this.waiting.push(done));
    this.active += 1;
  }
  release() {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}

class Origin {
  queries = 0;
  connections = 0;
  readonly pool = new Pool(15);
  identity = `setup-centre-load-${crypto.randomUUID()}`;
  constructor(
    readonly sqlite: SqliteD1TestDatabase,
    public network: NetworkProfile,
  ) {}
  /** A fresh server instance: nothing cached for this database yet. */
  restart() {
    this.identity = `setup-centre-load-${crypto.randomUUID()}`;
  }

  /** The database one request sees, like `PostgresD1Database.fromHyperdrive`. */
  forRequest() {
    return new NetworkLikeDatabase(this, new Pool(5));
  }
}

class NetworkLikeDatabase implements D1Database {
  readonly provider = "sqlite" as const;
  // Per-request pools share caches by naming their database, as the Postgres adapter does.
  readonly cacheIdentity: string;

  private opened = 0;

  constructor(
    private readonly origin: Origin,
    private readonly requestPool: Pool,
  ) {
    this.cacheIdentity = origin.identity;
  }

  prepare(query: string): D1PreparedStatement {
    return this.wrap(this.origin.sqlite.prepare(query));
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    // One transaction on one connection: BEGIN, the statements and COMMIT are round trips too.
    return this.roundTrip(statements.length + 2, () =>
      this.origin.sqlite.batch<T>(statements.map((statement) => (statement as Wrapped).inner)),
    );
  }

  async exec(query: string) {
    return this.roundTrip(1, () => this.origin.sqlite.exec(query));
  }

  private wrap(statement: D1PreparedStatement): Wrapped {
    return {
      inner: statement,
      bind: (...values) => this.wrap(statement.bind(...values)),
      first: (column) => this.roundTrip(1, () => statement.first(column)),
      all: () => this.roundTrip(1, () => statement.all()),
      run: () => this.roundTrip(1, () => statement.run()),
    };
  }

  private async roundTrip<T>(statements: number, execute: () => Promise<T>): Promise<T> {
    this.origin.queries += statements;
    await this.requestPool.acquire();
    // A request's pool keeps the connections it opened; a new one is opened only when all of
    // them are busy.
    if (this.requestPool.busy > this.opened) {
      this.opened += 1;
      this.origin.connections += 1;
      await delay(this.origin.network.connectMs);
    }
    await this.origin.pool.acquire();
    try {
      await delay(this.origin.network.roundTripMs * statements);
      return await execute();
    } finally {
      this.origin.pool.release();
      this.requestPool.release();
    }
  }
}
// setTimeout rounds short waits up to the platform timer (about 10 ms on Windows), so waits
// are measured against the clock instead.
const delay = (ms: number) =>
  new Promise<void>((done) => {
    const until = performance.now() + ms;
    const check = () => (performance.now() >= until ? done() : setImmediate(check));
    check();
  });
type Wrapped = D1PreparedStatement & { inner: D1PreparedStatement };

describe.sequential("Setup Centre load", () => {
  let sqlite: SqliteD1TestDatabase;
  let origin: Origin;
  let env: SerametEnv;

  beforeEach(() => {
    sqlite = createMigratedTestDatabase();
    origin = new Origin(sqlite, placed);
    resetSchemaCheckForTests();
    env = {
      SERAMET_ENVIRONMENT: "development",
      SERAMET_JWT_SECRET: jwtSecret,
      SERAMET_JWT_ISSUER: jwtIssuer,
      SERAMET_JWT_AUDIENCE: jwtAudience,
    };
  });

  afterEach(() => {
    setConfigurationRepositoryForTests(undefined);
    sqlite.close();
  });

  it("opens with one authenticated request", async () => {
    const owner = await signIn();
    const branchQuery = `?branchId=${encodeURIComponent(owner.branchId)}`;
    const results: Record<string, Measured> = {};
    for (const network of [placed, remote]) {
      origin.network = network;
      // Cold: a server that hasn't loaded this restaurant's configuration yet.
      origin.restart();
      results[`${network.name} cold, 15 requests`] = await measure(() =>
        openLegacy(owner, branchQuery),
      );
      origin.restart();
      results[`${network.name} cold, bootstrap`] = await measure(() => openBootstrap(owner));
      // Warm: the configuration is cached on this server.
      results[`${network.name} warm, 15 requests`] = await measure(() =>
        openLegacy(owner, branchQuery),
      );
      results[`${network.name} warm, bootstrap`] = await measure(() => openBootstrap(owner));
    }
    for (const [name, result] of Object.entries(results))
      console.info(
        `[setup-centre-load] ${name}: ${result.queries} queries, ` +
          `${result.connections} connections, ${result.ms} ms`,
      );

    const response = await owner.get(`/api/seramet/setup/bootstrap${branchQuery}`);
    const sections = (
      response.body as { sections: Record<string, { ok: boolean; status: number }> }
    ).sections;
    expect(Object.keys(sections).sort()).toEqual(
      [
        "businessProfile",
        "centre",
        "deviceHealth",
        "diagnostics",
        "historicalSales",
        "importCapability",
        "integrationHealth",
        "menuCatalog",
        "onboarding",
        "openingStock",
        "options",
        "organisationStructure",
        "providerMappings",
        "providers",
        "references",
      ].sort(),
    );
    for (const [name, section] of Object.entries(sections)) {
      // A new restaurant has no onboarding record yet; everything else must load.
      if (name === "onboarding" && section.status === 404) continue;
      expect(section.ok, `${name}: ${JSON.stringify(section)}`).toBe(true);
    }

    for (const state of ["cold", "warm"]) {
      const legacy = results[`placed ${state}, 15 requests`]!;
      const bootstrap = results[`placed ${state}, bootstrap`]!;
      expect(bootstrap.queries, state).toBeLessThan(legacy.queries);
      expect(bootstrap.connections, state).toBeLessThanOrEqual(5);
      expect(bootstrap.ms, state).toBeLessThan(legacy.ms);
    }
  });

  async function openBootstrap(owner: Owner) {
    const response = await owner.get(
      `/api/seramet/setup/bootstrap?branchId=${encodeURIComponent(owner.branchId)}`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  it("authenticates a warm request in a few round trips", async () => {
    const owner = await signIn();
    await owner.get("/api/seramet/setup/providers");
    const providers = await measure(() => owner.get("/api/seramet/setup/providers"));
    console.info(
      `[setup-centre-load] warm authenticated request: ${providers.queries} queries, ${providers.ms} ms`,
    );
    // Session, identity facts and the configuration revision; the schema is checked once.
    expect(providers.queries).toBeLessThanOrEqual(3);
    // One wave of round trips plus opening its connections.
    expect(providers.ms).toBeLessThan(5 * placed.roundTripMs + 3 * placed.connectMs + 25);
  });

  type Measured = { queries: number; connections: number; ms: number };
  async function measure(run: () => Promise<unknown>): Promise<Measured> {
    const queries = origin.queries;
    const connections = origin.connections;
    const started = performance.now();
    await run();
    return {
      queries: origin.queries - queries,
      connections: origin.connections - connections,
      ms: Math.round(performance.now() - started),
    };
  }

  async function openLegacy(owner: Owner, branchQuery: string) {
    const responses = await Promise.all(
      legacySectionPaths(branchQuery).map((path) => owner.get(path)),
    );
    for (const [index, response] of responses.entries()) {
      const path = legacySectionPaths(branchQuery)[index]!;
      if (path === "/api/seramet/setup/onboarding" && response.status === 404) continue;
      expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(200);
    }
  }

  type Owner = Awaited<ReturnType<typeof signIn>>;

  async function signIn() {
    const provisioned = await new RestaurantRegistrationService(sqlite).register(
      {
        provider: "supabase",
        subject: "subject-setup-load",
        sessionId: "session-setup-load",
        email: "setup-load@example.test",
        emailVerified: true,
        issuedAt: Math.floor(Date.now() / 1_000) - 60,
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      },
      {
        idempotencyKey: "registration-setup-load-idempotency",
        administratorName: "Restaurant owner",
        slug: "setup-load",
        legalName: "Kitchen setup-load",
        tradingName: "Kitchen setup-load",
      },
    );
    const sessionId = "api-session-setup-load";
    const issued = new Date(Date.now() - 1_000).toISOString();
    sqlite.sqlite
      .prepare(
        `INSERT INTO auth_sessions
          (tenant_id,id,user_id,device_id,issued_at,expires_at,revoked_at,last_seen_at,
           token_version,ip_hash,metadata_json)
         VALUES (?,?,?,NULL,?,?,NULL,?,1,NULL,'{}')`,
      )
      .run(
        provisioned.tenantId,
        sessionId,
        provisioned.userId,
        issued,
        new Date(Date.now() + 3_600_000).toISOString(),
        issued,
      );
    const token = await signToken({
      tid: provisioned.tenantId,
      sub: provisioned.userId,
      sid: sessionId,
    });
    return {
      ...provisioned,
      async get(path: string) {
        const response = await handleSerametApiRequest(
          new Request(`http://localhost${path}`, {
            headers: {
              authorization: `Bearer ${token}`,
              "x-seramet-tenant-id": provisioned.tenantId,
              "x-seramet-branch-id": provisioned.branchId,
            },
          }),
          { ...env, SERAMET_DB: origin.forRequest() },
        );
        return { status: response.status, body: (await response.json()) as unknown };
      },
    };
  }
});

// The combined identity read, the count batches and the bootstrap are new SQL: run them on
// PostgreSQL too, as production does.
it("authenticates and opens Setup Centre on PostgreSQL", async () => {
  const postgres = new PGlite();
  try {
    await postgres.exec(postgresCompatibilityPrelude);
    for (const file of migrationFiles) {
      await postgres.exec(
        compileSqliteMigrationForPostgres(
          readFileSync(resolve(process.cwd(), "migrations", file), "utf8"),
        ).sql,
      );
    }
    const query = async (sql: string, values?: unknown[]) => {
      const result = await postgres.query(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    };
    const db = new PostgresD1Database(
      { query, connect: async () => ({ query, release() {} }) } as unknown as PostgresPool,
      `setup-centre-postgres-${crypto.randomUUID()}`,
    );
    resetSchemaCheckForTests();
    const provisioned = await new RestaurantRegistrationService(db).register(
      {
        provider: "supabase",
        subject: "subject-setup-postgres",
        sessionId: "session-setup-postgres",
        email: "setup-postgres@example.test",
        emailVerified: true,
        issuedAt: Math.floor(Date.now() / 1_000) - 60,
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      },
      {
        idempotencyKey: "registration-setup-postgres-idempotency",
        administratorName: "Restaurant owner",
        slug: "setup-postgres",
        legalName: "Kitchen setup-postgres",
        tradingName: "Kitchen setup-postgres",
      },
    );
    const issued = new Date(Date.now() - 1_000).toISOString();
    await db
      .prepare(
        `INSERT INTO auth_sessions
          (tenant_id,id,user_id,device_id,issued_at,expires_at,revoked_at,last_seen_at,
           token_version,ip_hash,metadata_json)
         VALUES (?,?,?,NULL,?,?,NULL,?,1,NULL,'{}')`,
      )
      .bind(
        provisioned.tenantId,
        "api-session-setup-postgres",
        provisioned.userId,
        issued,
        new Date(Date.now() + 3_600_000).toISOString(),
        issued,
      )
      .run();
    const token = await signToken({
      tid: provisioned.tenantId,
      sub: provisioned.userId,
      sid: "api-session-setup-postgres",
    });
    const env: SerametEnv = {
      SERAMET_ENVIRONMENT: "development",
      SERAMET_DB: db,
      SERAMET_JWT_SECRET: jwtSecret,
      SERAMET_JWT_ISSUER: jwtIssuer,
      SERAMET_JWT_AUDIENCE: jwtAudience,
    };
    const get = async (path: string) => {
      const response = await handleSerametApiRequest(
        new Request(`http://localhost${path}`, {
          headers: {
            authorization: `Bearer ${token}`,
            "x-seramet-tenant-id": provisioned.tenantId,
            "x-seramet-branch-id": provisioned.branchId,
          },
        }),
        env,
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const branchQuery = `?branchId=${encodeURIComponent(provisioned.branchId)}`;
    const bootstrap = await get(`/api/seramet/setup/bootstrap${branchQuery}`);
    expect(bootstrap.status, JSON.stringify(bootstrap.body)).toBe(200);
    const sections = bootstrap.body.sections as Record<string, { ok: boolean; status: number }>;
    for (const [name, section] of Object.entries(sections)) {
      if (name === "onboarding" && section.status === 404) continue;
      expect(section.ok, `${name}: ${JSON.stringify(section)}`).toBe(true);
    }
    // The section endpoints answer the same as the bootstrap's sections.
    const centre = await get(`/api/seramet/setup/centre${branchQuery}`);
    expect(centre.status, JSON.stringify(centre.body)).toBe(200);
    const fromBootstrap = (sections.centre as unknown as { value: { setup: { stages: unknown } } })
      .value.setup.stages;
    expect((centre.body.setup as { stages: unknown }).stages).toEqual(fromBootstrap);
    // A revoked session is refused on the very next request.
    await db
      .prepare("UPDATE auth_sessions SET revoked_at=? WHERE tenant_id=? AND id=?")
      .bind(new Date().toISOString(), provisioned.tenantId, "api-session-setup-postgres")
      .run();
    expect((await get("/api/seramet/setup/providers")).status).toBe(401);
  } finally {
    await postgres.close();
  }
}, 120_000);

async function signToken(input: { tid: string; sub: string; sid: string }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    ...input,
    iss: jwtIssuer,
    aud: jwtAudience,
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}
