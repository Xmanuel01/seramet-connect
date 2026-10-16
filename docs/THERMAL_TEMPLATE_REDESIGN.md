# Thermal Document Template Redesign

Date: 15 October 2026

## Scope

Presentation changes only, on `codex/thermal-template-redesign`, based on PR #128
head `c3521770804d579d62e84b01ef43347913022316`. The redesign is not deployed.
The existing ESC/POS encoder, gateway, routing, signatures, print claims, durable
queue, retry/recovery authorization and audit mechanisms are retained.

## Layout Contract

- 58mm uses 32 monospaced columns; 80mm uses 42.
- Centered configured text branding is the logo fallback. Restaurant, branch and
  available contact/PIN details are wrapped rather than truncated. Production
  tickets retain a compact restaurant/branch header.
- Document title (TAX INVOICE for invoices), number, order/date/time, operator, service mode/table and
  applicable customer details use ruled sections.
- Customer tables use `QTY | ITEM | PRICE` at 58mm and
  `QTY | DESCRIPTION | AMOUNT` at 80mm. The monetary column contains the line
  amount; invoices additionally show the unit price below each item.
- Kitchen and bar tables use `QTY | ITEM`, with the existing optional priced-KOT
  setting respected. Station and order identity remain prominent.
- Long descriptions wrap in their own column. Modifiers and item notes are
  indented full-span rows. Production special requests use a separate ruled box.
- Totals have aligned amounts and a distinct TOTAL band. Service and discount
  rows are supported when explicitly supplied; the renderer does not infer them
  or recalculate the authoritative total. Existing adapters are not changed to
  manufacture these amounts.
- Existing paid amounts, change, payment methods/references and loyalty details
  remain available. Bills retain PAYMENT PENDING; receipt and invoice settlement
  information continues to use the existing supplied payment data.
- Customer duplicates have a conspicuous DUPLICATE COPY section. Kitchen/bar
  recovery tickets retain REPRINT and amendment labels. Internal original-job
  IDs remain in the job/audit record rather than cluttering the paper.
- Thermal invoices now honor the configured thermal width instead of being
  forced into A4. Explicit A4 configuration remains supported at 78 columns.

No monetary, date/time, authorization, permission, routing or recovery semantics
are redesigned. No schema, dependency, credential or infrastructure changes are
required.

## Fresh Emulator Evidence

The existing pinned ESC/POS emulator revision is
`1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d`. The verifier sends real encoded bytes
through the local bridge and TCP listener and renders the emulator's own
ReceiptViewer. The capture viewport expands to include the entire paper.

| Document          | 58mm                                                       | 80mm                                                       |
| ----------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Kitchen order     | [Preview](thermal-template-evidence/kot-58mm.png)          | [Preview](thermal-template-evidence/kot-80mm.png)          |
| Bar order         | [Preview](thermal-template-evidence/bar-58mm.png)          | [Preview](thermal-template-evidence/bar-80mm.png)          |
| Bill              | [Preview](thermal-template-evidence/bill-58mm.png)         | [Preview](thermal-template-evidence/bill-80mm.png)         |
| Receipt           | [Preview](thermal-template-evidence/receipt-58mm.png)      | [Preview](thermal-template-evidence/receipt-80mm.png)      |
| Invoice           | [Preview](thermal-template-evidence/invoice-58mm.png)      | [Preview](thermal-template-evidence/invoice-80mm.png)      |
| Kitchen reprint   | [Preview](thermal-template-evidence/kot-copy-58mm.png)     | [Preview](thermal-template-evidence/kot-copy-80mm.png)     |
| Bar reprint       | [Preview](thermal-template-evidence/bar-copy-58mm.png)     | [Preview](thermal-template-evidence/bar-copy-80mm.png)     |
| Bill duplicate    | [Preview](thermal-template-evidence/bill-copy-58mm.png)    | [Preview](thermal-template-evidence/bill-copy-80mm.png)    |
| Receipt duplicate | [Preview](thermal-template-evidence/receipt-copy-58mm.png) | [Preview](thermal-template-evidence/receipt-copy-80mm.png) |
| Invoice duplicate | [Preview](thermal-template-evidence/invoice-copy-58mm.png) | [Preview](thermal-template-evidence/invoice-copy-80mm.png) |

