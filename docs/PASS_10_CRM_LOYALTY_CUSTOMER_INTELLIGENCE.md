# Pass 10 CRM, Loyalty And Customer Intelligence

Status: implemented on the Pass 5 authoritative server/database foundation.

## Architecture

Pass 10 extends the existing order, payment, refund, accounting, integration-runtime, worker, audit, permission, business-date and feature-entitlement boundaries. CRM routes call authenticated server APIs. They do not persist authoritative customer, consent, loyalty, voucher, gift-card, campaign or feedback state in the browser.

The principal modules are:

- `crm-service.ts`: customer identity, consent, privacy, feedback, import/export and profile read models.
- `loyalty-value-service.ts`: loyalty, rewards, vouchers and gift-card value ledgers.
- `campaign-service.ts`: segments, audience materialization, approval, scheduling, delivery and attribution.
- `crm-analytics.ts`: deterministic RFM, retention, cohort and dashboard read models.
- `campaign-provider-registry.ts`: provider-neutral communication adapter registry.
- `crm-api.ts`: authenticated, permission-gated and runtime-validated HTTP boundary.
- `workers.ts`: durable CRM recalculation, campaign, expiry and privacy jobs.
- `authoritative-transaction-repository.ts`: atomic checkout, refund and accounting integration.

## Customer Master And Identity

Customers are tenant-owned records. Exact normalized PHONE, EMAIL and EXTERNAL identifiers are separate rows with tenant-scoped uniqueness. Phone normalization uses tenant configuration and an explicit country calling code. Email normalization is conservative. Similar names are only duplicate candidates; they are never automatically merged.

Merge is an explicit `crm.customer.merge` operation. It validates tenant scope, preserves an immutable alias from the retired record to the canonical customer, moves transaction and CRM relationships, records audit evidence and never destroys financial documents. Branch access is resolved from the authenticated actor rather than request-supplied authority.

Anonymous checkout remains valid. POS may search and link an existing customer or create a minimal customer independently of marketing consent.

## Consent And Privacy

Consent events are append-only and default to `UNKNOWN`. Marketing eligibility requires current GRANTED consent for the requested channel and no active suppression. Transactional communication is represented separately and cannot be used as a marketing-consent shortcut.

Withdrawal takes effect immediately for future audience and dispatch eligibility. Campaign workers recheck consent and suppression at dispatch time, not only when the audience was created.

Privacy requests are tenant scoped and audited. Anonymization removes or replaces direct customer PII while preserving aliases, invoice/payment/order relationships and legally relevant audit/financial records. Exports require `crm.customer.export`; privacy processing requires `crm.privacy.manage`.

## Loyalty, Rewards And Tiers

Loyalty programs are configured data with TENANT, BRAND or BRANCH scope. Tier thresholds, earning rules, expiry, receipt display and reward definitions are records, not business-name checks.

Points use an append-only integer ledger. Balance is the sum of ledger entries. Earn, redeem, expire, adjust and refund-reversal entries have unique idempotency keys. Redemption executes inside the authoritative transaction repository and rejects insufficient points under concurrent attempts. Tier and reward eligibility are deterministic server calculations.

## Vouchers

Voucher definitions include validity, branch/channel/customer scope, minimum spend, usage limits, per-customer limits and stacking policy. Codes are normalized and stored with a deterministic lookup hash. Validation and redemption are server-side and transactional. Redemption rows are immutable and protected against replay by database constraints/triggers.

A qualifying full refund can restore voucher eligibility according to the stored voucher policy and immutable original voucher payment amount. Partial refunds do not silently restore full voucher value. Voucher issuance remains distinct from stored-value accounting.

## Gift Cards

Gift cards use a cryptographically random public token. Only a token hash and last four characters are stored for lookup/display. Value is an append-only integer-minor-unit ledger. Currency is fixed at issuance; cross-currency redemption is rejected. Concurrent redemption cannot make the balance negative.

