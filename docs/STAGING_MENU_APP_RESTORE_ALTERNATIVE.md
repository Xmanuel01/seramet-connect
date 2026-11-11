# Independent application-only staging recovery alternative

INCIDENT-SPECIFIC and STAGING-ONLY. This is a separate recovery route, not
an amendment or exception to the original full-restore procedure.
The original docs/STAGING_MENU_IMPORT_RECONCILIATION.md and
scripts/reconcile-staging-menu-imports.mjs remain unchanged and keep
requiring a full, independently verified isolated database restore.

## Explicitly limited evidence

Owner-provided evidence from 2026-09-28:
- Original private custom-format full logical archive:
  SHA256 95E5C05D8FD0D421DC5EBA7CECA49E914E72D46A62CFECAC7563677512BB1B43,
  1,705,540 bytes, archive table-of-contents and decompression passed.
- Initial full restore to plain local PostgreSQL failed because it lacked
  Supabase-specific supabase_vault. This failure was NOT a successful full restore.
- A second isolated local PostgreSQL 18 restore of only the public schema
  completed with --single-transaction and --exit-on-error, exit code 0.
  Placeholder local NOLOGIN authenticated and anon roles were needed.
- Local application counts: 10 menu imports, 3,088 preview rows,
  3 import jobs, 8 existing menu items.
  Every one of the 3 affected imports has exactly 343 unchanged preview rows.
- A prior independent staging read-only plan fingerprint was
  a7fb93005c0176decfcb3e94152d39a96ae17da35ba6bcff017ad8a7059c3481.

This evidence does NOT prove recovery of Supabase Auth, storage objects,
managed extensions or other platform services, configuration, secrets,
Cloudflare assets, or R2. It is only for the identified 3-import incident.
Supabase documents why raw pg_dump archives can contain incompatible managed
components and recommends filtered Supabase CLI dumps for general migrations:
https://supabase.com/docs/guides/self-hosting/restore-from-platform

The source-state pre-dump query and full dump were not a single transaction.
The alternative tool therefore verifies the source archive SHA256 itself,
inspects ACTUAL local restored public tables, inspects CURRENT staging, and
compares complete 1,029-row incident plan fingerprints before authorizing
any staging write. An altered row, mismatched count, new job, altered branch,
changed schema, mismatched backup or incomplete permissions fails closed.

## Implementation and security controls

Separate code files:
- scripts/staging-app-recovery-guards.mjs: exact immutable scope,
  archived SHA256, known global totals, expected prior plan fingerprint,
  local-only restored target, exact staging host and TLS verify-full.
- scripts/reconcile-staging-menu-imports-app-restore.mjs: read-only --plan,
  guarded --apply, independent read-only --verify. All three use the
  incident-specific verified schema and unchanged existing plan validator.
- scripts/run-staging-app-recovery.ps1: private, separate STAGING and LOCAL
  credential prompts; securely scoped environment and certificate path.
- scripts/verify-staging-menu-app-recovery.sql: independent psql-only
  read-only post-verification, separate from the updater.
- scripts/staging-app-recovery-guards.test.mjs: negative and positive guards.

Only --apply writes. It requires the original archive on the operator's
computer, successful local/staging fingerprint agreement, exact plan/evidence
approval, actual staging Queue/Cron freeze acknowledgment, authorized import
owner identity, and staging-only write credentials. It obtains a SERIALIZABLE
transaction, the same advisory lock as the original tool, row locks, and
checks each conditional update and postcondition before COMMIT.

The only permitted updates are exactly the 3 known setup_imports records
(COMMITTING to REJECTED, marked administrative quarantine) and their
3 previously unattempted worker_jobs (PENDING to DEAD_LETTER).
It appends one structured audit_events record per import. All 1,029 preview
rows, 8 existing menu items, bootstrap branch and the unrelated 41
management jobs stay unchanged. The earlier V3 CREATE becomes a canonical
REFERENCE ONLY, never runnable. Old expired, UNSCANNED_STAGING imports must
never replay. A real malware scanner and fresh scanned V3 preview are
needed before any new menu execution.

## Operator steps: no staging write until independent review

1. Actually PAUSE staging Cloudflare Cron, Queue consumers and deployments.
   Freeze manual import retries. Verify this outside the script, retain
   restricted evidence, and keep consumers paused through verification.
