# Native Raster ESC/POS

## Scope and Compatibility

This dependent draft builds on PR #129's approved text templates. It adds real
solid pixel borders, not replacement dash characters. Bills, receipts, tax
invoices, food KOTs, bar tickets and their authorized copies share the existing
business content, wrapping, amounts and delivery lifecycle. A4 is unchanged.

Only explicitly configured RAW TCP printers supporting normal-mode `GS v 0`
are eligible. Epson documents this as an obsolete/legacy command, not universal
Epson compatibility: [Epson GS v 0 reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html).
Other command families are rejected. Windows `Out-Printer` remains text-only.
Manufacturer names, TCP acceptance and bridge health never establish device
capability, paper output or printer status.

## One Existing Delivery Pipeline

1. The authenticated gateway loads the exact authoritative record and printer.
2. Existing text templates retain all essential information and 32/42-column
   wrapping. A compatibility adapter creates a printer-independent, versioned
   layout of text, tables, borders and emphasis. It performs no monetary arithmetic.
3. The signature binds content, canonical layout, renderer version, profile,
   targets, tenant, branch, document, copy and recovery identity.
4. The existing durable bridge ledger fingerprints the layout. Before consuming
   the server reservation and sending bytes, the worker re-verifies the signed
   envelope and uses its fields rather than editable ledger payload fields.
5. The configured renderer emits text or bounded raster bands through the same
   transport. There is no second queue, authorization system or financial source.

Raster needs authorization envelope **v2** and bridge **3.0.0**. The layout's
separate `version: 1` is not the envelope version. Old bridges reject v2, avoiding
silent raster-to-text downgrade. New bridges retain v1 text compatibility;
existing profiles omit the new fields and retain their previous fingerprints.
Upgrade the bridge software, including its sibling `printing-core` folder,
before enabling raster. Reconcile pending work before profile changes; switching
mode cannot reset an already-issued job identity or reservation.

## Bounds and Resource Isolation

| Setting         | Enforced bound                                                  |
| --------------- | --------------------------------------------------------------- |
| Layout          | 512 rows; 32 columns (58mm) or 42 (80mm); no truncation         |
| Printable width | 256-832 dots, multiple of 8; minimum 8 dots per column          |
| Resolution      | Explicit 203 or 300 DPI                                         |
| Band height     | 16-256 dots                                                     |
| Document height | Configured 256-32768 dots                                       |
| Encoded bytes   | Configured 4096-1048576 bytes, including commands/feed/cut      |
| Band allocation | At most 26624 bytes                                             |
| TCP timing      | Existing 3s resolution/connect, 5s inactivity, 15s overall      |
| Concurrency     | Existing serialized TCP lane; bridge concurrency 1-4, default 2 |

No full-page bitmap is allocated in the production bridge. Bounded band buffers
are concatenated into the capped transport payload; concatenation can temporarily
hold approximately twice the encoded bytes plus layout/runtime overhead. Rendering
is synchronous but bounded; the existing TCP lane serializes physical destinations.
The primary Worker produces only the small canonical layout. The POS frontend
does not load a font, graphics engine, canvas package or new dependency.

