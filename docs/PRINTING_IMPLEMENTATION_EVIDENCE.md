# Printing Implementation Evidence

Final retry/ledger-loss corrections and current certification evidence are
documented in [Printing Final Safety Review](PRINTING_FINAL_SAFETY_REVIEW.md).
That review supersedes the earlier alias-lock and PostgreSQL-coverage limitations
below; historical execution results remain labeled by layer.

## Review Layer A: Transport and Delivery Safety

The bridge v2 accepts only short-lived server-signed immutable jobs, scoped to
its enrolled tenant, branch and bridge. It retains jobs in a local SQLite WAL
ledger (Node 24), serializes delivery per physical endpoint, limits global
concurrency, rejects altered identity reuse and recovers interrupted sends as
UNCERTAIN. TCP connects to validated numeric LAN addresses after DNS validation.
Loopback printer targets require explicit `SERAMET_BRIDGE_MODE=local-test`.

Windows remains text submission via the existing PowerShell spooler path;
native USB is not claimed. HTTP acceptance, OS spool acceptance and TCP byte
submission are not physical output confirmation. No automatic uncertain retry
or fallback is performed. Manager-reviewed retries retain job identity and are
bounded to three authorized attempts. Kitchen/Bar alternate retries/reprints
now open the authoritative recovery page rather than sending directly.

This layer changes the bridge protocol and **must not be deployed independently
of its server authorization/configuration integration**. Legacy unsigned jobs
fail closed; there is no compatibility bypass. No new infrastructure or schema
migration is required. The audit document describes the pre-change baseline.

Executed locally with disposable data:

- `node --test local-print-bridge/printing.test.mjs`: 9 passed, 0 skipped.
- `npx.cmd eslint local-print-bridge/*.mjs src/routes/kitchen.tsx src/routes/bar.tsx`: passed.
- Formatting applied with repository Prettier.

Actual loopback TCP bytes were captured by a disposable TCP server, not physical
hardware or a visual ESC/POS emulator. Mocked Windows commands never print.
Physical certification and visual emulator acceptance are not established by
these results. A Windows cleanup-order error in the initial test harness was
corrected before the successful test invocation.

## Review Layer B: Authoritative Configuration and Authorization

Adds `/api/seramet/printing/printers` and `/authorize` within the existing API
gateway. Full hardware-management authentication protects persisted device
configuration. Active tenant/branch, enabled devices, station assignments and
server KOT claims constrain signed documents. The server, not the browser,
renders authoritative source records and binds exact targets/content/copies to
the enrolled bridge. Customer reprints require a reason and server audit.

The existing printer page now contains add/edit/disable, Windows/TCP selection,
station/role assignment, paper/cutter/copy settings, diagnostic documents,
local bridge configuration and durable bridge queue inspection. Scope selectors
remain selectors, not authorization. No schema migration or live secret changes.

The protected server `SERAMET_PRINT_SIGNING_KEY` remains server-only. Layer C
derives a separate tenant/branch/bridge-scoped HMAC key for authenticated
administrator enrollment; only that derived machine key is downloaded into
the bridge configuration. It must be protected on the workstation. The local
bearer token is separate. Loopback TCP additionally requires signed
local-development evidence and explicit local-test bridge mode. Non-ASCII text,
QR/status protocols and physical hardware remain model-certification limits.

Validation: 139 affected Vitest tests passed across nine files, including six
new API/routing tests. The initial new fixture used `SERAMET_ENV` rather than
the repository's `SERAMET_ENVIRONMENT`; correcting the fixture preserved the
production loopback rejection. No live services were used.

**Release limitation:** do not merge/deploy these layers as a certified pilot
until authenticated browser acceptance and the completion report are reviewed.
Configured fallback is retained, but automatic uncertain rerouting is not
allowed. Physical delivery remains unverified.

## Review Layer C: Integrated Acceptance and Recovery

Stack order (all draft; review together before any coordinated release):

- A: https://github.com/Xmanuel01/seramet-connect/pull/125
- B: https://github.com/Xmanuel01/seramet-connect/pull/126
- C: `codex/printing-emulator-acceptance`, based on B.

Completes scoped enrollment, per-tenant ledger/cache isolation, persistent
branch printing mode, approved NOT_SENT-only fallback, payload scrubbing and
bounded unresolved capacity. Accepted fingerprints remain durable so removing
receipt content cannot permit duplicate output. Primary/fallback endpoints are
reserved together. Printer replacement cannot change an outstanding job's
fingerprint; reconcile outstanding work before replacement.

Uses the acknowledged server bill identity rather than a predicted client ID.
Receipt reprint reasons are entered by the operator and registered before
authorization. Printer administration uses the enrolled branch's templates,
not the unrelated global legacy profile. No database migration or new frontend
dependency is introduced. The master signing secret is never an enrollment key.

