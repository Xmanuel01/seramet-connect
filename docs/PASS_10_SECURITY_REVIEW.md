# Pass 10 Security Review

Date: 2026-09-08

Result: **PASS - no open P0 or P1 finding identified in the implemented Pass 10 surface.**

This review supplements `PASS_10_THREAT_MODEL.md` and does not claim external provider certification or legal compliance approval.

## Reviewed Boundaries

- Customer tenant/branch isolation and direct API authorization.
- Contact normalization, duplicate resolution and customer merge.
- Consent, suppression, privacy export and anonymization.
- Loyalty points, rewards, voucher redemption and gift-card value.
- Campaign configuration, approval, audience, dispatch, retry and attribution.
- CRM analytics, feedback, imports/exports and Pass 9 evidence tools.
- POS customer linking, checkout value redemption, refunds, receipts and accounting.
- Provider secrets, logs, audit records, database constraints and durable workers.

## Findings Closed During Implementation

1. **Concurrent stored-value overspend:** closed with authoritative transactions, non-negative ledger triggers, immutable entries and concurrency tests.
2. **Voucher replay:** closed with tenant-scoped idempotency/usage constraints, append-only redemptions and checkout orchestration.
3. **Campaign consent time-of-check/time-of-use:** closed by rechecking consent and suppression immediately before dispatch.
4. **Unsafe duplicate merge:** closed by exact-identifier resolution only, explicit permission, immutable alias and audit; similar names never auto-merge.
5. **Provider credential exposure:** closed by managed `secretReference` storage and redacted provider/admin DTOs.
6. **AI protected-trait/PII exposure:** closed by an allowlisted CRM evidence boundary, source-domain permissions, minimized aggregate evidence and prohibited mutation capabilities.
7. **Refund double reversal:** closed by original-transaction links and idempotent reverse ledger entries.
8. **Misleading campaign causality:** closed by separate deterministic and correlated attribution types and explicit `causalClaim: false` for correlation.

## Residual Risks

| Severity | Risk | Required control |
|---|---|---|
| P2 | Incorrect imported consent provenance could permit unwanted marketing | Require reviewed provenance; imports cannot grant consent by default |
| P2 | Staff with contact permission can access operational PII | Apply least privilege, audit access and retention policy |
| P2 | Gift-card token theft can transfer spend authority | Protect delivery channel, expose full token once and support block workflow |
| P2 | A future live provider adapter may implement weak webhook verification | Provider-specific review and certification before activation |
| P3 | Correlated campaign conversion may be read as causal by an operator | Preserve attribution label and non-causal explanation in reporting |
| P3 | Shared-screen receipts may expose membership details | Configure receipt display and train operators |

## Data Protection

Direct identifiers are stored only where required and are tenant scoped. Gift-card lookup uses a token hash. Campaign providers receive the minimum contact/template payload required for an eligible delivery. Logs, audit records and API responses exclude secret values. Privacy anonymization preserves legal transaction relationships while replacing direct customer identity.

## Authorization

CRM, customer contact/value, privacy, loyalty, voucher, gift-card, campaign and feedback capabilities have distinct permission codes. APIs resolve tenant, branch and permissions from the authenticated server actor. UI navigation is not relied on for authorization.

## Integrity

Consent, privacy, loyalty, gift-card, voucher-redemption, campaign-event and feedback-event records are append-only at database level. Loyalty and gift-card balances are projections of immutable ledgers. Concurrent points and gift-card redemption, duplicate campaign execution and refund reversal are covered by tests.

## External Certification Required

No commercial communication provider is configured or certified in this repository. Before activation, validate its official API, authentication, secret rotation, webhook verification, retry/idempotency behavior, regional data processing and delivery-status semantics. Do not label a queued request as delivered without provider evidence.

