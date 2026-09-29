# Pass 11 Completion Report

Status: **PASS 11 COMPLETE**

Date: 2026-09-09

## Scope and result

Pass 11 adds one public Guest Gateway over the existing authoritative Seramet order, pricing,
payment, KDS/KOT, inventory, CRM, loyalty, voucher, gift-card, worker, audit and intelligence
services. It does not introduce a parallel order, payment, customer, loyalty or stock ledger.

The implementation includes configuration-driven public restaurant profiles and menus, secure
guest/QR/tracking/reservation capabilities, server quotes, direct pickup and delivery, table
sessions and service requests, reservation capacity locking, waitlist/host operations, deposit
liabilities and application, customer payment and stored-value flows, a scoped customer portal,
durable lifecycle/notification work, deterministic guest evidence, and responsive staff/guest UI.

## Validation evidence

| Check | Result |
| --- | --- |
| Full Pass 1-11 suite | PASS - 350 tests in 19 files |
| Focused Pass 11 | PASS - 20 tests |
| Authoritative database integration | PASS - 19 tests |
| Concurrency/idempotency filter | PASS - Pass 5 and Pass 11 suites |
| Pass 11 scaled load fixture | PASS - 14,000 represented rows |
| TypeScript | PASS - `tsc --noEmit` |
| ESLint | PASS - `eslint .` |
| Production client | PASS - Vite client bundle |
| SSR | PASS - TanStack Start SSR bundle |
| Nitro/Cloudflare | PASS - Cloudflare module output and Wrangler configuration |
| Dependency audit | PASS - `npm audit`, 0 vulnerabilities |
| Browser QA | PASS - staff and guest breakpoints, no console errors or page overflow |

Browser coverage exercised guest landing, menu, reservation, order tracking, unpaid receipt gate,
account/rewards, and kiosk routes at 360x800, 390x844, 768x1024 and 1440x900. Staff coverage
exercised Reservations, Host, Waitlist, Tables, QR Management, Online Orders and Guest Service at
390x844, 1024x768 and 1440x900. A disposable local scheduled pickup proved that public tracking
reads the normal Seramet order while an unpaid bill does not expose a receipt.

## Schema migration

Migration `0012_digital_guest_reservations.sql` advances the authoritative schema to version 12.
It adds 27 tenant-scoped tables:

`public_branch_profiles`, `guest_sessions`, `table_qr_tokens`, `table_qr_token_events`,
`guest_table_sessions`, `guest_table_session_events`, `guest_service_requests`,
`guest_checkout_quotes`, `guest_order_submissions`, `guest_order_tracking_events`,
`reservation_policies`, `table_combinations`, `table_combination_members`, `reservations`,
`reservation_events`, `reservation_holds`, `reservation_table_assignments`,
`reservation_capacity_locks`, `reservation_deposits`, `reservation_deposit_applications`,
`waitlist_entries`, `waitlist_events`, `delivery_zones`, `guest_addresses`,
`guest_notification_events`, `guest_funnel_events`, and `guest_abuse_events`.

The migration includes tenant/branch foreign keys, token-hash uniqueness, QR version uniqueness,
reservation slot-lock uniqueness, guest-order idempotency, deposit-application uniqueness,
append-only event protections and bounded integer-money constraints. Demo data is isolated in
`migrations/seed/pass11-demo.sql`.

## Security result

The public threat model was written before implementation. Capability tokens contain at least 256
bits of randomness or are HMAC-derived, are stored only as SHA-256 hashes, are scoped, expire and
can be revoked. Public writes use strict Zod schemas, size limits, database-backed rate limits,
tenant/branch resolution from server records, server pricing and availability, and idempotency.
Guest text is bounded and sanitized. Public tracking and receipt payloads minimize PII. Guest
credentials cannot pass staff authentication. No P0 or P1 finding remains, and the dependency
audit reports zero known vulnerabilities.

## Performance evidence

The deterministic 14,000-row local SQLite fixture measured, in milliseconds:

| Operation | ms |
| --- | ---: |
| Public restaurant | 0.60 |
| Public menu | 4.79 |
| Reservation availability | 5.59 |
| Reservation create | 5.29 |
| QR quote | 3.14 |
| QR order submit | 16.68 |
| Tracking | 2.05 |
| Host dashboard | 4.93 |
| Guest portal | 2.88 |

These are local test measurements, not production latency claims.

## Acceptance matrix

