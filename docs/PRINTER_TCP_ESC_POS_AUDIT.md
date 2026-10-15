# Seramet Lite: Printer TCP and ESC/POS Audit

Date: 15 October 2026 (Africa/Nairobi).

## Scope and Decision

Audit only. Inspected checkout `codex/pos-shift-acceptance-evidence` at
`4e73e9d1cde52a64e3ad18b3a9cad98c5d3a48cb`. Remote main verified as
`b40c8ab388c9554c28c54775199bc9cf93bc4ea0`. The bridge, print service,
queue hook, printer page, Kitchen/Bar pages, and print-profile adapter have no
diff against the local `origin/main` at that revision.

**Printing is not yet certified for restaurant pilot use. Direct RAW TCP and an
end-to-end ESC/POS byte encoder are absent.** The existing server-authoritative
KOT outbox is a useful foundation and should be retained, not replaced. The
installed bridge is an authenticated HTTP-to-OS-text-spooler adapter, not a RAW
network printer adapter. Several alternate UI paths undermine the stronger
server KOT recovery policy.

Only this report was added. No application changes, drivers, emulator installs,
printer settings, printing, hardware/network-printer contact, database changes,
deployments, merges, or comprehensive certification reruns were performed.
Existing unrelated untracked files were left alone.

Status meanings: PASS means the stated software behavior is supported by the
examined code/tests, not physical-paper certification. PARTIAL means some
necessary behavior exists. FAIL means required implementation is missing or
contradicted. NOT VERIFIED means runtime/device evidence was not obtained.

## A. Capability Matrix

| Capability               | Status  | Evidence                                                                                                                        | Required work                                                                                                |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| RAW TCP/IP printing      | FAIL    | `local-print-bridge/server.mjs:156` calls PowerShell `Out-Printer` or CUPS `lp`; no socket transport or host/9100 configuration | Add a bounded, authorized TCP transport inside the existing bridge                                           |
| Epson ESC/POS commands   | FAIL    | `seramet-print-service.ts:942,987` render strings; bridge writes UTF-8 `.txt`; `receipt-logo.ts:24` only packs image pixels     | Encode actual device-profiled ESC/POS bytes; model-specific certification                                    |
| USB printing             | PARTIAL | An OS-installed USB printer can be targeted by its spooler name                                                                 | Verify driver, 58/80mm output, offline/paper-out recovery; direct USB is not implemented                     |
| Windows spooler printing | PARTIAL | `server.mjs:156` has a real Windows command path                                                                                | Hardware output unverified; add bounded execution, durable identities and honest acceptance status           |
| Virtual TCP emulator     | FAIL    | No Seramet socket/byte sender                                                                                                   | Use the same future production TCP adapter with an explicitly enrolled loopback target                       |
| Multi-printer routing    | PARTIAL | Branch profiles, roles, copies, station grouping and fallback exist; routing tests pass                                         | Preserve exact device/station assignments rather than first matching role; respect disabled devices          |
| KOT printing             | PARTIAL | Atomic server obligations/claims and explicit uncertainty review exist; actual transport is OS text                             | Remove alternate retry/reprint bypasses; certify actual output and recovery                                  |
| Receipt printing         | PARTIAL | Authoritative receipt adapter, text rendering and bridge submission exist                                                       | Durable delivery/reprint authorization; proper encoding, totals presentation and hardware checks             |
| Bill printing            | PARTIAL | POS and invoice preview submit through the same hook                                                                            | Same transport/recovery gaps; verify financial presentation and paper layout                                 |
| Printer recovery         | PARTIAL | Server KOT survives repository restart; manager review of uncertainty exists                                                    | Unify all entry points; bridge idempotency, bounded operations, job lookup, durable local state              |
| Printer setup interface  | PARTIAL | Setup registers devices; printer page displays routes, tests and recovery                                                       | No functioning end-to-end network setup, endpoint enrollment, bridge-token editor or complete routing editor |

## B. Actual Architecture

### Normal Send Kitchen