Each preview has adjacent parsed `.txt` evidence. The
[summary](thermal-template-evidence/summary.json) records text SHA-256 hashes,
command counts and transport outcomes. All 20 have zero unknown commands,
bounded 32/42-column output, initialization, feed and cut commands. Visual review
covered the required six originals plus invoice and copy examples: no clipped
columns or missing totals, instructions or footers were observed.

These are disposable **presentation fixtures**, including explicit service and
discount example values. Their test-only signer is not evidence of real gateway
authorization or a financial transaction. The separate operational browser test
uses the actual application gateway and employee session.

## Validation

- Focused rendering/API/outbox/recovery/routing tests: **96 passed**, including
  **23 layout tests** for all 20 documents and extreme long identifiers/amounts
  at 58mm, 80mm and A4.
- Bridge transport/security/concurrency/recovery tests: **14 passed**.
- `npm run validate`: **passed**; typecheck, ESLint, **783/783 unit tests**,
  production build and compiled Worker Queue/Cron registration. ESLint reports
  28 existing warnings and zero errors.
- Final emulator verification: **20/20 passed**.
- Operational browser regression: **1/1 passed** in 1.6 minutes. The real employee
  flow covers Hold/recall, multi-station kitchen dispatch, invoice/bill, cash
  settlement/receipt, both widths, audited copies, duplicate submissions,
  lost-ledger/second-machine rejection, branch denial, printer outage recovery,
  bridge restart and uncertain delivery. See the sanitized
  [operational result](thermal-template-evidence/operational-regression.json).
- Formatting and `git diff --check`: **passed**. The earlier complete twelve-
  scenario browser acceptance suite is not claimed as rerun for this redesign.

The tested source is the local working tree, not the branch's unchanged base
commit. `candidateCommit` in the operational result reports that base HEAD; it
does not claim the uncommitted redesign exists in that commit. SHA-256 of
`src/lib/seramet-print-service.ts`:
`99312fdd672395ddff2e76077b3a4605d174becfb31951e08699a9e7074f3deb`.
SHA-256 of `src/server/printing-api.ts`:
`5532fdb1298de33e3523f8cc475b67e6d64374b7ab8a82dfbc836b6035d005d3`.

## Invoice Review Correction - 16 October 2026

Thermal invoices and duplicate copies now retain the TAX INVOICE title, matching
the A4 invoice and existing document semantics. The obsolete due-date helper is
removed: a creation timestamp is not a payment due date, and the current print
input has no authoritative due-date value. No fabricated `Due Date: -` is printed
at any width. Amounts and the ruled layout remain unchanged.

Focused renderer/API/flow regression: **87/87 passed**, including **26 layout
tests** and explicit 58mm/80mm/A4 title, amount and absent-due-date assertions.
The emulator verifier passed **20/20** again; only the four invoice originals and
copies and their summary entries were replaced. Other capture evidence and the
earlier operational browser result above remain historical evidence from the
original redesign, not newly rerun operational certification.

Corrected renderer SHA-256:
`a2eb40d02393bd38509d3fab791692f42d0664f30afa68996c4f2e0034142c8e`.

## Physical Limitations

- The pinned emulator labels its narrow paper geometry 50mm; the Seramet 58mm
  profile still encodes and checks exactly 32 columns. This is not a claim that
  a physical 58mm printer was calibrated.
- Narrow paper necessarily wraps more and uses more vertical paper. Very large
  line amounts move to a full-span Amount row rather than being truncated.
- ASCII rules and configured text branding preserve current code-page and
  printer compatibility. No raster logo download or new Unicode/box-drawing
  dependency is introduced. TOTAL emphasis comes from hierarchy and rules,
  without changing the encoder's existing emphasis behavior.
- Actual printable width, font density, cutter support, paper feed and physical
  output still require verification on the target device. BYTES_SUBMITTED is
  not proof of paper delivery. Uncertain delivery must not automatically retry.
- Existing operator/reason provenance and amendment semantics are retained;
  this presentation change does not certify a new recovery/security model.

Validation was performed locally before committing the redesign. Delivery is a
focused review PR only; no merge, manual deployment, database operation,
printer-driver installation or physical-printer certification is authorized.
Repository-managed CI or preview builds may run automatically on push.
