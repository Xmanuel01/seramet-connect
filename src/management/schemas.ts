import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const safeInteger = z.number().int().safe();

export const thresholdPolicySchema = z
  .object({
    id: id.optional(),
    branchId: id.optional(),
    metricCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    comparison: z.enum(["GREATER_THAN", "LESS_THAN", "ABSOLUTE_GREATER_THAN"]),
    severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    thresholdValue: safeInteger,
    valueUnit: z.enum(["MINOR", "BPS", "COUNT", "MILLISECONDS", "MICRO"]),
    effectiveFrom: date,
    effectiveTo: date.optional(),
    reopenAfterMinutes: z.number().int().min(0).max(525_600).optional(),
  })
  .strict()
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo must not precede effectiveFrom",
  });

export const branchTargetSchema = z
  .object({
    id: id.optional(),
    branchId: id.optional(),
    metricCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    targetValue: safeInteger,
    valueUnit: z.enum(["MINOR", "BPS", "COUNT", "MILLISECONDS", "MICRO"]),
    effectiveFrom: date,
    effectiveTo: date.optional(),
  })
  .strict()
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo must not precede effectiveFrom",
  });

export const actionTransitionSchema = z
  .object({
    status: z.enum(["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"]),
    note: z.string().trim().min(3).max(2_000),
  })
  .strict();

export const recalculationRequestSchema = z
  .object({
    branchId: id.optional(),
  })
  .strict();