```text
POS Send Kitchen (src/routes/pos.tsx)
  -> authenticated transaction mutation / server revision and permission checks
  -> TransactionEngine.sendToKitchen
     -> accepted production lines + station tickets
     -> queueKitchenPrintObligations (same authoritative commit)
  -> POS finds exact branch/order obligations
  -> claimKitchenPrintObligations (one atomic multi-station claim)
  -> useSerametPrintQueue.sendKitchenTickets
  -> SerametPrintService.createProductionTicketJobs
     -> group by line.productionStation (not category directly)
     -> resolvePrinter / branch hardware profile
     -> renderProductionTicket (plain text)
  -> DevicePrintQueueStore (browser-process memory)
  -> sendInstalledBridgeJob / submitCopies
     -> KDS_DISPLAY: local Displayed state, no printer transport
     -> physical: authenticated HTTP POST to installed bridge /jobs
  -> bridge: validate -> fresh UUID -> UTF-8 spool file
  -> PowerShell Out-Printer -Name (Windows) or lp (CUPS)
  -> HTTP accepted/rejected
  -> POS aggregates delivery routes -> settleKitchenPrintObligation
     BRIDGE_ACCEPTED or UNCERTAIN
```

Key evidence: `pos.tsx:1291-1407`, `transaction-engine.ts:1836-2055`,
`use-seramet-print-queue.ts:77-150,241-313`, `server.mjs:63-101,156-203`.
The frontend does not talk directly to printer TCP sockets. The Cloudflare
Worker does not connect to the restaurant LAN. Keep both properties.

### Bills, Invoices and Receipts

POS Print Bill creates/uses an authoritative invoice, then submits a customer
document (`pos.tsx:1536`). Confirmed payment can queue a receipt
(`pos.tsx:1725`). Invoice page Print first builds a text preview, and its modal
Print submits through `printCustomerDocument` (`invoices.tsx:266,873`). Receipt
register adapts authoritative receipt/invoice lines and calls the same hook
(`receipts.tsx:67`; `print-order-adapter.ts`). Preview/download is not transport.

These customer document jobs do not use the durable KOT obligation state
machine. Their delivery history is browser memory plus bridge spool/log files.
Receipt-register reprint auditing is requested after submission, without
awaiting successful authorization/audit (`receipts.tsx:73-79`).

### Configuration and Routing

- `ConfigurationRepository.listDevices/listPrintRoutes` scopes by tenant/branch
  (`configuration-repository.ts:248,263`). Branch-name ambiguity across tenants
  is rejected by `print-profile-adapter.ts` `resolveBranch`.
- Server setup `configureDevice` enforces hardware-manage permission and
  assigned branch (`onboarding-service.ts:3100`); device activation is a separate
  authenticated workflow. This is not bridge enrollment or a printer handshake.
- `getConfiguredBranchHardwareProfile` adapts devices/routes/templates.
  `toPrinterDevice` drops transport type/address; `buildStationRoutes` maps
  station names/codes to KITCHEN/BAR/DISPATCH roles, not exact devices.
- `resolvePrinter` picks the first device with a matching role. One available
  printer can serve several stations: separate station tickets are intentional,
  not duplicate original obligations. Combined KDS+printer mode intentionally
  creates both display and physical delivery jobs for one station record.
- Categories reach routing only through configured item production stations;
  there is no independent category-to-printer transport resolver in this path.
- `PrintRoute` already stores exact primary/fallback device IDs, so preserve
  those identities instead of inventing another routing system.

### Acknowledgement and Recovery Boundaries

| Observation                             | What is actually established                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| Order accepted / KOT obligation PENDING | Authoritative dispatch is durable; no printer delivery yet                        |
| CLAIMED                                 | One server-authorized claimant; no paper guarantee                                |
| Browser Queued/Sending                  | In-process activity only; not durable transport acceptance                        |
| HTTP 202 from bridge                    | Current OS command returned successfully, or dry-run wrote a file                 |
| Browser Printed/Fallback Printed        | Current label for HTTP acceptance, not paper confirmation                         |
| Server BRIDGE_ACCEPTED                  | Recorded delivery-route acceptance, not hardware success                          |
| TCP write (future)                      | Bytes handed to networking stack; not printer completion                          |
| Printer status (future/model dependent) | Only the status actually supported/reported; not per-job exactly-once paper proof |
| Human checks paper                      | Physical-output evidence; keep separate from bridge acceptance                    |