2. Keep the private archive and manifest in their original location. Do
   not upload the backup or passwords to GitHub, ChatGPT, or support logs.
3. Create a fresh worktree to avoid your POS branch and original tool:

       cd "$HOME/Desktop/seramet-connect"
       git fetch origin fix/staging-app-restore-audited-alternative
       git worktree add --detach "$HOME/Desktop/seramet-app-recovery" origin/fix/staging-app-restore-audited-alternative
       cd "$HOME/Desktop/seramet-app-recovery"
       npm ci --omit=dev --ignore-scripts --no-audit --no-fund
       node --test ./scripts/staging-app-recovery-guards.test.mjs

4. Run the evidence-bound READ-ONLY plan, entering separate local and
   staging passwords only at their private native prompts:

       powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME/Desktop/seramet-app-recovery/scripts/run-staging-app-recovery.ps1" -Mode Plan

   Confirm: plan SHA a7fb93005c0176decfcb3e94152d39a96ae17da35ba6bcff017ad8a7059c3481,
   tenant ref bf9879539d6c, canonical V3 ref c6b5a444b49a,
   3 unattempted queued jobs, 1,029 incident preview rows, the
   expected archive SHA256, and 10/3088/3/8 global totals in BOTH
   local restore and staging. Record restoreEvidenceSha256 from this output.
   If any count, fingerprint, scan status or branch differs: STOP. Do not
   edit the expected constants to force a pass.

5. A separate reviewer checks the archive manifest, original isolated
   public-schema restore exit code and counts, script/SQL diff, dry-run
   fingerprint, the live staging state, and actual Cloudflare freeze.
   This is an explicitly narrower application-data risk decision. It does
   not mean the original full-restore requirement was satisfied.
6. After the owner's previously documented three-import scope approval
   AND that independent review, the responsible operator may run:

       powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME/Desktop/seramet-app-recovery/scripts/run-staging-app-recovery.ps1" -Mode Apply -EvidenceSha256 "PASTE_EXACT_RESTORE_EVIDENCE_SHA256_FROM_STEP_4"

   The script demands an explicit FROZEN statement only after actually
   checking staging consumers, an exact APPROVE_THREE_STAGING_IMPORTS_ONLY
   typed confirmation, the separate private credentials, and the actual
   authorized import creator ID (from read-only source:
   d8fb62a3-97bb-457d-8a1c-f37b203c3048). It recomputes all evidence
   and the entire plan under the final transaction.
7. BEFORE restarting ANY Cloudflare consumer, run both verifiers:

       powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME/Desktop/seramet-app-recovery/scripts/run-staging-app-recovery.ps1" -Mode Verify

   Independently cross-check with psql, using verified staging SSL
   certificate and the private interactive password prompt:

       $env:PGSSLROOTCERT = "$HOME/Downloads/seramet-staging-ca.crt"
       $env:PGSSLMODE = "verify-full"
       psql -h aws-1-eu-west-1.pooler.supabase.com -p 5432 -U postgres.vnymbavsbxorwxpebkot -d postgres -W -v ON_ERROR_STOP=1 -f ./scripts/verify-staging-menu-app-recovery.sql
       Remove-Item Env:PGSSLROOTCERT,Env:PGSSLMODE -ErrorAction SilentlyContinue

   BOTH must pass. Expected: 3 quarantined imports, 3 DEAD_LETTER
   unattempted jobs, 3 correct audit events, 1,029 intact original
   preview rows, 8 unchanged menu items, 10 historic import records
   and 3,088 total preview rows. The 41 unrelated pending management
   jobs must remain untouched. Retain sanitized verification outputs
   and exact repository commit for an audit reviewer.

## Stop/rollback and next steps

If --plan or --apply refuses: do not bypass guards or repeat blindly.
Pre-commit failures roll back the entire SERIALIZABLE transaction.
If the process disconnects after commit, independently --verify first
rather than assuming rollback or success. NEVER set quarantined jobs back
to PENDING: prior Cloudflare messages may still exist. Preserve the archive.

Quarantine does not make staging release-ready. Keep the Queue/Cron paused
until the real scanner, proper Westlands branch mapping, durable worker
deployment and separate 41-job management backlog are independently
addressed. Then create a brand-new, genuinely scanned V3 preview and
test it on a disposable tenant before applying a fresh menu import.
