# Seramet Lite: Site and Account-to-Closing Audit

Date: 18 October 2026, Africa/Nairobi.

## Decision

**Not certified for unrestricted restaurant use or all Sales workflows.**
The navigation/rendering audit passed, but rendering is not functional certification.
Confirmed workflow gaps below must be fixed, excluded from the pilot, or explicitly accepted.
External-provider and physical-device acceptance remain separate release gates.

## Candidate, Environment and Boundaries

- Repository: Xmanuel01/seramet-connect.
- Candidate: `b142d72501597a6a6766ea5e6b91346ff1aec144`, branch `codex/pilot-staff-integration`, draft PR #138.
- Workspace: `C:/Users/USER/Desktop/seramet-pilot-completion`.
- Browser target: disposable local application, `http://127.0.0.1:4173`, Chromium.
- Each numbered simulation seeds a different random tenant, two branches and test identities.
- Catalog: existing reusable Pilot meal and operational food/drink fixtures. No real restaurant menu or prices changed.
- Employee accounts, device activation, PIN verification, orders, invoices, cash payments and closing use actual application APIs and the local authoritative SQLite repository.
- The six newly created employees use the existing broad PILOT_MANAGER test role (with Cashier job title), as in the printing operational fixture. They prove transactional journeys, not least-privilege cashier authorization. The separate staff-role browser scenarios test actual restricted chef, bartender, cashier and supervisor presets.
- Owner identity is a signed internal local fixture. This does **not** prove genuine Supabase signup, email verification, invitation delivery or password recovery.
- Kitchen dispatch and duplicate-dispatch checks use the server API; invoice creation, cash settlement and final closing confirmation use browser controls. These are hybrid journeys, not six exclusively click-driven physical restaurant shifts.
- No staging/production database access or writes, deployments, merges, secret provisioning, live mail or payment-provider calls.
- Application implementation remains unchanged. Added code is an optional audit suite and its existing runner integration.
- The reusable disposable seed now supplies the correct branch-specific station ID for its menu item in each branch. This is test-data repair only, not a migration or application routing change.

## Coverage and Meaning of Results

1. All **91 unique sidebar navigation routes** were visited as an authenticated manager, waiting for the signed-in shell rather than the transient session bootstrap screen.
2. All **14 Sales pages** were captured at desktop 1440x1000 and mobile 390x844.
3. Recorded uncaught page exceptions: **0**. Recorded HTTP 5xx responses: **0**. Page-load failures/crashes: **0**.
4. Document-level horizontal overflow on the 14 Sales pages: **0**. This does not certify every popup, keyboard, tablet or real handset.
5. Additional Sales subviews/table setup and six financial journeys are recorded below.
6. Non-Sales pages received an authenticated rendering smoke test, not exhaustive creation/editing/deletion of every business object. An empty page is not evidence of a working domain workflow.
7. Public signup/provider boundaries receive separate existing regression tests; a seeded owner must never be called successful live registration.

## Six Independent Simulations

Common path: fresh disposable restaurant fixture -> real staff account creation -> device enrollment/activation -> employee-code/PIN browser login -> drawer with KES 100 float -> existing catalog item -> Hold -> two explicit dispatch submissions -> one KOT obligation -> invoice UI -> cash UI -> real receipt record -> supervisor confirmation -> immutable day close -> secure PDF download.

| #   | Difference                                                                | Expected sale / counted cash | Result                                               |
| --- | ------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| 1   | Basic single-cashier cash sale                                            | KES 1,000 / 1,100            | CASH/CLOSE PASS; F1 remains                          |
| 2   | Held order recalled after browser reload; preparation note survives       | KES 1,000 / 1,100            | CASH/CLOSE PASS; F1 remains                          |
| 3   | Quantity 2 and 30 realtime events while editing a note                    | KES 2,000 / 2,100            | CASH/CLOSE PASS; F1 remains                          |
| 4   | Two cash settlements against one invoice                                  | KES 1,000 / 1,100            | CASH/CLOSE PASS; F1 remains                          |
| 5   | Branch B sale/close while a real Branch A control order remains unchanged | KES 1,000 / 1,100            | CASH/CLOSE PASS after fixture correction; F1 remains |
| 6   | KES 1 counted overage with explicit explanation                           | KES 1,000 / 1,101            | CASH/CLOSE PASS; F1 remains                          |

