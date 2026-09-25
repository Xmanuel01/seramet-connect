# Customers workflow hardening audit — 2026-09-25

**Branch:** `hardening/customers-20260925`  
**Pull request:** [#40](https://github.com/Xmanuel01/seramet-connect/pull/40)  
**Production `main`:** unaffected until review and merge  
**Release status:** BLOCKED until the complete Customers workflow is verified.

## Real restaurant scenario / trace

The release gate is **not** "the page renders" or "tests compile." It is an identified customer completing a genuine staff POS order and appearing accurately in every connected system. The scenario and observable pass criteria are:

| Stage | Required behavior | Evidence |
| --- | --- | --- |
| Staff enters POS | Session is authenticated, assigned to the correct tenant/branch, authorized to access POS and permitted to look up customers without unnecessary contact/spend access. | Pilot cashier role grants `crm.customer.view` only. Existing deployed roles require separate admin review/configuration. |
| Staff identifies a customer | Lookup searches the server with tenant-scoped credentials and a restricted branch; selecting a customer carries its canonical ID and code, not just a typed name. No cross-branch or cross-order selection carry-over. | New POS picker and scoped selection tests in this PR. |
| Order creation/KOT | Customer identity is included in the authoritative order draft before kitchen dispatch. Changing an existing order's customer before payment must be persisted server-side; kitchen lines and original prices stay authoritative. | POS order-draft integration in this PR; physical printer/KDS staging check outstanding. |
| Invoicing/settlement | Invoice inherits customer ID; confirmed payment changes order to paid exactly once. Declines, partial payments, retries and refunds cannot create duplicate customer history. | Existing production-foundation/payment tests and new CRM workflow test; external payment/provider checks are separate payment-phase release gates. |
| CRM projection | A confirmed paid order creates one `customer_transaction_links` row, customer journey entry, and pending recalculation event. Hourly worker processes metrics; no invented immediate metrics. | Inspected authoritative repository and worker schedule; new end-to-end test triggers recalculation deterministically. |
| Loyalty | Eligible configured loyalty rules award once on confirmed completion; duplicate saves do not award twice. Reversal follows actual confirmed refunds. | Existing Pass 10 loyalty/refund tests and new paid-customer flow test. |
| Customer 360 and CRM Overview | Authenticated server responses populate pages; branch filtering and field permissions apply. No static demo totals and no exposure of other tenants' customers. | Connected routes and regression tests in PR #40; browser login/permission staging checks outstanding. |
| Segments/campaigns | Segment snapshots use recorded paid-order evidence, not mocked arrays. Campaign audiences need explicit, current consent and a configured provider; drafts must not send. | Existing backend/Pass 10 tests; both frontend pages remain placeholders pending implementation. |
| Feedback and service recovery | Customer-linked feedback belongs to an authorized branch, status changes are audited, and sensitive note visibility follows role permissions. | Cross-branch check and restricted-note tests added in this PR; frontend complaints workflow remains incomplete. |
| Privacy | No inferred opt-in; access, anonymization and exports enforce permissions, and suppression applies after opt-out. | Existing Pass 10 tests; staging/browser checks outstanding. |

## Critical findings and actions

1. **POS-to-CRM identity link was absent in the real page.** The backend could accrue customer history *only if* an order already included `customerId`, but the cashier POS page built an anonymous name-only draft. Fixed in this branch: authenticated customer lookup, scoped selection, draft propagation, and pre-payment update when a linked customer changes.
2. **Pilot cashiers could not query customer accounts.** Added only `crm.customer.view` to the demonstration cashier role, intentionally excluding unneeded phone/email and spending permissions. **Existing real tenants' configured cashier roles are not auto-migrated**; their administrator must explicitly approve access.
3. **Customer CRM notes did not restrict SERVICE and FINANCE notes in profile responses.** Added permission-dependent note visibility for actors who can manage CRM, and regression checks.
4. **Feedback creation did not verify that an identified customer was visible to the acting employee's branch.** Added explicit branch-scope verification and a negative regression test.
5. **Metrics are asynchronous.** Paid-order events are queued for scheduled recalculation. Scheduler code specifies hourly CRM recalculation at minute 25 and deployment config specifies a minute cron. Cloud deployment scheduler activation and queue delivery still need staging verification; the frontend must not imply immediate account statistics.
6. **Customer Pipeline has no authoritative lead-table or workflow backend.** The current page uses an empty in-memory array and dead actions. It requires a separate database migration, tenant/branch permissions, lead lifecycle service, auditing, validated imports, and UI before release.
7. **Loyalty, Complaints, Campaigns, Segments are still placeholder frontend pages.** The CRM backend has programs, reward ledgers, feedback/case statuses, segments and campaign audience/queue services, but their existing pages are not connected. These pages cannot be signed off solely because backend tests exist.
8. **Cross-currency/multi-branch metrics require explicit currency-safe aggregation.** Customer 360 deliberately withholds cross-branch spend totals until reviewed; other aggregate/reporting code must be validated against mixed-currency data.
9. **External/live validation outstanding:** Check browser navigation and permission roles against the Cloudflare preview; exercise KOT/KDS receipt printing and actual authorized provider sandbox flows, with no live restaurant money or customer data.

## Mandatory release gates

- CI: dependency audit, TypeScript, lint, complete tests including POS-CRM scenario, production bundle and no source secrets.
- Functional: create customer; link before kitchen send and after kitchen send but before invoice; settle; verify one order link, one eligible earn, updated directory/profile, segment membership, consent suppression and feedback trail; verify duplicate, timeout, cross-tenant, cross-branch, and blocked users.
- UX: every button in Customers must perform its advertised action or be explicitly unavailable. Zero charts cannot stand in for unloaded/failed or unconfigured data.
- Environment: use nonproduction tenant/branch and nonproduction payment/provider credentials; do not send real customer communications.
- Review: confirm all seven Customers sidebar pages and the POS integration against this matrix. Keep PR in draft and do not begin a "completed next-category" claim while blockers remain.

**Audit decision:** Customer 360 and CRM Overview code is connected, and POS identity linkage and privacy guards have been addressed on a review branch; the Customers category as a whole is **not yet production-grade**.