The server refuses another claimant after uncertainty/acceptance. A manager
must review uncertainty with a reason; an active claim cannot be released for
five minutes. An accepted original requires a separate audited reprint, and an
unresolved reprint blocks another reprint. These are good existing safeguards.
Browser/bridge loss leaves inspectable server state, not permission for blind
automatic retry. This policy is not consistently enforced by alternate pages.

## C. Confirmed Defects

These are source-confirmed behaviors. Reproduction instructions below are for
future disposable/mocked acceptance; no hardware or live reproduction was run.

### P1-01: Alternate Kitchen/Bar retry and reprint bypass server policy

- **Severity:** High; duplicate production instructions and unauthorized repeat
  output can occur after ambiguous delivery.
- **Evidence:** `kitchen.tsx:167-202,456`, `bar.tsx:155-189,325`;
  `use-seramet-print-queue.ts:158-181`. KOT server permissions are separately
  defined at `platform/permissions.ts:210-214`.
- **Reproduce:** Make a mocked bridge accept bytes but lose its response. Open
  Kitchen/Bar Retry print for the resulting Failed job; or select Reprint KOT.
- **Expected:** Manager review/audited authorization, then claim the explicit
  obligation before a new physical attempt.
- **Actual:** Retry resubmits directly; reprint calls `sendKitchenTickets` with
  REPRINT directly. Neither path performs server review/claim/audit. Available
  print controls depend on kitchen mode, not manager reprint permission.
- **Minimum fix:** Route these actions through the existing obligation recovery
  and audited-reprint mutations. Do not weaken server guards.

### P1-02: Exact multi-station device assignments are lost

- **Severity:** High; a grill ticket can go to the wrong kitchen printer.
- **Evidence:** `print-profile-adapter.ts:83-117,395,480`;
  `seramet-print-service.ts:338-357,827`.
- **Reproduce:** Configure two kitchen printers with separate station routes
  and KITCHEN roles; make the intended grill device second in the device list.
- **Expected:** Grill follows its exact station/device route.
- **Actual:** First document route is selected and reduced to role; stations
  become roles; resolver picks the first KITCHEN device. IDs/station specificity
  do not survive to resolution.
- **Minimum fix:** Carry exact primary/fallback device IDs and station keys
  through the existing profile/resolver. Keep role fallback only as an explicit
  legacy default; reject ambiguous station routes.

### P1-03: Setup's Test print can certify without submitting output

- **Severity:** High for readiness evidence, not a demonstrated database exploit.
- **Evidence:** `seramet-setup.tsx:1069,1891`;
  `onboarding-service.ts:3185-3221` and readiness calculation near `4286`.
- **Reproduce:** A device is ACTIVE with non-null `last_seen_at`; invoke Setup
  Test print while no printer is reachable.
- **Expected:** Dispatch a marked job and report its actual stage separately
  from physical verification.
- **Actual:** Server records SUCCESS from trust status and any previous
  heartbeat only. It sends no print payload and tests no transport.
- **Minimum fix:** Rename current action to device-observation check or connect
  it to a genuine diagnostic job through the same bridge. Never use heartbeat
  alone as successful print certification.

### P1-04: Bridge has no stable idempotency ledger

- **Severity:** High when an already accepted request is retried.
- **Evidence:** `server.mjs:79-101`; incoming `job.id` is checked but not used
  for duplicate consumption. Every request gets a fresh UUID and print call.
- **Reproduce:** Send the same authorized job/copy identity twice to a mocked
  bridge transport, including across bridge restart.
- **Expected:** Return existing acceptance/state; never create another original
  physical attempt from duplicate delivery.
- **Actual:** Both requests spool/submit independently. Text files and JSONL
  logs are not a consumable delivery state machine.
- **Minimum fix:** Durable per-job/per-copy record bound to immutable content,
  scope and configured destination; reject altered identity reuse. Persist
  pre-send state and treat restart-during-send as uncertain, not resendable.

### P1-05: Disabled devices remain candidates

