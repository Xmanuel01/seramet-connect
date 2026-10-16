# Final Thermal Document Design

16 October 2026. Existing PR #129. The owner's receipt grid governs customer
documents; the ticket comparison governs kitchen, grill and bar production.
Reference images are design specifications, not business data.

## Final Layout

- Existing 58mm/32-column and 80mm/42-column ASCII profiles remain in use.
- Customer documents have centered configured merchant branding, branch and
  available contact/PIN details. A legacy SERAMET platform-brand default falls
  back to the merchant business name. No raster-logo support is invented.
- A thin divider precedes BILL, RECEIPT / PAID or TAX INVOICE. Reference, order,
  date/time, table/type and operator/customer details use compact aligned rows,
  not boxed metadata. Empty values and fabricated due dates are omitted.
- Customer tables use `QTY | ITEM | AMT` at 58mm and `QTY | ITEM | AMOUNT` at 80mm.
  Long descriptions wrap in their column. Modifiers and notes are indented
  full-span rows. Customer items share one table; production retains row dividers.
- Subtotal, tax and supplied nonzero service/discount values remain authoritative.
  TOTAL is separated by rules. No totals or tax rates are inferred/recomputed.
  Invoices retain unit prices, tax/customer information and TAX INVOICE semantics
  at thermal and A4 widths. This is not a legal tax-compliance certification.
- Receipts retain actual paid amount, tender breakdown, available references and
  change, with the configured short footer. Unconfigured payment instructions
  no longer print a configuration-warning placeholder.
- Production starts directly with KITCHEN ORDER / KOT number or BAR ORDER / BAR
  number, followed by order/type/table/date/station/operator and a short branch
  row. No merchant header, contacts, introductory feed, NEW ORDER footer or
  repeated KITCHEN TICKET / BAR TICKET footer remains.
- Production has a `QTY | ITEM` table, station-specific items and no prices by
  default. The existing explicit priced-KOT option is unchanged. Special requests
  have a ruled box; order instructions are not copied beneath every item.
- When the existing emphasis option is enabled, fixed ESC/POS commands emphasize
  titles, TOTAL, reprint/special-request labels and allergy text. Input is still
  sanitized; user-supplied controls never become device commands.
- Production reprints retain REPRINT and original ticket/order/station identity.
  Reprinted by identifies the authenticated claim holder, not the original cashier.

## Preserved Safety

RAW TCP, Windows transport, signed identities, tenant/branch permissions,
routing, immutable obligations, durable queues, idempotency, server attempt
reservations, audit and manager-reviewed recovery remain intact. Uncertain
delivery never automatically retries. Customer receipts still require a confirmed
authoritative receipt through the existing gateway.

Customer duplicate payloads remain stable across terminals for the same reprint.
Injecting the current requester's display name changed the fingerprint on replay
in the regression test, so production customer copies do not add that field.
Actual operator attribution remains in the durable server audit. Fixture copies
exercise the renderer's optional operator label separately; this is not a claim
that production customer copies include it. KOT reprint attribution has a focused
API regression proving the claim holder is distinct from the original cashier.

## Actual Emulator Evidence

Pinned upstream: `1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d`. All 20 final images
show its actual ReceiptViewer paper after real ESC/POS bridge/TCP delivery, cropped
only to the paper element. They are not design mockups or re-typeset documents.

| Document          | 58mm                                                     | 80mm                                                     |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Bill              | [Final](thermal-template-evidence/bill-58mm.png)         | [Final](thermal-template-evidence/bill-80mm.png)         |
| Paid receipt      | [Final](thermal-template-evidence/receipt-58mm.png)      | [Final](thermal-template-evidence/receipt-80mm.png)      |
| Tax invoice       | [Final](thermal-template-evidence/invoice-58mm.png)      | [Final](thermal-template-evidence/invoice-80mm.png)      |
| Kitchen KOT       | [Final](thermal-template-evidence/kot-58mm.png)          | [Final](thermal-template-evidence/kot-80mm.png)          |
| Bar ticket        | [Final](thermal-template-evidence/bar-58mm.png)          | [Final](thermal-template-evidence/bar-80mm.png)          |
| Bill duplicate    | [Final](thermal-template-evidence/bill-copy-58mm.png)    | [Final](thermal-template-evidence/bill-copy-80mm.png)    |
| Receipt duplicate | [Final](thermal-template-evidence/receipt-copy-58mm.png) | [Final](thermal-template-evidence/receipt-copy-80mm.png) |
| Invoice duplicate | [Final](thermal-template-evidence/invoice-copy-58mm.png) | [Final](thermal-template-evidence/invoice-copy-80mm.png) |
| Kitchen reprint   | [Final](thermal-template-evidence/kot-copy-58mm.png)     | [Final](thermal-template-evidence/kot-copy-80mm.png)     |
| Bar reprint       | [Final](thermal-template-evidence/bar-copy-58mm.png)     | [Final](thermal-template-evidence/bar-copy-80mm.png)     |

