# One-time staging management-job backlog consolidation

**Staging ONLY; not executed.** The available connected Supabase SQL role is read-only.
Do not run this on production, skip an actual isolated-restore rehearsal or
restart Cloudflare queue consumers until the whole release gate is cleared.

Read-only forensic findings (28 Sep 2026):
- 42 PENDING MANAGEMENT_INTELLIGENCE_RECALCULATION jobs, all zero attempts,
  unleased, same tenant, same generic CONFIGURING bootstrap branch.
- All 42 payloads specify the *same branch* and businessDate=null. None
  requests a historical dated reprocessing task. All have unique IDs and
  idempotency keys: the 41 original jobs date from 22–25 Sep and a new,
  same-payload job was scheduled on 28 Sep.
- The worker executes recalculateTenant(branchId, businessDate), where null
  selects the current server business date when executed. One future run on
  the same branch can replace these identical date-free requests; it does
  NOT reconstruct older historical dates, which none of the pending jobs
  actually requested.
- These are **not** the 3 UNSCANNED 343-row setup import jobs. Handle those
  separately using STAGING_MENU_IMPORT_RECONCILIATION.md first.

Safe treatment after backup/restore: preserve the newest of the 42 as
PENDING so the newly verified Queue/Cron worker can recompute precisely one
current business-date branch snapshot. Mark the older 41 as DEAD_LETTER with
an explicit **administrative supersession, no actual execution** reason,
plus one immutable audit event per superseded job. Do not delete anything,
mark old work SUCCEEDED, or activate the consumer until the full staging
release gate, scanner, security and queue binding tests pass.

Procedure:
1. Freeze all staging Cron/Queue consumers and prevent new import retries.
2. Obtain and actually restore a staging backup to an isolated PostgreSQL
   instance; retain restricted evidence and independently verify rollback.
3. First apply the separate approved import quarantine; verify all 3 old
   SETUP_IMPORT_COMMIT jobs are terminal and all 1,029 original preview
   rows retained. Do not create new branches until these stale jobs have
   been reconciled (the one-time fingerprint checks the original bootstrap).
4. On an authorized staging-only secure runner, set
   SERAMET_ENVIRONMENT=staging and SERAMET_POSTGRES_URL to the *real staging*
   database; then execute:

       node scripts/reconcile-staging-management-backlog.mjs --plan

   The read-only repeatable-read transaction proves the 41 original jobs
   and the one new 28 Sep job are same-branch, date-free and unleased;
   it returns sanitized references, a count (41+1), and exact snapshot SHA256. A changed
   row, additional new job, different business date, completed work or a
   new branch makes the plan refuse execution.

5. Only after a separate operator accepts the *exact output* and has
   documented independent isolated-restore evidence, execute the script
   with --apply and staging-only write access. Set the following protected
   environment values, never CI log output or public comments:

       SERAMET_MANAGEMENT_BACKUP_RESTORE_VERIFIED=true
       SERAMET_MANAGEMENT_RESTORE_EVIDENCE=<restricted restore evidence ref>
       SERAMET_MANAGEMENT_OPERATOR=<authorized actor>
       SERAMET_MANAGEMENT_APPROVED_PLAN_SHA256=<exact fresh read-only snapshot>
       SERAMET_MANAGEMENT_APPROVED_BRANCH_REF=<sanitized branch ref>
       SERAMET_MANAGEMENT_APPROVED_RETAINED_JOB_REF=<sanitized latest job ref>
       SERAMET_MANAGEMENT_QUEUE_REDELIVERY_REVIEWED=true

   A single SERIALIZABLE transaction locks the affected rows, recalculates
   the plan fingerprint, changes 41 jobs to DEAD_LETTER, appends 41 audit
   events and verifies exact postconditions. Any mismatch rolls everything
   back. The newest pending job is *not* executed by the script.

6. Independently requery the database: expect precisely 41 incident jobs
   administratively terminal, one original job still PENDING at zero
   attempts, 41 corresponding append-only audit events, zero ACTIVE
   import jobs, unchanged menu and branch rows.

7. Provision the real scanner and protect Data API, validate compiled
   Cloudflare queue and scheduled handlers in a disposable environment.
   Review existing Cloudflare Queue/DLQ messages. When the approved staging
   release is enabled, allow **one** selected job to finish, then verify
   it is SUCCEEDED and the dashboard snapshots were actually recomputed.
   Check attempts, failed jobs, DLQ and /health/ready before new user work.

This tool never changes public-schema grants or supplies a malware scanner,
never sets release approvals on behalf of a human and never touches genuine
historical date-specific jobs. No part of this runbook is evidence that the
actual staging database has already been modified.
