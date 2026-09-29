# Production Deployment Guide

## Prerequisites

1. Create separate Supabase projects or isolated databases for staging and production.
2. Configure Supabase Auth, email verification, asymmetric JWT signing, allowed redirect URLs and
   SMTP suitable for transactional mail.
3. Create Cloudflare Hyperdrive, R2, work queue, dead-letter queue and malware-scanner service.
4. Configure staging and production DNS names and Cloudflare deployment credentials.
5. Store the PostgreSQL migration URL and deployment credentials only in CI secrets.

## Staging release

1. Run `npm ci`, `npm audit --omit=dev`, `npm run typecheck`, `npm run lint`, and `npm test`.
2. Set `SERAMET_POSTGRES_URL` to the staging PostgreSQL connection URL and run
   `npm run migrate:postgres`.
3. Set the variables documented in `PRODUCTION_ENVIRONMENT_VARIABLES.md`.
4. Run `node scripts/render-cloudflare-config.mjs staging`.
5. Run `npm run build`, `npm run audit:bundle`, then deploy with the pinned Wrangler version used by
   `npm run deploy:staging`.
6. Verify `/api/seramet/health/live` and `/api/seramet/health/ready`.
7. Run clean registration, two-tenant isolation, payment callback, queue, R2 and responsive browser
   acceptance against the deployed URL.

## Production promotion

Promote the same reviewed commit and migration set. Take and verify a pre-deployment backup, record
schema/build identifiers, apply migrations once under the advisory lock, deploy the Worker, then run
bounded smoke checks. Do not load demo seeds. Do not enable test adapters.

## Rollback

Application rollback redeploys the previous known-good immutable artifact. Database migrations are
forward-only; use a reviewed compensating migration unless the disaster-recovery decision explicitly
requires restoring a backup. Disable affected feature flags before destructive recovery. Record the
incident, correlation IDs, build ID and restored data point.
