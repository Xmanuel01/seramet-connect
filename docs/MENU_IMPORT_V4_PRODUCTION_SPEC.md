# Seramet Menu Import V4 — Production Design
Status: architecture and progress foundation, NOT DEPLOYED. Depends on PR #52 (durable medium-size import) and PR #53 (Cloudflare Nitro Queue/Cron handlers).

## Incident baseline (2026-09-27)
Staging Cloudflare Worker has CPU-limit errors affecting both session and import-preview HTTP requests. Staging Postgres is reachable independently, with 41 pending management jobs and THREE pending 343-row menu imports; every job has zero execution attempts. The latest two menu imports have identical normalized rows; the earliest has the same item codes/prices but older template/category data. Existing imports must not be resumed automatically.

## End-user workflow
1. SOURCE. Upload CSV/XLSX or map external POS headings. Define target branches, stations, required references and duplicate policy. Enforce file signatures, size/row caps, tenant authorization and content-hash deduplication. For an existing identical import, show Resume — never submit a second copy.
2. DRY RUN. Stage immutable normalized rows in Postgres, validate all references and calculate field-level differences against authoritative tenant+branch catalogue. Distinguish NEW, IDENTICAL, MATERIAL_CHANGE, INVALID. Preview is strictly read-only.
3. REVIEW. Automatically skip identical items. Material differences in price, tax, recipe, category, modifiers, kitchen station or branch availability create a row-level Hold for Review. Provide side-by-side current versus uploaded values and explicit Keep Current, Use Uploaded or Edit Proposed choices. Invalid rows get a pre-filled Edit Manually control while other rows proceed. Never silently overwrite a materially different existing item.
4. COMMIT. Server returns promptly with one stable import ID and an idempotent queued job; support Continue in Background. Execute in bounded batches initially 10–25 rows, performance-tested in staging. A separate transaction per successful row includes menu master, branch settings, row ledger and durable outbox event. Lock overlapping imports by tenant and overlapping branches to prevent competing writes. Resume after crashes using row idempotency instead of restarting the whole file.
5. PROGRESS. Persist counters and monotonic revision; progress bar derives exclusively from terminal database row outcomes. At least two actual observed completion samples are needed before showing an estimated remaining time; otherwise display Calculating. For paused jobs display Paused, and for held rows display Waiting for Review. Stop at 99% until final authoritative verification.
6. LIVE MENU. After each committed row, authenticated tenant-and-branch scoped event notifies connected clients; update catalogue and move that row from Pending to Imported. Fall back to bounded polling while active and use revision-based catch-up after reconnect. Success toast only after complete verification; partial success presents a permanent exception summary and downloadable row errors.

## Database/state contract
Import states: DRAFT, VALIDATING, REVIEW_REQUIRED, READY, QUEUED, RUNNING, WAITING_FOR_REVIEW, VERIFYING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED, CANCELLED.
Row states: PENDING, VALIDATED, WAITING_FOR_REVIEW, READY, APPLYING, CREATED, UPDATED, SKIPPED, FAILED.
Row ledger unique (tenant_id, import_id, row_number); import lease scoped by tenant and overlapping branch(es); item unique within tenant by normalized code; explicit optimistic version check for approved material changes. Ensure an immutable source snapshot is separate from operator decisions and outcomes.
Progress response: id, total, processed, created, updated, skipped, needsReview, failed, pending, verified, revision, startedAt, updatedAt, workerStatus. processed = created + updated + skipped + failed. Needs-review rows are not considered imported. Store real processing timestamps for ETA.
Use an outbox inside each transactional row commit; event dispatch AFTER commit. Queue delivers at least once and ordering is not guaranteed; handle duplicates and out-of-order events.

## Performance and safety
Keep CPU-heavy file parsing and hundreds of SQL statements out of the HTTP hot path. Cap queue concurrency, prefer dedicated heavy-import queue over sharing with financial workflows; initial batch size one Queue message per worker invocation with bounded row batches. Control Postgres connection usage and use indexes (tenant_id, import_id, row_number/status).
Never allow 503 or lost commit response to clear the existing import identity or show Commit again. Resume the same import. Publish accurate error messages and a recoverable manual-edit workflow.
Health must verify ACTUAL Cron dispatch, consumer acknowledgements and a worker round-trip; binding existence alone is not readiness.
Prevent client auto-retry storms and repeated full-session/bootstrap fetches after a server-level 503; expose temporary-unavailable UI with bounded reconnect.

## Rollout gates
1. Confirm staging Workers CPU plan and limits; current logs show ~12–13 ms CPU-limit failures on session and import-preview requests. Paid plan can provide CPU headroom, but cannot replace workload optimization.
2. Take and VERIFY a staging backup. Identify and quarantine redundant queued imports only after owner approval; retain snapshots and audit trails. Do NOT arbitrarily delete or replay existing jobs.
3. PR #53 must register actual Nitro Queue and Cron hooks, and deployed version must show real events, message acknowledgements and scheduler recovery in staging.
4. Benchmark 10/100/343-row fixtures under concurrent checkout and auth traffic. Test duplicate file and overlapping imports, tenant isolation, manual corrections, meaningful ETA, partial failures, race, retry after crash, idempotency, stale catalogue, branch activation, poison message and DLQ.
5. Verify real POS menu visibility as rows commit, audit reconciliation and end-to-end import after service recovery. Production promotion requires separate credentials and data; never bulk-copy staging test transactions.

## Industry references
Cloudflare Worker limits: https://developers.cloudflare.com/workers/platform/limits/
Cloudflare Queue ack and retries: https://developers.cloudflare.com/queues/configuration/batching-retries/
Cloudflare DLQ: https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
Toast menu bulk import and partial errors: https://support.toasttab.com/en/article/Getting-Started-Menu-Bulk-Import-Tool-with-Multi-Location-Management