- **Severity:** High for routing correctness.
- **Evidence:** `configuration-repository.ts:248`,
  `print-profile-adapter.ts:68-77,395-430`, `seramet-print-service.ts:338,827`.
- **Reproduce:** A disabled device remains marked ONLINE and precedes another
  device with the same role.
- **Expected:** Disabled devices must not receive new jobs.
- **Actual:** Device listing filters scope, not enabled; adapted printers omit
  enabled and resolve from health/role alone.
- **Minimum fix:** Exclude disabled/non-printer targets from physical routing
  while retaining their historical identities for job inspection.

### P2-06: No bounded print operation or durable customer-document queue

- **Severity:** Medium; indefinite Sending and lost delivery history.
- **Evidence:** `seramet-print-service.ts:762-802` fetches without a deadline;
  `server.mjs:194` execFile has no execution timeout; queue store uses module
  Maps (`device-print-queue-store.ts:10`).
- **Reproduce:** Mock an HTTP request/OS command that never returns; reload a
  page containing bill/receipt delivery jobs.
- **Expected:** Bounded outcome, inspectable uncertain job and durable identity.
- **Actual:** Sending may not settle; browser reload loses customer delivery
  jobs/reprints. KOT server obligations survive, so this does not erase dispatch.
- **Minimum fix:** Add bounded HTTP/child-process/socket deadlines and durable
  bridge job lookup; persist device delivery history with tenant/branch/device
  keys and logout isolation. Never treat timeout as proof nothing printed.

### P2-07: Success and health labels overstate evidence

- **Severity:** Medium; operators can mistake simulation for hardware readiness.
- **Evidence:** `seramet-print-service.ts:287-297,700-741` has a simulated
  online/authenticated bridge; `seramet-printers.tsx:363,602,668` mixes simulated
  health with actual health. `use-seramet-print-queue.ts:277` labels acceptance
  Printed. `server.mjs:83` dry-run is accepted like physical submission.
- **Reproduce:** Open printer page without installed bridge; invoke a diagnostic
  with the bridge absent or dry-run enabled.
- **Expected:** Not configured/unknown, queued/accepted, simulated and physical
  verification are distinct.
- **Actual:** Healthy can derive from simulation; test notice says accepted
  immediately from job count; dry-run can reach server BRIDGE_ACCEPTED through
  normal submission.
- **Minimum fix:** Keep simulation explicit and non-certifying; block dry-run
  evidence from settling real obligations. Use Bridge accepted labels and real
  per-device telemetry with UNKNOWN for absent/stale evidence.

### P2-08: Configuration UX does not complete advertised setup

- **Severity:** Medium; operators cannot enroll a usable transport through UI.
- **Evidence:** `seramet-setup.tsx:315,1910-1974` registers type/name/role/
  station/paper size, but not transport/address/port; printer page is mostly
  read-only. `saveInstalledPrintBridgeConfig` has no application call sites.
  `print-profile-adapter.ts:395` omits transport/address from runtime device.
- **Reproduce:** Follow bridge README's instruction to save endpoint/token in
  Hardware Setup > Printers or try adding TCP printer 127.0.0.1:9100.
- **Expected:** Authorized setup, validation, save, enrollment and usable route.
- **Actual:** No wired bridge configuration form or network mode/address/port
  controls; database NETWORK/USB enums alone do not implement transport.
- **Minimum fix:** Extend existing setup, not another page/pipeline; protect
  mutation permissions and provision machine-scoped bridge enrollment.

### P2-09: Local reprint audit is not authoritative authorization

- **Severity:** Medium; audit may be missing or attributed to a fabricated role.
- **Evidence:** `seramet-printers.tsx:373-382` uses literal Branch Manager and
  generic reason; hook creates only local reprint log. `receipts.tsx:73-79`
  submits before `recordReceiptReprint` resolves.
- **Reproduce:** Reprint latest; or reject/mock failure of receipt audit mutation.
- **Expected:** Verified operator and permission, reason and authorization
  persisted before irreversible submission.
- **Actual:** Local submission can proceed without authoritative audit success.
- **Minimum fix:** Authorize/audit first, then consume a stable print identity;
  use current authenticated actor. Use existing KOT audited-reprint flow for KOT.

### P2-10: Logo/QR options do not produce advertised hardware content

