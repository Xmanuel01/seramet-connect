# Seramet Print Bridge v2

One existing bridge, two transports: Windows text spooling (including
OS-installed USB printers) and RAW TCP ESC/POS. Node.js 24 is recommended.
Nothing runs antivirus or printer sockets in the POS browser or primary Worker.

## Quick Setup (Windows till PC)

1. In Seramet open **Printers & devices**. The **This computer** card offers
   **Download for Windows** (`SerametPrintBridge.exe`, Node included).
2. Open the downloaded file. It installs for the signed-in Windows user under
   `%LOCALAPPDATA%\Seramet\PrintBridge`, starts at every sign-in with no window,
   and appears in Windows Settings > Apps for uninstalling. Running a newer
   download updates it in place and keeps its pairing.
3. Back in Seramet choose **Connect this PC**. The page requests a scoped
   enrollment for a new machine identity (e.g. `front-desk-3f2a9c`) and hands it
   with a fresh local token to the bridge's `POST /pair`. No file is moved and no
   token is typed.
4. Choose the detected Windows printer, save it, and run a test receipt.

Pairing rules: an unpaired bridge answers only Seramet origins
(`https://pos.seramet.co.ke`, plus `SERAMET_BRIDGE_PAIRING_ORIGINS`), and the
enrollment's `authorizationEndpoint` must be that same origin's consume
endpoint, so a page can only bind the bridge to its own server. A paired bridge
re-pairs only for a caller holding its current token; otherwise uninstall and
install again on that PC. The config and job store stay in the install folder
(user-profile ACLs). Unsigned builds show Windows SmartScreen until the exe is
code-signed.

Build: `npm run bridge:build` on Windows (CI embeds Node 24). The
**Publish Windows Print Bridge** workflow builds, smoke-tests the installer and
publishes `print-bridge-v<version>`, the release the Printers page downloads.

The manual enrollment file flow below remains for TCP-only or scripted setups.

## Coordinated Enrollment

Do not deploy the transport PR independently from its authorization/admin and
acceptance dependencies. Unsigned v1 payloads are rejected, not silently trusted.

1. After review/authorization, an operator provisions a random protected server
   `SERAMET_PRINT_SIGNING_KEY` (32+ characters). This implementation does not
   provision or change live secrets.
2. A fully authenticated hardware administrator selects the active branch in
   Seramet Printers, adds a printer, and chooses Windows or TCP. Set its bridge
   identity, roles/stations, paper/cutter/copies and approved fallback.
3. Download scoped enrollment using the printer's download control. The server
   derives a different signing key for each tenant/branch/bridge. The master key
   never leaves the server. Enrollment is audited and requires hardware-manage
   permission; ordinary POS PIN sessions cannot enroll or reconfigure printers.
4. Move the downloaded `config.local.json` securely into this directory or set
   `SERAMET_BRIDGE_CONFIG` to its protected location. Restrict NTFS access to the
   intended Windows account, administrators and SYSTEM. Do not share, commit or
   upload the file or store it in a public/synchronized folder. Protect/remove
   the downloaded copy. Verify local ACLs before real restaurant use.
5. Run `npm run bridge`. Enable the local bridge connection in Seramet after
   startup. The local bearer token and scoped bridge signing key are distinct.

Enrollment includes `authorizationEndpoint`, the existing gateway's HTTPS
`/api/seramet/printing/consume` endpoint. The bridge must reach it before every
physical attempt. Literal loopback HTTP is allowed only in explicit local-test
mode. No authorization endpoint, no connectivity, expired evidence or an
unexpected response means no printer contact. This is deliberate fail-closed
behavior, not offline printer availability.

The optional Windows installer requires explicit bridge/tenant/branch arguments,
the enrollment's HTTPS `AuthorizationEndpoint`,
and the **scoped** `SERAMET_BRIDGE_SIGNING_KEY` in its process environment. Never
give it the server master. It refuses to overwrite an existing enrollment. No
printer ports/drivers, printer defaults or security-policy changes are needed.

## Network and Model Contract

### Finding a Windows/USB printer

