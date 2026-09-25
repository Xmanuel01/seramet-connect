# Codex master prompt — tomorrow-critical onboarding, authentication, setup and integrations

Use this prompt as the authoritative implementation brief. Do not redesign unrelated Seramet modules.

---

You are working in **Xmanuel01/seramet-connect**. Treat this as a production restaurant POS/ERP, not a mock UI. Work workflow-first: assume a real owner opens a real restaurant tomorrow, employees sign in, take orders, send KOTs, receive payment, and management later audits what happened.

## 1. First action: audit before changing code

Read the current implementation and tests for at least:

- `src/routes/login.tsx`
- `src/routes/pos-login.tsx`
- `src/lib/auth-client.ts`
- `src/server/supabase-auth-api.ts`
- `src/server/identity-device-api.ts`
- `src/server/pos-auth-service.ts`
- `src/lib/seramet-auth.ts`
- `src/onboarding/OnboardingWizard.tsx`
- `src/onboarding/location-currency-service.ts`
- `src/onboarding/onboarding-service.ts`
- `src/onboarding/use-setup-centre.ts`
- `src/server/onboarding-api.ts`
- `src/routes/seramet-setup.tsx`
- `src/server/configuration-api.ts`
- `src/server/database/authoritative-configuration.ts`
- `src/platform/types.ts`
- `src/routes/integrations.tsx`
- `src/routes/marketplace.tsx`
- provider registries/adapters for Daraja/M-Pesa, Pesapal and marketplaces
- all current onboarding/auth/setup/integration tests

Before coding, write a short workflow map showing the current real state transitions and identify every place where the UI is hardcoded, uses legacy in-memory repositories, leaks technical provider configuration, fails to persist onboarding data, auto-authenticates, or reads a different source of truth from the server.

Do not delete working production-grade behavior merely because a page is confusing.

## 2. Required Seramet workflow

### A. New restaurant / first-ever account

1. Owner creates or signs into their verified account.
2. If the account has no restaurant, create/provision the tenant exactly once.
3. First-run onboarding appears only while authoritative onboarding state is incomplete.
4. Onboarding persists every completed step server-side. Refreshing or changing device must resume from authoritative state, not local component state.
5. After onboarding reaches `COMPLETED`, normal future app launches must **not** rerun onboarding.

### B. Onboarding steps

The wizard must guide the owner through these business concepts, not technical infrastructure:

1. **Business information**
   - Legal name
   - Trading name
   - Country
   - Base/default currency
   - Time zone
   - Locale
   - Basic business/contact/legal details
2. **Organisation**
   - Brand if applicable
   - First real branch
   - Branch code/name/timezone
   - No accidental duplicate bootstrap branches
3. **Departments and production areas**
   - Owner can see and manage restaurant departments/operational areas after onboarding.
   - Support at minimum Front/Cashier, Kitchen, Bar, Prep and Stores/Inventory where enabled.
   - Production stations must be real branch-scoped configuration and visible later in Setup.
   - Kitchen/bar stations used by menu routing, KDS and printing must come from this same source of truth.
4. **People and permissions**
   - Add employees
   - Assign role/branch
   - Issue/reset PIN according to 4/6 digit tenant policy
5. **Menu**
   - Link to the authoritative Menu Management flow.
6. **Payments and marketplace account details**
   - Only account-specific business values are entered by the owner.
7. **Devices, KDS and printing**
   - Register/activate device
   - Assign branch
   - Configure printer/KDS routing using authoritative stations/departments
8. **Review**
   - Show blockers explicitly
   - Owner confirms go-live readiness

Do not hide later Setup controls merely because onboarding is completed.

## 3. Fix the Setup Centre regression

Current observed bug: after onboarding the owner cannot reliably see the business information they already entered, and department/kitchen configuration is difficult or impossible to find.

Required outcome:

- Setup Centre always loads the persisted authoritative business profile after onboarding.
- Business Information becomes a clear editable section after onboarding; saving it updates the exact record onboarding reads.
- Organisation/Branches is a separate clear section.
- Add a clear **Departments & Stations** section:
  - list each branch's configured operational departments/stations
  - create/edit/deactivate according to permissions
  - prevent cross-branch edits
  - protect stations already referenced by active KDS/printing/menu configuration from destructive removal; use deactivate/reassign workflow
- Kitchen, Bar, Prep, Inventory/Stores and printer/KDS configuration must point to authoritative branch-scoped records, not demo defaults.
- Refreshing the page must not make information disappear.
- Empty data must show "not configured", never invented/demo values.

Trace and fix the root cause if onboarding and Setup currently read/write different tables or repositories.

## 4. Authentication and logout workflow

Seramet has two concepts:

- account identity / owner administration backed by Supabase
- restaurant employee operational sign-in using employee identity + PIN

The normal POS/staff workflow after a device is registered must be:

1. Show employee sign-in.
2. Employee enters **email or employee code**.
3. Employee enters the tenant's required **4- or 6-digit PIN** using the phone-style keypad.
4. Server validates employee, active employment, role, branch assignment, device status, PIN policy and lockout/rate limit.
5. Only then create the operational session and enter POS/app.
6. Branch shown for a branch-locked device must be authoritative. If branch selection is allowed for the employee/device policy, require explicit branch selection before session creation.

### Logout requirements

When an employee logs out or is locked for inactivity:

- revoke/clear the operational employee session
- clear cached actor/user data
- clear sensitive local/session state
- return to employee email/code + PIN login
- **never automatically sign the previous employee back in**
- employee tiles may prefill the identifier only; clicking a tile must never authenticate
- browser refresh after logout must remain logged out
- back-button/navigation must not expose authenticated pages from stale client state

