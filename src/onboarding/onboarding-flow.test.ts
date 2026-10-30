import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { LocationCurrencyService } from "@/onboarding/location-currency-service";
import { OnboardingService } from "@/onboarding/onboarding-service";
import {
  ONBOARDING_FLOW_MARKER,
  ONBOARDING_STEP_COUNT,
  onboardingStepNumber,
  translateLegacyProgress,
  weekDays,
} from "@/onboarding/onboarding-steps";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import {
  RestaurantRegistrationService,
  type RestaurantRegistrationResult,
} from "@/server/registration-service";

const step = onboardingStepNumber;

describe("legacy onboarding progress translation", () => {
  it("starts a freshly registered legacy restaurant at the first step", () => {
    expect(
      translateLegacyProgress({
        currentStep: 5,
        status: "IN_PROGRESS",
        completedSteps: [1, 2, 3, 4],
        responses: {},
      }),
    ).toEqual({
      currentStep: 1,
      status: "IN_PROGRESS",
      completedSteps: [],
      responses: { [ONBOARDING_FLOW_MARKER]: 2 },
    });
  });

  it("keeps answers that created records and drops the old configure-later choices", () => {
    const translated = translateLegacyProgress({
      currentStep: 15,
      status: "IN_PROGRESS",
      completedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      responses: {
        "5": { countryCode: "KE", city: "Nairobi" },
        "6": { confirmed: true },
        "8": { businessType: "Restaurant" },
        "9": { name: "Main", code: "MAIN" },
        "10": { useBusinessLocation: true },
        "11": { operatingHours: {} },
        "12": { serviceModes: ["DINE_IN"] },
        "13": { choice: "CONFIGURE_NOW" },
      },
    });
    expect(translated.completedSteps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(translated.currentStep).toBe(step("tax"));
    expect(translated.responses["1"]).toEqual({
      countryCode: "KE",
      city: "Nairobi",
      confirmed: true,
    });
    expect(translated.responses["4"]).toEqual({
      name: "Main",
      code: "MAIN",
      useBusinessLocation: true,
    });
    expect(translated.responses["7"]).toBeUndefined();
  });

  it("keeps a completed legacy onboarding completed", () => {
    expect(
      translateLegacyProgress({
        currentStep: 20,
        status: "COMPLETED",
        completedSteps: [5, 6, 7, 8, 9, 10, 11, 12, 20],
        responses: {},
      }),
    ).toMatchObject({ status: "COMPLETED", currentStep: ONBOARDING_STEP_COUNT });
  });

  it("clamps out-of-range steps stored in the current flow", () => {
    expect(
      translateLegacyProgress({
        currentStep: 20,
        status: "COMPLETED",
        completedSteps: [1, 20],
        responses: { [ONBOARDING_FLOW_MARKER]: 2 },
      }),
    ).toMatchObject({ currentStep: ONBOARDING_STEP_COUNT, completedSteps: [1] });
  });
});

describe.sequential("guided onboarding flow against real records", () => {
  let db: SqliteD1TestDatabase;

  beforeEach(() => {
    db = createMigratedTestDatabase();
  });

  afterEach(() => {
    setConfigurationRepositoryForTests(undefined);
    db.close();
  });

  it("walks a new restaurant through every step and completes only when records exist", async () => {
    const provisioned = await register("flow-complete", "Flow Complete Kitchen");
    const owner = actor(provisioned);
    const flow = new LocationCurrencyService(db, owner);
    const setup = new OnboardingService(db, owner, {});
    const save = (stepNumber: number, response: Record<string, unknown>) =>
      flow.saveOnboardingStep({ step: stepNumber, action: "SAVE", response });

    expect(await flow.getOnboardingState()).toMatchObject({ currentStep: 1, completedSteps: [] });
    await save(step("location"), {
      countryCode: "KE",
      city: "Nairobi",
      addressLine: "Configured address",
      confirmed: true,
    });
    await save(step("currency"), { baseCurrency: "KES", secondaryCurrencies: [] });
    await expect(save(step("businessType"), { businessType: "Spaceship" })).rejects.toThrow(
      /type of business/,
    );
    await save(step("businessType"), { businessType: "RESTAURANT" });
    await save(step("branch"), {
      branchId: provisioned.branchId,
      name: "Main branch",
      code: "MAIN",
      useBusinessLocation: true,
    });

    const allWeek = (open: string, close: string) =>
      Object.fromEntries(weekDays.map((day) => [day, { open, close, closed: false }]));
    await expect(
      save(step("hours"), { operatingHours: allWeek("09:00", "09:00") }),
    ).rejects.toThrow(/different opening and closing/);
    await expect(
      save(step("hours"), {
        operatingHours: Object.fromEntries(
          weekDays.map((day) => [day, { open: "", close: "", closed: true }]),
        ),
      }),
    ).rejects.toThrow(/at least one day/);
    // Closing after midnight is a valid overnight trading day.
    await save(step("hours"), { operatingHours: allWeek("16:00", "02:00") });

    await expect(save(step("serviceModes"), { serviceModes: ["DINE_IN"] })).rejects.toThrow(
      /not set up yet: DINE_IN/,
    );
    insert(
      "INSERT INTO order_channels (tenant_id,id,code,channel_type,active,payload_json) VALUES (?,?,?,?,1,'{}')",
      provisioned.tenantId,
      "channel-dine-in",
      "DINE_IN",
      "DINE_IN",
    );
    await save(step("serviceModes"), { serviceModes: ["dine_in"] });

    await expect(save(step("tax"), {})).rejects.toThrow(/tax rate/);
    await setup.configureTaxServiceRule({
      ruleType: "TAX",
      code: "VAT",
      name: "VAT",
      rateBps: 1600,
      calculationMode: "INCLUSIVE",
      effectiveFrom: "2026-01-01",
    });
    await save(step("tax"), {});

    await expect(save(step("payments"), {})).rejects.toThrow(/payment method/);
    insert(
      "INSERT INTO payment_methods (tenant_id,id,code,category,active,payload_json) VALUES (?,?,?,?,1,'{}')",
      provisioned.tenantId,
      "method-cash",
      "CASH",
      "CASH",
    );
    await save(step("payments"), {});

    await expect(save(step("stations"), {})).rejects.toThrow(/preparation station/);
    await setup.configureStation({
      branchId: provisioned.branchId,
      code: "KITCHEN",
      name: "Kitchen",
      stationType: "KITCHEN",
    });
    await save(step("stations"), {});

    await expect(save(step("menu"), {})).rejects.toThrow(/menu item/);
    await save(step("menu"), { later: true });
    await save(step("team"), {});

    await expect(save(step("review"), { confirmed: false })).rejects.toThrow(/confirm/);
    const done = await flow.saveOnboardingStep({
      step: step("review"),
      action: "COMPLETE",
      response: { confirmed: true },
    });
    expect(done).toMatchObject({ status: "COMPLETED", currentStep: ONBOARDING_STEP_COUNT });
    expect(done.responses[ONBOARDING_FLOW_MARKER]).toBe(2);
  });

  it("refuses to complete with required steps missing and cannot skip ahead", async () => {
    const provisioned = await register("flow-missing", "Flow Missing Kitchen");
    const flow = new LocationCurrencyService(db, actor(provisioned));
    await expect(
      flow.saveOnboardingStep({ step: step("tax"), action: "SAVE", response: { noTax: true } }),
    ).rejects.toThrow(/cannot be skipped/);
    await expect(
      flow.saveOnboardingStep({ step: 13, action: "SAVE", response: {} }),
    ).rejects.toThrow(/Unknown onboarding step/);
    // Force the cursor to review without completing the required steps.
    db.sqlite
      .prepare("UPDATE onboarding_wizard_progress SET current_step=12 WHERE tenant_id=?")
      .run(provisioned.tenantId);
    await expect(
      flow.saveOnboardingStep({
        step: step("review"),
        action: "COMPLETE",
        response: { confirmed: true },
      }),
    ).rejects.toThrow(/Complete these steps first: Where is your business located\?/);
  });

  it("translates a legacy progress row on read and rewrites it on the next save", async () => {
    const provisioned = await register("flow-legacy", "Flow Legacy Kitchen");
    db.sqlite
      .prepare(
        `UPDATE onboarding_wizard_progress
         SET current_step=5,completed_steps_json='[1,2,3,4]',responses_json='{}' WHERE tenant_id=?`,
      )
      .run(provisioned.tenantId);
    const flow = new LocationCurrencyService(db, actor(provisioned));
    expect(await flow.getOnboardingState()).toMatchObject({ currentStep: 1, completedSteps: [] });
    await flow.saveOnboardingStep({
      step: 1,
      action: "SAVE",
      response: {
        countryCode: "KE",
        city: "Nairobi",
        addressLine: "Configured address",
        confirmed: true,
      },
    });
    const row = db.sqlite
      .prepare(
        "SELECT current_step,completed_steps_json,responses_json FROM onboarding_wizard_progress WHERE tenant_id=?",
      )
      .get(provisioned.tenantId) as Record<string, string | number>;
    expect(row["current_step"]).toBe(2);
    expect(JSON.parse(String(row["completed_steps_json"]))).toEqual([1]);
    expect(JSON.parse(String(row["responses_json"]))[ONBOARDING_FLOW_MARKER]).toBe(2);
  });

  it("creates and updates branch stations with audit, scoped to the actor", async () => {
    const provisioned = await register("flow-stations", "Flow Station Kitchen");
    const owner = actor(provisioned);
    const setup = new OnboardingService(db, owner, {});
    const first = await setup.configureStation({
      branchId: provisioned.branchId,
      code: "BAR",
      name: "Bar",
      stationType: "BAR",
    });
    const second = await setup.configureStation({
      branchId: provisioned.branchId,
      code: "BAR",
      name: "Cocktail bar",
      stationType: "BAR",
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(
      db.sqlite
        .prepare("SELECT name,active FROM stations WHERE tenant_id=? AND id=?")
        .get(provisioned.tenantId, first.id),
    ).toEqual({ name: "Cocktail bar", active: 1 });
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS total FROM audit_events WHERE tenant_id=? AND entity_type='STATION'",
        )
        .get(provisioned.tenantId),
    ).toEqual({ total: 2 });
    await expect(
      setup.configureStation({
        branchId: "branch-of-someone-else",
        code: "GRILL",
        name: "Grill",
        stationType: "GRILL",
      }),
    ).rejects.toThrow();
    const viewer = new OnboardingService(
      db,
      { ...owner, permissions: owner.permissions.filter((p) => p !== permissions.setupManage) },
      {},
    );
    await expect(
      viewer.configureStation({
        branchId: provisioned.branchId,
        code: "GRILL",
        name: "Grill",
        stationType: "GRILL",
      }),
    ).rejects.toThrow(/setup.manage/);
  });

  function insert(sql: string, ...values: string[]) {
    db.sqlite.prepare(sql).run(...values);
  }

  async function register(slug: string, tradingName: string) {
    return new RestaurantRegistrationService(db).register(
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
        legalName: tradingName,
        tradingName,
      },
    );
  }
});

function actor(provisioned: RestaurantRegistrationResult): ServerActor {
  return {
    id: provisioned.userId,
    name: "Restaurant owner",
    tenantId: provisioned.tenantId,
    roleIds: ["tenant-administrator"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: [provisioned.branchId],
    assignedBranches: [{ id: provisioned.branchId, name: "Configured branch" }],
    branchScope: { type: "ALL" },
    branchId: provisioned.branchId,
    branch: "Configured branch",
    role: "Configured administrator",
  };
}
