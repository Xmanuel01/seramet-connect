# Seramet

Seramet is a multi-tenant restaurant ERP/POS covering sales, KDS/KOT, payments, inventory,
procurement, finance, CRM, guest ordering, reservations, setup and enterprise operations.

## Local development

Requirements: Node.js 22 and npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Local startup creates an empty authoritative SQLite database at `.seramet/development.sqlite` and
opens the real Supabase sign-in/restaurant-registration flow. It does not seed a restaurant, branch,
user or operational record. Development-header authentication is disabled by default and is retained
only as an explicit test harness; operational fixtures are loaded only by test helpers.

Start a clean restaurant from `/register`, verify the account, then complete `/seramet-setup`.
The former pilot database is not read by the runtime.

## Validation

```powershell
npm run typecheck
npm run lint
npm test
npm run test:commercial
npm run build
npm run audit:bundle
```

## Production architecture

Production uses Cloudflare Workers/Nitro, Hyperdrive to PostgreSQL, Cloudflare Queues/Cron, R2,
Supabase Auth and managed server secrets. Production startup fails closed if it detects local
database mode, development authentication, test providers, missing durable bindings or unsafe URLs.

Start with:

- `docs/PRODUCTION_READINESS_AUDIT.md`
- `docs/PRODUCTION_ARCHITECTURE.md`
- `docs/PRODUCTION_DEPLOYMENT_GUIDE.md`
- `docs/PRODUCTION_ENVIRONMENT_VARIABLES.md`
- `docs/COMMERCIAL_LAUNCH_CHECKLIST.md`

Apply PostgreSQL migrations from a trusted deployment environment:

```powershell
$env:SERAMET_POSTGRES_URL = '<managed CI secret>'
npm run migrate:postgres
```

Generate staging deployment configuration only after Cloudflare resources exist:

```powershell
node scripts/render-cloudflare-config.mjs staging
npm run deploy:staging
```

Never commit `.env.local`, direct database URLs, service-role keys, provider credentials or generated
Wrangler configuration.
