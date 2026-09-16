# Production Identity, Device and Branch Architecture

## Authority model

Seramet has two authentication levels. Full account authentication is provided by the configured external identity provider and is required for registration, ownership, employee administration, device activation, setup and other sensitive configuration. POS PIN authentication is a branch-bound operational session and cannot perform full-account actions.

The server resolves tenant, branch assignments, roles and permissions from the authoritative database. Browser headers and selectors can request an already-authorized branch but cannot grant tenant or branch authority.

## Account ownership

`account_owners` is the ownership authority. It is separate from an operational role. Registration creates one verified active owner and an `ACCOUNT_OWNER` role used for delegated application permissions. Database triggers prevent the final active owner record from being ended or deleted and prevent its user from being disabled.

Ownership transfer requires:

- an active owner
- `ownership.transfer`
- a full account session issued within the preceding 15 minutes
- an active target user linked to a verified external identity
- the exact confirmation phrase and an audit reason

The transaction activates the target owner first, transfers the former owner, moves the ownership role, grants existing branch assignments, revokes both users' sessions and records an audit event.

## Device lifecycle

Devices use `UNREGISTERED`, `ACTIVATION_PENDING`, `ACTIVE`, `LOCKED`, `REVOKED` and `RETIRED`. Registration alone does not trust a browser. An authorized full-account user activates a device and receives an opaque `HttpOnly`, `SameSite=Strict` device cookie. Production also sets `Secure`.

Only a SHA-256 digest of the 256-bit random device secret is stored. Rotation revokes prior credentials. Device revocation also revokes all POS sessions. A missing or invalid credential returns the browser to administrator sign-in rather than restaurant registration.

## Employee PINs and sessions

PINs are stored as PBKDF2-SHA256 credentials using a unique 128-bit salt and 600,000 iterations. The algorithm, parameters and credential version are persisted for upgrades. Plaintext PINs are not returned, audited or logged.

The default policy is six digits. Four digits require an explicit tenant policy. Sequential and repeated values are rejected. Failed attempts are recorded and lock the credential according to policy. Authentication requires an active device, active employee, current effective dates and assignment to the device branch.

POS sessions are opaque, short-lived, inactivity-limited and revalidate user, branch, device and credential version on every authenticated request. PIN reset and device revocation invalidate existing sessions. Full-account-only APIs reject POS PIN sessions.

## Startup state machine

1. Public runtime configuration is loaded.
2. The server validates the device cookie.
3. An active device opens `/pos-login` with its authoritative tenant and branch.
4. Pending, locked, revoked or retired devices show safe administrator recovery.
5. An unknown device opens account sign-in. Registration remains an explicit action.
6. Full account authentication resumes the tenant's saved onboarding or Setup Centre state.

No startup decision depends on local storage as the source of truth.

## Branch lifecycle

Registration creates exactly one `DRAFT` bootstrap branch. The first-branch onboarding step updates that branch and moves it to `CONFIGURING`; it does not insert another branch. Additional branch creation is unavailable until the bootstrap branch is active.

Later branch creation requires all-branch scope and an idempotency key. The transaction creates the branch, operating profile, enterprise hierarchy node and closure, optional warehouse, active-owner assignments, idempotency response and audit event. Normalized tenant branch codes are database-unique. Similar names, codes or addresses require explicit duplicate review.

The Branches page is an operational read model. Mutation is routed to the server-backed Setup Centre and cannot fall back to browser persistence.

## Recovery and administration

- Lost device credential: full-account sign-in and explicit reactivation.
- Revoked device: investigate, then issue a new credential only through device activation.
- Forgotten PIN: authorized reset; the old PIN is never recoverable.
- Suspected duplicate branch: use duplicate-review preview, inspect dependency counts, and only deactivate an empty candidate. Branches containing operational records require a planned data migration.
- Ownership recovery: an existing active owner performs transfer after fresh sign-in. External identity-provider recovery remains provider-owned.

## Audit coverage

Registration, owner transfer, employee creation, PIN reset, device activation/revocation, POS login attempts, branch creation, duplicate reconciliation, setup and go-live emit authoritative audit or security-attempt records without credentials.

