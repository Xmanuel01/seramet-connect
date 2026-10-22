import { describe, expect, it } from "vitest";
import { migrationConnectionConfig } from "./migration-connection";

describe("migration connection security", () => {
  it.each(["db.example.supabase.co", "aws-1-eu-west-1.pooler.supabase.com"])(
    "requires verified TLS without URI options for %s",
    (host) => {
      const config = migrationConnectionConfig(
        `postgresql://migration:test-only@${host}:5432/postgres`,
      );
      expect(config.ssl).toEqual({ rejectUnauthorized: true });
      expect(new URL(config.connectionString).hostname).toBe(host);
    },
  );

  it("retains exact project username, endpoint, database and unrelated options", () => {
    const original = new URL(
      "postgresql://postgres.productionproject:test-only@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&application_name=seramet-migration",
    );
    const config = migrationConnectionConfig(original.toString());
    const sanitized = new URL(config.connectionString);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    for (const key of ["hostname", "port", "pathname", "username", "password"] as const)
      expect(sanitized[key]).toBe(original[key]);
    expect(sanitized.searchParams.get("application_name")).toBe("seramet-migration");
    expect(sanitized.searchParams.has("sslmode")).toBe(false);
  });

  it.each([
    "sslmode=disable",
    "sslmode=prefer",
    "sslmode=require",
    "sslmode=no-verify",
    "ssl=false",
    "sslrootcert=private",
    "sslcert=private",
    "sslkey=private",
    "uselibpqcompat=true",
  ])("rejects remote verification overrides: %s", (query) => {
    expect(() =>
      migrationConnectionConfig(
        `postgresql://migration:test-only@db.example.supabase.co/postgres?${query}`,
      ),
    ).toThrow(/^MIGRATION_TLS_/);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "preserves disposable local PostgreSQL compatibility for %s",
    (host) => {
      const url = `postgresql://test:test-only@${host}:5432/disposable`;
      expect(migrationConnectionConfig(url)).toEqual({ connectionString: url });
    },
  );

  it("cannot mistake a hostname prefix for loopback", () => {
    expect(
      migrationConnectionConfig("postgresql://test:test-only@localhost.attacker.example/postgres")
        .ssl,
    ).toEqual({ rejectUnauthorized: true });
    expect(() => migrationConnectionConfig("https://example.test")).toThrow(
      "MIGRATION_POSTGRES_URL_REQUIRED",
    );
  });

  it("does not expose malformed credentials through URL parser errors", () => {
    expect(() => migrationConnectionConfig("postgresql://private-password@[")).toThrow(
      "MIGRATION_POSTGRES_URL_INVALID",
    );
  });
});
