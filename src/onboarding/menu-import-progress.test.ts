import { describe, expect, it } from "vitest";
import {
  estimateImportEtaSeconds,
  importPresentationStage,
  summarizeImportProgress,
} from "@/onboarding/menu-import-progress";

describe("authoritative import progress", () => {
  it("keeps polling a verified commit until publication is authoritatively confirmed", () => {
    const committed = { status: "COMMITTED", verification: { status: "VERIFIED" } };
    expect(importPresentationStage({ ...committed, publishStatus: "READY" })).toBe("STAGED");
    expect(importPresentationStage({ ...committed, publishStatus: "PUBLISHING" })).toBe(
      "PUBLISHING",
    );
    expect(importPresentationStage({ ...committed, publishStatus: "PUBLISHED" })).toBe("PUBLISHED");
    expect(importPresentationStage({ ...committed, publishStatus: "FAILED" })).toBe("FAILED");
    expect(importPresentationStage(committed)).toBe("PROCESSING");
  });
  it("does not fabricate percentage or ETA for a stalled 343-item job", () => {
    const progress = summarizeImportProgress({
      total: 343,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      needsReview: 0,
      workerStatus: "PENDING",
      verified: false,
    });
    expect(progress).toMatchObject({ percent: 0, processed: 0, stage: "QUEUED", pending: 343 });
    expect(estimateImportEtaSeconds(null, { total: 343, processed: 0, observedAt: 0 })).toBeNull();
  });
  it("caps progress at 99% until the catalogue has been verified", () => {
    const input = {
      total: 343,
      created: 343,
      updated: 0,
      skipped: 0,
      failed: 0,
      needsReview: 0,
      workerStatus: "SUCCEEDED",
    };
    expect(summarizeImportProgress({ ...input, verified: false })).toMatchObject({
      percent: 99,
      stage: "VERIFYING",
    });
    expect(summarizeImportProgress({ ...input, verified: true })).toMatchObject({
      percent: 100,
      stage: "COMPLETED",
    });
  });
  it("keeps unresolved major differences separate from successfully processed rows", () => {
    const progress = summarizeImportProgress({
      total: 20,
      created: 11,
      updated: 3,
      skipped: 2,
      failed: 0,
      needsReview: 4,
      workerStatus: "RUNNING",
      verified: false,
    });
    expect(progress).toMatchObject({
      processed: 16,
      pending: 0,
      percent: 80,
      stage: "WAITING_FOR_REVIEW",
    });
  });
  it("calculates ETA only from actual persisted row completion rates", () => {
    const first = { total: 343, processed: 20, observedAt: 10_000 };
    const second = { total: 343, processed: 40, observedAt: 20_000 };
    expect(estimateImportEtaSeconds(first, second)).toBe(152);
    expect(estimateImportEtaSeconds(first, { ...second, processed: 20 })).toBeNull();
    expect(estimateImportEtaSeconds(first, { ...second, observedAt: 12_000 })).toBeNull();
  });
  it("marks verified partial success as completed with exceptions", () => {
    expect(
      summarizeImportProgress({
        total: 5,
        created: 3,
        updated: 0,
        skipped: 1,
        failed: 1,
        needsReview: 0,
        verified: true,
      }),
    ).toMatchObject({ percent: 100, stage: "COMPLETED_WITH_ERRORS" });
  });
});
