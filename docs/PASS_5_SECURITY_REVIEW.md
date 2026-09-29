# Pass 5 Security Review

Reviewed 30 August 2026 against the production data, identity, offline, worker and concurrency implementation.

## Findings

### 1. P0: development-header authentication in production - CLOSED

Production/staging authentication now requires a verified bearer token and authoritative session (`src/lib/seramet-auth.ts:70`). The development header path requires explicit development mode, explicit enablement and localhost. Production readiness rejects the dev-auth flag (`src/server/environment.ts:122`). Tests verify production header rejection, JWT validation, session invalidation and device revocation.

### 2. P0: browser/snapshot financial authority - CLOSED

Production/staging require the authoritative database. The production UI uses typed commands; snapshot PUT is rejected with 405 (`src/lib/seramet-api.ts:117`); configuration browser persistence is disabled after authoritative bootstrap (`src/lib/app-context.tsx:379`). Local IndexedDB is a cache/command queue only (`src/offline/offline-store.ts:7`). Database revisions, idempotency, records, audit and uniqueness remain authoritative after browser/device reset.

### 3. P1: production content security policy requires edge integration - OPEN

No production Content-Security-Policy is defined in application source. The root document contains a small inline theme bootstrap (`src/routes/__root.tsx:122`) and TanStack Start injects streaming scripts, so the deployment must issue a nonce- or hash-compatible CSP at the trusted edge. Do not ship an unreviewed `unsafe-inline` policy. Validate the final policy against SSR, payment dialogs, print previews and provider redirects in staging.

### 4. P1: production identity issuance and MFA are deployment integrations - OPEN

The server validates tokens/sessions but does not bundle a password or MFA identity provider. Before a pilot, connect the selected identity provider, define token rotation, recovery and MFA policy, and complete device enrollment procedures.

### 5. P1: managed backup and malware services are infrastructure dependencies - OPEN

The schema, health model, records and runbooks exist; a real backup scheduler/object store, restore drill and file malware service must be configured in the target environment. Do not treat `backup_records` as the backup itself. File validation and the scanner boundary are implemented in `src/server/file-import-security.ts:19`.

### 6. P1: provider certification remains external - OPEN

Daraja/Pesapal production credentials, merchant approvals, callback registration and live certification remain required. TendePay undocumented live operations remain `SPEC_REQUIRED`.

### 7. P2: browser cache confidentiality depends on device controls - OPEN

IndexedDB may contain cached restaurant order/customer data for offline use. Managed devices need OS login, disk encryption, screen lock, browser profile isolation and remote revoke/clear procedures. Server revocation prevents sync/API use but cannot erase an already-offline device by itself.

## Controls verified

- Tenant/user/session/branch/permissions resolve from server identity, not request identity headers.
- Composite tenant foreign keys reject cross-tenant assignments.
- Database uniqueness covers provider events/references, external orders, settlements, receipts, stock commands, outbox and document sequences.
- Concurrent callback/mutation, refund, invoice allocation, settlement, drawer close, inventory and goods receipt tests preserve one effect.
- Confirmed payments, allocations, posted journals/settlements, inventory movements and audit records are immutable.
- Production callbacks use trusted HTTPS configuration; provider webhooks retain adapter verification and idempotency.
- Secrets use server `SecretStore`; access tokens are memory-only in the browser.
- File validation limits type/size/rows, rejects unsafe names/signatures and exposes a malware-scanner boundary.
- Structured logs exclude authorization, cookies, tokens, credentials and card-sensitive data.

## Conclusion

The two original Pass 4 P0 findings are closed in application architecture and tested production behavior. A live pilot still requires edge CSP integration, deployment-specific identity, provider certification, managed backup/restore, malware scanning, monitoring and managed-device operations.
