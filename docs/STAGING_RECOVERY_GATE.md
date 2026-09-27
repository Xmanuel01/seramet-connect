# Staging recovery and controlled-release gate

**Scope:** Seramet staging only. Do not run against production or delete pending jobs.
This document describes the explicit safety conditions for the 27 September 2026
queue/import incident. A passing source build is **not** staging acceptance.

## Verified facts and remaining unknowns

- Audited `main` CI was green; the last main staging deploy failed **before Worker
  upload**, because the required scanner service name was absent.
- Older deployment workflow migrated PostgreSQL before Cloudflare binding discovery.
  The proposed repair reorders preflight ahead of migration.
- PR descriptions **report**, but this change has **not re-measured**, three
  overlapping 343-row imports plus 41 pending management jobs, and CPU 503s.
- Nitro Queue/Cron hook restoration (#53) and durable 101+ item import (#52) are
  independently reviewed changes, not assumed to be active.

## Safe recovery checklist

1. Freeze staging deployments and do not click Retry import.
2. With authorized read-only Cloudflare access, record sanitized current Worker
   version/build ID, Queue consumer and Cron bindings, 503/CPU events and
   Hyperdrive errors. Do not export tokens, customer data or secret values.
3. Confirm the actual PostgreSQL authority and its deployed migration version.
   Run `node scripts/inspect-staging-backlog.mjs` using staging-scoped
   `SERAMET_POSTGRES_URL` and `SERAMET_ENVIRONMENT=staging` inside an
   authorized secure runner. The script uses `BEGIN READ ONLY`, emits aggregate
   counts only, and blocks overlapping committing menu-file groups.
4. Obtain a verified staging backup **and rehearse restore to an isolated database**.
   Preserve immutable import and event audit rows. Record backup time,
   coverage and the independent restore evidence in a restricted operations log.
5. Inspect the actual import IDs, target branches, normalized item-code overlap
   and associated job IDs within authorized staging DB access, without copying
   private payloads to CI logs. Decide which *one* import may be completed.
   Require separate explicit approval for any auditable quarantine of the
   others. Review each of the reported management jobs for safe replay.
6. Provision a real internal malware-scanner Worker on the correct Cloudflare
   account. It must expose the expected RPC `scan({bytes,contentType,fileName})`
   contract and return `CLEAN`, `INFECTED`, or `ERROR`. A stub returning
   `CLEAN` is forbidden. Verify clean and non-clean fixture behavior and fail
   closed on timeouts, malformed output and service unavailability. Configure
   the staging `SERAMET_MALWARE_SCANNER_SERVICE` variable to its deployed
   script name; the pipeline independently checks that Worker exists.
7. Independently review #53 hook wiring and compiled-event checks and #52
   durable import tests. Do not activate workers until the stale/duplicate
   job disposition is approved and replay-idempotency is checked.
8. Approve *only the exact new release commit*: staging GitHub environment
   variables `SERAMET_STAGING_APPROVED_SHA=<exact 40-character release SHA>`,
   `SERAMET_STAGING_BACKUP_RESTORE_VERIFIED=true`, and
   `SERAMET_STAGING_BACKLOG_REVIEW_APPROVED=true`.
   Flags attest to a documented human review; they do **not** perform backups
   or quarantine. A new commit invalidates the SHA approval. Use GitHub
   environment protection and limit who can change these variables.
9. Run the staging deployment. The workflow now verifies resources and
   approvals, reads pending job/import aggregate counts and only then runs
   migrations or modifies Cloudflare settings. If any check fails, do not
   bypass the gate: investigate and rerun for that exact SHA.
10. Observe one isolated approved sentinel through Queue/Cron exactly once.
    Validate oldest-job lag, retries, failed jobs and dead letters. The
    `/health/ready` guard rejects work more than 30 minutes overdue; this
    is **not** proof of consumer correctness without a successful sentinel.
11. Execute one approved 343-row V3 Mona test import on a disposable staging
    tenant with Westlands and Ngong Road selected and appropriate KITCHEN/BAR
    stations. Verify one tenant master per item code and branch activation.
    Then run the restaurant end-to-end cash/simulated-payment/stock/GL oracle.

## Release controls and rollback

- Never automatically re-enqueue, delete or mass-retry existing pending jobs.
- Keep staging credentials server-side; never paste connection strings into
  tickets, chat or logs.
- Failed preflight **must precede** the database migration step.
- Migrations require a reviewed expand/contract compatibility and recovery
  strategy, not merely a green CI run. Staging-only data fixes need a distinct
  approved change and reversible plan.
- The scanner service must actually work at the RPC boundary; naming an
  unrelated Worker does not satisfy this requirement.
- Keep real Daraja/Pesapal merchant transactions disabled until the internal
  POS→receipt→stock→GL→EOD test and duplicate-callback negative cases pass.
