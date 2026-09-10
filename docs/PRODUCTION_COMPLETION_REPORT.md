# Seramet Production Readiness Completion Report

Date: 2026-09-10

## Decision

**SERAMET PRODUCTION READINESS: NOT READY**

The production code path is implemented and locally validated. Commercial deployment remains
blocked by missing external infrastructure and evidence: production PostgreSQL migration,
Cloudflare bindings/deployment, backup/restore rehearsal, live-provider certification, external
monitoring/WAF configuration and physical print/KDS acceptance.

## Validation

| Check | Result |
| --- | --- |
| Pass 1-12 and commercial suite | PASS, 455/455 tests in 26 files |
| PostgreSQL migration-from-zero | PASS in PGlite, schema 16, more than 140 tables and 120 triggers |
| Commercial integration tests | PASS, 10/10 |
| Database focus | PASS, 19/19 |
| Concurrency focus | PASS, 19/19; 71 unrelated tests skipped by filter |
| Offline/reconnect focus | PASS, 2/2; 17 unrelated tests skipped by filter |
| TypeScript | PASS |
| Lint | PASS, zero errors; 18 existing Fast Refresh warnings |
| Client/SSR/Nitro Cloudflare build | PASS |
| Production bundle audit | PASS; no known secrets, pilot IDs or development DB/demo artifacts |
| Browser QA | PASS locally for login/register, POS and Setup Centre; tested 390x844, 768x1024 and 1440x900 |
| Deployed staging QA | BLOCKED, Cloudflare resources and staging URL not supplied |

## Production Acceptance Matrix

`PASS` means implemented and supported by repository evidence. `BLOCKED` means external deployed or
physical evidence is still required. This matrix contains 210 independently reviewable criteria.

