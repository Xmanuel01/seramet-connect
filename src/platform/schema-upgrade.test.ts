import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nodeInputSchema } from "@/enterprise/schemas";
import { businessProfileSchema, importPreviewRequestSchema } from "@/onboarding/schemas";

describe("patched schema runtime compatibility", () => {
  it("rejects an oversized constrained collection before traversing its elements", () => {
    let visited = 0;
    const element = z.custom(() => {
      visited++;
      return false;
    });
    const result = z.array(element).max(2).safeParse(Array(1_000).fill(null));
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized input must be rejected");
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.code).toBe("too_big");
    expect(visited).toBe(0);
  });

  it("still validates elements of collections within their configured limit", () => {
    const result = z.array(z.string()).max(2).safeParse([123]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Invalid element must be rejected");
    expect(result.error.issues[0]?.code).toBe("invalid_type");
    expect(result.error.issues[0]?.path).toEqual([0]);
  });

  it("preserves enterprise defaults and omitted optional fields", () => {
    const result = nodeInputSchema.parse({ type: "BRANCH", code: "WL", name: "Westlands" });
    expect(result.status).toBe("ACTIVE");
    expect(result.metadata).toEqual({});
    expect(result).not.toHaveProperty("parentId");
    expect(nodeInputSchema.safeParse({ ...result, unexpected: true }).success).toBe(false);
  });

  it("preserves string-valued contact dictionaries and optional metadata", () => {
    const schema = businessProfileSchema.pick({ contact: true, fiscalSettings: true });
    expect(schema.parse({})).toEqual({});
    expect(
      schema.parse({ contact: { phone: "0700000000" }, fiscalSettings: { ready: false } }),
    ).toEqual({ contact: { phone: "0700000000" }, fiscalSettings: { ready: false } });
    expect(schema.safeParse({ contact: { phone: 123 } }).success).toBe(false);
  });

  it("preserves import mapping validation and the configured branch-list limit", () => {
    const schema = importPreviewRequestSchema.pick({
      columnMap: true,
      referenceMap: true,
      targetBranchIds: true,
    });
    expect(schema.parse({ referenceMap: { stations: { MAIN: " kitchen " } } })).toEqual({
      referenceMap: { stations: { MAIN: "kitchen" } },
    });
    expect(schema.safeParse({ columnMap: { name: 7 } }).success).toBe(false);
    expect(schema.safeParse({ referenceMap: { stations: { MAIN: " " } } }).success).toBe(false);
    expect(schema.safeParse({ targetBranchIds: Array(101).fill("branch") }).success).toBe(false);
  });
});