For each completed run, inspect `.seramet/site-audit/scenario-N/result.json`, `closing.pdf` and `closed.png`.
A test stopping at an earlier stage is a FAIL/BLOCKED journey, not a completed close.
No KOT obligation is falsely marked physically printed; actual delivery is outside these six simulations.
These are cash-sale financial closure journeys, not six complete human-operated restaurant shifts: actual cooking/ready/serving, courier delivery, real owner verification and provider confirmations are not performed by them.

## Sales Page Matrix

| Page           | Evidence and limit                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POS            | Desktop/mobile render, existing items, staff PIN, Hold, draft note, recall, quantity and realtime scenarios. Printer availability correctly reports incomplete fixture business-profile configuration. |
| Orders         | Authenticated desktop/mobile render. Exact held-order selection and multi-terminal conflicts additionally covered by existing browser regression.                                                      |
| Online Orders  | Authenticated empty-list/render check. No real web/marketplace order-provider delivery certified.                                                                                                      |
| Marketplace    | Render and connection-empty state; ORDERS/MENU SYNC/EXCEPTIONS subviews audited separately. No external sync or queue processing initiated.                                                            |
| Tables         | Render, filters and table setup exercised separately. Occupancy is not wired to authoritative operational state; see F3.                                                                               |
| Invoices       | Actual UI invoice creation and cash settlement; duplicate server invoice preparation must retain one invoice.                                                                                          |
| Pending        | Authenticated desktop/mobile render. Unpaid/ambiguous provider cases remain covered by domain tests, not newly completed provider transactions.                                                        |
| Receipts       | Authenticated render; each simulation independently verifies persisted receipt linked to its exact paid invoice. No real emailed receipt or paper output.                                              |
| Front of House | Render; linked Reservations, Seating, Waitlist and Guest requests checked separately. No real customer notifications.                                                                                  |
| QR Management  | Render; generation remains disabled without configured tables/guest prerequisites in initial fixture. No public QR/customer-device journey certified.                                                  |
| Returns        | Render passes, but Log return and Export are disabled; no persisted return workflow.                                                                                                                   |
| Refunds        | Render passes. High-risk action uses first receipt/refund and canned amount/reason instead of operator selection; see F2.                                                                              |
| Delivery       | Render, filters/subviews; no live courier lifecycle certified. Internal Riders link causes full navigation.                                                                                            |
| Riders         | Render; no real rider/handset delivery certified. Delivery link causes full navigation; date/channel matching concerns below.                                                                          |

## Confirmed Findings

### F1: New POS invoices lose the economic component breakdown (High)

Evidence: a newly created, fully paid UI POS invoice yields a closing snapshot with
`invoiceComponents: {status: "NOT_RECORDED", missing: 1, invoiceCount: 1}`.
The PDF explicitly says that gross/discount/service amounts are unavailable.

Root cause: `src/routes/pos.tsx:1017` submits
`financialOverride: { subtotal, tax, total }` without `financialComponents`.
`src/lib/transaction-engine.ts:805` deliberately preserves missing components as unavailable when an override is supplied.
Cash/invoice totals reconcile; that does not establish a complete gross/discount/service breakdown.

Correction: preserve verified pricing components from the authoritative pricing contract for future POS invoices. Do not infer historical values, mutate closed snapshots, or fabricate zero discounts/service charges. Retest actual POS -> invoice -> daily PDF, not only synthetic invoices with components supplied by a test.

### F2: Refunds operates on implicit first records and canned business values (High)

