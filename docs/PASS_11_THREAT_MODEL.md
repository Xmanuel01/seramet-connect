# Pass 11 Public Guest Threat Model

Status: implementation gate for public guest, QR, reservation and payment surfaces.

## Assets

- Authoritative menu prices, tax/service rules, availability and operating hours.
- Orders, invoices, payment intents, allocations, receipts and refunds.
- Reservation capacity, table occupancy, deposits and waitlist position.
- Customer identity, contact details, delivery addresses, loyalty, vouchers and gift cards.
- Staff permissions, tenant/branch configuration, provider credentials and audit history.

## Trust Boundaries

1. The guest browser and embedded widgets are untrusted clients.
2. QR, guest-session, tracking, reservation-management, receipt and feedback tokens grant only narrow capabilities.
3. The Guest Gateway is the only public command boundary and resolves public slugs to server-side tenant/branch scope.
4. Existing order, payment, inventory, KDS/KOT, CRM, loyalty and accounting services remain authoritative.
5. Provider callbacks continue through the Pass 2 integration runtime and never trust a browser redirect.
6. Durable workers own expiry, reminders, scheduled release, notification retry and aggregate recalculation.

## Principal Abuse Cases And Controls

| Threat | Control |
|---|---|
| Enumerate tenants, branches, orders or reservations | Public opaque slugs plus random 256-bit tokens stored only as hashes; bounded responses use generic not-found errors. |
| Tamper with item/modifier price, tax, service charge, discount, delivery fee or payment status | Server loads current catalog/rules and creates an expiring signed quote; submission accepts item identity and quantity only, then revalidates the quote and availability. |
| Replay checkout, QR order, deposit, voucher, gift card or payment request | Database uniqueness and existing authoritative idempotency keys; value redemption remains in the Pass 10 transaction boundary. |
| Double-book a table or seat the same table twice | Interval capacity locks and active-table-session uniqueness are committed transactionally. |
| Use a QR as staff authentication or access another table | QR tokens contain no staff authority, are hash-verified, branch/table/mode scoped, versioned, expirable, revocable and rotatable. |
| Cross-tenant or cross-branch access | Public profile resolution supplies tenant scope; every joined row repeats tenant/branch constraints and guest sessions are bound to both. |
| Steal PII from tracking or public profile endpoints | Public DTO allowlists exclude phone, email, payment references, staff data and internal identifiers; delivery addresses are never returned from tracking. |
| Brute-force voucher, gift-card, OTP, booking or tracking endpoints | Database-backed per-scope rate limits, bounded payloads and a provider-neutral abuse decision boundary. |
| Inject script or instructions through special requests, addresses, names or feedback | Strict runtime schemas, length limits, control-character stripping and React text rendering; content is labelled untrusted before Pass 9 evidence use. |
| Forge an allergen/dietary claim | Only explicitly configured catalog metadata is displayed; guest notes are warnings, not safety assertions. |
| Mark a digital payment successful while offline or after redirect | Only authoritative provider confirmation can change payment state to paid; guest UI treats redirects as processing/unknown. |
| Leak provider credentials or internal account mappings | Guest APIs never return connections, secrets, technical payment IDs or accounting mappings. |
| Duplicate notification or reminder | Unique notification idempotency keys plus durable worker claim/retry/dead-letter semantics. |
| Kiosk leaks the previous guest's data | Kiosk sessions are short-lived and the client clears cart, contact and payment state after completion/timeout. |
| Reservation spam or denial of capacity | Configurable verification/deposit/staff-confirmation policy, rate limits, expiring holds and per-session creation limits. |
| Guest text alters AI behavior | Pass 9 receives structured, minimized aggregates; guest text remains untrusted evidence and cannot create domain commands. |

## Security Invariants

- A guest token is a capability, not an identity-provider or staff token.
- Raw guest capability tokens are returned only when issued and are never persisted server-side.
- No public request may specify tenant authority.
- No quote or order trusts client monetary fields.
- A receipt is exposed only after confirmed payment and through a scoped receipt/session token.
- Cancellation, deposit application, loyalty, voucher and gift-card mutations reuse authoritative financial workflows.
- Event histories and material public-configuration changes remain append-only/audited.

## Residual Deployment Risks

- Live notification and payment adapters require provider-specific certification and managed secrets.
- Public traffic needs production edge protections, TLS, monitored rate-limit storage and an operational abuse-response policy.
- Privacy, reservation deposits, cancellation and retention policies require tenant legal/operational sign-off before a pilot.
