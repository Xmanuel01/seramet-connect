# Customers category — workflow-first remediation and release gates

**Branch:** `hardening/customers-20260925`  
**PR:** [#40](https://github.com/Xmanuel01/seramet-connect/pull/40) (draft, unmerged)  
**Purpose:** Replace hardcoded category pages with genuinely integrated CRM workflows, then demonstrate state changes and failure protections with tests.

## What is implemented on the PR branch

| Page/workflow | Actual integration on this branch | Security and integrity |
| --- | --- | --- |
| Customer 360 | Authenticated directory, cursor pagination, creation, individual profile/loyalty/visits/journey, internal CRM notes | Existing server tenant/branch scoping; sensitive contact/value permissions; suppress cross-branch value totals; separate visibility for SERVICE/FINANCE notes. |
| POS customer linking | Search and select an existing customer on the **real staff POS screen**, carry canonical customer ID and code into order creation and edits, persist selection before invoice prep | Cashiers have masked directory lookup only in pilot role; selection tied to active tenant, branch, order; prevent stale cross-scope selection; do not guess consent. Existing deployed roles need explicit authorization. |
| CRM overview | Server-calculated authoritative customer dashboard, no hardcoded totals | Query caches keyed to tenant and branch; deny unauthorized roles. Metrics are asynchronous and need recalculation worker. |
| CRM Pipeline | New migration 0026, scoped lead API with keyset pagination and true server-derived branch summary, lead create, owner, follow-up dates/actions, immutable audit history, version-checked stage transitions | No implied sales/revenue on WON; stage transitions restrict illegal changes, closure reason required; canonical idempotency request payload recorded on original create and each change; enforce tenant/branch access. No pretend weighted forecast. |
| Loyalty | Existing authoritative programs, tiers, rewards, member enrolment, manual ledger adjustment with reason, individual balance in Customer 360 | Enrollment idempotent with one audit entry, scoped customer and program eligibility, tier/reward branch restrictions, duplicate manual-adjustment payload conflict checks. Value redacted from branch-limited roles; reward redemption remains only at checkout, not through an unsafe separate endpoint. |
| Complaints | Existing server feedback categories, real case intake, linked-customer choice or anonymous feedback, branch case register, auditable investigation/follow-up/resolution/dismissal | Server feedback permissions and branch isolation. No invented severity/recovery count; no fake order association. |
| Segments | Server-defined behavioral rules (UI subset), branch-scoped recalculated member snapshots with evidence quality, stable segment register | Server forbids protected attribute rules. Branch-specific snapshot counts prevent display of another branch's count. Rebuilding a segment is a recorded server action; no mock records. |
| Campaigns | Live register and provider status; real draft creation, server preview of consent-gated audience, separate permission-gated approval, explicit SEND confirmation before durable dispatch | No fake delivery or attributable revenue metrics. Server verifies audience eligibility and provider, queue worker handles send. Staging must use test/sandbox providers: **do not test on live contacts**. |

## Real workflow and automated evidence

1. Create a real customer on the existing CRM API and verify default marketing consent UNKNOWN; select the account on the real POS screen using masked branch-limited lookup.
2. Send the selected POS customer to the existing order/KOT workflow. Actual order draft must carry `customerId/customerCode`, including a changed customer before billing; cashier role does not automatically gain raw phone/email or financial value access.
3. On server-confirmed payment, original authoritative transaction code produces one linked paid-order record, one customer journey entry and eligible loyalty ledger entries. Replays must not duplicate awards.
4. Scheduled CRM recalculation updates the customer profile, dashboard and segment snapshot; do not imply customer metrics refresh immediately at checkout.
5. A staff member can record feedback against an authorized customer and resolve it; restricted staff cannot read service/finance notes outside permissions.
6. For corporate opportunities, create a lead, assign owner to recording staff, progress NEW -> CONTACTED -> QUALIFIED -> PROPOSAL -> WON or LOST, require closure reason, reject stale revisions and altered idempotency keys; WON is not a payment event.
7. For outreach, derive segment from actual linked orders, preview consent and configured provider, require separate approval, explicitly confirm SEND, then review durable delivery outcomes. Do not exercise actual emails until a dedicated staging-only provider is verified.

**Existing automated tests** cover POS/customer/payment/loyalty linkage, refunds, duplicate saves, protected-data scope and campaign consent, with new regression tests for lead lifecycle (including unique key and immutable history), one-time loyalty enrolment, crossbranch tier/reward configuration, and manual ledger replay conflicts. GitHub Actions result for the latest commit must be checked before declaring these changes validated.

## Release blockers and non-goals

- **Never merge this draft PR automatically.** Run the final *unmodified* repository lint, TypeScript, complete test suite, production build, security dependency and secret-bundle audit after removing the temporary CI formatting helper.
- **Staging schema migration:** apply and verify migration 0026 on a nonproduction database through the existing migration mechanism before testing CRM Pipeline. Validate rollback/restore plan. A successful source build does not prove target DB migration applied.
- **Staging browser/manual:** login with cashier, branch manager, marketer and unauthorized users; create actual test orders, verify KOT/KDS/print-queue delivery with test printer, payment simulation, updated Customer 360 and asynchronous metric scheduling, lead lifecycle, branch switching and form error states. GitHub source/CI alone cannot prove these hardware and external services run.
- **External providers:** verify email sandbox/provider health and queue consumer + dead-letter handling using dummy contacts. No live customer messaging during QA.
- **Cross-currency:** branch-specific business-data snapshots and multi-branch monetary aggregation require a separate explicit verified currency conversion and reporting policy. Hide metrics rather than silently sum different currencies.
- **Privacy/legal:** do not infer marketing opt-in; test withdrawal suppression and retention/anonymization in a nonproduction tenant; existing configured roles require reviewed updates for customer lookup.
- **Remaining product breadth:** CRM pipeline CSV import, flexible all-field segment editing, more advanced loyalty policies, historical pagination, notifications/print delivery confirmation and evidence of live data must be considered separately rather than implemented as inert buttons.

**Final decision remains a release gate, not a claim:** a page is feature-connected when requests reach authoritative services; the full Customers category may be called production-ready only after latest CI, migration, browser and external integration verification pass.
