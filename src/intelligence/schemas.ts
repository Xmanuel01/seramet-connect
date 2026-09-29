import { z } from "zod";

const qualitySchema = z.enum(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA", "COMPLETE", "PARTIAL"]);

const actionSchema = z
  .object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(160),
    route: z.string().regex(/^\/[a-z0-9/\-?=&]*$/i),
    risk: z.enum(["READ_ONLY", "LOW", "MEDIUM", "HIGH"]),
    requiresConfirmation: z.boolean(),
    command: z.enum(["ACKNOWLEDGE_MANAGEMENT_ACTION"]).optional(),
    commandPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const structuredIntelligenceAnswerSchema = z
  .object({
    summary: z.string().min(1).max(2400),
    keyFindings: z
      .array(
        z
          .object({
            statement: z.string().min(1).max(1200),
            classification: z.enum(["CONFIRMED", "CORRELATED", "UNEXPLAINED"]),
            evidenceRefs: z.array(z.string().min(1).max(160)).max(20),
          })
          .strict(),
      )
      .max(20),
    evidenceRefs: z.array(z.string().min(1).max(160)).max(100),
    dataQuality: qualitySchema,
    qualityReasons: z.array(z.string().max(300)).max(30),
    limitations: z.array(z.string().max(500)).max(30),
    suggestedActions: z.array(actionSchema).max(12),
  })
  .strict();

export const askIntelligenceSchema = z
  .object({
    question: z.string().trim().min(3).max(1200),
    sessionId: z.string().uuid().optional(),
    branchIds: z.array(z.string().min(1).max(160)).max(50).optional(),
    screenContext: z.string().trim().max(120).optional(),
    forceRefresh: z.boolean().optional(),
  })
  .strict();

export const feedbackSchema = z
  .object({
    messageId: z.string().uuid(),
    rating: z.enum(["HELPFUL", "NOT_HELPFUL", "INCORRECT_OR_MISSING_EVIDENCE"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export const providerConfigSchema = z
  .object({
    id: z.string().min(1).max(160).optional(),
    providerKey: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,80}$/),
    displayName: z.string().trim().min(2).max(120),
    modelIdentifier: z.string().trim().min(1).max(160),
    enabled: z.boolean(),
    secretReference: z.string().trim().max(300).optional(),
    timeoutMs: z.number().int().min(1000).max(60000),
    maxInputUnits: z.number().int().min(100).max(1000000),
    maxOutputUnits: z.number().int().min(100).max(100000),
    perMinuteLimit: z.number().int().min(1).max(10000),
    dailyRequestLimit: z.number().int().min(1).max(1000000),
    monthlyRequestLimit: z.number().int().min(1).max(10000000),
    perUserDailyLimit: z.number().int().min(1).max(100000),
    retentionMode: z.enum(["EPHEMERAL", "SHORT", "STANDARD"]),
    allowedFeatures: z.array(z.string().min(1).max(100)).max(100),
    allowedRoleIds: z.array(z.string().min(1).max(160)).max(100),
    promptVersion: z.string().trim().min(1).max(80),
  })
  .strict();

export const briefRequestSchema = z
  .object({
    briefType: z.enum(["MORNING", "EOD", "OWNER", "MANAGEMENT"]),
    branchId: z.string().min(1).max(160).optional(),
    periodStart: z.string().date().optional(),
    periodEnd: z.string().date().optional(),
  })
  .strict();

export const confirmActionSchema = z
  .object({
    proposalId: z.string().uuid(),
    confirmationToken: z.string().min(24).max(300),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