Install the manufacturer's Windows driver and confirm the printer appears in
Windows Settings under Printers & scanners. After updating/restarting the existing
bridge, save and enable its enrolled local connection in Seramet Printers.
Authorized hardware administrators then see installed printer names automatically,
or can select Detect installed printers. Choose Configure printer, review its
roles, stations, paper width and bridge identity, then explicitly save. Detection
does not enroll hardware, change Windows defaults, create routes or print a job.
The browser cannot enumerate OS printers without this local bridge. A missing
bridge, wrong branch enrollment or unsupported OS fails closed. An installed
printer may still be unplugged, offline or out of paper. TCP-only printers must
still be configured using the existing authorized TCP transport; this inventory
does not scan the LAN.

The bridge stays on 127.0.0.1. Its Windows account must reach the configured
printer LAN and port (default 9100). Private IPv4 destinations are validated;
all hostname answers must be permitted, then the checked numeric address is
used. Public, metadata/link-local, broadcast-like and unsupported IPv6 targets
are denied. Do not expose printer port 9100 or the bridge on the public internet.
Use an isolated printer network. RAW TCP itself does not encrypt printer bytes.

Loopback printer destinations require BOTH `SERAMET_BRIDGE_MODE=local-test` and
server-signed local-development evidence. Production/staging configuration
rejects literal loopback printer addresses; changing a browser payload cannot
authorize a new host. The server signs the exact immutable document/target.

58mm uses 32 columns and 80mm uses 42. Supported output is ASCII with explicit
replacement for unsupported glyphs, emphasis, initialization, alignment,
wrapping, feed and opt-in full/partial cut. QR, raster logos, native USB and
bidirectional printer-status protocols are not certified/supported by this
profile. Do not select a cutter unsupported by the actual device. Epson ePOS
HTTP/XML is a different protocol, not implemented here.

## API and Delivery Semantics

- Public `GET /health`: bridge process availability, not printer readiness.
- Authenticated `GET /jobs`: recent redacted job stages, never document content.
- Authenticated `GET /printers`: bounded, read-only Windows spooler inventory for
  the bridge's Windows account, with enrolled tenant/branch/bridge identity.
  Allowed-origin and bearer authorization are required. Requests share an
  in-flight enumeration and five-second cache; PowerShell is hidden and has a
  five-second timeout. This is not physical delivery or paper-status certification.
- Authenticated `POST /jobs`: requires short-lived scoped server evidence.
  Duplicate submissions return the existing durable outcome. Polling does not
  create another physical attempt. Altered identity reuse is rejected.

Jobs and attempts use SQLite WAL in a directory hashed by tenant/branch/bridge.
CREATED -> ASSIGNED -> QUEUED -> TRANSMITTING -> BYTES_SUBMITTED or SPOOL_ACCEPTED.
NOT_SENT means no TCP submission occurred; UNCERTAIN means output may exist.
Printer status remains UNKNOWN; neither terminal acceptance state means paper
printed. There is no production dry-run success path.

Concurrency is bounded (default two, maximum four). All TCP targets share one
bridge-wide lane, including fallback, so different hostnames for the same
physical device cannot interleave. Windows endpoints retain independent lanes.
Approved fallback is attempted only after TCP reports NOT_SENT. It
is never attempted after partial bytes, timeout after submission, uncertain OS
spooling, or partial multi-copy acceptance. Unknown output requires inspection.

## Recovery and Retention

1. Do not repeat Send Kitchen or manually send raw bytes to recover an order.
2. Inspect the server KOT obligation and bridge queue. On restart, interrupted
   TRANSMITTING jobs become UNCERTAIN; queued jobs remain durable.
3. Inspect paper/station and device status. A manager records confirmation or
   authorizes retry with a specific reason. Active claims cannot be released
   immediately. Retry preserves original job/copy identity and is bounded to
   three explicitly authorized attempts.
4. Accepted originals require a separate audited KOT reprint obligation. An
   unresolved reprint blocks another copy. Receipt-register copies require an
   entered reason; the server authorizes/audits before signing.
