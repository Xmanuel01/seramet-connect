# Seramet Lite: account creation → operational closing (disposable end-to-end release contract)

## Purpose and truthful evidence standard
This document specifies a **single fresh-tenant end-to-end journey**. The repository previously had separate tests for onboarding, POS, printing, attendance, inventory and daily closing; these independent passes do **not** prove the entire journey works as one integrated release.

Only isolated test accounts and disposable databases are permitted. Do not create real user accounts, send real email/SMS, bill a customer, print to live kitchen devices or migrate staging/production.

## Workflow and expected outcomes

| Order | User journey | Required authoritative assertions | Existing evidence / gaps |
|---|---|---|---|
| 01 | Open `/register`; create an account | Email/phone identity must be independently verified; prevent duplicate/invalid signups and unauthorized reuse | Registration session routing tested; **real external verification requires an isolated identity environment** |
| 02 | Create restaurant from verified account | Exactly one tenant, legal entity, brand, initial branch, linked owner, `ACCOUNT_OWNER` role, setup state, audit record; safe replay on same idempotency key | New `src/server/account-to-close-journey.test.ts` exercises repository registration in disposable SQLite |
| 03 | First-time `/seramet-setup` onboarding | Complete country/location, KES, business type, branch details, timezone, hours, service modes, taxes, tenders, staff, menu, inventory, kitchen and hardware; no unexpected GO_LIVE | Wizard has distinct steps 5–20; not yet proven as one end-to-end browser workflow |
| 04 | Add Employee in `/people` → `/employees` | Account owner may create valid employee with role, branch and temporary PIN; unauthorized staff denied; no cashier privileges for attendance-only user | Attendance PR #137 has UI/API tests; BYOD login from unregistered phones still requires field confirmation |
| 05 | Configure attendance policy, clock in/out | Authenticated employee only, assigned active branch, fresh accurate foreground GPS, server timestamp, audited supervisor exception | PR #137 browser/SQLite tests; **real iOS/Android and workplace GPS pilot not run** |
| 06 | Configure menu and price/tax | Restaurant catalogue becomes visible on POS and kitchen at assigned branches; idempotent import with quarantine/activation | `tests/e2e/menu-import-pipeline.spec.ts` covers disposable import and publication |
| 07 | Receive stock/purchase supplies | Authorized receiving creates immutable inventory movements; recipes and wastage reconcile; no negative stock when blocking enabled | Independent inventory tests exist, no full purchase-to-service E2E proof |
| 08 | Open a till | One active drawer/authorized cashier per policy, verified opening float and branch date | POS/finance independent tests; integrated cashier-start flow pending |
| 09 | Create a dine-in/takeaway/delivery order | Select menu lines/modifiers, keep draft on temporary connectivity failure; correct KES pricing and tax | `tests/e2e/pilot-two-terminal.spec.ts` covers drafts, revisions and separate-terminal conflicts |
| 10 | Route order to kitchen/bar | New order KOT/bar ticket exactly once, correct station; preparation/ready/served state transitions and recall | Existing kitchen, offline and printing tests; needs combined-order acceptance |
| 11 | Produce guest bill and accept payment | Bill reflects correct totals, partial/mixed tenders where supported, successful payment recorded once, immutable receipt, no replay duplicate | POS/PostgreSQL financial tests exist; do not create live charges |
| 12 | Print bill/receipt | Authorization, station routing, job signing/deduplication, real 58/80 mm paper quality | `tests/e2e/printing-admin.spec.ts` and print-service tests; physical printers unverified |
| 13 | Handle exceptions | Voids, refunds, change of tender, disconnect/recovery and denied permissions must not corrupt orders/payments | Concurrent reconciliation and reversal tests; refund settlement states must be confirmed before daily close |
| 14 | Close drawer and business day | Count cash and MPesa/card/provider payments, variance review, one final close under concurrent terminals, immutable snapshot, no unfinalized refunds, auditable reopen | PRs #131–#133 are stacked draft changes, not integrated into this branch |
| 15 | Report and notify | Authorized daily-closing PDF with accurate register/taxes/expenses; queued notifications are not synonymous with delivered email; export is scoped | PRs #132/#133 require integrated stack certification and approved isolated mail provider |
| 16 | Restart and next business day | Prior close persists across restart, next shift opens new drawer, no stale orders/duplicate payments; audit and roles remain sound | Integration regression test not yet proven |

## Release-blocking integration requirements

1. Create **one disposable integration branch** from refreshed main, layering reviewed PRs in dependency order and checking migration collisions. Do not merge existing PRs just to assemble the test.
2. Authenticate from an account created via **mocked isolated identity provider** (not fabricated browser headers on production) and assert the resulting owner and branch state.
3. Drive the wizard with real API/UI writes and read back the same state from a second client.
4. Seed or import a small deterministic menu through normal onboarding. Use a real authorized POS user, create an order, route KOT, accept *simulated* test tender, persist a receipt and reconcile the correct drawer.
5. Verify exactly one closing snapshot and authorized PDF/notification outbox state. Never substitute locally computed totals for the authoritative snapshot.
6. Test two terminals and retries throughout. No insecure bypasses, audit deletion or tests weakened to make the journey green.
7. Include a parallel negative path for a restricted staff identity and wrong tenant/branch, plus a corrupted/duplicate request.
8. Run lint, typecheck, unit tests, Playwright, disposable SQLite, disposable PostgreSQL and production-build safety checks on the **exact candidate commit**.
9. Separate physical acceptance (GPS, iPhone/Android, 58/80 mm printers, real restaurant workflows) from automated CI evidence.

## Acceptance outcome format

For every step, report `PASS`, `FAIL`, `BLOCKED` or `NOT RUN`, with evidence (test name, SHA, workflow, backend response or relevant artifact). **Do not mark the full end-to-end journey PASS just because its component suites pass.**

A successful one-tenant operational journey requires verified account creation, approved owner/employee identities, completed setup, menu, staff, cash drawer, kitchen ticket, verified payment, closure and report **in the same isolated test tenant**. It remains blocked until this chain and the physical gates are explicitly signed off by the owner.
