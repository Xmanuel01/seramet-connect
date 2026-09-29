# Production Security Review

Date: 2026-09-10

## Result

No open P0/P1 code finding was identified in the implemented production path. Commercial readiness
is still **NOT READY** because deployment and operational controls have not been evidenced in a live
staging environment.

## Closed findings

- Production development-header authentication: closed. It is accepted only for explicit local
  development; production validation rejects it.
- Browser/local financial authority: closed. Production requires PostgreSQL through Hyperdrive and
  rejects local database mode.
- Supabase identity boundary: local signature verification plus authoritative Auth user resolution;
  Seramet membership and session revocation remain server-side.
- Cross-tenant authority: repository methods and database constraints are tenant scoped; registration
  creates isolated identifiers and memberships atomically.
- Upload authority: R2 object paths are random and tenant scoped, metadata is server authoritative,
  private reads require permission, and production requires malware scanning.
- Browser mutation protection: same-origin enforcement, HttpOnly `SameSite=Lax` cookies, runtime
  schemas, authorization and idempotency remain in front of writes.
- Response hardening: HSTS, CSP, frame, MIME, referrer and permissions headers are emitted in
  production.
- Sensitive data: no service-role key, DB URL, provider credential or signing key is exposed through
  `VITE_*`; the production bundle audit rejects known secret patterns.

## Residual operational risk

- WAF/bot rules, external monitoring, alert destinations and log retention need Cloudflare setup.
- Supabase backup retention and point-in-time recovery depend on the selected plan and must be
  verified, not assumed.
- Payment/delivery/notification providers require credentials, signatures and certification.
- The malware-scanner service, physical print/KDS devices and device-agent enrollment require staging
  acceptance.
- An independent penetration test is recommended before broad public rollout.

No raw PAN, CVV, PIN, track data or provider secrets may be logged or stored. Incident handling is in
`PRODUCTION_INCIDENT_RESPONSE.md`.
