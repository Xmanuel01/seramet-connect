import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const cookbookMethodStepSchema = z
  .object({
    id: id.optional(),
    title: optionalText(160),
    instruction: z.string().trim().min(1).max(2_000),
    timerMinutes: z.number().int().min(0).max(1_440).optional(),
    temperatureC: z.number().min(-50).max(500).optional(),
    stationNote: optionalText(300),
  })
  .strict();

export const cookbookMediaSchema = z
  .object({
    id: id.optional(),
    kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]),
    url: z.string().trim().min(1).max(2_000),
    caption: optionalText(300),
  })
  .strict();

export const cookbookDraftSchema = z
  .object({
    branchId: id,
    recipeId: id,
    recipeVersionId: id,
    idempotencyKey: z.string().trim().min(16).max(200),
    prepMinutes: z.number().int().min(0).max(1_440).default(0),
    cookMinutes: z.number().int().min(0).max(1_440).default(0),
    portionLabel: optionalText(120),
    imageUrl: optionalText(2_000),
    chefNotes: optionalText(5_000),
    method: z.array(cookbookMethodStepSchema).min(1).max(100),
    media: z.array(cookbookMediaSchema).max(30).default([]),
    sourceDocument: optionalText(255),
    sourceReference: optionalText(500),
    changeSummary: optionalText(500),
  })
  .strict();

export const cookbookPublishSchema = z
  .object({
    branchId: id,
    contentVersionId: id,
    idempotencyKey: z.string().trim().min(16).max(200),
    changeSummary: optionalText(500),
  })
  .strict();

export type CookbookDraftInput = z.infer<typeof cookbookDraftSchema>;
export type CookbookPublishInput = z.infer<typeof cookbookPublishSchema>;
export type CookbookMethodStep = z.infer<typeof cookbookMethodStepSchema>;
export type CookbookMedia = z.infer<typeof cookbookMediaSchema>;