- **Severity:** Medium for output correctness.
- **Evidence:** `receipt-logo.ts:24-57,99` returns packed pixels, not a framed
  ESC/POS command; `seramet-printers.tsx:131,386` keeps assets in component state;
  `renderCustomerDocument` never uses logo assets or `showQrCode`.
- **Reproduce:** Upload logo or toggle a QR-enabled template and inspect rendered
  job/bridge payload, without printing.
- **Expected:** Saved asset and actual printer-supported image/QR instructions,
  or an honest unsupported indication.
- **Actual:** Logo preview/byte count exists but no logo in output; bill payment
  prompt is text, not QR. Assets disappear when the page remounts.
- **Minimum fix:** Persist approved assets using existing configuration/storage,
  add capability-gated encoding, or hide unsupported claims until implemented.

### P2-11: Long production item names are silently truncated

- **Severity:** Medium; kitchen loses distinguishing item details.
- **Evidence:** `seramet-print-service.ts:1164-1175` slices the main item label
  to paper character width; notes/modifiers wrap but the name does not.
- **Reproduce:** Render two long names sharing their first 32 characters on a
  58mm ticket.
- **Expected:** Full identifying names wrap legibly with quantity preserved.
- **Actual:** Distinguishing suffix is lost.
- **Minimum fix:** Wrap names with quantity/continuation indentation and test
  model-specific printable width, long words and modifiers.

### Additional Security and Operational Limitations

- Default bridge bind is loopback and `/jobs` plus `/printers` require a secret
  of at least 16 characters. Public `/health` exposes only bridge metadata.
  PowerShell arguments escape single quotes; no confirmed shell-injection
  finding is established here.
- The shared machine bearer token authorizes any named printer/content accepted
  by the bridge. It does not verify tenant, branch, dispatch claim or operator.
  Browser storage holds the token; local JS/token holders can bypass UI-only
  restrictions. Server device activation is not proof of bridge/job enrollment.
- Endpoint validation only checks HTTP(S) plus token length
  (`print-bridge-client-config.ts:46`); it is not an enrolled-endpoint policy.
  HTTP on loopback is not itself a remote TLS vulnerability. Arbitrary remote
  bridge URLs and non-loopback bridge binding need explicit restrictions.
- No direct TCP SSRF exists in this code because the TCP transport is absent.
  Adding it without an authorized target registry would introduce that risk.
- CORS only emits allowed-origin headers; it is not server-side origin rejection
  or independent job authorization (`server.mjs:222`). Actual browser local
  network permission/CSP compatibility with protected HTTPS staging is unverified.
- Spool files include customer/order text; no retention purge, explicit file ACL
  policy, bounded disk usage or log rotation exists in the bridge. Raw child
  process error text is returned/logged; avoid exposing machine paths/details.
- `printAtFallback` changes state without transport (`service.ts:612`); it has
  no current page caller, so it is a latent unsafe helper, not proof of an active
  false-fallback button. Missing-bridge retry can invoke the simulated processor.
- Receipt/bill presentation hardcodes DISCOUNT to zero; print input lacks
  explicit discount/service-charge breakdown. This audit did not establish a
  specific live discounted-sale misstatement; reconcile authoritative breakdowns
  before certifying those cases. Some helpers remove non-ASCII while other text
  is UTF-8: there is no consistent printer code-page contract.

## D. Minimum Production-Grade Completion Plan

Implementation requires approval. This is a proposal, not completed work.

### 1. Close Existing Safety Gaps First

Use the current server obligation/claim/review pipeline from every production
print entry point. Remove direct uncertain retries and KOT reprint shortcuts.
Authorize customer reprints before transmission. Preserve atomic multi-station
claims, immutable accepted lines, branch scope, idempotency and manager review.
Do not change order/payment state merely because printing failed.

### 2. Extend the Existing Bridge With Two Transports

Suggested files, subject to existing coding conventions:

- `local-print-bridge/transports/windows-spooler.mjs`: extract existing OS
  transport with explicit deadlines and acceptance-only outcomes.
- `local-print-bridge/transports/tcp-escpos.mjs`: Node `net` transport; no browser
  sockets, no Cloudflare-to-LAN calls, no frontend antivirus/printing engine.
