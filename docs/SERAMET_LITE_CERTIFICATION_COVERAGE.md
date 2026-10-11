# Seramet Lite comprehensive certification: evidence contract

This document defines what the manually dispatched
`.github/workflows/seramet-lite-certification.yml` proves and, just as
importantly, what it **does not** prove. An isolated CI green run is not a live
staging or production release sign-off.

## Running the certification

GitHub Actions > **Seramet Lite Comprehensive Certification** > **Run workflow**.
The default run uses **only synthetic local/CI data** and has no credentials
for deployed PostgreSQL, Cloudflare or payment providers.

Inputs:

- `include_load=false`: normal engineering certification; set to true
  to add the existing load/resilience suites and consume more runner minutes.
- `check_staging_health=false`: do not contact staging by default. Set to
  true only on the `main` branch to perform **read-only HTTPS** operational
  and readiness checks through the protected `staging` GitHub environment.
  This does **not** invoke a staging browser test, create records or run
  database migrations.

No automatic push/PR trigger is installed, to avoid duplicate or unwanted
full-suite runs. The workflow requests `contents: read` only.

## Engineering coverage and evidence

| Workflow or architecture | CI evidence gate | Limitation |
| --- | --- | --- |
| Restaurant registration, onboarding and setup | All Vitest tests; local browser setup/settings test | Real Supabase signup/email and live tenant provisioning require protected staging acceptance |
| Staff identities, device access, PIN and branch permissions | All Vitest tests; local browser session and tenant/branch rejection tests | Local browser tests use development fixtures; real staging Auth is a separate existing acceptance workflow |
| Manual menu and branch activation | All Vitest tests; real SQL catalogue/branch-isolation verifier on disposable PostgreSQL | Live POS visibility still requires staging acceptance |
| Menu CSV upload, approval, batching, publication, retry and recovery | Local Playwright menu-import test; PostgreSQL worker/import verifier | Local scanner simulation is not certified genuine staging CLEAN evidence |
| POS draft/hold, dispatch and kitchen obligations | Two-terminal Playwright; PostgreSQL transaction verifier; all Vitest tests | Actual KDS displays and physical kitchen tickets require device acceptance |
| Invoice, cash, receipt and refund | PostgreSQL transaction verifier; all Vitest tests | Physical receipt printing remains manual |
| M-Pesa payment state, reconciliation rules and callback idempotency | Payment/unit/integration tests included in Vitest suite | Provider sandbox callbacks, credentials and settlement **not** certified here |
| Cash drawer, reconciliation, EOD and business-date accounting | PostgreSQL POS verifier; all Vitest tests | Live shift reconciliation and accounting sign-off required |
| Inventory, procurement, recipes, food costing, waste and stock counts | Existing Vitest domain tests | Operational inventory counts and provider/warehouse integration require human acceptance |
| CRM, loyalty, guest ordering, reservations and marketplace logic | Existing Vitest/integration tests | Actual external delivery/payment provider certification not included |
| Finance, management dashboards, reports and permissions | Existing Vitest tests; PostgreSQL transaction paths | UI totals on real staging data and accountants' review not certified |
| Multi-user concurrency, isolation, idempotency, offline replay | Dedicated Vitest concurrency/offline runs; two-browser test; two-connection PostgreSQL POS verifier | Real network disruption on pilot terminals still requires staging acceptance |
| Database migration versions 1–27 | Official migration runner on *disposable* PostgreSQL 17; exact ledger assertion | This never migrates deployed staging; staging may remain on 26 |
| Migration 27 RLS on four internal tables | PostgreSQL catalog assertion on the **fresh disposable** database | Fails until the migration 27 security correction is present in the tested ref |
| PostgREST public-schema lockdown guard and anonymous grants | Existing isolated security verifier against disposable `seramet_test` database | The guarded lockdown SQL is never applied to staging; deployed Worker role/consumer impact not proven |
| Worker compilation, queue and cron registration, source and credential policies | Source contracts; typecheck; lint; build; bundle audit; compiled queue/cron hook check | Actual Hyperdrive, Cloudflare Queues and scheduled delivery require live integration evidence |
| ESC/POS printer bridge and print idempotency | Logic tests included in Vitest | Does not prove paper output, correct Windows spooler mapping, or retry/reprint on hardware |
| Representative load and resilience | Existing load suites, only with `include_load=true` | Does not measure Cloudflare live capacity or vendor SLAs |
| Read-only deployed staging health | Only with `check_staging_health=true` on `main` | No transactional staging E2E; current schema can legitimately fail readiness |

The **All application unit/integration tests** step uses `npm test`, which runs
the existing Vitest suite as-is; this table identifies domain coverage already
represented in that suite and other verifiers. It is **not** a claim that
every route or external integration has its own independent automated E2E
test. Test failures, skipped tests and future coverage gaps must be reviewed
in the run logs.

## Release gates outside this workflow

A full pilot sign-off must separately record protected staging evidence for:

1. Verified Supabase owner onboarding, employee PIN and branch/device
   restrictions (existing `pilot-staging-acceptance.yml` is a starting point).
2. Disposable-tenant, server-authoritative menu -> order -> KOT -> invoice ->
   cash/payment -> receipt -> reconciliation -> EOD -> reporting across two
   deployed terminals, with permission and rollback evidence. **Not yet fully
   automated against live staging.** Require explicit approval for test-record
   writes before building/running this stage.
3. Genuine scanner CLEAN evidence bound to the exact uploaded object.
4. M-Pesa sandbox callbacks, delayed/duplicate/invalid events, settlement and
   cancellation.
5. Real printer/KDS output with hardware, missing paper, disconnect, reconnect
   and explicit audited reprint.
6. Real Cloudflare Worker/Hyperdrive/queue/cron delivery and secure
   Data API/RLS compatibility for the actual runtime identity.
7. Other enabled third-party marketplace, notification and finance providers.

Do not mark any of these gates as passed merely because isolated engineering
certification is green.

## Failure policy

- Do not dispatch the staging deployment or staging database migration workflows
  as part of this certification.
- Keep PostgreSQL integration tests fenced to disposable loopback CI databases.
- Do not use production/staging payment credentials in synthetic tests.
- Review the failing named job and Playwright failure artifacts; fix only
  evidenced failures before scheduling another run.
- A failing migration 27 RLS assertion is a legitimate release blocker,
  not something to bypass.
