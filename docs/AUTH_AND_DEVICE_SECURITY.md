# Authentication and Device Security

## Bearer identity

The production identity boundary validates HS256 JWTs using server-only configuration:

- `SERAMET_JWT_SECRET` (minimum 32 characters)
- `SERAMET_JWT_ISSUER`
- `SERAMET_JWT_AUDIENCE`

Required claims are `sub`, `tid`, `sid`, `iss`, `aud`, `iat` and `exp`. `deviceId` and `jti` are optional. The database session must match tenant, user and token version. Password/credential changes invalidate sessions by incrementing the user password version.

The access token is held in JavaScript process memory, not localStorage or IndexedDB. A future identity provider can replace token issuance without changing feature routes.

## Development authentication

Header authentication requires all of:

1. `SERAMET_ENVIRONMENT=development`;
2. `SERAMET_ENABLE_DEV_AUTH=true`;
3. request host is localhost, `127.0.0.1` or `::1`;
4. `x-seramet-dev-auth: enabled`.

Staging and production reject the path. Production readiness also rejects the opt-in flag.

## Authorization

Permissions are loaded from `user_roles`, `role_permissions` and `user_branches`. The server selects tenant from the verified token/session. Branch requests must be assigned unless the actor holds the all-branch permission. UI visibility is convenience only.

Server enforcement covers transaction actions, refunds, reconciliation, settlements, hardware/device management, configuration import/export, audit and health operations. Unknown mutation actions are rejected.

## Sessions

`auth_sessions` records issue, expiry, revocation, last seen, device and token version. Logout revokes the current session. Device revocation revokes all active sessions bound to that device. Expired, revoked, wrong-tenant and version-invalidated sessions receive authentication errors.

## Devices

Supported device types include POS terminal, tablet, KDS, printer bridge, manager device, self service and other configured hardware. New devices start `PENDING`; an authorized manager activates or revokes them. Production token/device binding requires `ACTIVE` and not revoked.

## Security controls

- Trusted callback URLs come only from server configuration and require HTTPS in production.
- Provider secrets remain behind `SecretStore`; connection records contain references, not values.
- Rate limits protect sensitive payment/configuration/import paths.
- Runtime request parsing rejects unknown fields on hardened endpoints.
- Logs redact authorization, cookies, tokens, secrets and card-sensitive fields.
- Full PAN, CVV, PIN and track data remain prohibited by Pass 4.
