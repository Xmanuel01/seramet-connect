# Remaining Photo and Audit Corrections

## Scope

Local corrections following `SITE_LIFECYCLE_AUDIT_2026-10-18.md`. Daily Sales Journal and Payment Control were left unchanged during this pass. Earlier local photo, login, dispatch/clock, invoice-split/printer-discovery and Front of House corrections remain in the worktree; this report does not substitute for their separate evidence.

No live database, credential, infrastructure, merge or deployment operation was performed. Existing business records and closed snapshots were not backfilled. No migration or dependency was added.

## Findings and Disposition

| Finding                                     | Correction                                                                                                                                                                                                    | Status / boundary                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F1: POS invoice component breakdown missing | New POS drafts carry verified integer-minor-unit pricing components through the existing order/invoice contract. Tax and service remain separate.                                                             | Fixed for new POS transactions. Existing unknown component records remain unavailable, not inferred or rewritten.             |
| F2: implicit first-record refunds           | Explicit receipt, collected method, amount, reason and confirmation; explicit approval selection; server source/scope validation, remaining-collection caps, request identity and verified actor attribution. | Request/approval corrected. Approval is not a confirmed customer payout; no provider refund or cash payout is invented.       |
| F3: table occupancy                         | Earlier Front of House correction uses existing authoritative seating/table state and consolidates Tables into Front of House.                                                                                | Previously corrected; see the Front of House report.                                                                          |
| F4: Returns placeholder                     | Removed from pilot navigation; direct route explicitly says unavailable.                                                                                                                                      | Safely unavailable, not a newly implemented returns workflow.                                                                 |
| F5: Delivery/Riders full navigation         | Existing router navigation replaces internal document navigation in both directions.                                                                                                                          | Browser document marker survives both links.                                                                                  |
| F6: rider literal channels / UTC dates      | Resolve configured channel IDs/codes/names and own-delivery mode; branch timezone and cutoff determine completion dates.                                                                                      | Unit coverage includes overnight Nairobi and daylight-saving boundaries. Real courier execution remains unverified.           |
| F7: empty management registers              | Hide Audit Trail, Notifications, Tasks, Decisions, Leave and Recruitment placeholders; direct routes explain that no authoritative register is available.                                                     | Safely unavailable. Existing durable audit events, attendance-delay notifications and closing-email obligations are retained. |

The unresolved photo of a generic error screen does not identify its route or exception. It cannot establish a further root cause. The earlier authenticated rendering audit observed no page crashes; this is not proof that every possible device/data combination is crash-free.

## Changes

- Pricing: `src/payments/pos-invoice-components.ts`, its tests and `src/routes/pos.tsx`.
- Refunds: `src/routes/refunds.tsx`, `src/payments/refund-eligibility.ts` and tests, plus the existing transaction engine, API, repository and authoritative repository source-branch handling.
- Delivery: `src/delivery/rider-workload.ts` and tests, `src/routes/delivery.tsx`, `src/routes/riders.tsx`.
- Availability: `src/lib/pilot-unavailable.ts` and tests, existing navigation and AppShell; navigation expectation updated in `src/lib/seramet-flows.test.ts`.
- Browser regression: `tests/e2e/audit-corrections.spec.ts`; optional focused runner entry reuses the existing disposable operational catalog/account setup. It does not change live configuration or the default browser-suite fixtures.

## Financial and Security Boundaries

Existing authentication, device restrictions, tenant/branch permissions, closed-period checks, server revision checks, transactional persistence and idempotency protections remain active. Refund request identities prevent repeated business requests even when a retry has a different HTTP idempotency key. Forged status, ID and approver fields are not copied from request input.

Refund reservations are capped against confirmed collection evidence, not pending payments. Invalid amounts and wrong receipt/invoice/order relationships are rejected. Approval does not settle an invoice, execute a payment reversal, or claim funds were delivered to the customer.

New POS pricing uses the existing configured catalog/tax/service calculation and component verifier; this is not a replacement server-pricing engine. The current POS has no discount command, so its new undiscounted sales explicitly capture zero discounts. Missing historical components are never guessed. Existing final charge amounts are preserved.

## Focused Evidence

- Final local validation: three browser scenarios PASS on the final application changes; TypeScript, focused ESLint, Prettier checks, production build and `git diff --check` PASS. CI was not dispatched.
- 93/93 pricing, refund, rider, navigation, transaction-flow, invoice-component, closing and report tests passed.
- 47/47 payment, settlement and authoritative closing-repository regressions passed.
- 22/22 selected concurrency/idempotency/offline regressions passed. The name filter excluded 79 unrelated cases; this was not a complete-suite certification.
- Browser regression covers exact refund selection, failed-request draft retention, retry/double-click deduplication, explicit approval, desktop/mobile rendering, real POS Hold -> dispatch -> invoice -> configured cash -> immutable daily close -> authenticated repeatable PDF, router document continuity and unavailable-route notices.
- Initial browser setup failures were diagnosed rather than bypassed: missing kitchen dispatch and missing disposable cash-account configuration. The focused runner now reuses `seed-printing-operational.ts`, including its real account rows and payment-method columns, instead of fabricating accounting defaults in application code.
- Screenshots: `.seramet/audit-corrections/refunds-desktop.png`, `refunds-phone.png`, `refund-dialog-phone.png`. Narrow tables remain internally scrollable; dialogs must fit the phone viewport.

## Remaining Operational Requirements

These local fixes do not configure the restaurant's real chart of accounts, bank/cash classifications, printer enrollment/routing or protected scanner. Configuration warnings must not be hidden by fabricated financial records. A browser cannot directly enumerate Windows printers without the supported local bridge.

The legacy receipt-linked refund approval register and the payment-orchestrator refund/payout workflow remain separate existing models. This change does not certify cross-model payout coordination or a complete money-return lifecycle; requests and approvals must not be represented as completed refunds.

Fresh PostgreSQL certification, real protected authentication/provider integration, authenticated malware-scanner evidence, physical printer output and a realistic authorized shift remain separate gates. This pass did not connect to PostgreSQL or run CI and makes no production-readiness or live-deployment claim.