Adjacent parsed text and [summary](thermal-template-evidence/summary.json) record
SHA-256 hashes, encoded line counts and zero unknown commands. All 20 images
were visually reviewed for alignment, wrapping, clipping, notes, amounts and copy
labels. Automated checks assert bounds, titles, header/footer suppression and feed/cut.

Before images/text use the same filenames under
[before-final](thermal-template-evidence/before-final/), from baseline
`f5c0d8c4cfcd627ab92be0ada7cc9b5d2cc1fe38`. Before images include the emulator
frame; final images crop its paper. Do not infer paper savings from pixel height.

## Encoded Line Savings

Counts are actual parsed NewLine commands, not emulator CSS/buffer height.
The existing three-line `ESC d 3` cutter feed is unchanged and counted separately.
Fixture items/amounts are retained; reprints now demonstrate a distinct, longer
operator name. No extra introductory feed is introduced.

| Document             | Before | Final | Saved |
| -------------------- | -----: | ----: | ----: |
| Kitchen 58mm         |     32 |    23 |     9 |
| Kitchen 80mm         |     30 |    21 |     9 |
| Bar 58mm             |     32 |    23 |     9 |
| Bar 80mm             |     30 |    21 |     9 |
| Kitchen reprint 58mm |     36 |    24 |    12 |
| Kitchen reprint 80mm |     33 |    22 |    11 |
| Bar reprint 58mm     |     36 |    24 |    12 |
| Bar reprint 80mm     |     33 |    22 |    11 |

Original production tickets save approximately 28-30% of text lines. Customer
originals save 7-11 lines. All 20 comparisons are in
[line-comparison.json](thermal-template-evidence/line-comparison.json).
These are not physical millimetre measurements or guarantees for every order.

## Validation and Provenance

- Focused rendering/API/routing/outbox/recovery: **100/100 passed**, including
  **27 layout tests**, branded-header fallback, absent placeholders, monetary
  values, station isolation and correct reprint attribution.
- Bridge transport/security/concurrency/recovery/emphasis: **15/15 passed**.
- Final emulator cases: **20/20 passed**.
- Real employee POS / four independent TCP emulators: **1/1 operational browser
  scenario passed** in 2.3 minutes. It covers Hold/recall, station dispatch,
  invoice/bill, cash receipt, both widths, audited copies, duplicate submissions,
  branch denial, outages, restart and uncertain delivery. See
  [operational result](thermal-template-evidence/operational-regression.json).
- Repository validation and GitHub CI results are recorded in the PR completion
  comment; a failed security gate is never a successful certification.

Evidence was generated from the final local working tree before commit. The
operational result's candidateCommit denotes its base HEAD, not a claim that the
refinements existed in that commit. Exact tested source hashes are in
[source-hashes.json](thermal-template-evidence/source-hashes.json).
Fixture-only signing is presentation evidence; operational browser acceptance
uses the real authenticated gateway, not a mock authorization endpoint.

## Known Limits

- The pinned emulator labels narrow geometry 50mm; Seramet still checks 32
  columns for its 58mm profile. Its renderer does not faithfully show emphasis
  and inserts spacing on style changes. Commands and encoded line counts, not
  those CSS artefacts, establish emphasis/feed. Upstream is not patched to make
  the evidence look better.
- ASCII rules approximate thin borders. No Unicode dependency, fake logo or new
  raster support is introduced. Windows retains text spooling; native emphasis
  evidence applies to RAW ESC/POS.
- Printable dots, font density, darkness, cutter/feed and physical paper remain
  printer-model-specific and unverified. BYTES_SUBMITTED is not proof of delivery.
- Narrow paper wraps more; oversized amounts use full-span rows instead of
  truncation. Existing A4 output remains bounded at 78 columns.
- This is not dependency remediation or a new architecture. The known production
  dependency-audit blocker must not be bypassed.

No merge, manual deployment, live database operation, secret provisioning or
driver installation is part of this work. Existing repository-managed preview
builds may run automatically on push.
