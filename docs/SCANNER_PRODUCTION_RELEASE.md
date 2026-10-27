# Guarded scanner production release

## Candidate identity

Use the combined scanner candidate, not PR 160 alone. PR 160 starts at old main
and omits the validated financial/recovery corrections and newer release gates.
The combined candidate retains that validated release, the registration/onboarding
corrections, pinned Zod 4.6.7/Vitest 4.1.12 and repaired dependencies, then ports
only the queue-verification correction. It adds environment-isolated scanner
configuration and a scanner-only staging mode. No schema migration is added.

Record the final 40-character head SHA and main-targeted combined PR number in
the owner approval package after every required check finishes successfully.
An uploaded Cloudflare preview is not an active production deployment.

## Environment separation

| Resource | Staging | Production |
| --- | --- | --- |
| Primary Worker | seramet-staging | seramet-connect |
| Scanner Worker | seramet-file-scanner-staging | seramet-file-scanner-production |
| Private R2 bucket | seramet-staging-objects | seramet-production-objects |
| Scan queue | seramet-staging-file-scan | seramet-production-file-scan |
| Scan DLQ | seramet-staging-file-scan-dlq | seramet-production-file-scan-dlq |
| Scanner ID | seramet-clamav-staging | seramet-clamav-production |

Quarantine objects retain the existing tenant-scoped private object keys and
PENDING_SCAN/QUARANTINED status. Neither bucket may have enabled r2.dev access
or custom public domains. Verify these properties again before promotion.
Production keeps its existing live database and work/DLQ pair, never staging or
the older unused production database/queues. Configuration generation enforces
these existing resource identities and rejects preview-variable reuse.

Generate a distinct cryptographically random scanner evidence key (at least
32 bytes) per environment. Store it only in the corresponding protected GitHub
environment and Worker secrets. Share it between that environment's scanner
and primary Worker only. Do not copy staging keys to production or log them.
Production deployment credentials must be protected separately and authorize
only the required Worker/R2/Queue/Container operations on the intended account.

## Exact owner approval

Follow [the solo release policy](SOLO_RELEASE_POLICY.md). The owner must post
an unedited comment on the combined main-targeted PR, with the exact tested SHA,
fresh UUID v4 and UTC expiry no more than two hours after comment creation.
Staging and production-promotion are separate approvals; no status is synthesized
from a general instruction to proceed.

The operator validates the actual owner comment using:

```powershell
node scripts/solo-release-approval.mjs --pr PR_NUMBER --comment-id OWNER_COMMENT_ID --sha EXACT_SHA --scope staging
```

For production, only after staging certification and recovery pass:

```powershell
node scripts/solo-release-approval.mjs --pr PR_NUMBER --comment-id OWNER_COMMENT_ID --sha EXACT_SHA --scope production-promotion --publish-production-status
gh pr merge PR_NUMBER --repo Xmanuel01/seramet-connect --merge --match-head-commit EXACT_SHA
```

Do not use admin bypass, weaken required checks or reuse a stale approval. Before
deployment, independently verify the actual PR head, merged main ancestry and
source-tree equality with the approved commit. Deploy the approved SHA, not an
unrelated latest main build. Stop if any identity differs.

## Staging certification

1. Complete fresh encrypted backup/isolated restore and backlog/security review.
   Preserve the historical no-replay holds and old transport DLQ. Only after
   verification and exact staging approval may the protected staging approved-SHA
   variable be advanced. Do not merely set verification flags to obtain a pass.
2. Confirm Containers authorization, an existing Workers Paid subscription and
   the owner's extra-spending limit. Do not change subscriptions or exceed it.
3. Dispatch the existing staging workflow on the exact combined candidate:

```powershell
gh workflow run deploy-staging.yml --repo Xmanuel01/seramet-connect --ref codex/scanner-production-release -f maintenance_only=false -f scanner_only=true -f release_pr=PR_NUMBER -f owner_approval_comment_id=OWNER_COMMENT_ID
```

This mode deploys the existing app and isolated scanner/queues, not database
migrations, Hyperdrive credential changes or payment/delivery-provider secrets.
Every approval, backup/backlog and database security gate remains mandatory.

4. In a dedicated identifiable staging test tenant, exercise the real deployed
   scanner, not fabricated signed verdicts:

| Case | Required evidence |
| --- | --- |
| Clean menu CSV | Matching object version/SHA, actual ClamAV engine/signature versions, authenticated CLEAN verdict, one parser execution and valid preview |
| Standard EICAR test CSV | Actual INFECTED verdict, quarantined object, zero preview/parser/publication and no menu/inventory mutation |
| Engine unavailable/timeout | Bounded retry and terminal ERROR/DLQ evidence, retained quarantine, zero parser/publication |
| Tampered object/evidence and duplicate delivery | Rejection of wrong hash/version, expired/replayed evidence and no duplicate import |

Record job/correlation IDs, expected/actual results, timestamps, retries and scan
duration. Do not replay old jobs. Never send EICAR to production or a real tenant.
Unit tests using synthetic verdicts do not certify this deployed scanner.

## Production rollout

Production promotion remains blocked until the staging evidence above passes,
all exact-head CI passes, a fresh production recovery point/isolated restore is
verified and the actual production owner approval is recorded.

Record the active deployment/version and its bindings, not merely the latest
uploaded version's settings. Capture the current application/queue health and
rollback version before any write. Generate both configurations explicitly:

```powershell
node scripts/render-scanner-cloudflare-config.mjs production
node scripts/render-cloudflare-config.mjs production
```

Provide all production-specific variables from verified production resources;
do not use SERAMET_REUSE_EXISTING_VARS or borrow staging configuration. Create
only the identified production scan queue/DLQ if absent, and retain private
quarantine storage. Provision the new scanner Worker/container with its production
key before connecting the primary application's scan producer.

For the primary Worker, upload the approved artifact/configuration and protected
secret file as one version, inspect that exact version's build/bindings, then
promote only its recorded version ID. With a pinned Wrangler version supporting
the documented secrets-file flag:

```powershell
npx --yes wrangler@4.153.0 versions upload --config .seramet/wrangler.generated.json --secrets-file PROTECTED_PRODUCTION_SECRETS_FILE
npx --yes wrangler@4.153.0 versions deploy VERIFIED_VERSION_ID@100% --config .seramet/wrangler.generated.json
```

The secret file must be temporary, access-restricted, outside the repository,
and removed after use. Preserve existing authentication secrets. Do not run
plain secret put/delete against an unpromoted preview: those commands can
activate a version immediately. Verify actual deployed build ID, authoritative
production schema, authentication and active bindings after promotion.

## Production test tenant and rollback

Only after promotion succeeds, use a dedicated SERAMET-QA-WESTLANDS tenant with
identifiable TEST-QA transactions. Validate login, setup, a harmless clean import,
menu/inventory, order/KOT/kitchen, billing, receipt and reconciliation. Capture
stock, payment and ledger totals and evidence after reload. Use provider sandbox
payments only, never actual customer charges or globally enabled fake adapters.
No provider approval, physical printing or settlement success is inferred.

If scanning is absent, unhealthy, unverified or returns invalid evidence, imports
stay unavailable/quarantined; do not override the scan gate. On failed rollout,
restore the recorded known-good application version, disable only the new scanner
consumer if needed, retain objects/jobs/audit history and investigate. Do not
restore over live databases, delete evidence, mark unsafe imports clean or replay
historical jobs. Application rollback does not undo external storage mutations.

References: [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[versions/deployments](https://developers.cloudflare.com/workers/versions-and-deployments/),
[container pricing](https://developers.cloudflare.com/containers/platform/pricing/).
