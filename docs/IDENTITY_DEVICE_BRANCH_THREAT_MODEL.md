# Identity, Device and Branch Threat Model

## Assets and trust boundaries

Protected assets include tenant configuration, employee identities, device credentials, POS sessions, PIN credentials, branch assignments, operational records and ownership authority. Trust boundaries exist between the public browser, activated POS device, external identity provider, Seramet API, authoritative database and background runtime.

## Primary abuse cases

| Threat | Control |
| --- | --- |
| Internet PIN guessing | PIN login is unavailable without a valid branch-bound device credential; rate limiting, failure counters and lockout apply. |
| Employee enumeration | Unknown employee and wrong PIN return the same public error; employee tiles are opt-in and branch scoped. |
| Stolen browser state | Device and POS credentials are opaque HttpOnly cookies; server-side digests, status and versions remain authoritative and revocable. |
| POS PIN used for administration | Sensitive setup, role, employee, ownership and device mutations require full authentication. |
| Tenant or branch header tampering | The server resolves membership and assignments, validates requested scope and requires explicit branch-switch/all-branch permissions. |
| Duplicate registration or branch submission | Request hash plus scoped idempotency key replays equivalent success and rejects changed payloads. Database uniqueness is the final guard. |
| Duplicate first branch | Registration creates one marked bootstrap branch; onboarding updates that identifier and hides additional creation until activation. |
| Final owner removal | Database triggers reject ending, deleting or disabling the final active owner. |
| Unauthorized ownership transfer | Active ownership, permission, recently issued full session, verified target identity, explicit phrase and reason are required. Sessions are revoked after transfer. |
| PIN disclosure | Only salted KDF output and metadata are stored. APIs, audit, diagnostics and employee lists exclude PIN material. |
| Cross-branch employee login | The employee must be assigned to the activated device's branch and is issued a single-branch POS actor. |
| Partial branch provisioning | Branch, profile, hierarchy, closure, warehouse, owner assignments, idempotency record and audit are one database batch. |
| Destructive duplicate cleanup | Dry-run dependency counts precede action. Only empty candidates can be closed automatically; operational data is never deleted. |

## Residual risks

- A short PIN has limited entropy. Device binding, rate controls and short sessions are mandatory compensating controls.
- Browser cookies are bearer credentials. TLS, secure cookie deployment, endpoint origin checks and rapid revocation remain required.
- Shared POS terminals require physical controls and prompt manual locking.
- Offline employee PIN verification is intentionally not implemented. Authentication fails closed when the server is unavailable.
- Ownership transfer depends on external identity security. MFA and provider session policy should be enabled before pilot.