- `local-print-bridge/escpos-encoder.mjs`: maintained, pinned encoder/library or
  small reviewed adapter selected against supported models and licensing.
  Reuse semantic document data/layout instead of inventing a second business
  renderer. Do not pass encoded control bytes through `Out-Printer`.
- `local-print-bridge/job-store.mjs`: durable, bounded ledger within the existing
  bridge; reuse existing spool area, not another remote printing service.
- Existing `server.mjs`, profile adapter, queue hook, print-order adapter and
  setup UI: minimal integration changes. Extend existing hardware metadata and
  routes if sufficient; do not assume a migration is necessary.

Proposed transport boundary:

```ts
type PrintOutcome = {
  stage: "NOT_SENT" | "SPOOL_ACCEPTED" | "BYTES_SENT" | "UNCERTAIN";
  printerStatus?: "READY" | "PAPER_OUT" | "OFFLINE" | "UNKNOWN";
  attemptId: string;
};
interface PrintTransport {
  send(job: AuthorizedImmutableJob, target: EnrolledPrinter): Promise<PrintOutcome>;
  probe(target: EnrolledPrinter): Promise<PrinterStatus>;
}
```

This is an interface sketch, not existing exported code. Physical confirmation
must remain a separate human/device-specific event. Preserve existing Windows
text clients/versioned payloads during transition. Give each configured copy a
stable identity; current `submitCopies` sends copies one by one, so the bridge
cannot deduplicate by parent job ID alone without suppressing legitimate copies.

### 3. TCP Execution and Recovery Contract

- Default configured port 9100, strict numeric range and approved ports;
  explicit printer model, paper/dot width, encoding, cut/status capabilities.
- Connect, write-idle, overall and response deadlines; handle refusal, DNS errors,
  partial transmission, early close and status timeouts separately.
- Write binary buffers; honor backpressure/drain and completion; cleanup socket,
  listeners and timers on every terminal path. Serial queue per physical printer
  prevents interleaved documents; bound concurrency across printers.
- Persist immutable job/copy identity and payload hash before sending. Reject
  changed payload/target under an existing identity. Persist results before ACK;
  restart during transmission is UNCERTAIN. Never promise exactly-once paper
  delivery from a non-transactional RAW printer.
- Retry automatically only when definitely no bytes/spool submission occurred,
  bounded by policy. If any bytes or copies may have arrived, require existing
  audited recovery. Fallback only before delivery could have occurred.
- Printer status/ASB is model-dependent. Record UNKNOWN if unsupported. A READY
  status is not an order-specific paper receipt. Reprints receive new audited
  identities with visible duplicate markings.

### 4. Endpoint Security and Enrollment

- Keep bridge loopback-bound by default, authenticate discovery/submission, reject
  unauthorized origins in addition to CORS, and enroll authorized app origins.
- Hardware-manage authorization server-side for target/routing changes; cashiers
  may print allowed documents but cannot select arbitrary endpoints.
- Browser sends enrolled printer ID, never arbitrary host/port/commands. Bridge
  resolves a scoped, administrator-approved registry. Bind jobs to tenant,
  branch, device/bridge, exact content, copy and dispatch authorization using
  short-lived server-authenticated evidence. Do not trust a client role string.
- Explicitly permit configured private LAN destinations: a blanket private-IP
  ban would break restaurant printing. Validate IPv4/IPv6 and all DNS answers;
  reject public, multicast, broadcast, unspecified, link-local/metadata and
  unapproved subnet targets. Prevent DNS rebinding by checking/pinning the
  resolved address used for connection. No userinfo, redirects or URL schemes
  in printer destinations.
- Loopback emulator is an explicit locally enrolled target, not a general
  production bypass. Restrict 127.0.0.1/::1 plus its configured port; do not open
  unrestricted local sockets. RAW printers normally lack transport encryption:
  isolate the printer VLAN/LAN and do not expose 9100 to the public internet.
- Protect local token/config/spool ACLs, bound input/job size and concurrency,
  redact logs, rotate enrollment credentials, and retain audit metadata separately
  from short-lived document contents. Specify retention/deletion before rollout.