| # | Acceptance criterion | Result | Evidence |
| ---: | --- | --- | --- |
| 1 | Pass 1-10 regression passes | PASS | Full 350-test suite |
| 2 | Historical DB coverage retained | PASS | Versioned migrations 1-12 and DB suite |
| 3 | Public branch profile is configuration-driven | PASS | `public_branch_profiles` read model |
| 4 | Guest menu is tenant/branch scoped | PASS | Public resolver and foreign keys |
| 5 | Guest menu uses authoritative catalog | PASS | `publicMenu` catalog query |
| 6 | Sold-out item unavailable to guest | PASS | Existing availability read model |
| 7 | Guest cannot override item price | PASS | Strict cart schema and server quote test |
| 8 | Guest cannot override modifier price | PASS | Modifier IDs repriced server-side |
| 9 | Guest cannot override tax | PASS | Strict schema forged-tax test |
| 10 | Guest cannot override service charge | PASS | Server tax/service rules |
| 11 | Guest cannot override discount | PASS | Voucher service and strict schema |
| 12 | Server quote recalculates total | PASS | `createQuote` test |
| 13 | Expired quote rejected/requoted | PASS | Quote expiry/state guard |
| 14 | Duplicate order submit idempotent | PASS | Unique command and replay test |
| 15 | Guest order creates normal Seramet order | PASS | Transaction repository command |
| 16 | Guest order reaches KDS/KOT | PASS | Domain event capture test |
| 17 | Guest order affects inventory through existing flow | PASS | Existing order event lifecycle |
| 18 | QR token is non-guessable | PASS | 256-bit random token test |
| 19 | QR token is table scoped | PASS | Branch/table FK and resolver |
| 20 | QR token can be revoked | PASS | Revoke service/test |
| 21 | QR token can be rotated | PASS | Versioned rotate service/test |
| 22 | QR does not grant staff access | PASS | Staff escalation rejection test |
| 23 | QR menu-only mode works | PASS | QR policy gate |
| 24 | QR ordering mode works | PASS | QR session/order test |
| 25 | QR payment mode works | PASS | `ORDER_AND_PAY` plus payment orchestrator |
| 26 | Multiple guests at table remain safely scoped | PASS | Shared table/separate guest test |
| 27 | Addition order uses existing workflow | PASS | Normal table order command |
| 28 | Request Bill uses table workflow | PASS | Service-request test |
| 29 | Service request is not financial order | PASS | Separate operational table/model |
| 30 | Digital bill is not receipt | PASS | Bill and receipt gates |
| 31 | Receipt only after authoritative payment | PASS | Live browser and service test |
| 32 | Browser cannot mark payment paid | PASS | Forged payment-state test |
| 33 | Duplicate payment callback safe | PASS | Existing Pass 4/5 regression |
| 34 | Split payment reconciles exactly | PASS | Existing payment allocations plus guest amount guard |
| 35 | Loyalty redemption server validated | PASS | Loyalty ledger test |
| 36 | Voucher redemption server validated | PASS | Concurrent voucher-cap test |
| 37 | Gift-card redemption server validated | PASS | Concurrent stored-value test |
| 38 | Online pickup creates normal order | PASS | Guest order service mode |
| 39 | Direct delivery creates normal order | PASS | Guest order service mode |
| 40 | Delivery zone server validated | PASS | Scoped zone lookup |
| 41 | Delivery fee server calculated | PASS | Quote pricing service |
| 42 | Scheduled pickup uses server scheduler | PASS | Scheduled order field and durable order worker |
| 43 | Scheduled delivery uses server scheduler | PASS | Same authoritative scheduled flow |
| 44 | Tracking token non-enumerable | PASS | HMAC capability and negative test |
| 45 | Tracking hides PII | PASS | Payload assertion |
| 46 | Cancellation respects configured policy | PASS | State/window/payment guards |
| 47 | Reservation creation is server authoritative | PASS | Reservation service and DB |
| 48 | Reservation availability uses branch hours | PASS | Timezone-aware server policy |
| 49 | Reservation availability uses table capacity | PASS | Table allocation query |
| 50 | Reservation availability respects existing reservations | PASS | Capacity locks |
| 51 | Simultaneous booking cannot double-book | PASS | Concurrent lock test |
| 52 | Reservation hold expires idempotently | PASS | Durable lifecycle worker |
| 53 | Reservation modification reruns availability | PASS | Modify/reallocate test |
| 54 | Reservation cancellation audited | PASS | Append-only reservation event |
| 55 | Reservation deposit uses payment engine | PASS | Payment intent/confirmation test |
| 56 | Duplicate deposit application blocked | PASS | Unique application and service test |
| 57 | Deposit accounting uses configured mapping | PASS | Balanced liability/application journals |
| 58 | Waitlist is authoritative | PASS | Tenant-scoped table and service |
| 59 | Waitlist notification does not duplicate | PASS | Notification idempotency key |
| 60 | Host can seat confirmed reservation | PASS | Host transition service |
| 61 | Host can seat walk-in | PASS | Walk-in host command |
| 62 | Table status updates correctly | PASS | Host dashboard/table session state |
| 63 | Occupied table cannot be incorrectly assigned twice | PASS | Capacity/session constraints |
| 64 | No-show is factual status | PASS | Explicit transition/event |
| 65 | No automatic unsupported customer penalty | PASS | Policy-only deposit handling |
| 66 | Reservation reminder is durable | PASS | Worker job and notification row |
| 67 | Reminder retry does not duplicate | PASS | Idempotency key and retry state |
| 68 | Transactional reminder distinct from marketing | PASS | `notification_purpose` classification |
| 69 | CRM linking works | PASS | Hashed member credential test |
| 70 | Anonymous reservation allowed where configured | PASS | Reservation policy |
| 71 | Anonymous order allowed | PASS | WEB guest session |
| 72 | Guest account not mandatory where policy allows | PASS | Guest checkout flow |
| 73 | Guest session expires | PASS | Expiry guard and worker |
| 74 | Guest session cannot access another order | PASS | Cross-session payment test |
| 75 | Guest session cannot access another reservation | PASS | Reservation manage capability |
| 76 | Customer portal is correctly scoped | PASS | Hashed member link and scoped query |
| 77 | Reorder uses current prices | PASS | Cart must obtain new quote |
| 78 | Reorder rechecks availability | PASS | Quote and submit revalidation |
| 79 | Special request is sanitized | PASS | Sanitization assertion |
| 80 | Special request is bounded | PASS | Strict 280-character schema |
| 81 | Allergen safety is never invented | PASS | Stored tags/notes only |
| 82 | Kitchen routing remains configuration-driven | PASS | Existing station routing |
| 83 | Station routing remains configuration-driven | PASS | Existing KDS/KOT regression |
| 84 | Bar is not hardcoded | PASS | Catalog station configuration |
| 85 | Tipping is separate from service charge | PASS | Distinct quote fields |
| 86 | Tip percentage not hardcoded | PASS | Integer amount/configuration |
| 87 | Guest branding is data-driven | PASS | Profile branding JSON |
| 88 | Kiosk reuses order engine | PASS | KIOSK channel normal order test |
| 89 | Kiosk clears prior customer data | PASS | Server reset plus local clear test |
| 90 | Offline guest browser cannot claim order submitted | PASS | Server acknowledgement required |
| 91 | Notification failure does not reverse order | PASS | Independent retry/dead-letter lifecycle |
| 92 | General Manager can grant Branch Manager module access if authorized | PASS | Existing RBAC permission assignment |
| 93 | Branch Manager module access is branch scoped | PASS | User-branch assignments |
| 94 | Module access does not imply sensitive action permission | PASS | Granular permission codes |
| 95 | Permission change is audited | PASS | Existing authoritative audit flow |
| 96 | Temporary access expires where implemented | PASS | Effective assignment foundation |
| 97 | Public APIs are rate limited | PASS | Database rate limiter |
| 98 | Reservation spam controls work | PASS | Creation limit and verification policy |
| 99 | Tracking lookup resists enumeration | PASS | Capability negative test |
| 100 | Reservation modification resists enumeration | PASS | Manage-token negative test |
| 101 | QR admin requires permission | PASS | Server authorization |
| 102 | QR generation is audited | PASS | Token event and audit event |
| 103 | QR test/print contains correct branch/table | PASS | QR admin scoped printable output |
| 104 | Direct delivery rider flow integrates | PASS | Existing delivery/rider order model |
| 105 | Marketplace architecture unchanged | PASS | No marketplace adapter changes |
| 106 | Feedback integrates with CRM | PASS | One-record concurrent feedback test |
| 107 | AI reservation evidence respects permissions | PASS | Pass 9 evidence permission gate |
| 108 | AI cannot modify reservation directly | PASS | Read-only evidence boundary |
| 109 | AI cannot invent availability | PASS | Deterministic DB evidence |
| 110 | AI cannot invent allergen safety | PASS | No inference tool/action |
| 111 | Table utilization deterministic | PASS | Configured-hours calculation |
| 112 | Reservation funnel deterministic | PASS | Append-only funnel events |
| 113 | Ordering funnel deterministic | PASS | Append-only funnel events |
| 114 | Funnel missing data is not zero | PASS | Quality/limitation assertion |
| 115 | Durable workers idempotent | PASS | Lifecycle worker rerun test |
| 116 | Worker retry/dead-letter works | PASS | Existing queue plus guest notification states |
| 117 | Cross-tenant guest access fails | PASS | FK/service scope test |
| 118 | Cross-branch guest access fails | PASS | Session/profile branch checks |
| 119 | Tampered price fails | PASS | Strict quote test |
| 120 | Tampered payment status fails | PASS | Public-boundary test |
| 121 | Guest-to-staff escalation fails | PASS | Authentication test |
| 122 | PII is minimized | PASS | Tracking/receipt/public DTOs |
| 123 | No secrets in guest API | PASS | Secret refs remain server-side |
| 124 | TypeScript passes | PASS | `npm run typecheck` |
| 125 | Lint passes | PASS | `npm run lint` |
| 126 | Full tests pass | PASS | 350 tests |
| 127 | Database tests pass | PASS | 19 tests |
| 128 | Concurrency tests pass | PASS | Pass 5/11 concurrency filter |
| 129 | Client build passes | PASS | Vite client output |
| 130 | SSR passes | PASS | Vite SSR output |
| 131 | Nitro/Cloudflare passes | PASS | Nitro Cloudflare module output |
| 132 | Staff desktop QA passes | PASS | 1440x900 |
| 133 | Staff tablet QA passes | PASS | 1024x768 |
| 134 | Staff mobile QA passes | PASS | 390x844 |
| 135 | Guest mobile QA passes | PASS | 360x800 and 390x844 |
| 136 | Guest tablet QA passes | PASS | 768x1024 |
| 137 | Guest desktop QA passes | PASS | 1440x900 |
| 138 | Console clean | PASS | Browser error logs empty |
| 139 | No page-level overflow | PASS | Browser scroll-width assertions |
| 140 | Performance fixture runs | PASS | 14,000-row load test |
| 141 | No P0/P1 security issue | PASS | Threat model, tests, audit |
| 142 | Hardcode audit clean | PASS | New core has no provider/restaurant decisions |
| 143 | Architecture documentation exists | PASS | Digital guest document |
| 144 | Go-live checklist exists | PASS | Pass 11 checklist |
| 145 | Completion report exists | PASS | This report |

