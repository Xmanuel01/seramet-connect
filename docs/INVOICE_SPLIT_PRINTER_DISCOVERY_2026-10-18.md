# Custom invoice splitting and installed printer discovery

## Corrections

The invoice toolbar previously called `splitBill` immediately with two equal
allocations. It now opens the same dialog as clicking an invoice reference.
Two people and Multiple people accept custom positive amounts; additional people
can be added without a fixed UI count limit. The existing server request bounds
and monetary safety limits still apply. All allocations must match the exact
invoice total in integer minor units before confirmation is enabled.

For a KES 600 invoice, 400 + 200 and 300 + 300 are valid. 400 + 300 is rejected;
200 + 300 + 50 leaves KES 50 to allocate. Incomplete, nonpositive, excessively
precise and out-of-range amounts cannot be submitted. Errors retain the entered
amounts, and an in-flight guard prevents duplicate confirmation clicks.

The existing authorized, revision-checked `splitBill` command still performs the
financial mutation. The dialog does not report success until the authoritative
response contains the expected child invoices. Partially paid and finalized
invoices cannot be split. Other invoices, financial component allocation,
historical record identities, authorization and print recovery are unchanged.

Invoice-list references now display `Invoice 00027` instead of `BILL-00027`.
Persisted references are not rewritten. A pre-payment printed BILL remains a
bill; this change does not alter tax-invoice or receipt document semantics.

## Printer connection

The existing bridge's `/printers` endpoint previously returned an empty array.
It now enumerates installed Windows printers through a fixed read-only
`Get-Printer` command. Enumeration is origin/bearer protected, bounded to five
seconds and 128 KiB, coalesces concurrent requests and caches successful results
for five seconds. Inventory includes the bridge's enrolled tenant and branch;
the browser rejects mismatched inventory before displaying printer names.

After updating/restarting the existing enrolled bridge, an authorized hardware
administrator can save and enable the local connection in Seramet Printers.
Installed printers appear automatically. Configure printer prefills the exact
Windows name and bridge identity, but requires an explicit configuration save.
There is no automatic enrollment, route creation, default-printer change, LAN
scan, driver installation or test printing. Missing or wrong-scope bridges fail
closed. No dependency was added to the frontend or primary API Worker.

The bridge runs under a Windows account: printers installed for another account
may not appear. Windows must have the appropriate manufacturer driver installed.
Installed inventory is not proof of paper, connectivity or physical delivery.
The existing TCP transport remains available for explicitly configured LAN
printers. See `local-print-bridge/README.md` for enrollment and setup steps.

## Validation evidence

- 80 focused unit/API tests passed: allocation validation, financial component
  conservation, existing transaction flows, printing authorization and routing.
- All 25 local bridge tests passed, including authenticated discovery, bounded
  enumeration, caching, queue durability, recovery, TCP and raster regressions.
- All four focused browser scenarios passed on disposable loopback data:
  two-person desktop split, multiple-person phone split, automatic scoped
  discovery, and existing signed TCP diagnostic/branch-denial acceptance.
- TypeScript typecheck, focused ESLint, Prettier checks, production build and
  `git diff --check` passed. No comprehensive certification was repeated.
- Desktop and phone dialog captures were generated and visually reviewed at
  `.seramet/invoice-split-acceptance/desktop.png` and `phone.png`; the three
  invoice/discovery scenarios passed again while producing these captures.
- The split scenarios verify blank initial amounts, no immediate mutation,
  exact selected invoice, mismatch rejection, excessive amounts without a crash,
  failed-response draft preservation, double-click protection, persisted child
  totals, unrelated invoice preservation and refresh recovery.
- Discovery acceptance verifies no implicit writes, exact printer-name prefilling,
  wrong-branch rejection and narrow-screen overflow checks.
- One initial discovery assertion failed because it counted a canceled startup
  request as a completed enumeration. The trace showed one canceled GET followed
  22 ms later by one successful GET during scope hydration. The test now verifies
  one completed scoped response and a bounded initial request count. Bridge tests
  independently verify coalesced OS enumeration. No timeout was increased.
- A genuine read-only invocation of the Windows discovery module found only
  Microsoft Print to PDF on the accessible laptop. No print job was submitted.
  The restaurant workstation and its thermal printer remain unverified.

No live database operation, credential change, merge, push or deployment was
performed. This is local engineering evidence, not physical printing acceptance.