Issuance and redemption post through configured liability, collection and redemption accounts. No account is selected by display name. Gift cards remain liabilities until redeemed and are separate from discount vouchers.

## Campaigns And Providers

Campaigns progress through DRAFT, APPROVED, SCHEDULED and execution states. Audience rows are tenant scoped and materialized from deterministic segments. Unknown template variables fail validation. Approval and send permissions are separate.

Delivery uses the generic `CampaignProviderAdapter`. Provider configuration contains a managed `secretReference`, never a secret value. Health is reported from adapter evidence or `UNKNOWN`; absence of a configured live adapter is not reported as healthy.

Dispatch rechecks consent/suppression, uses a server rate limit, claims durable jobs, uses idempotency keys, retries retryable failures and moves exhausted work to dead letter. The deterministic provider is test/development-only and is not a live messaging provider.

Attribution distinguishes:

- `DETERMINISTIC`: stored evidence such as redemption of a voucher attached to the campaign.
- `CORRELATED`: an order following a delivered campaign within the configured attribution window, with `causalClaim: false`.

Pass 10 does not claim that correlation proves marketing causality.

## Analytics And Feedback

Dashboard, profile, RFM, retention, cohort and segment results are server-side read models. Calculations are deterministic and include quality states. Incomplete identity/history is reported as insufficient or lower quality rather than filled with inferred attributes.

Feedback, resolution and service-recovery events are tenant/branch scoped and audited. NPS is calculated only for a configured NPS survey. Feedback is not converted into staff misconduct evidence automatically. Service-recovery vouchers use the same voucher domain.

## POS, Refunds, Receipts And Accounting

POS checkout links the customer to the authoritative order and supports voucher, gift-card and loyalty redemption through the same transaction repository used by payments. Public CRM redemption endpoints intentionally reject direct value mutation and require checkout orchestration.

Confirmed receipts may show configured loyalty program name, earned/redeemed points and balance. KOT and bar tickets remain operational documents and do not receive customer loyalty details.

Refunds create immutable reverse loyalty/gift-card/voucher effects once, link to the original transaction and preserve journal history. Gift-card and loyalty accounting use configured account IDs and balanced journals.

## AI Safety

Pass 9 gains allowlisted aggregate CRM evidence tools. Tools require both intelligence and CRM permissions. Customer contact PII is removed unless the actor has the specific contact permission and the operation requires it; aggregate evidence does not contain direct identifiers. Protected-trait inference, consent mutation, customer merge, gift-card issuance and campaign dispatch are structurally unavailable to the AI action boundary.

## Durable Work

The Pass 5 queue runs targeted CRM metric recalculation, segment snapshots, campaign scheduling/dispatch/retry, points expiry, voucher expiry, gift-card expiry, privacy export and import jobs. Jobs retain tenant, attempts, claim state, correlation and idempotency. Expensive historical calculations do not run on every React render.

## Security And Invariants

- All tables and repository methods are tenant scoped; branch-restricted reads validate actor assignments.
- Consent, privacy, loyalty, voucher redemption, gift-card, campaign attribution and feedback event ledgers are append-only.
- Integer minor units are used for money; integer points are used for loyalty.
- Full provider tokens, customer gift-card tokens and secrets are not returned by list/read APIs.
- Permission checks are server-side; navigation visibility is only a usability layer.
- Duplicate redemption, duplicate campaign delivery and concurrent balance races are rejected transactionally.

## Known Limitations

- No commercial SMS, email or WhatsApp adapter is configured in this repository. The provider-neutral live boundary is implemented; the deterministic provider is test/development-only.
- A digital loyalty member token/QR payload foundation exists, but Apple Wallet and Google Wallet integrations are not claimed.
- Customer import is an authoritative preview/commit workflow. A dedicated voucher spreadsheet-import UI is not included.
- Customer aliases retain reversible merge history, but automated unmerge of a heavily transacted customer is intentionally not offered.
- The customer portal is a server/profile foundation rather than a complete public self-service application.
- Performance validation uses a scaled local SQLite fixture, not a production distributed load test.