Evidence: `src/routes/refunds.tsx:48` chooses the first branch receipt;
line 51 chooses `rows[0]`; lines 61-63 hardcode
`Math.min(1200, paidReceipt.total)` and a compensation reason.

The page does not make the intended source receipt, amount and reason explicit before Request refund.
Approve selected is likewise not based on an operator-selected row.

Correction: require exact receipt/refund selection, valid remaining refundable amount, operator-entered reason, confirmation and authoritative acknowledgement. Keep server approval, scope and closed-period controls. No refund mutation was performed by this audit.

### F3: Tables reports configured tables as Available regardless of operational state (Medium)

Evidence: `src/routes/tables.tsx:62` maps every configured table to the literal
`state: "Available"`; guests, waiter, amount and duration are set to undefined.
Consequently Occupied filters and occupancy statistics cannot represent live seating/orders.

Correction: consume the existing authoritative seating/order projection and retain branch isolation. Compare Tables against Front of House with an actually occupied table. Current finding is source-confirmed; no live seating records were altered.

### F4: Returns is a disabled presentation, not an implemented return workflow (Medium)

Evidence: `src/routes/returns.tsx:28` uses `emptyRecords()`.
Log return and Export have no action. The shared `Btn` correctly disables missing-action buttons, and the browser captured both disabled.

Correction before a focused pilot: hide/label the unavailable page or explicitly exclude returns from pilot scope. Do not treat this page-render pass as return-processing certification.

### F5: Some internal Sales links still force complete document navigation (Medium)

Evidence:

- `src/routes/tables.tsx:93`: New reservation -> `window.location.href`.
- `src/routes/delivery.tsx:377`: Rider accountability -> `window.location.href`.
- `src/routes/riders.tsx:150`: View delivery queue -> `window.location.href`.

These are deterministic navigation implementations, not evidence of the previously reported spontaneous reload.
Correction: use existing client-router navigation for internal links while retaining protected-route checks.
Leave genuine external/mail/download navigation alone.

### F6: Rider delivery/date projection has a legacy matching gap (Medium)

Evidence: `src/routes/riders.tsx:88` limits channels to display strings
`Delivery` and `Online`; line 101 compares a sliced UTC timestamp against `currentDateKey()`.
Configured channel IDs/codes and the branch timezone/cutoff are not consistently used here.

Correction: resolve configured delivery channels and canonical branch business dates, reusing existing logic.
No midnight/real-rider browser simulation was performed; the unimplemented matching contract is source-confirmed, operational incidence is not measured.

### F7: Several management pages remain empty presentation logs (Low / scope-dependent)

Audit Trail, Notifications, Tasks, Decisions, Leave and Recruitment import `emptyRecords()`.
Dedicated attendance-delay and closing obligations are separate real workflows; an empty global Notifications or Audit Trail page must not be represented as their authoritative history.

Correction: distinguish unavailable presentation pages from the underlying audited services; hide or explicitly scope out unimplemented pages for pilot. No new management features were implemented.

## Financial Evidence

Illustrative completed cash run:

- Opening float: 10,000 minor units.
- Invoice and collection: 100,000 minor units.
- Expected cash: 110,000 minor units.
- Count: 110,000 minor units; variance: 0.
- One invoice, linked receipt, finalized drawer, one revisioned closing snapshot.
- Supervisor performs one combined daily close; no duplicate employee End Shift is required.
- PDF comes from persisted closing snapshot and includes cashier/supervisor, business date, timezone/cutoff, cash count and exceptions.
- Initial fixture has no tax/service rule; zero fixture tax is not VAT-provider or configured-tax certification.
- Gross/discount/service availability limitation remains F1.
- Real email delivery is not exercised; financial closure must not be described as email delivery.

## Diagnosed Harness and Configuration Failures

