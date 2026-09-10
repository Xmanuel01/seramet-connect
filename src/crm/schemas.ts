import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const optionalId = id.optional();
const currency = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/);

export const customerCreateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    phone: z.string().trim().max(64).optional(),
    email: z.string().trim().max(254).optional(),
    preferredLanguage: z.string().trim().max(16).optional(),
    preferredBranchId: optionalId,
    brandId: optionalId,
    accountType: z.enum(["INDIVIDUAL", "CORPORATE"]).optional(),
    companyName: z.string().trim().max(200).optional(),
    billingContact: z.string().trim().max(160).optional(),
    taxIdentifier: z.string().trim().max(80).optional(),
    invoiceTermsDays: z.number().int().min(0).max(3650).optional(),
    accountReference: z.string().trim().max(80).optional(),
    createdSource: z.string().trim().min(1).max(80),
  })
  .strict();

export const identityResolveSchema = z
  .object({
    type: z.enum([
      "PHONE",
      "EMAIL",
      "EXTERNAL_CUSTOMER_ID",
      "LOYALTY_NUMBER",
      "MEMBER_TOKEN",
      "MARKETPLACE_REFERENCE",
      "ONLINE_ACCOUNT",
    ]),
    value: z.string().trim().min(1).max(256),
    providerConnectionId: optionalId,
  })
  .strict();

export const mergeCustomersSchema = z
  .object({
    canonicalCustomerId: id,
    duplicateCustomerId: id,
    reason: z.string().trim().min(4).max(500),
    confirmed: z.literal(true),
    idempotencyKey: id,
  })
  .strict();

export const consentSchema = z
  .object({
    customerId: id,
    channel: z.enum([
      "EMAIL_MARKETING",
      "SMS_MARKETING",
      "WHATSAPP_MARKETING",
      "PUSH_MARKETING",
      "PHONE_MARKETING",
    ]),
    status: z.enum(["GRANTED", "DENIED", "WITHDRAWN", "UNKNOWN"]),
    source: z.string().trim().min(1).max(80),
    policyVersion: z.string().trim().min(1).max(80),
    proofReference: z.string().trim().max(256).optional(),
    effectiveAt: z.string().datetime().optional(),
  })
  .strict();

export const privacyRequestSchema = z
  .object({
    customerId: id,
    requestType: z.enum([
      "ACCESS",
      "EXPORT",
      "CORRECTION",
      "ANONYMIZATION",
      "DELETION_WHERE_PERMITTED",
      "MARKETING_OPTOUT",
    ]),
    requestReference: z.string().trim().min(1).max(128),
  })
  .strict();

export const anonymizeSchema = z
  .object({ requestId: id, reason: z.string().trim().min(4).max(500) })
  .strict();

export const loyaltyProgramSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(120),
    scopeType: z.enum(["TENANT", "BRAND", "BRANCH"]),
    brandId: optionalId,
    branchId: optionalId,
    effectiveFrom: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    earningType: z.enum(["SPEND", "ITEM", "CATEGORY", "VISIT", "BONUS"]),
    spendMinorPerPoint: z.number().int().positive().optional(),
    minimumSpendMinor: z.number().int().min(0).default(0),
    roundingPolicy: z.enum(["FLOOR", "NEAREST", "CEILING"]).default("FLOOR"),
    expiryType: z.enum(["NONE", "FIXED_DATE", "DAYS_AFTER_EARN"]).default("NONE"),
    expiryDays: z.number().int().positive().optional(),
    expiryDate: z.string().datetime().optional(),
    eligibleBranchIds: z.array(id).default([]),
    eligibleChannels: z.array(z.string().trim().min(1).max(40)).default([]),
    redemptionRules: z.record(z.unknown()).default({}),
    receiptMessage: z.string().trim().max(240).optional(),
  })
  .strict();

export const loyaltyRedeemSchema = z
  .object({
    customerId: id,
    programId: id,
    branchId: id,
    channel: z.string().trim().min(1).max(40),
    points: z.number().int().positive(),
    orderId: id,
    businessDate: z.string().date(),
    idempotencyKey: id,
  })
  .strict();

export const loyaltyAdjustmentSchema = z
  .object({
    customerId: id,
    programId: id,
    branchId: optionalId,
    points: z
      .number()
      .int()
      .refine((value) => value !== 0),
    reason: z.string().trim().min(4).max(500),
    businessDate: z.string().date(),
    idempotencyKey: id,
  })
  .strict();

