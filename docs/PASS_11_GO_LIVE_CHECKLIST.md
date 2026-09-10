# Pass 11 Go-Live Checklist

## Public profile

- [ ] Confirm every public restaurant and branch slug.
- [ ] Confirm brand name, logo, cover image, colors, address, phone, email, social and legal links.
- [ ] Confirm only intended active branches are publicly enabled.
- [ ] Confirm public status and service modes per branch.
- [ ] Verify branch timezone, business-day cutoff, public hours and reservation hours.
- [ ] Test closed, paused, reservations-only and coming-soon states.

## Menu and pricing

- [ ] Publish the intended channel catalog, descriptions and approved imagery.
- [ ] Verify branch/channel prices, modifier prices, required/min/max selections and station routes.
- [ ] Verify stored dietary and allergen declarations with kitchen management.
- [ ] Confirm tax, service-charge, delivery-charge, tip and minimum-order rules.
- [ ] Test stale quote, changed price, sold-out item, disabled modifier and 86 restoration.
- [ ] Confirm guest menu never displays unsupported allergen claims.

## Tables and QR

- [ ] Verify service areas, table codes, capacities, accessibility data and active state.
- [ ] Configure only physically valid table combinations.
- [ ] Select QR mode per table: menu, order, order/pay or call-waiter.
- [ ] Rotate all pilot QR capabilities immediately before print.
- [ ] Print and scan every table card; verify branch, table, branding and mode.
- [ ] Test QR disable, rotation, expiry, multiple guests and table close.
- [ ] Train staff not to treat a QR scan as staff authentication.

## Reservations and host

- [ ] Configure slot interval, default duration, buffer, party limits and advance window.
- [ ] Configure verification: none, email, phone, deposit or staff confirmation.
- [ ] Configure cancellation, late-cancellation, no-show and deposit refund/forfeiture policies.
- [ ] Configure fixed/per-guest deposit amount, liability account and payment method if used.
- [ ] Test concurrent booking, modification, cancellation, seating, walk-in and no-show.
- [ ] Test waitlist notification, expiry and table assignment.
- [ ] Train host staff on arrivals, table state, service requests and conflict handling.

## Ordering and kitchen

- [ ] Choose QR review policy: auto, waiter review or cashier review.
- [ ] Test QR addition tickets and cancellation/void policy.
- [ ] Test pickup ASAP and scheduled pickup.
- [ ] Test direct delivery address, zone, fee, schedule and rider dispatch.
- [ ] Confirm guest orders create normal Seramet orders and one bill.
- [ ] Confirm KDS/KOT printer and station routing for every guest channel.
- [ ] Confirm sale consumption, 86 and marketplace availability outbox behavior.
- [ ] Test server outage: cart remains, submission does not falsely succeed.

## Payments and value

- [ ] Enable only certified, branch-applicable guest payment methods.
- [ ] Test provider timeout, failure, delayed callback, duplicate callback and successful confirmation.
- [ ] Confirm no receipt exists before authoritative payment.
- [ ] Test partial/split payment and two guests attempting the same balance.
- [ ] Test voucher scope, cap, stacking and simultaneous use.
- [ ] Test gift-card partial balance, simultaneous use and exhausted balance.
- [ ] Test loyalty membership linking, reward eligibility, redemption and earning.
- [ ] Test reservation deposit collection, application, refund and configured forfeiture workflow.
- [ ] Verify all payment, deposit and refund journals against configured accounts.

## CRM, portal and feedback

- [ ] Confirm anonymous checkout policy.
- [ ] Issue verified membership credentials using the approved Pass 10 process.
- [ ] Verify portal scope for orders, reservations, points, tier and rewards.
- [ ] Confirm feedback categories, invitation policy and follow-up ownership.
- [ ] Test digital bill, receipt view, download/share and receipt privacy.
- [ ] Review PII retention for addresses, guest sessions, reservations and notifications.
- [ ] Verify privacy-request and consent procedures remain available.

## Notifications

- [ ] Configure approved transactional notification adapters and managed secrets.
- [ ] Approve templates for confirmation, reminder, ready, delivery and receipt events.
- [ ] Confirm transactional purpose is separate from marketing consent.
- [ ] Test retries, provider failure, idempotency and dead-letter escalation.
- [ ] Confirm notification failure does not reverse domain state.

## Access and operations

- [ ] Grant `reservation.*`, `waitlist.*`, `guest_order.*`, `table.manage`, `digital_menu.manage` and `qr.manage` individually.
- [ ] Verify Branch Manager assignments are branch scoped.
- [ ] Verify module view permissions do not grant cancellation, refund, QR rotation or financial approval.
- [ ] Test effective-dated temporary assignments if used.
- [ ] Train General Managers on audited role/permission changes.
- [ ] Confirm guest worker schedules, queue health, retries and dead letters.

## Security and deployment

- [ ] Use authoritative production database and apply migration 0012 once.
- [ ] Set production JWT/capability signing secret through managed secrets.
- [ ] Require HTTPS and verify trusted callback/public base URLs.
- [ ] Verify edge CSP, framing, TLS, request-size and bot/WAF policies.
- [ ] Verify public rate limits behind the production proxy and trusted client-IP headers.
- [ ] Run external penetration tests for token enumeration, IDOR, tampering, XSS and abuse.
- [ ] Verify no test provider, demo tenant or demo secret is active in production.
- [ ] Review logs/diagnostics for token, PII and provider-secret redaction.

## Recovery and pilot signoff

- [ ] Back up the database and test restore including reservations, events, QR history and guest orders.
- [ ] Document QR emergency disable and online-order pause procedures.
- [ ] Document provider outage and manual host/POS fallback.
- [ ] Test rollback of application code without rolling back an applied migration.
- [ ] Complete tablet/mobile/desktop checks on production-like staging.
- [ ] Obtain restaurant operations, finance, privacy and security signoff.
- [ ] Run a controlled branch pilot before enabling all branches.

