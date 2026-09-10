# Production Environment Variables

No secret values belong in this document, source control, browser variables or generated client
bundles.

| Name | Location | Secret | Purpose |
| --- | --- | --- | --- |
| `SERAMET_ENVIRONMENT` | Worker variable | No | `staging` or `production` |
| `SERAMET_DATABASE_PROVIDER` | Worker variable | No | Must be `postgres` |
| `SERAMET_HYPERDRIVE` | Worker binding | Yes | Hyperdrive PostgreSQL connection |
| `SERAMET_WORK_QUEUE` | Queue binding | No | Durable job producer/consumer |
| `SERAMET_OBJECTS` | R2 binding | No | Tenant object storage |
| `SERAMET_MALWARE_SCANNER` | Service binding | No | Upload scanning service |
| `SERAMET_IDENTITY_PROVIDER` | Worker variable | No | Must be `supabase` |
| `SERAMET_SUPABASE_URL` | Worker variable | No | Trusted Auth project URL |
| `SERAMET_SUPABASE_PUBLISHABLE_KEY` | Worker variable | No | Public Auth API key; not DB authority |
| `SERAMET_PUBLIC_ORIGIN` | Worker variable | No | Canonical HTTPS application origin |
| `SERAMET_CALLBACK_BASE_URL` | Worker variable | No | Trusted HTTPS callback origin |
| `SERAMET_ALLOWED_ORIGINS` | Worker variable | No | Explicit browser origins |
| `SERAMET_JWT_SECRET` | Worker secret | Yes | Guest capability-token signing secret |
| `SERAMET_SECRET_STORE` | Worker variable | No | Managed secret-store selector |
| `SERAMET_BUILD_ID` | Worker variable | No | Immutable release identifier |
| `SERAMET_APP_VERSION` | Worker variable | No | Application version |
| `SERAMET_POSTGRES_URL` | CI secret only | Yes | Direct migration connection; never a Worker var |

Production must set `SERAMET_REQUIRE_BEARER=true`, `SERAMET_ENABLE_DEV_AUTH=false`,
`SERAMET_ENABLE_LOCAL_DATABASE=false`, and `SERAMET_ALLOW_TEST_PROVIDERS=false`. Readiness fails
closed when required bindings are absent or origins are not HTTPS.
