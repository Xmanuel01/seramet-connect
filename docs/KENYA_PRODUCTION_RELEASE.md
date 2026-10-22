# Kenya Production Release

Initial execution evidence: 22 October 2026, Africa/Nairobi.

## Release Decision

**NO-GO.** The public site is reachable, but the deployed runtime is not a verified
production POS. No deployment, live database mutation, provider activation or
customer charge has been performed by this release work.

This is an initial, evidence-based readiness inventory, not a claim that every
page or workflow has been certified on production. Existing engineering results
remain separate from production acceptance.

## Verified Infrastructure

- `https://seramet.co.ke` serves an existing Seramet dashboard over Cloudflare HTTPS.
  Its existing purpose must be preserved until its replacement is approved and
  recoverable; a loaded homepage is not release acceptance.
- Its operational/readiness response reports `development` rather than production.
  The new read-only release verifier rejects that response despite HTTP 200.
- Existing Worker `seramet-connect` has assets and two protected secrets, but no
  Hyperdrive, work-queue or R2 bindings in its currently deployed version.
- Current deployment version: `71bac930-053b-4f81-9938-5fc2d95587d7`.
  This is a rollback reference, not proof that the old version is safe for trading.
- Cloudflare CLI authentication works. Required deployment resources have not
  been provisioned or charged to the owner.
- GitHub initially had only a `staging` environment and no production deployment
  workflow. This execution created a separate `production` environment with an
  explicit `main` branch deployment policy, without copying secrets or deploying.
  That branch policy is not independent review or proof of database recoverability.
  The existing configuration renderer supports a production target;
  staging's hard-coded identity/approval guards must not be repurposed or bypassed.
- The production environment now contains only the nonsecret public-origin variable
  `SERAMET_PUBLIC_ORIGIN=https://seramet.co.ke`. No database/provider secrets or
  approved release SHA have been copied into it.
- Supabase CLI project discovery works. `seramet-staging` is active; the separate
  project named `Seramet` is inactive. Other existing projects are not release
  targets and will not be modified.
- The owner-authorized **new** `seramet-production` project is now active in
  SafariX, whose subscription was verified as `free` through the official
  organization API using the existing CLI sign-in. No subscription upgrade or
  paid add-on was requested. The generated bootstrap password is retained in
  Windows Credential Manager, not a plaintext dump, repository file or log.
  The dedicated read-only Management API reports PostgreSQL **17.11** and **zero
  public tables**. No application migrations or records have been copied/applied.
  This read does not certify the Worker's eventual PostgreSQL/TLS path.
- The directive authorizes a fresh production database, **not** deleting,
  overwriting, restoring into or reusing either existing project.
- Repository-required schema version is **30**, with migrations 0001 through 0030.
  The earlier version-26/27 report is historical, not current live evidence.
- Production schema, RLS, grants, backup/restore and queue execution have **not**
  been verified. Staging's earlier job counts have not been re-certified and must
  not be copied or replayed into production.

## Initial Feature Matrix

The classification is for production-hosted acceptance. BLOCKED does not mean the
local implementation is absent. Do not convert inherited CI passes into live passes.

| Area                       | State    | Evidence / Missing Acceptance                                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| Frontend/routing           | FIX      | Public dashboard loads; site runs development configuration.                                                        |
| Backend/Workers            | FIX      | Public readiness incorrectly reports success without production resources.                                          |
| Database/migrations        | BLOCKED  | Fresh Free-plan target exists and is empty; schema 30 is not yet applied or certified on PostgreSQL 17.11.          |
| Auth/authorization         | BLOCKED  | Supabase implementation exists; dedicated production Auth is not configured.                                        |
| Tenant/branch isolation    | BLOCKED  | Engineering tests exist; production negative-role tests not executed.                                               |
| Staff/PIN/device security  | BLOCKED  | Production membership, activation and revocation acceptance outstanding.                                            |
| Sales/accounting           | FIX      | Source-linked invoice recognition implemented and focused-tested; combined PostgreSQL/lifecycle acceptance pending. |
| Menu/import/publication    | BLOCKED  | Existing staged pipeline; genuine production scanner not certified. Keep imports fail-closed.                       |
| Inventory/procurement      | BLOCKED  | Requires production schema, account mappings and authorized synthetic workflow.                                     |
| Closing/reconciliation/PDF | BLOCKED  | Immutable report implementation and local layout work retained; production reconciliation not executed.             |
| Payment providers          | BLOCKED  | No specific approval for real charges; verify each provider separately.                                             |
| Uber Eats                  | BLOCKED  | Test-app token/scopes succeeded; store list returned no stores; production access not granted.                      |
| Glovo/Bolt Food            | BLOCKED  | Partner approval, credentials and real contract acceptance still required.                                          |
| TendePay                   | DEFERRED | Owner has not completed registration; keep inactive.                                                                |
| Queues/Cron/import jobs    | BLOCKED  | No production bindings or executing consumer/sentinel verified.                                                     |
| Secrets/environment        | FIX      | Explicit production bindings and separate credentials required. Never copy staging secrets.                         |
| CI/CD                      | MISSING  | Existing CI and staging deployment are present; reviewed production release/migration workflow is not established.  |
| Monitoring/recovery        | BLOCKED  | Production alerts, durable recovery point and isolated restore evidence unavailable.                                |
| Physical printing          | BLOCKED  | Only Microsoft Print to PDF was detected; real thermal output/recovery not certified.                               |
| Brevo reports/email        | BLOCKED  | Supabase SMTP does not provide Worker API configuration; live report delivery unverified.                           |
| Public privacy notice      | MISSING  | No public `/privacy` route found; operator identity and retention policy require confirmation.                      |
| Merchant OAuth             | MISSING  | Existing gateway has signed callbacks; Uber merchant authorization/state/code-exchange flow not found.              |