### 5. Complete Existing Setup and Truthful Observability

Extend Setup/Printers to choose Windows-installed versus TCP ESC/POS. USB can
initially remain an OS-installed printer, explicitly labeled; direct USB is a
separate optional capability, not required for this minimal plan.

Save exact OS printer name or authorized host/port, branch, station, document
route, model, 58/80mm, character/dot width, capabilities, copies, approved fallback
and enabled state. Support disable/replacement without rewriting historical
job destinations. Add actual diagnostic receipt/KOT, per-device UNKNOWN/offline
status, stable job/attempt details and manager-only uncertain recovery. Ensure
hardware-view is insufficient for management actions. Bridge settings must have
a real enrollment/save flow, not developer-console localStorage instructions.

### 6. ESC/POS Document Contract

Retain existing authoritative order/invoice/receipt adapters, quantities,
modifiers, kitchen notes, source identities and integer-minor financial truth.
Add profile-gated initialize/alignment/emphasis/font-size/code-page, line feeds,
raster image/QR and feed/cut commands. Wrap long item names; prohibit user text
from injecting ESC/POS controls, cash-drawer pulses or firmware commands.
Validate totals, discounts, tax, service charges, tender and change against
canonical records; do not invent breakdowns in the encoder.

Use explicit model capability profiles. Epson ESC/POS, Epson ePOS HTTP/XML and
Windows driver rendering are different transports/contracts. This proposal is
RAW ESC/POS, not a claim to implement ePOS or every Epson command/model.

## E. Tests, Emulators and Acceptance

### Tests Executed Here

```powershell
npx.cmd vitest run --maxWorkers=1 src/lib/kitchen-print-outbox.test.ts src/lib/kitchen-print-recovery.test.ts src/lib/device-print-queue-store.test.ts src/lib/seramet-flows.test.ts src/platform/platform-foundation.test.ts src/kitchen/kds-production-hardening.test.ts
```

Result: **6 files, 76 passed, 0 failed, 0 skipped; 5.83 seconds.** Includes
rendering, modes, single/two/three printer resolution, packed logo pixels,
obligation invariants, local queue and recovery. The broader flow test file also
contains other in-memory domain tests. Simulated `processQueuedJobs` success
assertions do not exercise the actual HTTP hook/OS process/hardware.

```powershell
npx.cmd vitest run --maxWorkers=1 src/server/pass-5-production-foundation.test.ts -t 'KOT'
```

Result: **2 passed, 0 failed, 25 excluded by the explicit name filter;
6.07 seconds.** Verifies persisted original outbox/repository restart and atomic
multi-station claims using disposable SQLite-backed repository tests. This is
not physical printing or PostgreSQL/transport certification.

Total executed: **78 passed**. No full suite or staging workflow was run.
No new test files were added during this audit.

### Emulator Assessment (Documentation Verified, Not Executed)