Account-owner "administrator sign in" can remain as a separate recovery/setup path, but it must not silently create an operational employee session.

Add regression tests for:
- logout then refresh
- logout then browser back
- employee A logout followed by employee B login
- invalid/locked PIN
- wrong branch
- inactive employee
- unregistered/revoked device
- owner/admin account authenticated but no employee POS session

## 5. Integration configuration: hide technical infrastructure from account owners

The owner should configure **their account**, not Seramet's provider implementation.

### Global/deployment-managed values

These must be provisioned by Seramet operators/server environment/secret store/Supabase secure server configuration and must never be displayed as editable technical fields to restaurant users:

- provider app/client secrets
- API private keys shared by the Seramet integration deployment
- webhook signing infrastructure
- callback base URLs
- internal endpoint URLs
- secret-store paths/references
- adapter class/provider IDs
- OAuth token storage internals
- queue names
- webhook route internals
- technical environment flags

Do not show fields such as "Server secret reference" or vault paths to the Account Owner.

### Restaurant/account-specific values

Frontend may request only values genuinely unique to that tenant/branch/provider, for example when applicable:

- M-Pesa till / paybill / shortcode / store number belonging to this restaurant
- restaurant-specific merchant/account identifier
- marketplace store/restaurant ID
- provider branch/store mapping
- restaurant-specific settlement account choice
- display name
- branch assignment
- operational toggles such as enabled/paused
- any provider credential that is genuinely issued uniquely to the merchant **only if the backend architecture cannot provision it securely beforehand**; if required, submit it once to a secure backend secret endpoint and never return it to the browser

The UI should display high-level status such as:
- Connected
- Credentials provisioned
- Account mapping incomplete
- Webhook healthy
- Action required

It must not reveal raw secrets or internal secret references.

Refactor provider definitions if necessary so **public/account configuration schema** is separate from **server credential requirements**.

## 6. Marketplace setup

For Uber Eats, Glovo, Bolt Food and future marketplaces:

- operator/provider adapter technical credentials are server-side
- owner selects provider and branch
- owner enters only their restaurant/store identifiers and business-level options
- map external stores/items to internal Seramet branch/items
- test connection from the backend
- show health without exposing raw tokens
- no direct client-side provider API calls requiring secrets
- all webhooks remain server validated and tenant resolved
- preserve existing order, cash-due, receivable and settlement workflows

## 7. Source-of-truth rules

- PostgreSQL/Supabase-backed authoritative services are the source of truth.
- Do not silently fall back to demo/in-memory configuration in staging/production.
- Client state is a cache, never the authority.
- Tenant and branch IDs come from the authenticated server session and authorized scope; do not trust arbitrary client tenant IDs.
- Every write needs permission checks, branch checks, validation, audit and idempotency where retry can occur.
- Do not duplicate tables just to make a page work.
- Do not hardcode Mona Swahili, Westlands, Ngong Road or any particular restaurant.
- Multi-branch must remain independent.

## 8. Migration and compatibility requirements

If database changes are necessary:

- add a forward migration only
- keep migration numbering consistent
- update SQLite test adapter and real PostgreSQL CI
- preserve existing data
- add explicit conflict/idempotency rules
- test migration on disposable PostgreSQL
- never mutate production data from tests

## 9. UI requirements

Maintain the Seramet green visual system.

Setup must feel like a restaurant product, not a developer console:
- plain restaurant terminology
- clear sections and statuses
- dialogs/drawers for create/edit flows
- no raw JSON
- no provider implementation IDs
- no secret references
- no environment variable names in normal user UI
- explicit save/cancel
- unsaved change warning where appropriate
- mobile/tablet usable

## 10. End-to-end acceptance scenarios

Do not declare complete until automated tests prove these flows and the staging checklist is written:

### Scenario 1 — first owner
Create account → create restaurant → complete business profile → branch → departments/stations → employee → menu → payment account settings → printer/KDS → complete onboarding → sign out → return → onboarding does not restart → Setup shows the saved business/branch/departments.

### Scenario 2 — employee POS login
Registered Westlands device → employee enters email/code + PIN → correct branch/role loaded → logout → login page remains logged out → another employee signs in → no identity leakage.

### Scenario 3 — account-owner setup
Owner logs into administration → Setup Centre shows business info and departments → edits business phone and kitchen station → reload → values persist → POS/KDS/menu station selection reflects the same update.

### Scenario 4 — integration
Owner opens M-Pesa setup → sees merchant/till fields and status only → never sees app secret/vault path/callback internals → backend uses pre-provisioned secret → server connection test passes/fails with safe message.

### Scenario 5 — marketplace
Owner selects Glovo/Uber/Bolt Food → supplies restaurant-specific store identity and branch mapping → backend validates → menu/order sync uses server-held provider credentials.

### Scenario 6 — isolation
Branch-limited manager cannot edit another branch's station, employees, menu activation or provider store mapping.

## 11. Delivery discipline

- Work on a dedicated branch.
- Keep current production behavior working while replacing hardcoded/legacy paths.
- Add tests before claiming completion.
- Run dependency audit, typecheck, lint, full tests, production build and bundle secret scan.
- Run the relevant services against disposable real PostgreSQL, not only SQLite.
- Do not merge automatically.
- Produce a final report with:
  - files changed
  - migrations
  - workflow map before/after
  - bugs found
  - tests added
  - remaining external/manual staging checks
  - exact staging verification steps

**Priority:** tomorrow's restaurant usability first. Authentication, persistent setup/business/department configuration and safe account-level integration setup are more important than advanced analytics or cosmetic completeness.