## Corrections In This Branch

1. Public operational/readiness probes reject a development or test runtime.
   Loopback development and cheap liveness remain unchanged. Public development
   health requests cannot trigger local database initialization.
2. Operational/readiness responses include the build identity, allowing the
   release probe to reject an old deployment instead of accepting any HTTP 200.
3. `npm run verify:production` checks HTTPS, disables redirects, checks both health
   endpoints once, requires production environment, exact schema/build identity,
   authoritative database and queue availability, and reports sanitized failures.
   It performs only GET requests and never migrates, deploys or changes data.
4. The verifier explicitly leaves operational acceptance `NOT_PERFORMED`:
   bindings are not evidence of executing jobs, email delivery, printer output or
   provider approval. Its regression tests run in ordinary CI.
   The manual production verification workflow is read-only, restricts both the
   original and triggering actors to the owner on main, and uses the production
   concurrency group. It has no migration, deployment or secret-provisioning step.
   Set the production environment's `SERAMET_PUBLIC_ORIGIN` variable to the approved
   public origin only after reviewing the production target. An HTTP check passing
   this workflow is not permission to activate uncertified providers.
5. The official migration runner now requires certificate- and hostname-verified
   TLS for remote PostgreSQL URLs, rejects URI verification overrides and preserves
   local disposable CI connections. Migration SQL, sequencing and history remain unchanged.
6. Previously approved local invoice-label/report-layout work and the confirmed
   shared-day browser-test corrections are retained without changing financial
   amounts, historical snapshots or authorization boundaries.