| Emulator                                                                              | Verified project contract                                                                                                        | Seramet compatibility now                                                                                      | Future use and limits                                                                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [maseylan/escpos-virtual-printer](https://github.com/maseylan/escpos-virtual-printer) | README describes loopback TCP 9100, receipt preview, raw command log and a direct TCP example without a system printer           | No: Seramet has no TCP ESC/POS sender; emulator HTTP support is not the authenticated Seramet `/jobs` contract | Use the production TCP adapter; inspect receipts/raw bytes/feed/cut. Runtime, command completeness and package trust were not certified                 |
| [yhonc9/CrossEscPosEmulator](https://github.com/yhonc9/CrossEscPosEmulator)           | README documents configurable TCP 9100, raw payload dumps, bidirectional status/paper-out simulation and partial command support | No: same missing sender/encoder                                                                                | Useful candidate for status/failure acceptance; explicitly bind loopback because documented default is all interfaces. Not proof of real Epson behavior |

Both can accept TCP data without installing a Windows spooler printer. Neither
can make the current Seramet bridge emit RAW bytes merely by being started.
Do not point Seramet's HTTP bridge URL at port 9100: HTTP JSON is not ESC/POS.
No emulator was installed or launched; current Windows policy was not bypassed.
Emulator software must be pinned/reviewed before execution; README claims are
not evidence of successful Seramet integration.

Epson's [official ESC/POS reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/index.html)
provides model-specific command applicability. Verify feed/cut/status/encoding
against the actual selected model; emulator rendering does not certify cutter,
USB driver, paper, print-head quality or physical delivery.

### Required Completion Tests

| Area                | Required assertions/evidence                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kitchen KOT         | Original, addition, void, modifiers, long names, allergen/preparation notes, exact station/order/source and duplicate marker; immutable accepted lines                          |
| Bar KOT             | Drinks only; correct station and role; coffee/custom bar station labels and correct document profile                                                                            |
| Bills               | Payment-pending distinction, exact selected invoice, authoritative totals/tax/discount/service-charge breakdown, no premature paid statement                                    |
| Receipts            | Confirmed payment/allocation, real receipt number, split tender, change/refund cases and audited copies                                                                         |
| Paper/layout        | 58mm/80mm profiles, printable dot/character width, code pages/special characters, logo, QR, wrapping, feed/cut; emulator images plus raw-byte golden assertions                 |
| Multiple printers   | Counter/kitchen/grill/bar/fallback, same-role station routing, two branches/tenants, one printer serving several stations, disable and replace; no interleaved bytes            |
| Authorization       | Cashier target-change denied, hardware-view cannot manage, cross-branch claims denied, forged/replayed/expired job evidence rejected, altered payload reuse rejected            |
| Network safety      | Unauthorized/public/metadata/broadcast targets rejected; approved LAN and enrolled loopback allowed; DNS rebinding/IPv6 variants and origin/token failures covered              |
| Offline/reconnect   | Refusal before sending permits bounded retry; partial writes, dropped ACK, paper-out and stale status remain uncertain; no blind fallback or duplicate                          |
| Restart/crash       | Before persistence, after claim, during first/second copy, after bytes but before ACK and after durable ACK; recover original identity/history and preserve uncertainty         |
| Duplicate/reprint   | Rapid clicks, two terminals, duplicate HTTP requests, repeated recovery and bridge restart: one original attempt per authorized identity, separate manager-audited reprint      |
| Performance         | No print I/O in main transaction Worker; bounded per-printer queue, concurrency, memory/disk and timeouts; POS remains responsive while printer/bridge is unavailable           |
| Physical acceptance | Human-confirmed kitchen/bar/bill/receipt paper, paper-out/cover/offline/cutter, Windows USB and real LAN models, restart and fallback; record separately from bridge acceptance |

Use fake/local transports for deterministic tests first. Run emulator capture
only after approval, with disposable data and a loopback-only listener. Hardware
certification still needs explicitly authorized physical printer tests. Keep
receipt/customer contents out of public screenshots/log artifacts.

## F. Explicit Final Answers

1. **Production-grade RAW TCP/IP ESC/POS now? NO.** The active transport is OS
   text spooling; command bytes, endpoint control and TCP recovery are missing.
2. **Connect a TCP emulator immediately without Seramet code changes? NO.** Not
   through the existing Seramet printing path without installing an OS printer.
   The emulators themselves accept driverless TCP, but Seramet needs an adapter.
3. **Does current UI support network printer setup? NO.** Generic device
   registration/NETWORK metadata is not a wired host/port/transport setup flow.
4. **Missing/unverified:** RAW encoder/transport, exact multi-station device
   routing, disabled-target enforcement, unified authorization/recovery,
   durable bridge/copy idempotency, bounded transport, genuine diagnostic output,
   trustworthy health/acceptance labels, usable enrollment/setup and real
   emulator/physical acceptance. OS USB/LAN driver operation remains unverified.
5. **Precise pilot completion:** Close P1 recovery/routing/readiness gaps; extend
   the existing bridge with durable identities and Windows/TCP transports;
   encode capability-profiled ESC/POS; complete authorized setup and truthful
   status; pass isolated transport and emulator cases; then certify the intended
   Windows USB and LAN Epson-compatible devices on actual paper. Do not replace
   the transaction/KOT pipeline or certify hardware from simulated tests.

**Stop point:** Report complete. Implementation, emulator installation and
hardware testing await separate approval.
