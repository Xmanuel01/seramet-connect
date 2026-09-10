import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const iso = z.string().datetime({ offset: true });

export const nodeInputSchema = z
  .object({
    id: id.optional(),
    type: z.enum([
      "GROUP",
      "LEGAL_ENTITY",
      "BRAND",
      "REGION",
      "AREA",
      "BRANCH",
      "WAREHOUSE",
      "COMMISSARY",
    ]),
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    parentId: id.optional(),
    legalEntityId: id.optional(),
    brandId: id.optional(),
    branchId: id.optional(),
    warehouseId: id.optional(),
    status: z.enum(["ACTIVE", "TEMPORARILY_CLOSED", "SUSPENDED", "CLOSED"]).default("ACTIVE"),
    effectiveFrom: iso.optional(),
    effectiveTo: iso.optional(),
    timezone: z.string().trim().max(80).optional(),
    currency: z.string().trim().min(3).max(3).optional(),
    metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export const legalEntitySchema = z
  .object({
    id: id.optional(),
    code: z.string().trim().min(1).max(60),
    legalName: z.string().trim().min(1).max(200),
    tradingName: z.string().trim().max(200).optional(),
    registrationReference: z.string().trim().max(120).optional(),
    countryCode: z.string().trim().min(2).max(3),
    baseCurrency: z.string().trim().length(3),
    taxIdentifiers: z.record(z.string()).default({}),
    fiscalConfiguration: z.record(z.unknown()).default({}),
    accountingConfiguration: z.record(z.unknown()).default({}),
    status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"]).default("ACTIVE"),
  })
  .strict();

export const policyDefinitionSchema = z
  .object({
    id: id.optional(),
    code: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(80),
    valueSchema: z.record(z.unknown()).default({}),
    sensitive: z.boolean().default(false),
  })
  .strict();

export const policyAssignmentSchema = z
  .object({
    id: id.optional(),
    policyCode: z.string().trim().min(1).max(120),
    scopeNodeId: id,
    value: z.unknown().optional(),
    state: z.enum([
      "INHERIT",
      "LOCAL_VALUE",
      "LOCKED",
      "ALLOWED_OVERRIDE",
      "ALLOWED_WITHIN_RANGE",
      "APPROVAL_REQUIRED",
      "NOT_APPLICABLE",
    ]),
    minimumValueMinor: z.number().int().safe().optional(),
    maximumValueMinor: z.number().int().safe().optional(),
    approvalPolicy: z.record(z.unknown()).default({}),
    approvedExceptionId: id.optional(),
    effectiveFrom: iso.optional(),
    effectiveTo: iso.optional(),
  })
  .strict();

export const roleAssignmentSchema = z
  .object({
    id: id.optional(),
    userId: id,
    roleId: id,
    scopeNodeId: id,
    descendToChildren: z.boolean().default(true),
    effect: z.enum(["ALLOW", "DENY"]).default("ALLOW"),
    validFrom: iso.optional(),
    validUntil: iso.optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const priceRolloutSchema = z
  .object({
    id: id.optional(),
    scopeNodeId: id,
    menuItemId: id,
    priceMinor: z.number().int().safe().nonnegative(),
    currency: z.string().trim().length(3),
    idempotencyKey: z.string().trim().min(8).max(160),
    scheduledAt: iso.optional(),
    requiresApproval: z.boolean().default(false),
  })
  .strict();

export const exceptionSchema = z
  .object({
    policyCode: z.string().trim().min(1).max(120),
    scopeNodeId: id,
    requestType: z.string().trim().min(1).max(80),
    requestedValue: z.unknown().optional(),
    reason: z.string().trim().min(3).max(1000),
    validFrom: iso.optional(),
    validUntil: iso.optional(),
  })
  .strict();

export const exceptionTransitionSchema = z
  .object({
    status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "REVOKED"]),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

export const franchiseFeeCalculationSchema = z
  .object({
    feeDefinitionId: id,
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
  })
  .strict();
