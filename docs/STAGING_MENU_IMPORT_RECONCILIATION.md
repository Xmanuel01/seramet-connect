# Controlled staging menu-import reconciliation (28 September 2026)

**STAGING ONLY. Merging a PR does not change the staging database.**
The connected Supabase inspection credential is read-only. Do not change
staging data until an authorized full database backup has actually been
restored to an isolated database and a reviewer approves the current plan.

## Verified incident and disposition

The inspected staging database has migration 26, one CONFIGURING generic
bootstrap branch, and three unexecuted 343-row menu imports. Their three
SETUP_IMPORT_COMMIT jobs are PENDING with zero attempts or leases. There are
no matching menu-code writes from these previews in the authoritative menu.

| Masked import | Version | Finding | Proposed treatment |
| --- | --- | --- | --- |
| 0dbfc75ce14a | V1 CREATE | Older file: V1 and V3 differ in menuSection and templateVersion for all 343 rows and categoryCode in 337; other normalized values match | Supersede, retain rows and audit |
| c6b5a444b49a | V3 CREATE | Earlier V3; identical normalized rows to later V3 | Preserve as canonical **reference only**, not runnable |
| bdd509d51269 | V3 SKIP | Same file checksum, target, mappings and all 343 normalized rows as earlier V3 | Exact duplicate; retain rows and audit |

All three previews are explicitly UNSCANNED_STAGING. The V3 report metadata
differs only in cleanScan details; neither proves a real malware scan.
All three target the generic bootstrap branch rather than separately
configured Westlands and Ngong Road.

**Disposition:** administratively quarantine all three old imports/jobs while
retaining the earlier V3's full preview rows as the canonical reference. The
existing schema provides REJECTED as the non-runnable import terminal state
and DEAD_LETTER as the queue worker terminal state. Explicit audit reasons and
verification metadata distinguish these administrative dispositions from CSV
validation failures or attempted worker processing. All **1,029** original
preview rows remain, with no menu items committed or deleted.

A real malware scanner, correct branch configuration and a **fresh scanned V3
preview** are required before any new menu execution. The other **41
management-recalculation jobs are untouched** and must be reviewed separately.

## Operational steps

1. Freeze staging deployments and Queue/Cron processing. Do not retry imports.
   Review the current staging data and current GitHub code revision.
2. Take an authorized full staging backup and actually rehearse restore into an
   isolated database. Keep restricted restore-evidence reference and independent
   operator approval. This repository script does **not** perform or verify
   a backup, and setting an attestation without proof is prohibited.
3. Use a secure runner with SERAMET_ENVIRONMENT=staging and a staging-only
   SERAMET_POSTGRES_URL. Run:
       node scripts/reconcile-staging-menu-imports.mjs --plan
   This is a read-only REPEATABLE READ database transaction. Its output exposes
   only masked references, row/job counts and an exact SHA-256 snapshot hash.
4. Compare the dry-run with the findings above. The reviewed script checks
   three imports, 343 rows per import, the 337/343 legacy differences,
   exact V3 identity, the UNSCANNED status, single target bootstrap branch,
   migration version, zero applied rows/audits and three untouched jobs.
   A changed state causes refusal rather than an invented reconciliation.
5. After a real restored backup and **separate operator approval**, repeat
   with --apply using a staging-specific write credential and all these
   secure environment values (never commit credentials, and do not paste the
   restore evidence into public logs):

       SERAMET_RECONCILE_BACKUP_RESTORE_VERIFIED=true
       SERAMET_RECONCILE_RESTORE_EVIDENCE=<restricted-evidence-reference>
       SERAMET_RECONCILE_APPROVED_PLAN_SHA256=<exact-dry-run-sha256>
       SERAMET_RECONCILE_APPROVED_TENANT_REF=<dry-run-tenant-ref>
       SERAMET_RECONCILE_APPROVED_CANONICAL_REF=<dry-run-canonical-ref>
       SERAMET_RECONCILE_UNSCANNED_IMPORTS_WILL_NOT_REPLAY=true
       SERAMET_RECONCILE_OPERATOR=<authorized-operator>
       SERAMET_ENVIRONMENT=staging

   Apply rechecks the full fingerprint under one SERIALIZABLE transaction,
   locks affected rows, conditionally transitions all three imports to
   REJECTED and all three jobs to DEAD_LETTER, and appends three detailed
   immutable audit events. Any mismatch or failed postcondition rolls back.
   No preview rows, menu masters, existing branch settings or unrelated
   management jobs are changed.
6. Independently inspect the live database again after an authorized apply.
   Expect: zero COMMITTING imports among the original three, zero PENDING
   SETUP_IMPORT_COMMIT jobs among their associated jobs, 1,029 retained
   preview rows, three terminally quarantined jobs with zero attempts,
   three new SETUP_IMPORT_QUARANTINED audit events, and no new menu writes.
   If any of these is not true, **do not approve a staging release**.
7. Independently fix the real scanner, Supabase Data API exposure, Queue/Cron
   registration, branch setup and unrelated job backlog. Only then prepare a
   brand-new scanned V3 preview, choose correct branches and validate on a
   disposable tenant before executing the intended menu import.

## Failure or rollback

The transaction fails closed and rolls back automatically before COMMIT.
After COMMIT, do not change terminal jobs back to PENDING because existing
Cloudflare queue messages may be redelivered. Stop consumers, inspect the
incident audit and invoke the independently verified restore procedure if
required. Duplicate reconciliation alone never establishes staging readiness.