Glyphs use a bundled printable-ASCII subset of the Adafruit GFX classic font,
pinned at `e6ffe30f00a6af1c69aa85af35b1da83c5bca2c8`, with its BSD license retained
in `local-print-bridge/FONT-LICENSE.txt`.
[Pinned upstream source](https://github.com/adafruit/Adafruit-GFX-Library/blob/e6ffe30f00a6af1c69aa85af35b1da83c5bca2c8/glcdfont.c).
No remote images/fonts are fetched. The existing ASCII sanitization remains;
this does not add Unicode typography or raster logos.

## Administration and Safe Fallback

The existing branch-scoped printer form adds rendering mode and advanced raster
limits. Initial raster suggestions are 384 dots (58mm), 576 dots (80mm), 203 DPI,
128-dot bands, 8192-dot height and 524288 bytes. These suggestions require operator
confirmation against the actual printer manual; they are not model detection.
The configured cutter and emphasis settings remain authoritative.

Managers can issue separate, server-generated **Test text** and **Test raster**
diagnostics. Raster diagnostics require saved explicit capabilities. Rendering
overrides are rejected for business documents. Cross-width raster fallbacks are
rejected; no alternate wrapping or unapproved target is synthesized by the bridge.

There is **no automatic renderer retry**. An explicitly configured fallback may
run only after the existing transport reports `NOT_SENT` (no potentially submitted
bytes). Partial writes, missing acknowledgements, restarts during transmission
and uncertain output require existing manager reconciliation and audited recovery.
Never change a job's mode to retry an ambiguous print. Server reservations,
attempt limits, branch isolation and copy audit remain in force. Exactly-once
physical printing is not claimed.

## Reproducible Evidence

Run from the repository root with Node 24 and the existing pinned disposable
emulator setup described in `local-print-bridge/README.md`:

```powershell
node --test local-print-bridge/printing.test.mjs local-print-bridge/raster.test.mjs
node scripts/verify-print-emulator.mjs
$env:SERAMET_PRINT_RENDERING='RASTER_ESC_POS'
node scripts/verify-print-emulator.mjs
Remove-Item Env:SERAMET_PRINT_RENDERING
node scripts/run-pilot-e2e.mjs tests/e2e/printing-operational.spec.ts
```

The harness captures actual loopback TCP bytes through a transparent tap. Raster
PNGs are reconstructed only from those captured `GS v 0` bitmap bits using an
independent test decoder, and every bitmap byte must also match the pinned
upstream emulator's raster parser. The upstream ReceiptViewer adds spacing between
raster bands; it is deliberately not used to judge band continuity. Text PNGs use
the actual upstream ReceiptViewer (its narrow mode approximates 58mm).

`raster-printing-evidence/` contains 20 raster and 20 text captures, raw `.bin`
streams, 20 side-by-side comparisons and summaries with hashes and measurements.
Raster `.source.txt` files are signed-input semantic text, **not OCR or decoded
printer text**. The operational result is a sanitized separate real gateway run;
its `candidateCommit` is the parent HEAD at test time. `source-manifest.json`
records the actual tested source hashes so uncommitted-source evidence is explicit.

All 20 raster originals/copies were visually inspected: continuous outer borders,
aligned totals, wrapped names/notes, distinct copy labels and correct TAX INVOICE
titles. Modifier rows intentionally span the table rather than retaining internal
price/quantity dividers. Narrow output needs more lines; large values retain the
existing full-width wrapping. Pixel tests cover intersections, band seams,
golden hashes, custom widths/DPI, malformed/oversized inputs and signed integrity.

## Release Status

### Measured Local Capture Run

| Measurement                  | Raster (20 documents) | Text (20 documents) |
| ---------------------------- | --------------------- | ------------------- |
| Encoded bytes                | 22219-66315           | 705-1723            |
| Local encode time            | 1.63-29.54 ms         | 0.19-11.43 ms       |
| Local bridge submission time | 55.6-464.4 ms         | 45.9-189.7 ms       |
| Raster bands                 | 4-8                   | Not applicable      |
| Bitmap height                | 406-1004 dots         | Not applicable      |

At the configured 203 DPI, bitmap content is approximately 50.8-125.6 mm long,
before the three feed lines and any firmware cut margin. Captured bands are at
most 9216 bytes (576 dots by 128 rows). During individual encodes, observed RSS
snapshot changes were 0-1937408 bytes and heap changes -54992 to 692952 bytes;
garbage collection explains negative deltas. These are before/after snapshots
inside the shared Node/emulator harness, **not peak or isolated bridge memory**.
Timing includes local host scheduling and is not a printer-speed benchmark.
Raster costs more bytes and paper density than text; use explicit tested profiles.

This is emulator evidence, not physical-printer certification. Actual printhead
width, firmware GS v 0 behavior, feed length, cut action, throughput, heat density,
paper-out handling and device acknowledgement still require the target hardware.
Do not enable raster merely because a TCP write succeeds. No live settings,
enrollment secrets, database records or manual deployments are changed by this work.
