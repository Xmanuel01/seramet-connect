import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { OnboardingService } from "@/onboarding/onboarding-service";
import { allPermissionCodes } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import type { ObjectStoreBinding } from "@/server/environment";
import { RestaurantRegistrationService } from "@/server/registration-service";
import { createSecretStore } from "@/server/secrets";

describe.sequential("connecting a restaurant's own M-Pesa", () => {
  let db: SqliteD1TestDatabase;
  let objects: ReturnType<typeof memoryObjects>;
  let env: Record<string, unknown>;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    objects = memoryObjects();
    env = {
      SERAMET_OBJECTS: objects,
      SERAMET_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      SERAMET_CALLBACK_BASE_URL: "https://pos.example.test",
    };
  });

  afterEach(() => {
    setConfigurationRepositoryForTests(undefined);
    db.close();
  });

  it("stores the restaurant's keys encrypted, with a generated callback key", async () => {
    const { service, owner } = await restaurant("mpesa-till");
    const saved = await service.configureProviderConnection({
      providerId: "provider-daraja",
      branchId: owner.branchId,
      environment: "PRODUCTION",
      configuration: { accountType: "TILL", shortcode: "7654321", tillNumber: "123456" },
      credentials: { consumerKey: "ck-live", consumerSecret: "cs-live", passkey: "pk-live" },
      enabled: true,
    });
    const row = db.sqlite
      .prepare("SELECT status,secret_reference,payload_json FROM provider_connections WHERE id=?")
      .get(saved.id) as Record<string, string>;
    expect(row["status"]).toBe("CONFIGURED");
    expect(row["secret_reference"]).toBe(`managed://seramet/${owner.tenantId}/${saved.id}`);
    expect(JSON.parse(row["payload_json"]!).configuration).toMatchObject({
      accountType: "TILL",
      shortcode: "7654321",
      tillNumber: "123456",
    });
    // Nothing secret reaches the database or object storage in plain text.
    const everything = JSON.stringify(
      db.sqlite.prepare("SELECT * FROM provider_connections").all(),
    );
    for (const secret of ["ck-live", "cs-live", "pk-live"]) {
      expect(everything).not.toContain(secret);
      expect([...objects.data.values()].join("")).not.toContain(secret);
    }
    const stored = JSON.parse(
      (await createSecretStore(env).resolve(row["secret_reference"]!)).value,
    ) as Record<string, string>;
    expect(stored).toMatchObject({ consumerKey: "ck-live", passkey: "pk-live" });
    expect(stored["webhookSecret"]).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("keeps saved keys and the callback key when an owner changes only the numbers", async () => {
    const { service, owner } = await restaurant("mpesa-update");
    const input = {
      providerId: "provider-daraja",
      branchId: owner.branchId,
      environment: "PRODUCTION" as const,
      configuration: { accountType: "PAYBILL", shortcode: "600100" },
      enabled: true,
    };
    const first = await service.configureProviderConnection({
      ...input,
      credentials: { consumerKey: "ck-1", consumerSecret: "cs-1", passkey: "pk-1" },
    });
    const reference = `managed://seramet/${owner.tenantId}/${first.id}`;
    const before = JSON.parse((await createSecretStore(env).resolve(reference)).value);
    await service.configureProviderConnection({
      ...input,
      configuration: { accountType: "PAYBILL", shortcode: "600200" },
      credentials: { passkey: "pk-2" },
    });
    const after = JSON.parse((await createSecretStore(env).resolve(reference)).value);
    expect(after).toEqual({ ...before, passkey: "pk-2" });
  });

  it("asks for the right numbers and for all three keys", async () => {
    const { service, owner } = await restaurant("mpesa-invalid");
    const base = {
      providerId: "provider-daraja",
      branchId: owner.branchId,
      environment: "PRODUCTION" as const,
    };
    await expect(
      service.configureProviderConnection({
        ...base,
        configuration: { accountType: "TILL", shortcode: "7654321" },
      }),
    ).rejects.toThrow(/till number/);
    await expect(
      service.configureProviderConnection({
        ...base,
        configuration: { accountType: "PAYBILL", shortcode: "12" },
      }),
    ).rejects.toThrow(/Paybill number/);
    const partial = await service.configureProviderConnection({
      ...base,
      configuration: { accountType: "PAYBILL", shortcode: "600100" },
      credentials: { consumerKey: "ck" },
    });
    const status = db.sqlite
      .prepare("SELECT status FROM provider_connections WHERE id=?")
      .get(partial.id) as { status: string };
    expect(status.status).toBe("CREDENTIALS_REQUIRED");
  });

  async function restaurant(slug: string) {
    const provisioned = await new RestaurantRegistrationService(db).register(
      {
        provider: "supabase",
        subject: `subject-${slug}`,
        sessionId: `session-${slug}`,
        email: `${slug}@example.test`,
        emailVerified: true,
        issuedAt: Math.floor(Date.now() / 1_000) - 60,
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      },
      {
        idempotencyKey: `registration-${slug}-idempotency`,
        administratorName: "Restaurant owner",
        slug,
        legalName: `Kitchen ${slug}`,
        tradingName: `Kitchen ${slug}`,
      },
    );
    const owner: ServerActor = {
      id: provisioned.userId,
      name: "Restaurant owner",
      tenantId: provisioned.tenantId,
      roleIds: ["tenant-administrator"],
      permissions: [...allPermissionCodes],
      assignedBranchIds: [provisioned.branchId],
      assignedBranches: [{ id: provisioned.branchId, name: "Main" }],
      branchScope: { type: "ALL" },
      branchId: provisioned.branchId,
      branch: "Main",
      role: "Owner",
    };
    return { owner, service: new OnboardingService(db, owner, env) };
  }
});

function memoryObjects(): ObjectStoreBinding & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async head(key) {
      return data.has(key) ? {} : null;
    },
    async get(key) {
      const value = data.get(key);
      return value === undefined
        ? null
        : { arrayBuffer: async () => new TextEncoder().encode(value).buffer as ArrayBuffer };
    },
    async put(key, value) {
      data.set(key, typeof value === "string" ? value : String(value));
      return {};
    },
    async delete(key) {
      for (const item of Array.isArray(key) ? key : [key]) data.delete(item);
    },
  };
}