### Executed Evidence

Disposable local data only, 15 October 2026:

| Command / scenario                                                | Result                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `node --test local-print-bridge/printing.test.mjs`                | 11 passed, zero skipped                                                                                           |
| Affected Vitest suite below                                       | 141 passed across nine files, zero skipped                                                                        |
| `npm.cmd run typecheck`                                           | Passed                                                                                                            |
| Focused ESLint and Prettier                                       | Passed                                                                                                            |
| `node scripts/verify-certification-contract.mjs`                  | Passed; no unexpected skip/todo/only                                                                              |
| `npm.cmd run build`                                               | Cloudflare-module production output generated                                                                     |
| `npm.cmd run audit:bundle`                                        | Passed                                                                                                            |
| Existing local browser suite                                      | 11 existing scenarios passed; new printing scenario initially failed                                              |
| `node scripts/run-pilot-e2e.mjs tests/e2e/printing-admin.spec.ts` | Passed after fixing the branch-template defect; final run also checks mobile overflow and captures both viewports |
| `node scripts/verify-print-emulator.mjs`                          | Six documents passed through actual upstream TCP/parser/renderer; zero unknown commands                           |

Affected regression invocation:

```powershell
npx.cmd vitest run --maxWorkers=1 src/server/printing-api.test.ts src/printing/printer-routing.test.ts src/lib/kitchen-print-outbox.test.ts src/lib/kitchen-print-recovery.test.ts src/lib/device-print-queue-store.test.ts src/lib/seramet-flows.test.ts src/platform/platform-foundation.test.ts src/kitchen/kds-production-hardening.test.ts src/onboarding/pass-8-commercial-productization.test.ts
```

The initial browser failure was diagnosed, not hidden by increasing timeouts:
the new enrolled profile must supply its own template settings. The existing
eleven browser successes are reused; only the changed printing scenario was
rerun. API tests exercise authorization, branch denial, persistence, disabled
devices, scoped key derivation and exact persisted KOT claims against disposable
SQLite. They do not establish PostgreSQL-specific printing certification.

### Captured Output

Pinned upstream emulator revision:
`1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d`.
The actual upstream ReceiptViewer renders captured ESC/POS, not an invented
receipt mock. Setup and localhost restrictions are in the bridge README.

- [KOT, narrow](printing-evidence/kot-58mm.png)
- [KOT, 80mm](printing-evidence/kot-80mm.png)
- [Bill, narrow](printing-evidence/bill-58mm.png)
- [Bill, 80mm](printing-evidence/bill-80mm.png)
- [Receipt, narrow](printing-evidence/receipt-58mm.png)
- [Receipt, 80mm](printing-evidence/receipt-80mm.png)
- [Administrator desktop](printing-evidence/admin-desktop.png)
- [Administrator mobile](printing-evidence/admin-mobile.png)
- [Capture hashes and transport timings](printing-evidence/summary.json)

Amounts include KES 123.45 subtotal, 16.00 tax and 139.45 paid total. Fixtures
are anonymized, include long names/modifiers/notes, and verify initialization,
wrapping, feed and cut. Transport measurements are 86.2-236.8ms for six local
samples, not a load benchmark, printer latency SLA or POS performance claim.
The emulator supports 50/78/80mm visual geometry, not exact 58mm: narrow images
use its 50mm view while the encoded profile is verified at 32 columns.

### Safety and Remaining Certification

Both earlier PRs have green CI; C requires its own head checks and review.
No merge, manual deployment, real printer operation, staging/production data
change, driver installation or Windows security-policy change was performed.
Git-connected PR preview builds may deploy automatically; this is not a pilot
or production release approval.

- Socket completion means BYTES_SUBMITTED; Windows means SPOOL_ACCEPTED. Device
  acknowledgement and paper status remain UNKNOWN with this profile.
- Interrupted writes and bridge crashes preserve UNCERTAIN; automatic replay
  and fallback are prohibited. Reviewed retry retains identity/history.
- ASCII only: unsupported glyphs are replaced. QR, raster logos, native USB,
  ePOS HTTP/XML and bidirectional status are not claimed.
- No user-facing cancellation or hardware-confirmed acknowledgement is
  certified. Never describe these as completed supported controls.
- Endpoint serialization covers configured endpoint keys, including primary
  and fallback; distinct DNS aliases of one physical printer need operational
  normalization and are not certified as a shared lock.
- Real Windows spooler output, Epson model/code-page/cutter compatibility,
  no-paper/offline/cover-open handling, restart recovery and audited reprints
  still require operator-observed physical tests before rollout.
- Securely provision the server master and enroll each machine/branch only
  after review. No live credentials or printer destinations were configured.