export const voucherDefinitionSchema = z
  .object({
    code: z.string().trim().min(3).max(64),
    name: z.string().trim().min(1).max(120),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().optional(),
    branchIds: z.array(id).default([]),
    channels: z.array(z.string().trim().min(1).max(40)).default([]),
    itemIds: z.array(id).default([]),
    categoryCodes: z.array(z.string().trim().min(1).max(80)).default([]),
    minimumSpendMinor: z.number().int().min(0).default(0),
    currency: currency.optional(),
    discountType: z.enum(["FIXED_MINOR", "PERCENT_BPS", "FREE_ITEM", "NON_FINANCIAL"]),
    discountValue: z.number().int().min(0),
    usageCap: z.number().int().positive().optional(),
    perCustomerCap: z.number().int().positive().optional(),
    customerSpecific: z.boolean().default(false),
    singleUse: z.boolean().default(false),
    stackingPolicy: z.enum(["ALLOW", "BLOCK", "BEST_ONLY", "PRIORITY_ORDER"]).default("BLOCK"),
    stackingPriority: z.number().int().default(100),
    refundPolicy: z.enum(["KEEP_REDEMPTION", "RESTORE_ON_FULL_REFUND"]).default("KEEP_REDEMPTION"),
  })
  .strict();

export const voucherIssueSchema = z
  .object({
    voucherDefinitionId: id,
    customerId: optionalId,
    expiresAt: z.string().datetime().optional(),
    sourceType: z.string().trim().min(1).max(80),
    sourceId: optionalId,
  })
  .strict();

export const voucherRedemptionSchema = z
  .object({
    code: z.string().trim().min(3).max(128),
    customerId: optionalId,
    branchId: id,
    orderId: id,
    invoiceId: optionalId,
    channel: z.string().trim().min(1).max(40),
    subtotalMinor: z.number().int().min(0),
    eligibleItemSubtotalMinor: z.number().int().min(0).optional(),
    currency,
    idempotencyKey: id,
  })
  .strict();

export const giftCardIssueSchema = z
  .object({
    amountMinor: z.number().int().positive(),
    currency,
    purchaserCustomerId: optionalId,
    recipientCustomerId: optionalId,
    liabilityAccountId: id,
    collectionAccountId: id,
    redemptionAccountId: id,
    breakageAccountId: optionalId,
    expiresAt: z.string().datetime().optional(),
    businessDate: z.string().date(),
    idempotencyKey: id,
  })
  .strict();

export const giftCardRedemptionSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    amountMinor: z.number().int().positive(),
    currency,
    branchId: id,
    orderId: id,
    invoiceId: optionalId,
    businessDate: z.string().date(),
    idempotencyKey: id,
  })
  .strict();

const segmentRuleSchema = z
  .object({
    field: z.enum([
      "orderCount",
      "netSpendMinor",
      "averageOrderMinor",
      "daysSinceLastVisit",
      "refundMinor",
      "discountMinor",
      "favoriteChannel",
      "loyaltyPoints",
      "tierId",
    ]),
    operator: z.enum(["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN"]),
    value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
  })
  .strict();

export const segmentSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    definition: z
      .object({
        all: z.array(segmentRuleSchema).optional(),
        any: z.array(segmentRuleSchema).optional(),
      })
      .strict(),
    lapsedDays: z.number().int().positive().optional(),
  })
  .strict();

export const campaignSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    objective: z.string().trim().min(1).max(500),
    segmentId: id,
    channels: z.array(z.enum(["EMAIL", "SMS", "WHATSAPP", "PUSH"])).min(1),
    scheduleAt: z.string().datetime().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    templateSubject: z.string().max(200).optional(),
    templateBody: z.string().min(1).max(4000),
    voucherDefinitionId: optionalId,
    branchIds: z.array(id).default([]),
    brandIds: z.array(id).default([]),
    budgetMinor: z.number().int().min(0).optional(),
    currency: currency.optional(),
    providerConfigId: optionalId,
    approvalRequired: z.boolean().default(false),
  })
  .strict();

export const campaignApprovalSchema = z
  .object({ campaignId: id, reason: z.string().trim().min(4).max(500) })
  .strict();

export const feedbackSchema = z
  .object({
    branchId: id,
    customerId: optionalId,
    orderId: optionalId,
    categoryId: id,
    surveyType: z.enum(["GENERAL", "NPS", "CSAT"]).default("GENERAL"),
    rating: z.number().int().min(0).max(10),
    comment: z.string().trim().max(2000).optional(),
    source: z.string().trim().min(1).max(80),
  })
  .strict();

export const feedbackResolveSchema = z
  .object({
    feedbackId: id,
    status: z.enum(["IN_REVIEW", "FOLLOW_UP", "RESOLVED", "DISMISSED"]),
    note: z.string().trim().max(2000).optional(),
    resolution: z.string().trim().max(2000).optional(),
  })
  .strict();

export const customerImportPreviewSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(200),
    fileHash: z.string().trim().min(16).max(128),
    idempotencyKey: id,
    rows: z
      .array(
        z
          .object({
            displayName: z.string().trim().min(1).max(160),
            phone: z.string().trim().max(64).optional(),
            email: z.string().trim().max(254).optional(),
            memberId: z.string().trim().max(128).optional(),
            tags: z.array(z.string().trim().min(1).max(80)).default([]),
            consentStatus: z.enum(["GRANTED", "DENIED", "WITHDRAWN", "UNKNOWN"]).optional(),
            consentEvidence: z.string().trim().max(256).optional(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
