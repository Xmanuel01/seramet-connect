# Codex master brief — Seramet go-live: onboarding, authentication, business setup and safe integrations

**Priority:** This work happens IN PARALLEL with menu restoration in draft PR #44. You own **onboarding, login, post-onboarding setup, and integration UX**. Do not edit `src/routes/menu-import.tsx`, `src/components/app/ManualMenuItemDialog.tsx`, `src/onboarding/manual-menu-item.ts`, or the canonical menu import backend while PR #44 is in progress. Start an independent branch `hardening/onboarding-auth-go-live` from the latest `main`; review PR #44 and draft Customers PR #40 before merging to avoid schema or shared-route collisions. Do not deploy production or alter real tenant data.

## Non-negotiable working method

Treat Seramet as a real multi-tenant, multi-branch restaurant ERP. **Start with an evidence-based repository audit and actual restaurant workflow trace, not CSS or mocked responses.** Identify the routing, API, repository, current schema/migrations, authorization and each UI consumer. Document broken calls, hardcoded defaults, faux success states, missing buttons, missing persistence, and account/branch leaks. For every fix run real API/database tests including negative paths and verify UI flows on an isolated staging tenant. Push small reviewed commits and a separate draft PR. Keep existing features and green Seramet theme. Never overwrite my uncommitted laptop changes, access live money or send messages to genuine customer contacts.

## First-day critical path — implement and test in order

### P0. New restaurant lifecycle

1. On first installation, only if no authoritative organization exists for the authenticated account, show onboarding. When an organization and authorized account already exist, open the proper login flow — **not a second onboarding** and not silently auto-login. Verify correct treatment of a new owner who belongs to zero tenants, an existing owner with one or several tenants, and a disabled or pending user.
2. Owner onboarding should be a guided, recoverable sequence: verified owner identity/email -> business legal and trading name, country, default currency, timezone, contact/logo/legal identifiers and optional tax metadata -> brand -> explicit branch creation (name, branch code/address, hours, services) -> first manager/owner assignment and employee enrollment -> departments/kitchen/bar service and production station configuration -> printer/KDS assignments -> POS payment options -> seed menu or skip -> readiness review. Persist after each approved step to server with idempotent operations; draft progress survives refresh without creating duplicate brands/branches or privilege elevation.
3. Explicitly distinguish **owner account** from **staff POS login**. Do not assign arbitrary roles automatically or share users between tenants. Onboarding owner has auditable admin role in their tenant; subsequent staff accounts are created by an authorized admin and require explicit role and branch assignment. Each branch operates independently, with intentional owner-level all-branches access.

### P0. Authentication — no implicit auto-login after logout

1. Two supported entry points: (a) new owner signup/account verification and onboarding, (b) existing operator POS login using **email + individual PIN (4 or 6 digits) + branch selection** (iPhone-style accessible number keypad on POS-sized/mobile display). Distinguish normal browser reload with an active explicitly established authenticated session from a real logout.
2. Logging out MUST clear application session state, cached user/tenant/branch data, Supabase client authentication where applicable, and server session/refresh tokens. Redirect to a signed-out email-and-PIN login screen. Supabase background session restoration, saved account hints or previous device identity must **not** silently re-enter a user after logout. Do not invent fake auth flags.
3. Verify staff credentials, salted PIN hashes, rate limits, cooldown/lockout, anti-enumeration error messages, role status, branch entitlement, device permissions and server-issued scoped sessions on the backend. Never ship hardcoded root PINs, plaintext PIN hashes, shared PINs, default unlocks or browser-trusted role/tenant headers. Secure PIN reset/enrollment and owner account recovery through verified email / stronger authentication; changing PIN invalidates stale sessions.
4. Signed-in users see ONLY the authorized tenant and branches. Manager chooses among assigned branches only; branch-scoped permissions and query state must reset immediately on switch. Protected routes and APIs must reject unauthenticated requests. Test cross-tenant access, cross-branch access, blocked user, revoked PIN, brute force, idle expiration, refresh while logged in, and logout followed by reload/back-button.

### P0. Repair Setup — business information and kitchen/department controls

1. Reproduce and fix the reported Setup bug: business information entered during onboarding is invisible after onboarding. Trace onboarding write -> authoritative tenants/profile table -> correct tenant/branch GET -> Setup/business profile UI -> edit -> refresh/relogin. Preserve source of truth, don't duplicate it into frontend-only state. Display saved owner-visible legal/trading name, address, contacts, country, currency, timezone, logo and configured compliance values; provide authorized edit form with server verification. Handle missing optional fields clearly, and never show another tenant's details.
2. Make Setup navigation discoverable with explicit **Business information, Branches, Staff & roles, Departments, Kitchen & Bar stations, Printer/KDS routing, Menu & inventory, Payment methods, Marketplace accounts**, plus an honest Go-live checklist. If a configuration is still unimplemented, display an explicit unavailable reason instead of a fake Save button or zero metric.
3. Department configuration should model kitchen/bar/service departments, production stations owned by a branch, assignment of menu categories/items to production stations, KOT/KDS receipt destinations, and access-controlled create/edit/disable flows. Verify POS order -> chosen item -> authoritative station -> correct KOT/KDS/printer; if only one printer is configured route bills, receipts and KOT jobs there without duplicate dispatch. Preserve existing hardware and printer configuration.
4. Branch creation must require explicit owner-selected branch, not silently auto-create extra branches or auto-assign an unselected role. Use request idempotency, duplicate-code checks and conflict-safe persistence. A manager in branch A cannot change branch B's stations or staff.

