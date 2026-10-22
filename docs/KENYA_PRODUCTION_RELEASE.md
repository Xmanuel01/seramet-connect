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

| Area                       | State    | Evidence / Missing Acceptance                                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Frontend/routing           | FIX      | Public dashboard loads; site runs development configuration.                                                       |
| Backend/Workers            | FIX      | Public readiness incorrectly reports success without production resources.                                         |
| Database/migrations        | BLOCKED  | Fresh production target and its cost must be verified; schema 30 required.                                         |
| Auth/authorization         | BLOCKED  | Supabase implementation exists; dedicated production Auth is not configured.                                       |
| Tenant/branch isolation    | BLOCKED  | Engineering tests exist; production negative-role tests not executed.                                              |
| Staff/PIN/device security  | BLOCKED  | Production membership, activation and revocation acceptance outstanding.                                           |
| Sales/accounting           | FIX      | Release notes record missing invoice-to-ledger posting; it is not resolved or re-certified by this patch.          |
| Menu/import/publication    | BLOCKED  | Existing staged pipeline; genuine production scanner not certified. Keep imports fail-closed.                      |
| Inventory/procurement      | BLOCKED  | Requires production schema, account mappings and authorized synthetic workflow.                                    |
| Closing/reconciliation/PDF | BLOCKED  | Immutable report implementation and local layout work retained; production reconciliation not executed.            |
| Payment providers          | BLOCKED  | No specific approval for real charges; verify each provider separately.                                            |
| Uber Eats                  | BLOCKED  | Test-app token/scopes succeeded; store list returned no stores; production access not granted.                     |
| Glovo/Bolt Food            | BLOCKED  | Partner approval, credentials and real contract acceptance still required.                                         |
| TendePay                   | DEFERRED | Owner has not completed registration; keep inactive.                                                               |
| Queues/Cron/import jobs    | BLOCKED  | No production bindings or executing consumer/sentinel verified.                                                    |
| Secrets/environment        | FIX      | Explicit production bindings and separate credentials required. Never copy staging secrets.                        |
| CI/CD                      | MISSING  | Existing CI and staging deployment are present; reviewed production release/migration workflow is not established. |
| Monitoring/recovery        | BLOCKED  | Production alerts, durable recovery point and isolated restore evidence unavailable.                               |
| Physical printing          | BLOCKED  | Only Microsoft Print to PDF was detected; real thermal output/recovery not certified.                              |
| Brevo reports/email        | BLOCKED  | Supabase SMTP does not provide Worker API configuration; live report delivery unverified.                          |
| Public privacy notice      | MISSING  | No public `/privacy` route found; operator identity and retention policy require confirmation.                     |
| Merchant OAuth             | MISSING  | Existing gateway has signed callbacks; Uber merchant authorization/state/code-exchange flow not found.             |

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

## Resource Authorization And Access

The owner approved proceeding with production setup and new resource costs during
the voice conversation. An actual project quote or subscription plan still could
not be retrieved: the connected Supabase tool returns a missing connection-link
error, the available CLI lists projects but not the organization subscription,
and browser automation was unavailable. No priced project was created without
its actual charge being established. This is an access/quotation blocker, not a
request to authorize another sandbox. Existing Supabase projects remain unchanged.

## Minimum Safe Execution Sequence

1. Confirm the organization's subscription and any charges for a **new** production
   project. Free quota is not an assumption; do not create a paid resource without
   owner approval. UI billing access was unavailable in this session.
2. Provision the authorized fresh database with a generated secret stored through
   protected channels. Verify project identity and emptiness before running SQL.
   Do not restore staging data, accounts or queued jobs.
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

- Confirm free eligibility or approve the actual new-database cost before creation.
- Provide final business/operator privacy details through approved configuration.
- Complete Uber test-store provisioning and obtain separate production approval
  before live merchant/order activation. Rotate the exposed test secret securely.
- Supply production provider configuration through secret management; approve
  any real financial test individually.
- Make the restaurant printer accessible for physical acceptance.

The seven-day objective is not evidence that these gates have passed. The release
remains NO-GO until mandatory database, accounting, recovery and deployed-workflow
acceptance succeed.
