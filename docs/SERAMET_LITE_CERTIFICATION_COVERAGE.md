# Seramet Lite engineering certification: evidence contract

The `Seramet Lite Comprehensive Certification` workflow is **manual-only**
and uses isolated synthetic data by default. A passing CI run is NOT a
deployed-staging acceptance or a production release authorization.

## Six non-overlapping certification gates

| Gate | Evidence | How it runs |
| --- | --- | --- |
| `contract` | Pinned actionlint, Lovable/source-policy checks, route/API evidence inventory, unexpected skipped/todo/focused tests, seven-load-suite inventory | Every comprehensive run; also a cheap automatic PR workflow |
| `application` | Typecheck, ESLint, `npm audit --omit=dev --audit-level=high`, the entire **non-load** Vitest suite once, recovery/policy script tests, deployable build and bundle audit, Cloudflare Worker queue/cron contract check | Once per manual certification |
| `browser` | Three existing local-fixture Playwright specifications for auth/settings, menu import and two-terminal POS, with a JSON result and failure traces | Once per manual certification |
| `postgres` | Disposable PostgreSQL 17 with three **separate** databases: POS; Finance; menu/import/CRM/schema-27 RLS and guarded lockdown. All eight specific verifiers execute once | Once per manual certification, never against a deployed DB |
| `load` | All seven distinct `src/**/*-load.test.ts` suites (single load-only Vitest invocation) | **Off** unless `include_load=true` |
| `staging-health` | HTTPS operational and ready health endpoints only, no writes | **Off** unless `check_staging_health=true`; only on protected `main` |

The standard Vitest config explicitly excludes `*-load.test.ts`.
`vitest.load.config.ts` includes only those seven suites, and existing
individual load npm scripts continue working through the dedicated config.
The comprehensive workflow does NOT re-run concurrency/offline Vitest subsets,
nor does it re-run menu-import PostgreSQL from two separate jobs.

The optional load and staging steps must be marked NOT REQUESTED unless
selected; unexpected required skips/failures or missing evidence fail the
aggregate result. All GitHub Actions use repository `contents: read` and
`persist-credentials: false`; the only database credentials are synthetic
loopback CI credentials. The optional staging HTTPS check uses the protected
staging environment URL and does not receive a PostgreSQL secret.

## Automatic, cheap PR contract

`.github/workflows/seramet-certification-contract.yml` runs on relevant PR
changes without `npm ci`, browsers, Docker databases or the comprehensive
suite. It checks:

- GitHub workflow syntax via pinned `actionlint`.
- Branch ancestry against the latest remote `main` fetched during checkout;
  a behind/diverged branch fails closed.
- Explicit classification of every discovered `src/routes/**/*.ts(x)` and
  `src/server/**/*-api.ts` entry in
  `certification/coverage-manifest.json`.
- No unexpected focused, todo/fixme or skipped test declarations.
- Exactly seven load files and correct Vitest config partitioning.
- Existing pilot source policies and unsupported integration guard tests.

The manifest distinguishes **local-browser evidence** and **service-level
PostgreSQL coverage** from **unverified route-level and external HTTP E2E**;
adding a route or API requires an explicit inventory update. Three conditional
`test.skip` calls in the separate protected-staging auth specification are
allowlisted by exact file and count; they are not counted as local browser
certification. Inventory validation is not a claim of full API test coverage.

## Reproducible evidence

Each applicable gate uploads 7-day-retained machine-readable evidence with
the tested commit, `package-lock.json` SHA256 and Node version. Vitest and
Playwright gates include passed, failed, skipped, todo and flaky counts as
available; PostgreSQL records its verified server version and named checks.
The aggregate `report` job records:

- Exact `github.sha` under test, base-main SHA at report time, Actions run URL.
- Lockfile hash, Node version and PostgreSQL version.
- Every mandatory and selected optional job's status.
- Passed/failed/skipped/todo counts; missing evidence is a **blocker**.
- SHA256 of downloaded/unpacked evidence and trace files.
- Explicit **NOT VERIFIED** status for external release gates.

An artifact hash verifies the downloaded file bytes; it is not a signature of
GitHub's compressed artifact ZIP. No secrets should enter these reports.

## Coverage limits

| Category | Evidence available | Remaining independent acceptance |
| --- | --- | --- |
| Restaurant onboarding, staff PIN, branches, setup | Vitest + local Playwright | Real Supabase owner verification and deployed device/branch login |
| Manual menu and branch activation | Vitest + disposable PostgreSQL catalogue + local browser | Deployed POS menu visibility, real permissions |
| CSV menu import, scanner, queued batching and publication | Local browser (simulated scanner), one PostgreSQL import verifier | Genuine scanner CLEAN evidence on exact object and live Cloudflare queue |
| Order hold/dispatch, kitchen obligations, invoice, cash, receipt, EOD | Two-terminal local Playwright + authoritative POS PostgreSQL verifier | Protected deployed shift end-to-end, actual KDS and receipt printers |
| M-Pesa, marketplace, notification and payment-provider callbacks | Existing isolated domain tests | Real vendor sandbox integration, settlement, error/replay handling |
| Finance, CRM, journal reporting and tenant isolation | Finance and CRM PostgreSQL verifiers; domain suite | Accounting sign-off, real UI totals, production-role isolation |
| Inventory, stock, requisitions, food costing, cookbook, prep, waste | Domain suite | Physical stock and restaurant staff acceptance |
| Cloudflare Worker, Hyperdrive, queue/cron | Build, source/bundle and event-hook checks | Real runtime bindings/delivery under staging secrets |
| Database migration 27 and four new internal RLS flags | Full disposable PostgreSQL migration and explicit RLS/ledger check | Staging migration under separate authorization; existing public-schema exposure remains |

The isolated security verifier can run the guarded lockdown on **disposable CI
PostgreSQL only**. It does NOT clear staging's public-schema exposure or authorize
the independently guarded staging lockdown.

## Run and failure policy

Before merging, use the existing normal CI and cheap automatic PR contract
gate. Do not try to dispatch the expensive workflow on a PR branch before the
workflow is available on the default branch. After a protected merge, dispatch
**once** from `main` and record the exact tested main SHA.

Leave both optional inputs off for the first baseline. Do not rerun the full
suite or deployment workflow to investigate a single failed step. Review the
named failing gate's compact evidence and retained artifacts first.

No migration 27, schema lockdown, production/staging record write, Cloudflare
operation or deployment is performed by comprehensive certification.
