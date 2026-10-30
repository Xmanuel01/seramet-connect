import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SerametEnv } from "@/lib/seramet-auth";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import { onboardingStepNumber as step, weekDays } from "@/onboarding/onboarding-steps";
import type { OnboardingWizardState } from "@/onboarding/location-currency-types";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { PosInvoiceLedger } from "@/server/database/pos-invoice-ledger";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import {
  RestaurantRegistrationService,
  type RestaurantRegistrationResult,
} from "@/server/registration-service";

const jwtSecret = "onboarding-http-e2e-signing-secret-32-bytes";
const jwtIssuer = "https://identity.seramet.test";
const jwtAudience = "seramet-onboarding-e2e";

// Drives guided setup the way the wizard does: signed-in HTTP requests through the production
// router, so request schemas, authentication and routing are exercised, not only the services.
describe.sequential("guided onboarding over the HTTP API", () => {
  let db: SqliteD1TestDatabase;
  let env: SerametEnv;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    env = {
      // Local development host: the router serves it, while authentication stays real (no dev auth).
      SERAMET_ENVIRONMENT: "development",
      SERAMET_DB: db,
      SERAMET_JWT_SECRET: jwtSecret,
      SERAMET_JWT_ISSUER: jwtIssuer,
      SERAMET_JWT_AUDIENCE: jwtAudience,
    };
  });

  afterEach(() => {
    setConfigurationRepositoryForTests(undefined);
    db.close();
  });

  it("takes a new restaurant from registration to a bill the ledger posts", async () => {
    const owner = await signIn("http-new");
    expect((await owner.onboarding()).currentStep).toBe(1);
    await walkFrom(owner, step("location"));
    await expectBillPosts(owner.provisioned);
  });

  it("resumes a restaurant that finished the old onboarding and lets it bill", async () => {
    const owner = await signIn("http-resume");
    await owner.saveStep(step("location"), location);
    await owner.saveStep(step("currency"), currency);
    db.sqlite
      .prepare(
        `UPDATE onboarding_wizard_progress SET status='COMPLETED',current_step=20,
           completed_steps_json='[1,2,3,4,5,6,7,8,9,10,11,12,20]',
           responses_json='{"5":{"countryCode":"KE"},"8":{"businessType":"RESTAURANT"}}'
         WHERE tenant_id=?`,
      )
      .run(owner.provisioned.tenantId);
    await expectBillRejected(owner.provisioned);

    const resumed = await owner.call<{ onboarding: OnboardingWizardState }>(
      "POST",
      "/api/seramet/setup/onboarding/resume",
      {},
    );
    expect(resumed.status).toBe(200);
    expect(resumed.body.onboarding).toMatchObject({
      status: "IN_PROGRESS",
      currentStep: step("businessType"),
    });
    const again = await owner.call("POST", "/api/seramet/setup/onboarding/resume", {});
    expect(again.status).toBe(409);

    await walkFrom(owner, step("businessType"));
    await expectBillPosts(owner.provisioned);
    const refused = await owner.call("POST", "/api/seramet/setup/onboarding/resume", {});
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/at least 80% ready/);
  });

  it("refuses resume without authentication or setup permission", async () => {
    const owner = await signIn("http-guard");
    const anonymous = await handleSerametApiRequest(
      new Request("http://localhost/api/seramet/setup/onboarding/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      env,
    );
    expect(anonymous.status).toBe(401);
    db.sqlite
      .prepare("DELETE FROM user_roles WHERE tenant_id=? AND user_id=?")
      .run(owner.provisioned.tenantId, owner.provisioned.userId);
    const forbidden = await owner.call("POST", "/api/seramet/setup/onboarding/resume", {});
    expect(forbidden.status).toBe(403);
  });

  const location = {
    countryCode: "KE",
    administrativeLevel1: "",
    administrativeLevel2: "",
    city: "Nairobi",
    addressLine: "Configured address",
    postalCode: "",
    confirmed: true,
  };
  const currency = { baseCurrency: "KES", secondaryCurrencies: [], currencyConfigurations: [] };

  /** The requests the wizard sends for each step, from `from` to finishing the review. */
  async function walkFrom(owner: Owner, from: number) {
    const branchId = owner.provisioned.branchId;
    const reason = "Guided onboarding";
    const steps: Array<[number, () => Promise<Record<string, unknown>>]> = [
      [step("location"), async () => location],
      [step("currency"), async () => currency],
      [step("businessType"), async () => ({ businessType: "RESTAURANT", trackStock: false })],
      [
        step("branch"),
        async () => ({ branchId, name: "Main branch", code: "MAIN", useBusinessLocation: true }),
      ],
      [
        step("hours"),
        async () => ({
          operatingHours: Object.fromEntries(
            weekDays.map((day) => [day, { open: "08:00", close: "22:00", closed: false }]),
          ),
        }),
      ],
      [
        step("serviceModes"),
        async () => {
          await owner.expectOk("POST", "/api/seramet/configuration/order-channels", {
            displayName: "Dine-in",
            code: "DINE_IN",
            channelType: "DINE_IN",
            useOnlinePrice: false,
            reason,
          });
          return { serviceModes: ["DINE_IN"] };
        },
      ],
      [
        step("tax"),
        async () => {
          await owner.expectOk("POST", "/api/seramet/setup/tax-service-rules", {
            ruleType: "TAX",
            code: "VAT",
            name: "VAT",
            rateBps: 1600,
            calculationMode: "INCLUSIVE",
            effectiveFrom: "2026-01-01",
            active: true,
          });
          return { noTax: false };
        },
      ],
      [
        step("payments"),
        async () => {
          await owner.expectOk("POST", "/api/seramet/configuration/payment-methods", {
            displayName: "Cash",
            code: "CASH",
            category: "CASH",
            reason,
          });
          return {};
        },
      ],
      [
        step("stations"),
        async () => {
          await owner.expectOk("POST", "/api/seramet/setup/stations", {
            branchId,
            code: "KITCHEN",
            name: "Kitchen",
            stationType: "KITCHEN",
          });
          return {};
        },
      ],
      [step("menu"), async () => ({ later: true })],
      [step("team"), async () => ({})],
    ];
    for (const [number, prepare] of steps) {
      if (number < from) continue;
      const saved = await owner.saveStep(number, await prepare());
      expect(saved.currentStep, `after step ${number}`).toBe(number + 1);
    }
    const done = await owner.call<{ onboarding: OnboardingWizardState }>(
      "POST",
      "/api/seramet/setup/onboarding/step",
      {
        step: step("review"),
        action: "COMPLETE",
        response: { confirmed: true, standardAccounts: true },
      },
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.onboarding.status).toBe("COMPLETED");

    const centre = await owner.call<{ setup: { overallScoreBps: number } }>(
      "GET",
      `/api/seramet/setup/centre?branchId=${encodeURIComponent(branchId)}`,
    );
    expect(centre.status).toBe(200);
    expect(centre.body.setup.overallScoreBps).toBeGreaterThanOrEqual(8_000);
  }

  function invoice(provisioned: RestaurantRegistrationResult, id: string) {
    // KES 1,160 inclusive of 16% VAT: 1,000 net and 160 tax, in minor units.
    return {
      tenantId: provisioned.tenantId,
      invoiceId: id,
      branchId: provisioned.branchId,
      businessDate: "2026-10-30",
      currency: "KES",
      payload: {
        status: "OPEN",
        subtotal: 1000,
        tax: 160,
        total: 1160,
        paid: 0,
        financialComponents: {
          version: 1,
          currency: "KES",
          grossSalesMinor: 100_000,
          discountsMinor: 0,
          netSalesMinor: 100_000,
          serviceChargeMinor: 0,
          taxMinor: 16_000,
          totalMinor: 116_000,
        },
      },
      correlationId: crypto.randomUUID(),
      actorId: provisioned.userId,
      stamp: new Date().toISOString(),
    };
  }

  async function expectBillRejected(provisioned: RestaurantRegistrationResult) {
    await expect(
      new PosInvoiceLedger(db).prepare(invoice(provisioned, "invoice-before")),
    ).rejects.toThrow(/account mapping is required/);
  }

  async function expectBillPosts(provisioned: RestaurantRegistrationResult) {
    const { statements } = await new PosInvoiceLedger(db).prepare(
      invoice(provisioned, "invoice-first"),
    );
    await db.batch(statements);
    const journal = db.sqlite
      .prepare(
        `SELECT status FROM journal_entries WHERE tenant_id=? AND source_type='POS_INVOICE'
           AND source_id='invoice-first'`,
      )
      .get(provisioned.tenantId) as { status: string } | undefined;
    expect(journal?.status).toBe("POSTED");
    const totals = db.sqlite
      .prepare(
        `SELECT SUM(debit_minor) AS debit,SUM(credit_minor) AS credit FROM journal_lines
         WHERE tenant_id=? AND journal_entry_id='POS_INVOICE:invoice-first'`,
      )
      .get(provisioned.tenantId) as { debit: number; credit: number };
    // Integrity: the journal balances and carries the whole bill.
    expect(totals).toEqual({ debit: 116_000, credit: 116_000 });
  }

  type Owner = Awaited<ReturnType<typeof signIn>>;

  async function signIn(slug: string) {
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
    const sessionId = `api-session-${slug}`;
    const issued = new Date(Date.now() - 60_000).toISOString();
    db.sqlite
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
    const call = async <T = Record<string, unknown>>(
      method: "GET" | "POST" | "PATCH",
      path: string,
      body?: unknown,
    ) => {
      const response = await handleSerametApiRequest(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-seramet-tenant-id": provisioned.tenantId,
            "x-seramet-branch-id": provisioned.branchId,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        env,
      );
      return { status: response.status, body: (await response.json()) as T };
    };
    return {
      provisioned,
      call,
      async expectOk(method: "POST" | "PATCH", path: string, body: unknown) {
        const result = await call(method, path, body);
        expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBeLessThan(300);
        return result.body;
      },
      async onboarding() {
        const result = await call<{ onboarding: OnboardingWizardState }>(
          "GET",
          "/api/seramet/setup/onboarding",
        );
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        return result.body.onboarding;
      },
      async saveStep(number: number, response: Record<string, unknown>) {
        const result = await call<{ onboarding: OnboardingWizardState }>(
          "POST",
          "/api/seramet/setup/onboarding/step",
          { step: number, action: "SAVE", response },
        );
        expect(result.status, `step ${number}: ${JSON.stringify(result.body)}`).toBe(200);
        return result.body.onboarding;
      },
    };
  }
});

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
