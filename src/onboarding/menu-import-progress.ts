/** Authoritative, non-synthetic import progress presentation. */
export type PersistedImportProgress = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  needsReview: number;
  workerStatus?: string | null;
  verified: boolean;
};

export type ImportProgressSnapshot = {
  processed: number;
  total: number;
  observedAt: number;
};

/** Commit verification is not publication confirmation. */
export function importPresentationStage(result: {
  status: string;
  publishStatus?: string;
  verification?: { status: string };
}) {
  if (result.publishStatus === "PUBLISHED") return "PUBLISHED";
  if (result.publishStatus === "PUBLISHING") return "PUBLISHING";
  if (result.publishStatus === "FAILED" || result.status === "FAILED") return "FAILED";
  if (
    result.status === "COMMITTED" &&
    result.verification?.status === "VERIFIED" &&
    result.publishStatus === "READY"
  )
    return "STAGED";
  return "PROCESSING";
}

export function summarizeImportProgress(progress: PersistedImportProgress) {
  const total = Math.max(0, progress.total);
  const processed = Math.min(
    total,
    Math.max(0, progress.created + progress.updated + progress.skipped + progress.failed),
  );
  const pending = Math.max(0, total - processed - Math.max(0, progress.needsReview));
  const fullyVerified = progress.verified && processed === total;
  const percent =
    total === 0 ? 0 : Math.min(fullyVerified ? 100 : 99, Math.floor((processed / total) * 100));
  const stage = fullyVerified
    ? progress.failed > 0
      ? "COMPLETED_WITH_ERRORS"
      : "COMPLETED"
    : progress.workerStatus === "DEAD_LETTER"
      ? "FAILED"
      : progress.needsReview > 0 && pending === 0
        ? "WAITING_FOR_REVIEW"
        : processed === total && total > 0
          ? "VERIFYING"
          : ["PENDING", "RETRY_PENDING", "CLAIMED"].includes(progress.workerStatus ?? "")
            ? "QUEUED"
            : "PROCESSING";
  return { total, processed, pending, percent, stage };
}

/** Show ETA only when real completed-row samples demonstrate stable throughput. */
export function estimateImportEtaSeconds(
  previous: ImportProgressSnapshot | null,
  current: ImportProgressSnapshot,
): number | null {
  if (!previous || previous.total !== current.total || current.total <= 0) return null;
  if (current.processed >= current.total || current.processed <= previous.processed) return null;
  const elapsed = (current.observedAt - previous.observedAt) / 1000;
  if (elapsed < 5 || !Number.isFinite(elapsed)) return null;
  const rowsPerSecond = (current.processed - previous.processed) / elapsed;
  if (rowsPerSecond <= 0 || !Number.isFinite(rowsPerSecond)) return null;
  return Math.max(1, Math.ceil((current.total - current.processed) / rowsPerSecond));
}
