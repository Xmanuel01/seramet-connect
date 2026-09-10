# Pass 10 CRM, PII, Loyalty and Campaign Threat Model

## Scope

Pass 10 adds tenant-scoped customer identity, consent, privacy requests, loyalty points, vouchers, gift-card value, deterministic segmentation, feedback and outbound campaign orchestration to the authoritative Pass 1-9 platform. It reuses the existing order, invoice, payment, refund, accounting, identity, permission, audit, managed-secret, durable-worker and intelligence boundaries.

The browser remains a presentation and command surface. It is not authoritative for customer identity, consent, balances, eligibility, campaign audience, delivery state or privacy actions.

## Assets

- Direct identifiers: customer name, phone, email, member and external account identifiers.
- Consent and suppression evidence, including policy version and withdrawal history.
- Financially relevant loyalty, voucher and gift-card value ledgers.
- Authoritative order, invoice, refund and payment relationships.
- Customer value, retention, cohort and campaign read models.
- Marketing-provider credentials and message delivery metadata.
- Privacy requests, exports, anonymization evidence and audit records.
- Tenant, branch, brand, role, permission and feature-entitlement scope.

## Trust Boundaries

1. Browser to authenticated Seramet API: untrusted runtime-validated commands; tenant and branch scope come from the server actor.
2. CRM service to authoritative database: fixed tenant-scoped queries and state transitions; no browser-supplied tenant authority.
3. POS/order/refund events to CRM: idempotent source references only; CRM does not create a parallel transaction.
4. Campaign worker to provider adapter: only eligible, consented and non-suppressed recipients; secrets resolve through the managed secret store.
5. CRM evidence to Pass 9 Intelligence: allowlisted aggregate tools, source permissions and PII minimization; no customer contact details or protected-trait inference.
6. Imports/exports to file boundary: bounded schemas, preview before commit, explicit consent evidence requirements and audited export authorization.

## Attacker Model

- A user from another tenant or unauthorized branch may guess customer, campaign, voucher, gift-card or privacy-request identifiers.
- A legitimate user may attempt direct API calls without CRM, PII, merge, export, campaign, loyalty or value-adjustment permissions.
- A cashier or customer may replay points, voucher or gift-card redemption concurrently.
- A campaign retry or worker crash may duplicate a send.
- Imported names, feedback, notes or templates may carry spreadsheet formulas, template injection or instructions targeting Pass 9 AI.
- An administrator may misconfigure a provider, consent rule, accounting mapping or campaign scope.
- A provider callback may claim unsupported delivery or include a duplicate external event.

## Primary Abuse Paths And Controls

| Threat | Impact | Required control |
|---|---|---|
| Cross-tenant customer lookup or merge | PII disclosure and destructive identity corruption | Composite tenant keys, actor-derived scope, cross-tenant foreign keys rejected, isolation tests |
| Fuzzy name auto-merge | Unrelated histories and balances combined | Exact normalized identifier resolution only; explicit permissioned merge with aliases and audit |
| Consent defaulted to granted | Unlawful or unwanted marketing | `UNKNOWN` default; channel-specific append-only consent; absence never eligible |
| Withdrawal races queued campaign | Message sent after unsubscribe | Recheck latest consent and suppression at audience build and immediately before adapter send |
| Marketing mislabeled transactional | Consent bypass | Separate communication purpose enum; marketing routes cannot request transactional purpose |
| Loyalty double-spend | Negative or duplicated point value | Append-only ledger, transactional balance check, unique idempotency key, concurrent tests |
| Voucher replay or usage-cap race | Duplicate promotional entitlement | Transactional redemption insert, unique source/idempotency constraints and authoritative usage count |
| Gift-card token guessing or double-spend | Stored-value theft | Random high-entropy public token, stored token hash, atomic ledger capacity check, never log full token |
| Gift-card issuance posted as sales revenue | Financial misstatement | Existing configured liability/accounting mapping; no hardcoded journal account |
| Campaign retry duplicates a message | Spam and cost leakage | Stable delivery idempotency key, durable claim/lease, provider idempotency and delivery-event history |
| Provider result falsely marked delivered | Misleading campaign metrics | `DELIVERED` only from supported provider evidence; otherwise `SENT` or `UNKNOWN` |
| Template injection | Arbitrary execution or data disclosure | Allowlisted variables, inert interpolation, no expressions/eval, output length limits |
| Sensitive/protected segmentation | Discrimination and privacy harm | Fixed non-sensitive field/operator allowlist; forbidden-trait vocabulary rejected server-side |
| Hidden or speculative scoring | Opaque customer treatment | Deterministic documented RFM and historical value only; quality state and inputs retained |
| Feedback treated as staff misconduct | Unfounded employment action | Feedback remains customer evidence; no automatic employee finding or compensation |
| Unsafe anonymization | Broken financial/audit chain | Pseudonymize unnecessary identifiers, preserve posted financial references, append privacy events |
| Customer export leakage | Bulk PII disclosure | Dedicated permission, tenant scope, bounded export schema, audit, no secrets/payment credentials |
| AI exfiltration or protected-trait inference | PII disclosure and harmful profiling | Aggregate allowlisted CRM evidence, PII permission, minimization, protected-trait rejection and no AI mutations |
| Provider credential disclosure | Campaign-account compromise | Managed secret references only; never return or log resolved secret |

## Financial And Concurrency Invariants

- Loyalty and gift-card balances are sums of immutable ledger entries, never editable columns.
- A redemption cannot exceed the authoritative available balance at commit time.
- One source transaction and idempotency key can affect a ledger or redemption only once.
- Refund/reversal links are append-only and cannot reverse more value than the original effect.
- Voucher and gift-card domains remain separate; a voucher never becomes stored monetary value.
- Gift-card currency must match the payment/invoice currency.
- Campaign audience and delivery rows are tenant scoped and uniquely keyed per campaign/customer/channel.
- Customer merge retains source IDs as aliases and is idempotent; it never crosses tenants.

## Privacy Rules

- No protected or sensitive traits are inferred or stored as segmentation criteria.
- Contact details require dedicated PII permission in CRM responses.
- Customer notes reject secret-like content and display a warning against sensitive data.
- Consent, suppression and privacy-event history are append-only.
- Anonymization disables marketing and replaces unnecessary direct identifiers while retaining financial and audit integrity.
- Pass 9 receives aggregate CRM facts by default, not direct contact details, free-form notes or raw feedback comments.

## Residual Deployment Risks

- Production operators must approve consent wording, policy versions, retention, anonymization procedure and applicable legal basis.
- SMS, email, WhatsApp or push adapters require vendor documentation, managed credentials, callback verification, sender registration and data-processing review. No undocumented provider operation may be called live.
- Gift-card accounting and breakage treatment require tenant finance signoff.
- Campaign attribution is deterministic or correlated, never asserted as causal lift.
- Offline redemption remains blocked unless a future bounded, cryptographically safe allowance policy is explicitly implemented.

## Security Exit Criteria

Pass 10 cannot be complete with any open P0/P1 issue, cross-tenant customer access, consent or suppression bypass, points/gift-card double-spend, voucher replay, duplicate campaign send, unsafe merge, provider-secret leakage, or Pass 9 protected-trait inference path.
