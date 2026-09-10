# Pass 11 - Digital Guest Experience

## Scope

Pass 11 adds public restaurant discovery, authoritative menu reads, QR and web ordering, guest payments, reservations, waitlists, table service, secure tracking, a customer portal foundation, feedback, and a staff host station. It does not create a second order, payment, inventory, CRM, loyalty, printing, or kitchen domain.

The implemented flow is:

```text
Guest / QR / web / kiosk
  -> bounded Guest API
  -> scoped guest capability
  -> authoritative quote and availability recheck
  -> existing Seramet transaction repository
  -> existing order, KDS/KOT, inventory, payment, CRM and finance services
```

## Guest gateway

`src/server/guest-api.ts` is the public boundary. Public operations have database-backed rate limits, strict Zod payloads, a 128 KiB body limit, bounded slugs and capability tokens, safe JSON errors, and no staff identity fallback. Staff host and QR administration routes use the production bearer-auth boundary and enforce granular permissions in the domain service.

Production requires an authoritative database and a signing secret of at least 24 characters. The development capability-secret fallback is enabled only when `SERAMET_ENVIRONMENT=development`; an absent production secret fails closed.

## Public profile and menu

`public_branch_profiles` stores public name, contact, branding, public status, service modes, hours, ordering/reservation switches, minimum order, and legal links. Public slugs resolve server-side to tenant and branch IDs. Only active and publicly enabled branches are returned.

The guest menu reads `menu_catalog_items`, branch settings, configured modifiers, stored dietary/allergen metadata, and Pass 6 availability. It never infers dietary or allergen claims. Channel visibility and prices are configuration data. Sold-out items remain visible with an unavailable state but cannot pass quote validation.

## Quotes and checkout

The cart is temporary browser UX state. `guest_checkout_quotes` contains the authoritative server calculation and expires after ten minutes. Quote creation validates:

- current catalog and modifier versions;
- station and branch availability;
- QR/table scope and QR mode;
- public operating status and hours;
- service mode and delivery zone;
- minimum order;
- configured voucher eligibility;
- configured tax, service charge, delivery charge, and tip;
- integer minor-unit money and a single configured currency.

Order submission reloads and re-prices the cart. A material price, discount, tax, service, fee, or availability change returns `REQUOTE_REQUIRED`; the stale client value is never accepted. `(tenant, guest session, idempotency key)` guarantees one submission.

## QR and table security

QR tokens are 256-bit random capabilities. Only SHA-256 hashes and the last four characters are stored. A token is tenant-, branch-, table-, mode-, version-, status-, and optional-expiry scoped. Rotation revokes the previous token; disable and rotation are append-only audited events. A QR capability creates a guest session, never a staff session.

Supported modes are `MENU_ONLY`, `ORDERING_ENABLED`, `ORDER_AND_PAY`, and `CALL_WAITER_ONLY`. The database permits one active QR and one active operational table session per table. Multiple guest sessions may join the same table session while keeping separate financial submissions. Closing a table session rejects pending additions or unpaid bills and a database trigger blocks late additions.

## Orders and kitchen

Guest submission invokes the existing transaction repository and transaction engine. The resulting object is a normal Seramet order with a configured channel and guest context. The same commit creates the bill and existing KDS/KOT dispatch. Inventory consumption, 86 propagation, receipts, finance events, and marketplace availability continue through their existing paths.

Branch policy selects `AUTO_ACCEPT`, `WAITER_REVIEW`, or `CASHIER_REVIEW`. Review orders remain held and are not sent to the kitchen until accepted. Addition orders use the same table session and order workflow. Service requests (`CALL_WAITER`, `REQUEST_WATER`, `REQUEST_BILL`, `NEED_ASSISTANCE`) are operational records, not orders.

## Guest payments and receipts

Guest provider payments call the existing integration runtime and Payment Orchestrator. Public methods are exposed only when an active, branch-applicable Payment Method has `guestEnabled=true`. A browser redirect or button never confirms payment; provider callbacks remain authoritative and idempotent.

Gift cards use the Pass 10 stored-value ledger. Loyalty rewards use the Pass 10 loyalty ledger. Voucher redemption is committed with order creation. Their concurrency guards prevent double spend. Existing allocation rules support partial and split payments without exceeding the outstanding invoice.

A digital bill is an unpaid invoice view. A digital receipt is available only after confirmed allocation and requires both the owning guest session and the tracking capability. Receipt output uses the existing document identity and exposes display references, not provider secrets.

## Reservations and capacity

Reservations use server-authoritative branch hours, timezone/business date, slot interval, duration, buffer, party size, service-area preference, active tables, and explicit table combinations. `reservation_capacity_locks` has a database uniqueness constraint on every table/slot. Concurrent attempts therefore produce one reservation and one conflict.

