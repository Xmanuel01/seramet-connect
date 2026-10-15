# Printing Final Safety Corrections

Review baseline: `08edca3109fa45edaf6cedc26f1ba5b478ea9991`.
Scope: existing draft stack #125 -> #126 -> #127. Corrections are consolidated
in the final integration PR #127; intermediate layers must not deploy alone.
No application schema migration, live data change, secret provisioning, driver
installation, manual deployment or merge is authorized/performed.

## Confirmed Defects and Corrections

1. Local retry retained only the last recovery ID. After approval B, approval A
   could become reusable. SQLite now retains every consumed recovery ID and
   atomically commits consumption, payload refresh, state and attempt history
   under `BEGIN IMMEDIATE`. Initial enqueue/claim/outcome history is atomic too.
   A recovery ID first encountered on a fresh ledger is consumed by its initial
   enqueue, not available to authorize its own later retry. The three-attempt
   bound and explicit review requirement remain.
2. Local ledger deletion/second-machine submission could replay signed output.
   The existing gateway now issues durable grants and consumes a unique server
   attempt reservation before the bridge may contact a printer. Existing
   `audit_events` primary-key uniqueness supplies the cross-connection guard;
   three deterministic slots bound attempts. No replacement table/pipeline.
   Fresh signed evidence, issued fingerprint, scope and active configuration
   are verified independently. A failed/lost reservation response is UNCERTAIN,
   never permission to retry automatically. Restored queued evidence must still
   be fresh. Invalid signatures, altered content and unissued grants fail closed.
3. Different hostnames escaped the endpoint-key lock. A conservative bridge-wide
   TCP lane now serializes aliases and fallback without introducing another DNS
   resolution/locking subsystem. Independent Windows queues remain bounded.
4. Customer reprint identity did not bind the entered reason. Issued capability
   fingerprints now include reason/reprint identity. The dead hardcoded-manager
   reprint handler is removed; the legacy hook cannot reprint KOTs and customer
   copies carry a real reason and distinct server-audited copy identity.

The server master remains server-only. The consumption route authenticates a
previously issued, short-lived capability rather than trusting scope headers or
an unauthenticated caller's document. Possession of the scoped machine key alone
cannot create an unissued grant. Grant lookup/fingerprint and reservation CAS
precede physical I/O. Disabling/changing primary or fallback invalidates pending
capabilities. Existing KOT claims, station routing, manager review, receipt
register mutation and permissions remain authoritative.

## Evidence Plan and Commands

Execute affected Vitest suites using the nine-file command in
`PRINTING_IMPLEMENTATION_EVIDENCE.md`, plus:

```powershell
node --test local-print-bridge/printing.test.mjs
node scripts/run-pilot-e2e.mjs tests/e2e/printing-admin.spec.ts
node scripts/verify-print-emulator.mjs
npm.cmd run typecheck
git diff --check
```

The POS PostgreSQL verifier is extended, not replaced: disposable PostgreSQL 16,
two independent connections, twelve competing reservation calls, one winner,
old-capability rejection and a three-attempt maximum. It runs in the existing
aggregate POS CI gate. No staging connection is used. The final PR's existing CI
browser job must pass all twelve scenarios on its one exact tested head; separate
successful reruns on different heads are not an aggregate success. Final counts,
run links and candidate SHA are recorded in the PR after those checks finish.

Regression tests also cover atomic rollback during retry, old approval replay
after restart, twenty concurrent HTTP submissions to two disposable bridges,
ledger deletion, changed printer configuration, unissued/tampered/expired
evidence, and bill/receipt identity and audit across different operator IDs.
Cross-terminal KOT review/claims are covered by existing affected recovery and
outbox tests plus the API claim-owner/reviewed-recovery scenario. Consumption
rechecks the current authoritative KOT claim; a released/reassigned claim cannot
use its previous capability. No raw KOT alternate path is newly authorized.

Local results before final CI: affected Vitest 146/146 across nine files, bridge
14/14, focused authenticated browser 1/1, pinned emulator 6/6, focused ESLint and
typecheck. The last claim-recheck addition receives a focused API rerun and the
final unchanged-head CI suite. Full twelve-scenario success is reported only
from that final CI run, not inferred from these local results.

The first new reservation test exposed JSON property-order sensitivity after
schema parsing; hashes now canonicalize object keys. The initial Windows test
cleanup registered directory removal before closing SQLite; cleanup now closes
bridges first. Neither failure was hidden by weakening assertions/timeouts.

## Visual Review

All six committed PNG captures were opened: KOT, bill, receipt at both widths.
No content clipping or wrong fixture totals observed. Long names, quantity 1,
no-onion modifier, separate-sauce note and kitchen allergy note remain legible.
Bill: KES 123.45 + 16.00 tax = 139.45 pending. Receipt: matching paid/cash total.
Feed/cut are verified by the encoder/emulator command assertions, not inferred
from screenshot decoration. No template redesign was needed.

Known visual limitation: the upstream emulator has no exact 58mm geometry;
narrow captures use 50mm preview with 32-column encoded content. Its toolbar
wraps narrow-view labels; this is emulator chrome, not receipt clipping.
ASCII substitution, no QR/raster logo and model-specific cutter capabilities
remain explicit limitations.

## Remaining Risks and Release Boundary

- Physical paper, actual Windows spooler/USB, Epson cutter/code-page compatibility,
  paper-out/cover-open and human-observed uncertain-delivery recovery are not
  certified by a virtual printer.
- No distributed lock across unrelated bridge processes/identities is claimed.
  One active bridge must own each physical printer. Shared-job reservations
  prevent the same attempt from being replayed by a second machine.
- A server database rollback/deletion can erase global replay evidence. Stop
  printing and reconcile physical output before recovering restored work.
  Retain server grant/reservation audits and scoped local ledgers; backups do
  not roll back paper. Malicious machine administrators/raw LAN access cannot
  be made exactly-once by application code.
- A reservation is permission for at most one attempt, not proof of delivery.
  A crash between reservation and output may lose liveness, never justify an
  automatic duplicate. No physical exactly-once guarantee is made.
- Merge readiness depends on unchanged-head CI and review. Operational release
  still requires secure enrollment and physical-printer certification.
