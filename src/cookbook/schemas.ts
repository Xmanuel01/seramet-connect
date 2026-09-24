import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const optionalUrl = z.string().trim().url().max(1000).optional();

export const cookbookMethodStepSchema = z
  .object({
    step: z.number().int().positive().max(200),
    title: z.string().trim().max(160).optional(),
    instruction: z.string().trim().min(1).max(4000),
    durationMinutes: z.number().int().nonnegative().max(1440).optional(),
    temperature: z.string().trim().max(80).optional(),
    checkpoint: z.string().trim().max(500).optional(),
  })
  .strict();

export const cookbookMediaSchema = z
  .object({
    type: z.enum(["IMAGE", "VIDEO", "DOCUMENT", "LINK"]),
    url: z.string().trim().url().max(1000),
    label: z.string().trim().max(160).optional(),
  })
  .strict();

export const cookbookDraftSchema = z
  .object({
    recipeId: id,
    recipeVersionId: id,
    prepMinutes: z.number().int().nonnegative().max(1440),
    cookMinutes: z.number().int().nonnegative().max(1440),
    portionLabel: z.string().trim().max(160).optional(),
    imageUrl: optionalUrl,
    chefNotes: z.string().trim().max(8000).optional(),
    method: z.array(cookbookMethodStepSchema).min(1).max(200),
    media: z.array(cookbookMediaSchema).max(100).optional(),
    sourceDocument: z.string().trim().max(500).optional(),
    sourceReference: z.string().trim().max(1000).optional(),
    changeSummary: z.string().trim().min(3).max(500),
  })
  .strict();

export const cookbookPublishSchema = z
  .object({
    contentVersionId: id,
    changeSummary: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const cookbookCopyPreviousSchema = z
  .object({
    recipeId: id,
    targetRecipeVersionId: id,
    changeSummary: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