States are `PENDING`, `CONFIRMED`, `SEATED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`, and `WAITLISTED`. Modifications release old locks and acquire new capacity atomically. Reservation management uses a deterministic HMAC capability derived from a server secret and the reservation identity; the hash is stored. Reservation numbers alone do not authorize access.

Fixed and per-guest deposits are supported when liability account and payment-method mappings are configured. Collection credits the configured customer-deposit liability. Application to a seated bill creates an immutable adjustment transaction and a balanced journal: debit deposit liability, credit configured invoice receivable. Duplicate collection/application is rejected. Percentage deposits remain disabled until a configured reservation-value basis exists.

## Waitlist and host station

Waitlist entries are authoritative and use factual join/notified/seated timestamps. Estimates are deterministic from configured default turn duration and queue position; they are not described as AI. Staff can notify, cancel, expire, or seat an entry. Seating requires a specific available table and creates the reservation/table-session context atomically.

The staff Host screen combines bounded views for today's reservations, arrivals, waitlist, table state, seated sessions, and service requests. It supports walk-ins, seating, no-show/cancel/complete transitions, request acknowledgement, and table close with server-side RBAC.

## Pickup, direct delivery, schedules and tracking

Pickup and direct delivery orders use the same quote/order model. Delivery zones support configured flat, area, postal, radius, or polygon definitions. The server calculates minimum order and delivery fee. Address records are tenant-scoped, permission-protected, and carry a 30-day retention timestamp by default.

Scheduled orders are stored on the normal order and released by the Pass 5 durable worker architecture, not browser timers. Direct delivery uses the existing delivery/rider fields and safe public status mapping. Tracking capabilities are random, non-enumerable, rate-limited, and return no phone, email, staff, payment reference, or other order data.

## CRM, loyalty and portal

Anonymous checkout remains supported. A guest can optionally link an existing Pass 10 membership with a high-entropy membership credential; only its hash and last four characters are used. The scoped portal returns display name, memberships, tiers, points, eligible rewards, and that verified customer's own direct orders/reservations. It does not return phone or email.

Completed direct orders can submit one bounded, sanitized feedback record into the existing CRM feedback service. A database partial unique index and service replay handling prevent duplicate feedback.

## Notifications and workers

`GUEST_LIFECYCLE_MAINTENANCE` and `GUEST_NOTIFICATION_DISPATCH` run on the durable worker schedule. They expire holds, sessions, waitlist entries, and unpaid deposit windows; release locks; create idempotent confirmation/reminder events; retry provider delivery; and dead-letter exhausted notification attempts. Notification failure never reverses a valid reservation, order, or payment.

Actual SMS, email, WhatsApp, or push delivery remains dependent on a configured notification provider adapter and credentials.

## Analytics and Pass 9

The `GUEST_EXPERIENCE` evidence tool is read-only and permission-gated. It reports factual reservations, no-show rate, direct/QR order share, table turns, occupied duration, configured-hours table/seat utilization, waitlist time, service-response time, and funnel conversion. Funnel and utilization definitions are deterministic. Missing instrumentation lowers quality to `LOW` or `INSUFFICIENT_DATA`; it is not converted into zero demand.

## Kiosk and PWA foundation

Kiosk mode reuses the public menu, quote, order, and payment paths. Finishing a kiosk session clears cart, capability, tracking context, and guest PII from the browser. The web manifest provides installability metadata. Guest cart persistence is only a convenience cache; server acknowledgement is required before any order is shown as submitted. Full offline guest ordering is intentionally not supported.

## Privacy and security

- Guest tokens are non-guessable, expire, are hashed at rest, and are scope checked.
- Staff routes require server-authenticated bearer identity and domain permissions.
- Public responses minimize PII and set `no-store` for private records.
- Prices, taxes, discounts, payment state, availability, branch/table scope, and loyalty balance are server authoritative.
- SQL uses bound parameters; special requests and feedback are bounded and rendered as React text.
- Public routes are rate limited and request bodies are bounded.
- Event/audit histories are append-only where material.
- Guest-provided text remains untrusted evidence and cannot change Pass 9 instructions or execute domain commands.

No P0 or P1 Pass 11 issue remains after the implementation review. Production deployment must still verify edge HTML CSP, TLS, bot/WAF policy, notification/provider configuration, retention policy, and an external penetration test.

## Known limitations

- No password or ad-hoc OTP identity system was introduced. The portal foundation links an existing verified high-entropy membership credential.
- Percentage reservation deposits require an authoritative reservation-value basis and return a configuration error until one exists.
- Dynamic geocoding and map rendering require a future configured maps provider; no distance is fabricated when coordinates are absent.
- The manifest is a PWA foundation, not a claim of offline guest submission.
- Notification and live digital-payment certification are provider/deployment responsibilities.
- Seat utilization excludes sessions that have no factual party-size link; the evidence package discloses that limitation.