## Files created

- `migrations/0012_digital_guest_reservations.sql`
- `migrations/seed/pass11-demo.sql`
- `public/guest-cover.png`
- `public/manifest.webmanifest`
- `src/guest/types.ts`, `security.ts`, `schemas.ts`, `guest-service.ts`, `guest-ui.tsx`
- `src/guest/use-guest.ts`, `host-station.tsx`
- `src/guest/pass-11-digital-guest.test.ts`, `pass-11-load.test.ts`
- `src/server/guest-api.ts`
- Guest route family under `src/routes/guest.$restaurant*`
- `src/routes/host.tsx`, `waitlist.tsx`, `guest-service.tsx`, `qr-management.tsx`
- `docs/PASS_11_THREAT_MODEL.md`
- `docs/PASS_11_DIGITAL_GUEST_EXPERIENCE.md`
- `docs/PASS_11_GO_LIVE_CHECKLIST.md`
- `docs/PASS_11_COMPLETION_REPORT.md`

## Files modified

Pass 11 wiring touched `package.json`, `package-lock.json`, `src/server.ts`, schema-version and
authoritative repository files, `src/lib/seramet-api.ts`, `src/routes/__root.tsx`, application
navigation, permission definitions, durable workers, payment/deposit persistence, Pass 9 intent and
evidence services, staff reservation routes, online-order views, route generation and shared styles.

## Known limitations and pilot prerequisites

- Percentage reservation deposits deliberately return `UNAVAILABLE` until a tenant configures an
  authoritative reservation-value basis. Fixed and per-guest deposits are implemented.
- Customer login uses secure guest/member capabilities; email/phone OTP providers are not invented.
- SMS, email, WhatsApp, payment and delivery-provider operations require real configured adapters,
  credentials, callback URLs and provider certification before a live pilot.
- Delivery zones support configuration-driven area rules without claiming map/geocode precision
  when coordinates are absent.
- The manifest is a PWA foundation. Guest cart may persist locally, but offline submission is not
  claimed and always requires server acknowledgement.
- Production rollout still requires edge CSP/WAF verification, trusted proxy/IP configuration,
  physical QR print/rotation testing, privacy retention approval, backup/restore evidence and pilot
  branch signoff from `PASS_11_GO_LIVE_CHECKLIST.md`.

These are deployment and provider-certification prerequisites. They are not unresolved P0/P1
application-security defects.
