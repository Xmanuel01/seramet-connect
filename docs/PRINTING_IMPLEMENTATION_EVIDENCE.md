# Printing Implementation Evidence

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

The protected server `SERAMET_PRINT_SIGNING_KEY` and the matching enrolled
bridge key are prerequisites for operation; neither is delivered to browsers.
The local bearer token is separate. Loopback TCP additionally requires signed
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
