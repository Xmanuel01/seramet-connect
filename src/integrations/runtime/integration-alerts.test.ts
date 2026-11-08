import { afterEach, describe, expect, it } from "vitest";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { createIntegrationRepository } from "@/integrations/runtime/integration-repository";
import type { IntegrationDeadLetter } from "@/integrations/runtime/models";

let db: SqliteD1TestDatabase | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

function database() {
  db = createDemoFixtureDatabase();
  // The counts don't depend on a real provider connection behind each dead letter.
  db.sqlite.exec("PRAGMA foreign_keys = OFF");
  return db;
}

const tenantId = "tenant-demo-mona";
const letter = (id: string): IntegrationDeadLetter => ({
  id,
  tenantId,
  connectionId: "connection-alerts",
  providerId: "provider-alerts",
  sourceType: "OUTBOX",
  sourceId: `source-${id}`,
  originalPayload: { id },
  error: "Provider rejected the request",
  attemptCount: 3,
  correlationId: `correlation-${id}`,
  status: "OPEN",
  createdAt: new Date().toISOString(),
});

describe("integration alert counts", () => {
  it.each([
    ["database", () => createIntegrationRepository(database())],
    ["memory", () => createIntegrationRepository()],
  ])("match the full diagnostics lists (%s)", async (_, create) => {
    const repository = create();
    await repository.appendDeadLetter(letter(crypto.randomUUID()));
    const resolved = crypto.randomUUID();
    await repository.appendDeadLetter(letter(resolved));
    await repository.updateDeadLetter(tenantId, resolved, {
      status: "RESOLVED",
      resolvedAt: new Date().toISOString(),
      resolvedBy: "owner",
    });
    const counts = await repository.alertCounts(tenantId);
    const [deadLetters, events] = await Promise.all([
      repository.listDeadLetters(tenantId),
      repository.listEvents(tenantId),
    ]);
    expect(counts).toEqual({
      openDeadLetters: deadLetters.filter((row) => row.status === "OPEN").length,
      mappingRequired: events.filter((row) => row.status === "MAPPING_REQUIRED").length,
    });
    expect(counts.openDeadLetters).toBe(1);
  });
});