5. After ambiguous customer-document delivery, inspect output before requesting
   a separately marked copy. Do not fabricate a successful acknowledgement.
6. Printer replacement must preserve the target/profile of outstanding jobs,
   or be reconciled before reconfiguration. Changed content/target under the
   same identity fails closed; never edit the ledger to force printing.

### Ledger Loss, Re-enrollment and Reconciliation

Each issued capability has a durable server grant and an atomic, unique attempt
reservation in the existing `audit_events` store. This is shared by terminals
and machines, not inferred from a browser or local ledger. An already-reserved
attempt cannot reserve again after local disk loss, re-enrollment or submission
to another machine. A missing response after reservation is ambiguous: no
automatic replay, fallback or "not printed" claim is allowed. The existing KOT
manager review must record physical inspection and authorize a fresh claim;
customer copies require a specific entered reason and durable server audit.
There are at most three reserved attempts per logical job/copy. Independent
explicit reprints are separately identified and visibly marked copies.

Stop the old bridge before replacement. Preserve the ledger and inspect server
obligations, reservations and paper. Re-enrollment is not evidence of
non-delivery and cannot reset history. Configuration changes invalidate issued
targets/fallbacks; reconcile first, then use an authorized recovery or copy.
The TCP lane is local to a bridge process. Unrelated bridge IDs targeting the
same hardware are not a distributed device lock: assign one active bridge per
physical printer and drain/reconcile before moving it. Copied machine secrets
are a credential incident, not a supported deployment pattern.

Retain the server print grant/reservation audit records. Deleting/restoring
those records together with local ledgers removes replay evidence and cannot
be made exactly-once by this software. After server rollback or loss, stop
printing and explicitly reconcile all potentially delivered documents before
resuming; never automatically replay restored queues. Backup restoration cannot
undo physical output. No new live storage or credential changes are made here.

Accepted/cancelled job content and signed payload are logically scrubbed immediately; fingerprints, metadata
and attempt history remain to prevent replay. Unresolved documents retain their
payload for recovery. Pending work is bounded to 100; unresolved work to 1000.
Capacity exhaustion rejects new submissions rather than losing them. Inspect
and reconcile unresolved work; never delete uncertainty to make capacity free.
The ledger has no automatic deletion of replay-protection tombstones. WAL files
and backups remain sensitive; logical deletion is not forensic secure erasure. Windows
temporary spool text is removed after submission. Securely back up the scoped
ledger with the service stopped before moving hardware; do not restore an old
ledger as if it establishes non-delivery. Preserve uncertainty after disk loss.

## Local Acceptance

Native solid-border RAW TCP rendering is opt-in and requires bridge 3.0.0 plus
explicit supported capabilities. See [Native Raster ESC/POS](../docs/RASTER_ESC_POS.md)
for signed-envelope compatibility, bounds, test evidence and safe fallback rules.
Distribute the sibling `printing-core` folder with the bridge; keep existing
enrollment and ledgers. Windows spooler output remains text-only.

```powershell
node --test local-print-bridge/printing.test.mjs
node scripts/run-pilot-e2e.mjs tests/e2e/printing-admin.spec.ts
```

For the pinned visual emulator (development tools only, never app dependencies):

```powershell
git clone https://github.com/maseylan/escpos-virtual-printer.git .seramet/escpos-emulator
git -C .seramet/escpos-emulator checkout 1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d
npm install --ignore-scripts --no-save --package-lock=false --prefix .seramet/escpos-emulator-runtime pino@9.5.0 esbuild@0.25.12
node scripts/verify-print-emulator.mjs
```

This uses the upstream TCP server, parser/state and actual ReceiptViewer in a
headless browser. It does not install Electron, Windows printers or drivers.
127.0.0.1:9100 must be free. The script closes listeners, browser and bridge and
removes disposable job data in `finally`. Captures are generated under
`.seramet/printing-acceptance`. The emulator has 50/78/80mm visual modes, not
exact 58mm: narrow visual output is approximate while 32-column bytes are tested.
The upstream model lacks the paper-out/status behavior required to certify real
hardware. Successful emulation is not physical-paper or universal Epson proof.