| ID | Criterion | Status |
| --- | --- | --- |
| PR-001 | Public owner registration route exists | PASS |
| PR-002 | Registration creates a Supabase Auth account through the server | PASS |
| PR-003 | Registration requires verified external identity before provisioning | PASS |
| PR-004 | Registration endpoint is runtime-schema validated | PASS |
| PR-005 | Registration endpoint is rate limited | PASS |
| PR-006 | Registration endpoint enforces same origin | PASS |
| PR-007 | Registration is idempotent per identity and key | PASS |
| PR-008 | Registration rejects idempotency payload drift | PASS |
| PR-009 | Tenant, legal entity, brand and first branch are one transaction | PASS |
| PR-010 | First administrator membership is created atomically | PASS |
| PR-011 | First administrator receives configured permission records | PASS |
| PR-012 | First branch assignment is authoritative | PASS |
| PR-013 | Enterprise hierarchy roots are provisioned | PASS |
| PR-014 | Registration writes an audit event | PASS |
| PR-015 | New tenant starts in SETUP state | PASS |
| PR-016 | New tenant contains zero operational orders | PASS |
| PR-017 | New tenant contains zero payments and journals | PASS |
| PR-018 | New tenant contains zero inventory movements and customers | PASS |
| PR-019 | Country/currency/timezone/locale are registration data | PASS |
| PR-020 | First login routes the owner to Setup Centre | PASS |
| PR-021 | PostgreSQL adapter implements repository statement contract | PASS |
| PR-022 | Hyperdrive connection string stays server-side | PASS |
| PR-023 | PostgreSQL pool size is bounded | PASS |
| PR-024 | PostgreSQL connection and idle timeouts are bounded | PASS |
| PR-025 | D1 placeholders normalize safely to PostgreSQL parameters | PASS |
| PR-026 | Quoted question marks are not rewritten as parameters | PASS |
| PR-027 | INSERT OR IGNORE maps to conflict-safe PostgreSQL SQL | PASS |
| PR-028 | SQLite datetime offsets used by services normalize centrally | PASS |
| PR-029 | Minor-unit integer columns compile to BIGINT | PASS |
| PR-030 | Unsafe BIGINT values fail rather than lose precision | PASS |
| PR-031 | Full migration history has deterministic PostgreSQL compilation | PASS |
| PR-032 | PostgreSQL trigger functions preserve append-only guards | PASS |
| PR-033 | Migration-from-zero succeeds in PostgreSQL-compatible engine | PASS |
| PR-034 | Migration execution uses one advisory lock | PASS |
| PR-035 | Migration execution is transactional | PASS |
| PR-036 | Migration history is versioned through schema 16 | PASS |
| PR-037 | Production requests do not auto-run migrations | PASS |
| PR-038 | Production rejects a behind-schema database | PASS |
| PR-039 | Development SQLite is limited to development build path | PASS |
| PR-040 | Development database module is absent from production bundle | PASS |
| PR-041 | Supabase JWT signature verification uses JWKS | PASS |
| PR-042 | Legacy symmetric tokens require authoritative Auth resolution | PASS |
| PR-043 | Current Supabase user is resolved before local membership | PASS |
| PR-044 | Email verification state is authoritative | PASS |
| PR-045 | Tenant membership is resolved server-side | PASS |
| PR-046 | Browser tenant ID cannot create membership | PASS |
| PR-047 | Branch assignment is resolved server-side | PASS |
| PR-048 | Permission codes are resolved server-side | PASS |
| PR-049 | Seramet session is persisted server-side | PASS |
| PR-050 | Expired sessions are rejected | PASS |
| PR-051 | Revoked sessions are rejected | PASS |
| PR-052 | Logout revokes mapped Seramet sessions | PASS |
| PR-053 | Logout clears HttpOnly cookies | PASS |
| PR-054 | Access and refresh cookies are HttpOnly | PASS |
| PR-055 | Auth cookies use SameSite policy | PASS |
| PR-056 | Production cookies require Secure | PASS |
| PR-057 | Login error avoids account enumeration detail | PASS |
| PR-058 | Login and signup are database-rate-limited | PASS |
| PR-059 | Development header is rejected in production | PASS |
| PR-060 | Missing production identity configuration fails readiness | PASS |
| PR-061 | Navigation is derived from module permission registry | PASS |
| PR-062 | Staff routes are covered by module registry | PASS |
| PR-063 | Public login/register routes are outside staff module checks | PASS |
| PR-064 | Direct API calls enforce permissions | PASS |
| PR-065 | Module visibility does not grant mutation authority | PASS |
| PR-066 | Branch switching requires configured permission | PASS |
| PR-067 | Assigned branch scope is server authoritative | PASS |
| PR-068 | All-branch scope requires explicit permission | PASS |
| PR-069 | Primary branch is selected from authoritative assignment | PASS |
| PR-070 | Temporary scope assignments expire | PASS |
| PR-071 | Role permission changes increment access revision | PASS |
| PR-072 | Active clients refresh permission revision | PASS |
| PR-073 | Delegated administrators cannot grant authority they lack | PASS |
| PR-074 | HQ scope cannot be gained from branch permission alone | PASS |
| PR-075 | Legal entity, brand and branch remain distinct | PASS |
| PR-076 | Enterprise node closure enforces hierarchy scope | PASS |
| PR-077 | Cross-tenant configuration access fails | PASS |
| PR-078 | Cross-branch unauthorized access fails | PASS |
| PR-079 | Cross-tenant financial access fails | PASS |
| PR-080 | Permission changes are audited | PASS |
| PR-081 | Production database provider must be PostgreSQL | PASS |
| PR-082 | Hyperdrive binding is mandatory in production | PASS |
| PR-083 | Durable Queue binding is mandatory in production | PASS |
| PR-084 | R2 binding is mandatory in production | PASS |
| PR-085 | Malware scanner binding is mandatory in production | PASS |
| PR-086 | Managed secret store is mandatory in production | PASS |
| PR-087 | Trusted callback base URL must use HTTPS | PASS |
| PR-088 | Public origin must use HTTPS | PASS |
| PR-089 | Test providers are rejected in production | PASS |
| PR-090 | Local database mode is rejected in production | PASS |
| PR-091 | Local development auth is rejected in production | PASS |
| PR-092 | Readiness endpoint checks dependencies | PASS |
| PR-093 | Liveness endpoint does not require external providers | PASS |
| PR-094 | Unsafe production startup fails closed | PASS |
| PR-095 | Schema readiness is non-overridable | PASS |
| PR-096 | Production security readiness is non-overridable | PASS |
| PR-097 | Missing verified backup blocks staging/production go-live | PASS |
| PR-098 | Missing backup remains visible but nonfatal in development | PASS |
| PR-099 | Queue and provider health are reported separately | PASS |
| PR-100 | Environment model supports development/test/staging/production | PASS |
| PR-101 | Queue handler uses persisted job state | PASS |
| PR-102 | Scheduled handler runs without an open browser | PASS |
| PR-103 | Queue claiming prevents simultaneous duplicate execution | PASS |
| PR-104 | Worker retries preserve idempotency | PASS |
| PR-105 | Exhausted jobs reach dead letter | PASS |
| PR-106 | Dead-letter metadata is tenant scoped | PASS |
| PR-107 | Worker result has correlation identity | PASS |
| PR-108 | Payment verification jobs are durable | PASS |
| PR-109 | Integration outbox jobs are durable | PASS |
| PR-110 | Reservation/scheduled-order jobs are durable | PASS |
| PR-111 | Order creation remains server authoritative | PASS |
| PR-112 | Duplicate order requests are idempotent | PASS |
| PR-113 | POS uses existing order engine | PASS |
| PR-114 | KDS/KOT uses normalized order state | PASS |
| PR-115 | KOT retries do not create duplicate orders | PASS |
| PR-116 | Payment intent is distinct from confirmed collection | PASS |
| PR-117 | Payment callback idempotency is preserved | PASS |
| PR-118 | Browser cannot mark a digital payment confirmed | PASS |
| PR-119 | Payment allocations remain many-to-many | PASS |
| PR-120 | Journals remain balanced and immutable when posted | PASS |
| PR-121 | Cash drawer expected value derives from movements | PASS |
| PR-122 | Inventory remains append-only and movement-ledger based | PASS |
| PR-123 | Duplicate inventory movement is rejected | PASS |
| PR-124 | Goods receipt remains idempotent | PASS |
| PR-125 | Recipes/UOM/valuation remain authoritative | PASS |
| PR-126 | Procurement approval remains permission driven | PASS |
| PR-127 | Accounting mappings remain configuration driven | PASS |
| PR-128 | Business date remains server authoritative | PASS |
| PR-129 | Closed-period controls remain server enforced | PASS |
| PR-130 | Document numbering remains concurrency safe | PASS |
| PR-131 | CRM customer identity remains tenant scoped | PASS |
| PR-132 | Loyalty ledger remains immutable | PASS |
| PR-133 | Voucher redemption remains atomic and single use | PASS |
| PR-134 | Gift-card redemption remains atomic and single spend | PASS |
| PR-135 | Reservation locking prevents simultaneous double booking | PASS |
| PR-136 | QR capability tokens are scoped and revocable | PASS |
| PR-137 | Guest quote rejects client price/tax/payment authority | PASS |
| PR-138 | Guest order reaches existing order/KDS/inventory flow | PASS |
| PR-139 | AI tools remain read-only and permission scoped | PASS |
| PR-140 | Enterprise hierarchy and policy tests remain green | PASS |
| PR-141 | R2 object keys are random | PASS |
| PR-142 | R2 object keys are tenant scoped | PASS |
| PR-143 | Object metadata is authoritative in PostgreSQL | PASS |
| PR-144 | Private object reads require authentication and permission | PASS |
| PR-145 | Public object reads require public classification and slug scope | PASS |
| PR-146 | Upload size is bounded | PASS |
| PR-147 | Upload MIME type is allow-listed | PASS |
| PR-148 | Upload extension is validated | PASS |
| PR-149 | Infected upload is rejected | PASS |
| PR-150 | Failed metadata insert removes uploaded object | PASS |
| PR-151 | Realtime event history is server-side | PASS |
| PR-152 | Realtime stream authenticates the session | PASS |
| PR-153 | Realtime events filter by tenant | PASS |
| PR-154 | Realtime events filter by authorized branch | PASS |
| PR-155 | Client reconnects through EventSource | PASS |
| PR-156 | Realtime notification triggers authoritative refresh | PASS |
| PR-157 | Same-origin mutation policy is global | PASS |
| PR-158 | CORS does not grant wildcard production access | PASS |
| PR-159 | HSTS is emitted in production | PASS |
| PR-160 | CSP is emitted in production | PASS |
| PR-161 | Frame protection is emitted | PASS |
| PR-162 | MIME sniffing protection is emitted | PASS |
| PR-163 | Referrer policy is emitted | PASS |
| PR-164 | Browser feature permissions are restricted | PASS |
| PR-165 | Theme bootstrap uses a same-origin external script | PASS |
| PR-166 | Special request and public text remain untrusted/bounded | PASS |
| PR-167 | SQL values remain parameterized | PASS |
| PR-168 | Server errors hide database stack traces | PASS |
| PR-169 | Structured logs carry correlation context | PASS |
| PR-170 | Support diagnostics redact secrets and sessions | PASS |
| PR-171 | Production client build succeeds | PASS |
| PR-172 | Production SSR build succeeds | PASS |
| PR-173 | Cloudflare-module Nitro output succeeds | PASS |
| PR-174 | Production bundle has no original pilot IDs | PASS |
| PR-175 | Production bundle has no development database artifact | PASS |
| PR-176 | Production bundle has no service-role key pattern | PASS |
| PR-177 | Production bundle has no direct migration URL variable | PASS |
| PR-178 | Source keeps provider names inside adapter boundaries | PASS |
| PR-179 | Localhost occurrence is limited to optional local print agent | PASS |
| PR-180 | Browser/local state is non-authoritative in production | PASS |
| PR-181 | Full Pass 1-12 regression succeeds | PASS |
| PR-182 | Database integration focus succeeds | PASS |
| PR-183 | Concurrency focus succeeds | PASS |
| PR-184 | Offline/reconnect focus succeeds | PASS |
| PR-185 | PostgreSQL commercial focus succeeds | PASS |
| PR-186 | TypeScript succeeds | PASS |
| PR-187 | Lint has zero errors | PASS |
| PR-188 | Dependency production audit has zero vulnerabilities | PASS |
| PR-189 | Local desktop/tablet/mobile browser views have no overflow | PASS |
| PR-190 | Local browser console is clean in tested views | PASS |
| PR-191 | Real Supabase PostgreSQL is migrated to schema 16 | BLOCKED |
| PR-192 | Production Hyperdrive is created and bound | BLOCKED |
| PR-193 | Production Worker is deployed | BLOCKED |
| PR-194 | Production Queue and dead-letter queue are bound | BLOCKED |
| PR-195 | Production Cron trigger is observed running | BLOCKED |
| PR-196 | Production R2 bucket and scanner service are bound | BLOCKED |
| PR-197 | Production domain and HTTPS are active | BLOCKED |
| PR-198 | Cloudflare WAF/bot controls are configured | BLOCKED |
| PR-199 | External log/error/metric sinks are configured | BLOCKED |
| PR-200 | Automated PostgreSQL backup policy is verified | BLOCKED |
| PR-201 | Isolated database restore rehearsal succeeds | BLOCKED |
| PR-202 | R2 recovery/versioning procedure is rehearsed | BLOCKED |
| PR-203 | Production-like staging deployment passes readiness | BLOCKED |
| PR-204 | Clean registration-to-sale E2E passes in staging | BLOCKED |
| PR-205 | Two-tenant isolation E2E passes in staging | BLOCKED |
| PR-206 | Enabled payment/delivery/notification providers are certified | BLOCKED |
| PR-207 | Physical KDS device acceptance passes | BLOCKED |
| PR-208 | Physical print bridge and printer acceptance passes | BLOCKED |
| PR-209 | Pilot restaurant operational/privacy sign-off is recorded | BLOCKED |
| PR-210 | Rollback and incident escalation drill passes | BLOCKED |

## Performance evidence

- Pass 7 fixture: 10 branches, 365 days, 250,000 represented orders; owner dashboard 10.71 ms,
  branch dashboard 15.97 ms.
- Pass 8: readiness 11.22 ms, menu preview 94.63 ms, inventory preview 111.56 ms.
- Pass 9: 50 branches and 250 concurrent requests; full request 941.05 ms.
- Pass 11: 14,000 rows; public menu 7.96 ms, QR submit 18.41 ms, host dashboard 6.69 ms.
- Pass 12: 500 branches; hierarchy 12.21 ms, dashboard 19.66 ms, overview 14.93 ms.

These are local deterministic fixture measurements, not production capacity claims.

## External inputs required

- Supabase PostgreSQL migration connection URL and approved backup plan.
- Cloudflare account/token plus Hyperdrive, Queue, DLQ, R2, scanner, Worker and domain identifiers.
- Managed guest signing secret and external telemetry/alert configuration.
- Credentials and approval for each provider enabled for the pilot.
- Physical KDS/printer/device-agent environment and pilot acceptance owner.
