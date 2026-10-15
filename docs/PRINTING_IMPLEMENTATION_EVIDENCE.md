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
