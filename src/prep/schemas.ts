import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const revision = z.number().int().positive();

export const prepAdjustSchema = z
  .object({
    expectedRevision: revision,
    targetQuantityMicro: z.number().int().positive(),
    stationId: id.nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const prepApproveSchema = z
  .object({
    expectedRevision: revision,
    warehouseId: id,
  })
  .strict();

export const prepStartSchema = z
  .object({
    expectedRevision: revision,
  })
  .strict();

export const prepCompleteSchema = z
  .object({
    expectedRevision: revision,
    actualOutputQuantityMicro: z.number().int().positive(),
  })
  .strict();

export const prepDismissSchema = z
  .object({
    expectedRevision: revision,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