7. Vite is patched from locked version 8.2.1 to exact version 8.2.4. The registry
   audit reported Windows editor command-execution and development-server file
   disclosure findings through 8.2.3, including
   [the high-severity Windows finding](https://github.com/advisories/GHSA-587h-7wmj-h5pm).
   This is a compatible patch, not a major upgrade or advisory suppression.
   `npm audit --omit=dev --audit-level=high` now reports zero known vulnerabilities.
   A clean audit does not certify that the deployed application is secure.
8. A separate owner-only production recovery workflow captures a consistent
   read-only application snapshot, retains authenticated encrypted artifacts and
   verifies restoration only in an isolated PostgreSQL 17 target. It is not a
   production restore or migration workflow. See [Production Recovery](PRODUCTION_RECOVERY.md)
   for required separate credentials, coverage limits and the remaining live gate.

## Current Certification Evidence

- Commit `e136c89a13e08bc4114e69ccac6e5f172142a180` passed GitHub validation
  (unit/typecheck/lint/build/bundle/security), financial PostgreSQL 16 and 17,
  menu PostgreSQL, CRM PostgreSQL, source policy and the two-terminal browser
  workflow. These results do not certify subsequent recovery changes; the final
  combined commit must receive new checks.
- The bounded local full-suite run completed with 1,141 passes and three failures:
  two five-second timeouts and the draft-account-approval regression during an
  in-progress edit. The corrected code passed all 35 tests in the affected three
  files serially, without longer timeouts or weaker assertions. This focused
  rerun does not turn the failed aggregate run into a pass.
- New recovery unit tests cover actor/rerun authorization before secret access,
  approved identity, dedicated read-only login, TLS overrides, isolated restore
  target, evidence freshness/integrity, authenticated encryption and safe errors.
  Ordinary CI includes an actual PostgreSQL 17 encrypted restore fixture. This
  fixture contains synthetic local records, not a production recovery point.
- Native production recovery inspection found zero backups and PITR disabled.
  The manual production workflow has not been dispatched and its separate backup
  credential, trust root, encryption key and approved main revision are not yet
  configured. Production migration and live recovery remain **BLOCKED**.
- Cloudflare's automatic PR build completed, but its deployment inventory still
  points to the pre-existing October 20 version. Build success is not deployment
  evidence and did not change the live site.

## Resource Authorization And Access

The owner approved proceeding with production setup and new resource costs during
the voice conversation. The connector and browser were unavailable, but the
official Management API was accessed using only the existing CLI credential in
memory. The organization is on the Free plan and had one active project before
creation; the provider accepted the second Free project. No plan change or paid
add-on was used. Existing projects remain unchanged. Free-plan availability is
not a production SLA or evidence of backup retention; recovery must be certified
separately before trading. See [Supabase's billing policy](https://supabase.com/docs/guides/platform/billing-on-supabase).

The native production backup API currently reports **zero backups** and **PITR
disabled**. No recoverability claim is made. The staging-only backup/migration
guards are unchanged and must not be bypassed or pointed at production.

## Invoice-To-Ledger Correction

The existing payment journal debits the collection account and credits a
receivable. Ordinary invoices were missing the other half: a source-linked
`POS_INVOICE` journal establishing that receivable against sales, tax and service.
The correction adds this projection to the existing atomic repository batch;
it does not introduce another ledger or change invoice amounts.

- Staging/production API and integration repository factories require posting.
  Disposable legacy-domain tests can retain their previous repository mode;
  explicit strict-mode regression tests exercise the production behavior.
- Account mappings are tenant/branch scoped, approved by finance, active, correctly
  classified and currency-matched. A pending branch override never falls through
  to a tenant approval. `CUSTOMER_RECEIVABLE` is now a required onboarding mapping.
- An invoice records its approved account mapping and verified financial
  components in the normalized persisted snapshot. Historical invoices without
  such evidence require explicit reconciliation; there is no automatic backfill.
- For KSh 124 comprising KSh 100 net sales, KSh 10 service and KSh 14 tax,
  issuance debits receivables by 12,400 minor units and credits the three component
  accounts by 10,000, 1,000 and 1,400. Cash collection debits cash by 12,400 and
  credits the same receivable by 12,400: zero remaining receivable, no duplicate revenue.
- Payment allocation must use the same receivable, branch and currency as the
  invoice. Existing house-account credit-control records do not post a second
  revenue journal once issuance owns recognition.
- Unpaid split/merge/void reverses the source invoice once. Paid invoices cannot
  be silently voided; posted amounts cannot be overwritten. Closed-period and
  immutable-journal protections remain enforced.
- Invoice projection, journal lines, posting, authoritative state, mutation
  identity and revision commit together; a posting failure rolls the batch back.
- The disposable financial PostgreSQL job now covers both versions 16 and 17,
  including actual invoice issuance and orchestrated cash collection. New results,
  not older finance passes, are required for acceptance.

This correction is not certification of every refund, foreign-currency,
marketplace settlement or credit-note path. Those and the complete closing
lifecycle remain release gates; partial focused success is not a live-sales GO.

## Minimum Safe Execution Sequence

1. **Complete:** verified the Free subscription and created the dedicated project
   without changing the plan. Any future paid upgrade/add-on requires its own quote.
2. **Complete:** generated and securely retained a new database bootstrap secret;
   verified the target identity and absence of application tables through a read-only
   query. Do not restore staging data, accounts or queued jobs.
3. Validate current database/driver compatibility, verified TLS and pooling.
   Use `scripts/migrate-postgres.ts` for the complete authoritative migration
   sequence; do not manufacture migration history or use staging-only guards on
   production. Apply appropriate grants/RLS before exposing the application.
4. Certify schema 30, foreign keys, immutable records, transactional rollback,
   negative roles, tenant/branch isolation and intended Worker access. Establish
   encrypted durable recovery and demonstrate restoration in an isolated target.
5. Resolve and reproduce the invoice-to-ledger accounting issue, then certify a
   synthetic sale through payment, inventory, ledger and daily closing. Do not use
   real customer payments as a diagnostic test.
6. Configure independent production Auth, Hyperdrive, private R2, work queue/DLQ,
   Cron and server secrets. Keep unverified imports/providers inactive. Inspect
   and preserve current domain routing and record an application rollback point.
7. Use normal review/merge controls and an explicitly authorized production
   release. The release branch is based on the existing draft pilot integration;
   it does not authorize merging that integration or its older overlapping PRs.
8. Run the exact-build production health gate, followed by controlled synthetic
   account/branch/menu/sale/PDF/closing and authorization tests. Verify queue
   consumer execution and production logs independently of binding checks.
9. Connect Uber test stores only after provider-side provisioning and scoped
   branch mapping. The requested short webhook and OAuth paths are not presently
   certified and must not be advertised as working URLs. Reuse the authoritative
   gateway; do not create a competing webhook or order engine.

## Current Production Probe

The read-only verifier rejected the existing domain with:

```text
NOT_PRODUCTION_ENVIRONMENT
STALE_DATABASE_SCHEMA
DATABASE_NOT_AUTHORITATIVE
DURABLE_QUEUE_UNAVAILABLE
DEPLOYED_BUILD_MISMATCH
```

`STALE_DATABASE_SCHEMA` means the required version was not demonstrated by the
response; it does not claim that a particular unknown production schema was read.
No production schema was modified or reset.

## External Actions Still Required

- Establish durable production backups and isolated recovery; the Free project
  must not be described as recoverable merely because it exists.
- Provide final business/operator privacy details through approved configuration.
- Complete Uber test-store provisioning and obtain separate production approval
  before live merchant/order activation. Rotate the exposed test secret securely.
- Supply production provider configuration through secret management; approve
  any real financial test individually.
- Make the restaurant printer accessible for physical acceptance.

The seven-day objective is not evidence that these gates have passed. The release
remains NO-GO until mandatory database, accounting, recovery and deployed-workflow
acceptance succeed.