- Initial page-scan attempts captured the temporary authentication bootstrap rather than loaded content. Their screenshots were discarded, and the final inventory waits for the signed-in shell.
- The first closing locator matched both status text and hidden dialog text; it was scoped to the closing region without changing application code.
- Table creation persisted correctly, but an initial assertion expected `AUDIT01` instead of the rendered `Table AUDIT01`. Screenshot/DOM evidence establishes a test-locator mistake, not lost configuration. The subview assertion was corrected and rerun separately.
- The first Branch B journey stopped with no KOT obligation. A read-only inspection of its disposable database confirmed the item referenced Branch A's station and its Branch B setting lacked `station_id`; its saved line therefore had `productionStation: "NONE"`. The operational catalog correctly enforces station/branch matching, but defaults an unresolved code to NONE. The shared seed now supplies Branch B's own MAIN station. The failed record remains in `scenario-5/result-incomplete-fixture.json`; the one-KOT assertion was not weakened. Real deployments must verify station mappings, especially legacy or externally configured branch activation. This audit does not prove broken/missing mappings fail closed.
- One local email lease-recovery test exceeded its original five-second timeout during the concurrent browser/unit run. It passed when isolated, with no timeout or assertion change; it remains a timing-flakiness observation, not a demonstrated durable-email loss.

## Validation Ledger

- Six final cash/closing journeys: **6/6 completed**, with F1 observed in all six reports. Branch B was rerun after repairing its disposable station mapping; the initial failure is retained.
- Existing complete browser suite rerun: **26/26 passed**, no skipped tests, in 7.0 minutes.
- Focused registration/authentication, POS workflow, financial lifecycle, closing, immutable PDF and email repository tests: initial run **81 passed, 1 timed out** across 82 tests. The timed-out scheduler lease-recovery test subsequently **passed in isolation with unchanged assertions and the original timeout**; 14 unrelated cases were filtered out for that diagnostic rerun. This is not one clean aggregate 82-test pass.
- Malware/scanner boundaries: **11/11 passed** across three files, using disposable fixtures.
- TypeScript/ESLint/format/diff checks: final results below.
- Existing prior b142d72 CI evidence remains applicable to unchanged application source: 905 full unit tests, 26 default browser scenarios and PostgreSQL gates. Those gates were not all rerun by this audit.
- Prior printing emulator evidence independently identifies candidate `b142d72501597a6a6766ea5e6b91346ff1aec144`, Node 24.22.0 and pinned emulator `1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d`; `physicalOutput: NOT_VERIFIED`. Do not call emulator success physical output.
- Initial survey attempts that captured session bootstrap were discarded; they are not included in the 91-route counts. Early lifecycle locator ambiguity was corrected in audit-only code, not application behavior.

## Malware Import Status

Source guards remain fail-closed without scanner bindings/authenticated evidence.
The evidence validator binds CLEAN to hash, job, immutable object identity, scanner/version and timestamp.
Development-only import fixtures are constrained by DEV/development/dev-auth/CI flags; their browser success does **not** certify real ClamAV.
No scanner infrastructure was deployed or called. Genuine EICAR detection, scanner availability, production resource limits, queue recovery in protected staging and live publication remain **UNVERIFIED in this audit**. Do not enable imports on this evidence.

## Operational Gates Still Not Certified

- Genuine Supabase owner signup -> email verification -> recovery; personal staff invitations/email delivery.
- Real M-Pesa sandbox request/callback/duplicate/refund/reconciliation.
- Real marketplace webhook signatures/delivery and courier mapping.
- Physical printer output, paper-out, ambiguous physical delivery and human-confirmed recovery.
- Actual staff phones, geolocation permissions/accuracy, enrolled terminal sales restrictions on real devices.
- Live closing report email provider acceptance versus inbox delivery.
- Approved real recipe/menu content and operational business/profile/tax/printing configuration.
- Protected-target schema/configuration compatibility and approved rollout of draft PR #138. No current live schema version was checked, and historical staging version claims were not reused as current facts.
- Large data, capacity/load and extended real-world overnight shift behavior.

## Recommended Next Work

