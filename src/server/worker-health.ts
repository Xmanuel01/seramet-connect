import type { D1Database } from "@/server/database/d1";
import type { ReadinessIssue } from "@/server/environment";

/** Cheap, read-only staging guard. A bound queue is not proof of an executing consumer. */
export async function findOverdueDurableWork(
  db: D1Database,
  clock = Date.now(),
): Promise<ReadinessIssue[]> {
  const oldestAcceptable = new Date(clock - 30 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT 1 AS overdue
       FROM worker_jobs
       WHERE status IN ('PENDING','RETRY_PENDING','CLAIMED','RUNNING')
         AND scheduled_at < ?
       LIMIT 1`,
    )
    .bind(oldestAcceptable)
    .first<{ overdue: number }>();

  return row
    ? [
        {
          code: "WORKER_BACKLOG_STALE",
          message:
            "Overdue durable work exists; investigate Queue/Cron dispatch and pending imports before release",
        },
      ]
    : [];
}