### P0. Make tomorrow's restaurant shift usable

Run a controlled staging shift: owner login -> verify existing business profile -> authorized staff login with email+PIN -> select branch -> open POS -> see real activated menu items -> send actual test order -> receive KOT on configured kitchen test output -> modify/cancel with proper authorization -> settle cash/M-Pesa sandbox or mocked internal test only with explicitly marked sandbox -> cash-drawer and EOD reconciliation -> logout -> verify staff must reenter email+PIN. The menu creation/import UX is owned separately in PR #44; coordinate on menu API contracts and don't hardcode replacement menu values.

## P1. Provider integration model — simple restaurant UX, secrets backend only

**The operator/owner must see and edit only details specific to their restaurant account**: M-Pesa Till/Paybill and store number and settlement details as appropriate; marketplace merchant/store IDs, branch listing/mapping, enablement, supported order channels, platform fulfillment vs in-house rider assignment, local business delivery rules and human-readable connection state. Do not expose developer credentials, secret fields, client secrets, webhook signing secrets, OAuth details, internal callback URLs or raw provider response payloads to staff or owner.

Keep platform-wide **technical integrations** (M-Pesa Daraja consumer keys/secrets and securely stored OAuth token lifecycle, STK/callback verification, Pesapal, Uber Eats/Glovo/Bolt marketplace credentials, provider registry/version, webhook endpoints, retries/outbox, signature validation) entirely in backend env or a managed secret store/Supabase server-side secrets. Separate provider-wide secrets from tenant-specific **sensitive** credentials when a provider absolutely requires unique credentials per merchant: merchant-specific secrets are entered only through a short-lived authorized server-side secure-entry flow, immediately encrypted/storage-bound, redacted and never returned to the browser. Owner forms should not encourage routine secret-key entry. Owner config changes must be branch-scoped, audited, validated and idempotent; show only simple states **Not connected / Awaiting verification / Connected / Action needed**, plus safe connection testing.

For M-Pesa, the restaurant chooses Till/Paybill and applicable store configuration; backend determines provider secrets and handles Daraja requests and payment reconciliation. For marketplaces, use explicit incoming order source, merchant/branch mapping, own-rider vs platform-rider fulfillment, cash-due/part-payment settlement and expected marketplace receivables posting. A failed integration cannot fabricate a paid POS invoice or break a cash-only shift.

### P2 deferred after operational go-live

Deep historical imports, advanced campaign setup, optional automation and nonessential configuration must not block the owner creating real items, entering orders and completing a shift. Show honest warnings and a later-setup checklist; don't hide essential security blockers or pretend full production readiness without the configured malware scanner.

## Implementation and quality constraints

- Read the existing repository before proposing a new auth stack, tables or module. Reuse server/domain services, Supabase Auth integration, approved tenant/user/branch models and the existing green responsive design. Where the present design cannot support email+PIN, document and implement a secure server-side extension rather than trusting browser PIN checks.
- No UI endpoint may return hardcoded business profile, staff roles, department, station, credentials or claimed successful sync. API errors must be actionable without leaking stack traces or secrets.
- Backend secrets never enter production JS bundles, source commits, demo data, logs or public tables. Use secret redaction and scoped API permissions. Do not accept `x-seramet-tenant-id`/role headers as authorization.
- Each server mutation gets schema validation, tenant/branch auth, explicit idempotency and audit trail. Add migrations safely and provide staging apply + rollback/restore plan; never alter production data while testing.
- Avoid route/header/session state races by aborting stale fetches and clearing tenant-bound caches on switch and logout.
- Add automated unit, API, real isolated PostgreSQL and browser interaction tests (Playwright or existing UI harness if available). Test positive flows and failures, including no implicit session after logout, branch role checks, duplicate onboarding, missing station/one-printer fallback, provider credential redaction and interrupted saving.
- Preserve `main` and keep this work in a separate draft PR. Stop and report any blocker that requires live secrets or a real restaurant device, with exact operator-only follow-up steps.

## Required output from Codex

1. An audit table listing each broken page/action, actual failing API/logic, affected DB entities, severity, and corrected workflow.
2. A prioritised file-by-file P0 implementation and regression test plan; carry out P0 code changes with small commits.
3. A recorded end-to-end trace for owner onboarding, persisted business setup, staff email+PIN login, kitchen/station configuration, POS test-order lifecycle, cash reconciliation, logout and failed login.
4. P1 integration simplification with platform-wide backend credentials and only restaurant-specific business configuration in the UI; never surface raw keys to account staff.
5. Complete CI and isolated staging proof, what remains manual, and link a separate draft PR. Do not label this production-ready until authenticated browser, printer and sandbox payment checks pass.
