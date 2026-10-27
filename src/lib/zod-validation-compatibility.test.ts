import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it } from "vitest";
import { legalEntitySchema } from "@/enterprise/schemas";
import {
  acceptedCurrencySchema,
  businessProfileSchema,
  importPreviewRequestSchema,
  onboardingStepSchema,
  organisationProvisionSchema,
  providerSetupSchema,
} from "@/onboarding/schemas";

const profile = {
  legalName: "Validation Restaurant Ltd",
  tradingName: "Validation Restaurant",
  countryCode: "KE",
  defaultCurrency: "KES",
  timezone: "Africa/Nairobi",
  locale: "en-KE",
  accountingMode: "PERPETUAL" as const,
};

const importRequest = {
  kind: "MENU" as const,
  originalName: "validation-menu.csv",
  mimeType: "text/csv",
  base64: "bmFtZSxwcmljZQ==",
  duplicateStrategy: "ERROR" as const,
  idempotencyKey: "validation-import-001",
};

describe("Zod 4 validation compatibility", () => {
  it.each(Object.keys(profile))("keeps the business profile field %s required", (field) => {
    const input: Record<string, unknown> = { ...profile };
    delete input[field];
    const result = businessProfileSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });

  it("preserves form field errors and valid resolver output", async () => {
    const resolver = zodResolver(organisationProvisionSchema);
    const input = {
      ...profile,
      slug: "validation-restaurant",
      brandCode: "VALIDATION",
      brandName: "Validation Restaurant",
      administratorEmail: "owner@example.com",
    };
    const options = { criteriaMode: "all" as const, fields: {}, shouldUseNativeValidation: false };
    const invalid = await resolver(
      { ...input, legalName: " ", administratorEmail: "not-an-email" },
      undefined,
      options,
    );
    expect(invalid.values).toEqual({});
    expect(invalid.errors.legalName?.message).toBeTruthy();
    expect(invalid.errors.administratorEmail?.message).toBeTruthy();
    const valid = await resolver(input, undefined, options);
    expect(valid.errors).toEqual({});
    expect(valid.values).toEqual(input);
  });

  it("keeps optional records optional and string record values constrained", () => {
    expect(businessProfileSchema.parse(profile)).toEqual(profile);
    expect(
      businessProfileSchema.parse({ ...profile, contact: { email: "owner@example.com" } }).contact,
    ).toEqual({ email: "owner@example.com" });
    expect(businessProfileSchema.safeParse({ ...profile, contact: { phone: 123 } }).success).toBe(
      false,
    );
    expect(businessProfileSchema.safeParse({ ...profile, contact: [] }).success).toBe(false);
  });

  it("retains strict API objects and required onboarding responses", () => {
    expect(
      businessProfileSchema.safeParse({ ...profile, tenantId: "another-tenant" }).success,
    ).toBe(false);
    expect(onboardingStepSchema.safeParse({ step: 6, action: "SAVE" }).success).toBe(false);
    expect(onboardingStepSchema.safeParse({ step: 6, action: "SAVE", response: [] }).success).toBe(
      false,
    );
    expect(
      onboardingStepSchema.parse({
        step: 6,
        action: "SAVE",
        response: { confirmed: true, latitude: null, nested: { source: "manual" } },
      }).response,
    ).toEqual({ confirmed: true, latitude: null, nested: { source: "manual" } });
  });

  it("preserves import input requirements and station mapping validation", () => {
    expect(importPreviewRequestSchema.parse(importRequest)).toEqual(importRequest);
    expect(importPreviewRequestSchema.safeParse({ ...importRequest, base64: "" }).success).toBe(
      false,
    );
    expect(
      importPreviewRequestSchema.safeParse({ ...importRequest, base64: undefined }).success,
    ).toBe(false);
    expect(
      importPreviewRequestSchema.parse({
        ...importRequest,
        columnMap: { Item: "name" },
        referenceMap: { stations: { Kitchen: "station-1" } },
      }).referenceMap,
    ).toEqual({ stations: { Kitchen: "station-1" } });
    for (const stations of [{ Kitchen: " " }, { Kitchen: 1 }]) {
      expect(
        importPreviewRequestSchema.safeParse({ ...importRequest, referenceMap: { stations } })
          .success,
      ).toBe(false);
    }
  });

  it("retains record defaults without allowing invalid tax identifier values", () => {
    const entity = {
      code: "VALIDATION",
      legalName: "Validation Ltd",
      countryCode: "KE",
      baseCurrency: "KES",
    };
    expect(legalEntitySchema.parse(entity)).toMatchObject({
      taxIdentifiers: {},
      fiscalConfiguration: {},
      accountingConfiguration: {},
      status: "ACTIVE",
    });
    expect(legalEntitySchema.safeParse({ ...entity, taxIdentifiers: { pin: 123 } }).success).toBe(
      false,
    );
  });

  it("rejects empty provider credentials while retaining optional credentials", () => {
    const provider = { providerId: "validation-provider", environment: "SANDBOX" as const };
    expect(providerSetupSchema.parse(provider)).toEqual(provider);
    expect(
      providerSetupSchema.safeParse({ ...provider, credentials: { apiKey: "" } }).success,
    ).toBe(false);
  });

  it("preserves collection bounds, enums and currency transformations", () => {
    expect(acceptedCurrencySchema.parse({ currencyCode: " kes " })).toMatchObject({
      currencyCode: "KES",
      branchIds: [],
      paymentEligible: true,
    });
    expect(
      acceptedCurrencySchema.safeParse({
        currencyCode: "KES",
        branchIds: Array(501).fill("branch"),
      }).success,
    ).toBe(false);
    expect(
      acceptedCurrencySchema.safeParse({ currencyCode: "KES", status: "UNKNOWN" }).success,
    ).toBe(false);
  });
});