1. Fix F1 and F2 with focused transaction-to-report and selected-source regression tests.
2. Correct F3 and F5; resolve F6 before delivery is included in the pilot.
3. Hide or explicitly exclude F4/F7 unsupported workflows instead of calling every page functional.
4. Then execute one protected disposable multi-role shift with owner, cashier, supervisor and kitchen users, actual phones/printer and approved sandbox providers.
5. Keep real integrations and import enablement behind their existing security/acceptance gates.

## Complete Navigation Rendering Inventory

RENDER PASS means authenticated page content loaded; it does not mean every page action is implemented.

| Route                   | Page title                                    | Rendering   |
| ----------------------- | --------------------------------------------- | ----------- |
| `/`                     | Seramet - Home Dashboard                      | RENDER PASS |
| `/pos`                  | Seramet POS - Fast counter & table service    | RENDER PASS |
| `/orders`               | Orders - Seramet                              | RENDER PASS |
| `/online-orders`        | Online Orders - Seramet                       | RENDER PASS |
| `/marketplace`          | Marketplace - Seramet                         | RENDER PASS |
| `/tables`               | Table Management - Seramet                    | RENDER PASS |
| `/invoices`             | Invoices - Seramet                            | RENDER PASS |
| `/pending`              | Pending Invoices - Seramet                    | RENDER PASS |
| `/receipts`             | Receipts - Seramet                            | RENDER PASS |
| `/host`                 | Front of House - Seramet                      | RENDER PASS |
| `/qr-management`        | Seramet - Business Operating System           | RENDER PASS |
| `/returns`              | Returns - Seramet                             | RENDER PASS |
| `/refunds`              | Refunds - Seramet                             | RENDER PASS |
| `/delivery`             | Delivery Tasks - Seramet                      | RENDER PASS |
| `/riders`               | Riders - Seramet                              | RENDER PASS |
| `/kitchen`              | Kitchen Display - Seramet                     | RENDER PASS |
| `/production`           | Production - Seramet                          | RENDER PASS |
| `/bar`                  | Bar - Seramet                                 | RENDER PASS |
| `/cost-control`         | Cost Control - Seramet                        | RENDER PASS |
| `/menu-import`          | Menu Import - Seramet                         | RENDER PASS |
| `/recipes`              | Recipes - Seramet                             | RENDER PASS |
| `/cookbook`             | Cookbook - Seramet                            | RENDER PASS |
| `/requisitions`         | Requisitions - Seramet                        | RENDER PASS |
| `/prep`                 | Prep List - Seramet                           | RENDER PASS |
| `/kitchen-analytics`    | Kitchen Analytics - Seramet                   | RENDER PASS |
| `/inventory`            | Inventory Overview - Seramet                  | RENDER PASS |
| `/inventory-items`      | Inventory Items - Seramet                     | RENDER PASS |
| `/categories`           | Inventory Categories - Seramet                | RENDER PASS |
| `/stock-detail`         | Stock Detail - Seramet                        | RENDER PASS |
| `/warehouses`           | Warehouses - Seramet                          | RENDER PASS |
| `/stock-count`          | Stock Count - Seramet                         | RENDER PASS |
| `/transfers`            | Stock Transfers - Seramet                     | RENDER PASS |
| `/adjustments`          | Stock Adjustments - Seramet                   | RENDER PASS |
| `/wastage`              | Wastage - Seramet                             | RENDER PASS |
| `/breakages`            | Breakages - Seramet                           | RENDER PASS |
| `/par`                  | PAR Levels - Seramet                          | RENDER PASS |
| `/procurement`          | Procurement - Seramet                         | RENDER PASS |
| `/purchase-orders`      | Purchase Orders - Seramet                     | RENDER PASS |
| `/receiving`            | Receiving - Seramet                           | RENDER PASS |
| `/suppliers`            | Suppliers - Seramet                           | RENDER PASS |
| `/supplier-bills`       | Supplier Bills - Seramet                      | RENDER PASS |
| `/supplier-performance` | Supplier Performance - Seramet                | RENDER PASS |
| `/customers`            | Customer 360 - Seramet                        | RENDER PASS |
| `/crm`                  | CRM Overview - Seramet                        | RENDER PASS |
| `/crm-pipeline`         | CRM pipeline - Seramet                        | RENDER PASS |
| `/loyalty`              | Loyalty - Seramet                             | RENDER PASS |
| `/complaints`           | Service feedback - Seramet                    | RENDER PASS |
| `/campaigns`            | Customer campaigns - Seramet                  | RENDER PASS |
| `/segments`             | Customer segments - Seramet                   | RENDER PASS |
| `/people`               | People - Seramet                              | RENDER PASS |
| `/employees`            | Employees - Seramet                           | RENDER PASS |
| `/attendance`           | Attendance - Seramet                          | RENDER PASS |
| `/schedule`             | Schedule - Seramet                            | RENDER PASS |
| `/payroll`              | Payroll - Seramet                             | RENDER PASS |
| `/leave`                | Leave Management - Seramet                    | RENDER PASS |
| `/performance`          | Staff Performance - Seramet                   | RENDER PASS |
| `/recruitment`          | Recruitment - Seramet                         | RENDER PASS |
| `/finance`              | Finance - Seramet                             | RENDER PASS |
| `/profit-loss`          | Posted Profit and Loss - Seramet              | RENDER PASS |
| `/balance-sheet`        | Balance Sheet - Seramet                       | RENDER PASS |
| `/cash-flow`            | Cash Flow - Seramet                           | RENDER PASS |
| `/expenses`             | Posted Operating Expenses - Seramet           | RENDER PASS |
| `/payment-control`      | Payment Control Centre - Seramet              | RENDER PASS |
| `/reconciliation`       | Payment Control Centre - Seramet              | RENDER PASS |
| `/payables`             | Accounts Payable - Seramet                    | RENDER PASS |
| `/receivables`          | Accounts Receivable - Seramet                 | RENDER PASS |
| `/assets`               | assets - Seramet                              | RENDER PASS |
| `/general-ledger`       | General Ledger - Seramet                      | RENDER PASS |
| `/accounting`           | Accounting Hub - Seramet                      | RENDER PASS |
| `/daily-sales-journal`  | Daily Sales Journal - Seramet                 | RENDER PASS |
| `/trial-balance`        | Trial Balance - Seramet                       | RENDER PASS |
| `/prime-cost`           | prime cost - Seramet                          | RENDER PASS |
| `/tax-centre`           | Tax Control - Seramet                         | RENDER PASS |
| `/period-close`         | Period Close Readiness - Seramet              | RENDER PASS |
| `/command-centre`       | Command Centre - Seramet                      | RENDER PASS |
| `/enterprise`           | Enterprise - Seramet                          | RENDER PASS |
| `/decisions`            | Pending Decisions - Seramet                   | RENDER PASS |
| `/branches`             | Branches - Seramet                            | RENDER PASS |
| `/approvals`            | Approval Centre - Seramet                     | RENDER PASS |
| `/tasks`                | Tasks - Seramet                               | RENDER PASS |
| `/audit-trail`          | Audit Trail - Seramet                         | RENDER PASS |
| `/notifications`        | Notification Log - Seramet                    | RENDER PASS |
| `/ai`                   | Ask Seramet - Restaurant intelligence         | RENDER PASS |
| `/reports`              | Report Centre - Seramet                       | RENDER PASS |
| `/marketing`            | Website & Channels - Seramet                  | RENDER PASS |
| `/design-system`        | Seramet UI Kit                                | RENDER PASS |
| `/seramet-printers`     | Seramet Printers - Hardware and print routing | RENDER PASS |
| `/seramet-setup`        | Setup Centre - Seramet                        | RENDER PASS |
| `/integrations`         | Integrations - Seramet                        | RENDER PASS |
| `/system-health`        | System Health - Seramet                       | RENDER PASS |
| `/settings`             | Settings - Seramet                            | RENDER PASS |

