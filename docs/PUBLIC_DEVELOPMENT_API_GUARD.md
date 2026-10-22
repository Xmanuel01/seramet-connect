# Public Development API Guard

## Confirmed Finding

The health safeguard rejected public development-mode readiness, but ordinary
requests still reached authentication handlers, body parsing and repository setup.
Regression tests reproduced successful auth-configuration and unregistered-device
responses and downstream parsing/database access before the correction. This is
not evidence of an authentication bypass or unauthorized financial posting.

## Decision

Fail closed for non-local API operations when the resolved runtime is neither
staging nor production. Reuse the existing readiness classification; missing
configuration and publicly exposed test mode do not create exceptions.

- `GET /api/seramet/health/live` remains a cheap liveness-only response.
- Readiness/operational checks retain their existing diagnostic 503 responses.
- All other Seramet API requests return 503 with `PUBLIC_DEVELOPMENT_RUNTIME`
  before authentication dispatch, body consumption or repository initialization.
- The HTTP wrapper gives this rejection precedence over its cross-origin denial;
  normal local/staging/production origin restrictions remain intact.
- Internal scanner HTTP dispatch now goes through the same API entry guard, while
  retaining its signed-request authentication and existing handler behavior.
- Responses are non-cacheable. Forwarded headers and a forged Host header cannot
  turn a public request URL into a loopback request.
- Local development remains available on localhost, IPv4 loopback and IPv6
  loopback. IPv6 URL hostnames include brackets; the existing helper is corrected
  accordingly. Local servers still need normal safe bind/firewall configuration.
- Staging/production authorization, tenancy, device restrictions and readiness
  requirements are unchanged. Local development does not waive authentication.

This controls HTTP API dispatch, not static assets, SSR pages, Queue or Cron
events. It is not a replacement for correctly provisioning production. Enabling
production mode alone does not satisfy its existing database/identity controls.

## Release Impact

An accidentally public development-configured Worker will stop serving ordinary
API operations. The current production site's missing runtime/database/queue
configuration must still be corrected before live acceptance. This change must
not be represented as making that site production-ready.

The existing unchanged-snapshot authorization regression uses an explicit loopback
URL because it intentionally tests development mode; its cross-branch denial and
revoked-session assertions remain intact. No database migrations or live records
are modified by this correction.

CI also invokes the actual compiled Cloudflare fetch entry with public URLs,
forged loopback headers, cross-origin mutations, scanner callbacks and malformed
bodies. It checks response codes, non-cacheable headers, liveness, and zero
database/provider calls rather than relying only on source markers.
