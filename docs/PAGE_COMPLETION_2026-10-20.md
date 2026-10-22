# Inventory, Attendance and Campaign Page Completion

## Scope

Follow-up to PR #138. No merge, deployment, protected database mutation, credential
copying or provider test email is authorized or performed here. All browser writes
use randomly named disposable loopback fixtures. Supabase Auth SMTP is unchanged.

The owner reports successful sending/receiving through the existing Brevo setup.
That is owner-reported operational evidence, not a test executed by this change.
It does not establish campaign or closing-report delivery from the new candidate.

## Corrections

- **Inventory items:** adds a permission-gated CSV/XLSX import dialog using the
  existing quarantine, authenticated scanner verdict, preparation queue and import
  tables. The initial limit is 10 MB and 5,000 rows. No frontend parser or scanner
  bypass is introduced.
- **Review and publication:** an explicit approval freezes the server-side plan;
  durable workers stage 20 rows at a time. A separate publication confirmation
  verifies the plan and publishes the new catalog in one atomic set-based database
  transaction. The existing database publication guard rolls back all inserts if
  any required item/category/unit/branch warehouse cannot be verified.
- **Existing inventory:** re-import supports skipping existing stock masters.
  Spreadsheet updates to existing masters require separate reviewed item edits;
  they are rejected, not silently applied. Opening quantities, costs and financial
  stock movements remain separate authorized workflows. Rational purchase-unit
  conversions remain supported by the server importer.
- **Progress and recovery:** a scoped session-storage reference contains only job
  and import IDs, not file data or credentials. Reload resumes inspection of the
  same authoritative job. One bounded polling chain runs only while necessary;
  it pauses in hidden tabs and fetches full previews only when state changes.
  Background import progress does not refresh unrelated forms or the whole app.
  Upload identity hashes the file and full request settings before the existing
  worker-ID truncation step; different uploads in a long-ID branch cannot share
  a worker ID simply because their readable prefixes match.
- **Attendance:** invalid historical timestamps and invalid timezones no longer
  throw unhandled rendering errors. Malformed record/history/delay collections
  are rejected with a recoverable notice. Authorization and geofence checks are
  unchanged. This reproduces a crash mechanism locally; the original photographed
  live exception still has not been captured and cannot be attributed conclusively.
- **Campaign page:** adds a protected connection action to register the configured
  tenant's Brevo adapter, with an actionable message when server configuration is
  missing. No production credentials are read or copied. Missing provider setup
  remains a real sending prerequisite, not a reason to pretend delivery succeeded.
- **Campaign worker:** adds tenant-scoped Brevo HTTPS delivery, consent rechecks,
  a signed unsubscribe flow, bounded retry/backoff for known rejections, and
  quarantine of uncertain outcomes. Existing durable database claims prevent
  parallel sends. Provider acceptance remains distinct from inbox delivery.

## Email Boundary

`SERAMET_CAMPAIGN_EMAIL_CONFIG` is protected server-only configuration keyed by
tenant ID. Each authorized entry contains `apiKey`, `from`, and an independent
`unsubscribeSecret` of at least 32 characters. `SERAMET_PUBLIC_ORIGIN` supplies
the HTTPS origin for signed unsubscribe links. None of these values should be
pasted into chat, committed or returned to the browser.

The new campaign adapter uses Brevo. The existing daily-closing implementation
still uses its Resend-specific delivery/evidence contract. Its provider migration
is intentionally not silently changed during page validation: Brevo must not
inherit Resend's 24-hour idempotency/retry assumptions. Complete and certify that
isolated migration before claiming every application email uses Brevo.

No real scanner, campaign-provider call, real phone location or physical printer
was certified by these disposable tests. Genuine authenticated CLEAN evidence is
still mandatory before any uploaded file can be parsed or committed.

## Validation

- 145 focused tests passed across six files, including SQLite and disposable
  PGlite PostgreSQL inventory publication, rollback, branch isolation, scanner
  gates, campaign lifecycle/provider behavior, and Attendance recovery contracts.
- A final inventory SQL guard change passed all 14 inventory-import tests again.
  These overlap the 145 tests and are not 14 additional distinct tests.
- One additional upload-identity test passed, including distinct files, branches,
  settings and the legacy worker-key length constraint.
- All 90 sidebar routes were visited: 67 Sales-through-Finance routes and 23
  remaining Accounting, Management, Intelligence, Marketing and System routes.
  Both reports have zero crash screens, page exceptions or API 5xx responses.
- Attendance outage/malformed-history recovery, campaign configuration failure,
  QR issuance/revocation, inventory controls, requisition export and cookbook
  scaling passed in the browser. Mobile Attendance and cookbook width checks pass.
- The first import browser attempt sent an unsupported branch field to a strict
  category endpoint. The next expected a lowercase code despite the authoritative
  uppercase row key. Both were fixture/assertion errors, not application bypasses.
  A later capture found and corrected genuine mobile dialog grid overflow.
  Publication and persisted item visibility were independently reached during
  these focused attempts. The final import browser case passed on an unchanged
  application candidate (45.5 seconds), covering scan/stage/approve/reload/publish,
  one persisted item, and phone dialog bounds. The final capture was visually inspected.
- Nine distinct browser scenarios passed across the bounded runs, including both
  route scans. This is not a claim that one aggregate run passed all nine: failed
  fixture/locator attempts and the corrected mobile overflow are described above.
- TypeScript, scoped ESLint, formatting and diff checks pass. The final production
  client/server build and production bundle secret/demo-identifier audit also pass.

Raw local route evidence: `.seramet/category-acceptance/routes.json` and
`remaining-routes.json`. Browser captures/traces use disposable identities and are
not committed. A rendering scan is not evidence that every button, workflow,
role/device combination or external integration has been exercised. No hosted
PostgreSQL 16 or protected deployment certification is claimed by PGlite results.