## Local Evidence Index

- `.seramet/site-audit/scenario-1/pages.json`: complete route/error/control inventory.
- `.seramet/site-audit/scenario-1/*-desktop.png`, `*-mobile.png`: fourteen Sales page pairs.
- `.seramet/site-audit/scenario-2/sales-subviews.json`: additional Sales subviews/table persistence.
- `.seramet/site-audit/scenario-N/result.json`, `closing.pdf`, `closed.png`: each disposable shift.
- `.seramet/site-audit-scenario-N-verified.log`: six numbered runner logs.
- `.seramet/site-audit-scenario-5-configured.log`: final Branch B rerun with correct station mapping and persisted-row comparison.
- `.seramet/site-audit-sales-subviews-final.log`: final targeted subview/table check.
- `.seramet/site-audit/pdf-inspection.json`: all six PDF content checks and page counts.
- `.seramet/site-audit/manifest.json`: candidate/source identities and evidence SHA-256 checksums.
- `.seramet/site-audit-browser-regression.log`: existing full browser suite on unchanged application.
- `.seramet/site-audit-regression.log`, `site-audit-email-isolated.log`, `site-audit-scanner.log`: focused test evidence.
- `.seramet/printing-operational/result.json`: prior same-commit emulator evidence.
- Never publish fixture access tokens or unredacted browser traces as deployment credentials.

## Final Collected Results

| Gate                                                | Result                                          | Evidence / limitation                                                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated navigation inventory                  | PASS, 91/91 renders                             | Zero uncaught page exceptions and recorded HTTP 5xx; not exhaustive business actions                                                                                                     |
| Sales desktop/mobile rendering                      | PASS, 14/14 pages                               | 1440x1000 and 390x844; zero document-level horizontal overflow                                                                                                                           |
| Six cash-sale/closing journeys                      | PASS for tested cash/close assertions           | One immutable closing snapshot and PDF each; new-invoice components missing in all six                                                                                                   |
| Branch isolation                                    | PASS after fixture repair                       | Real Branch A record and persisted SQL identity, version (1 -> 1), amount, status, payload and timestamp unchanged after Branch B sale/close                                             |
| Cash variance                                       | PASS                                            | Expected 110,000, counted 110,100, variance 100 minor units; explanation preserved                                                                                                       |
| PDF downloads/content                               | PASS for six samples                            | Six two-page PDFs; source values, cashier, branch, date and variance reason verified; rendered all twelve pages and visually reviewed representative standard/branch/variance output     |
| Existing browser regression                         | PASS, 26/26                                     | Includes real local employee PIN/device, auth failure/revocation, GPS/delay roles, offline replay, conflicts and scanner-fixture publication                                             |
| Focused domain regression                           | Initial 81 PASS / 1 timeout; isolated case PASS | Same five-second timeout and assertions; do not present as one clean aggregate run                                                                                                       |
| Scanner boundary regression                         | PASS, 11/11                                     | No genuine antivirus engine or EICAR test performed                                                                                                                                      |
| Final audit code checks                             | PASS                                            | Typecheck, targeted ESLint, formatting and diff checks; no comprehensive certification rerun                                                                                             |
| Additional Sales subviews/table persistence         | PASS                                            | Reservations, Seating, Waitlist, Guest requests, three Marketplace tabs, three Delivery subviews and persisted table creation; separate targeted run after correcting table text locator |
| Real owner signup, live providers, physical devices | UNVERIFIED                                      | Not established by seeded internal identities or local simulations                                                                                                                       |

The optional audit deliberately skips duplicate page inventories/subview checks in the other numbered runs. These skips do not remove any scenario from the existing 26-test browser suite. The isolated email diagnostic selected one test and filtered fourteen others; they were not deleted.

Changed local files: `tests/e2e/site-lifecycle-audit.spec.ts`, `scripts/run-pilot-e2e.mjs`, `scripts/seed-pilot-e2e.ts`, and this report. No application module, dependency, schema, deployed environment or financial production record changed. No PR was merged or deployed, and this audit work was not pushed.
