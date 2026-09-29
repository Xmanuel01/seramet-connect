# Pass 9 Completion Report

Status: **PASS 9 COMPLETE**

Date: 2026-09-01  
Scope: Seramet Intelligence and Restaurant Copilot  
Schema version: 10

## Acceptance Result

All 100 requested acceptance criteria pass.

| # | Criterion | Result | Evidence |
|---:|---|:---:|---|
| 1 | Pass 1-8 regression tests remain passing | PASS | Full 15-file, 288-test suite |
| 2 | Historical DB suites remain included | PASS | Pass 5-8 DB tests run in full suite |
| 3 | Intelligence configuration is server authoritative | PASS | Migration 0010 and Intelligence API |
| 4 | LLM is never authoritative for ERP facts | PASS | Deterministic evidence boundary and grounding |
| 5 | No direct model database access exists | PASS | Provider accepts minimized evidence DTO only |
| 6 | No natural-language arbitrary SQL execution exists | PASS | Allowlisted planner and fixed repository queries |
| 7 | Evidence tools are allowlisted | PASS | Evidence tool registry |
| 8 | Evidence retrieval is tenant scoped | PASS | Actor-bound queries and isolation tests |
| 9 | Evidence retrieval is branch scoped | PASS | Authorized branch resolver and tests |
| 10 | Source-domain permissions are enforced | PASS | Tool permission requirements |
| 11 | AI permission cannot bypass finance permission | PASS | Dual permission tests |
| 12 | AI permission cannot bypass staff permission | PASS | Dual permission tests |
| 13 | AI provider credentials stay server-side | PASS | SecretStore reference boundary |
| 14 | Provider secret is never returned | PASS | Admin DTO and browser QA |
| 15 | Provider abstraction is vendor-neutral | PASS | Provider registry and adapter contract |
| 16 | Product continues without AI provider | PASS | Provider outage test and browser QA |
| 17 | AI unavailable state is honest | PASS | Explicit unavailable UI state |
| 18 | Business date uses server branch rules | PASS | Query planner tests |
| 19 | Cross-tenant question fails closed | PASS | Shared-DB isolation test |
| 20 | Unauthorized cross-branch comparison fails closed | PASS | Branch authorization tests |
| 21 | Conversation context cannot bypass authorization | PASS | Permission fingerprint revalidation |
| 22 | Cache cannot leak cross-tenant evidence | PASS | Tenant-partitioned cache keys and tests |
| 23 | Evidence packages contain quality | PASS | Structured evidence schema |
| 24 | Evidence retains calculation/source metadata | PASS | Evidence references and watermarks |
| 25 | Unsupported money cannot enter grounded answer | PASS | Hallucinated-number tests |
| 26 | Unsupported percentage cannot enter grounded answer | PASS | Hallucinated-percentage tests |
| 27 | Unsupported cause is not confirmed | PASS | Causal grounding tests |
| 28 | Unexplained variance remains unexplained | PASS | Remainder preservation tests |
| 29 | Low-quality data remains labelled | PASS | Quality propagation tests and UI |
| 30 | Staff misconduct is never inferred without evidence | PASS | Staff-judgment rejection test |
| 31 | Flash P&L remains labelled managerial | PASS | Finance evidence metadata |
| 32 | Financial calculations remain deterministic | PASS | Pass 7 read models remain authoritative |
| 33 | Food-cost explanation reconciles to Pass 7 bridge | PASS | Food-cost bridge evidence tool |
| 34 | Channel analysis is provider-neutral | PASS | Channel read-model evidence |
| 35 | Menu analysis uses Pass 6/7 cost evidence | PASS | Menu profitability evidence tool |
| 36 | Supplier explanation uses persisted supplier facts | PASS | Supplier evidence tool |
| 37 | Kitchen analysis uses persisted timestamps | PASS | Kitchen evidence tool |
| 38 | Inventory advice uses Pass 6 balance/forecast | PASS | Inventory/procurement evidence tools |
| 39 | Purchase recommendation is not auto-ordered | PASS | Recommendation-only response contract |
| 40 | Morning Brief uses authoritative evidence | PASS | Brief worker tests |
| 41 | EOD Brief uses authoritative evidence | PASS | Brief worker tests |
| 42 | Owner Brief respects branch scope | PASS | Owner-scope tests |
| 43 | Brief quality/limitations are displayed | PASS | Brief DTO and UI |
| 44 | Menu prompt injection cannot alter instructions | PASS | Injection fixture test |
| 45 | Order-note injection cannot alter permissions | PASS | Injection fixture test |
| 46 | Supplier-name injection cannot retrieve secrets | PASS | Injection and redaction tests |
| 47 | Model output is runtime-schema validated | PASS | Strict Zod structured-output schema |
| 48 | Malformed model response fails safely | PASS | Malformed-provider test |
| 49 | Provider timeout fails safely | PASS | Timeout-provider test |
| 50 | Provider rate limit fails safely | PASS | Rate-limit-provider test |
| 51 | ERP remains operational during AI outage | PASS | Browser outage/recovery QA |
| 52 | AI usage is measured server-side | PASS | Usage event ledger |
| 53 | Usage limits are enforced | PASS | Reservation and quota tests |
| 54 | Usage counters are tenant scoped | PASS | Tenant-partitioned usage queries |
| 55 | Cache includes tenant/permission/evidence scope | PASS | Cache key contract |
| 56 | Permission changes cannot reuse unsafe cache | PASS | Permission fingerprint test |
| 57 | Intelligence session is tenant scoped | PASS | DB constraints and session queries |
| 58 | Session retention policy works | PASS | Retention tests |
| 59 | PII minimization/redaction is applied | PASS | Privacy tests |
| 60 | Secrets never enter evidence payload | PASS | Payload inspection tests |
| 61 | Intelligence logs contain no secrets | PASS | Redaction boundary and security audit |
| 62 | Diagnostics contain no AI secrets | PASS | Admin summary omits values |
| 63 | Suggested action is explicit | PASS | Typed proposal object |
| 64 | Mutation requires confirmation | PASS | Short-lived hashed confirmation token |
| 65 | Confirmation rechecks domain permission | PASS | Confirmation tests |
| 66 | High-risk financial action cannot execute through AI | PASS | Action allowlist tests |
| 67 | AI cannot close accounting period | PASS | No capability/action route |
| 68 | AI cannot post journal | PASS | No capability/action route |
| 69 | AI cannot adjust stock | PASS | No capability/action route |
| 70 | AI cannot change payment credentials | PASS | No capability/action route |
| 71 | AI cannot approve go-live | PASS | No capability/action route |
| 72 | Provider health is evidence-based | PASS | Persisted health outcomes |
| 73 | Feature entitlement is server enforced | PASS | Entitlement checks |
| 74 | Feature flag cannot bypass permission | PASS | Permission remains independently required |
| 75 | Demo intelligence is isolated | PASS | Test provider limited to development/test |
| 76 | Model/prompt version is retained | PASS | Message, usage, health, and cache metadata |
| 77 | Feedback does not alter authoritative facts | PASS | Separate feedback records |
| 78 | Output rendering is sanitized | PASS | HTML/control-character sanitization test |
| 79 | Material configuration changes are audited | PASS | Provider configuration audit |
| 80 | Accepted suggested actions are audited | PASS | Action confirmation audit |
| 81 | Morning/EOD jobs are durable/idempotent | PASS | Queue worker/idempotency tests |
| 82 | Worker retry/dead-letter works | PASS | Durable worker tests |
| 83 | Concurrent tenant requests stay isolated | PASS | Shared DB concurrent test |
| 84 | Rate limits work under concurrency | PASS | Concurrent quota test |
| 85 | TypeScript passes | PASS | `npm run typecheck` |
| 86 | Lint passes | PASS | `npm run lint`, zero errors |
| 87 | Full tests pass | PASS | 288/288 |
| 88 | Database tests pass | PASS | Historical and Pass 9 DB coverage |
| 89 | Production client build passes | PASS | Vite client build |
| 90 | SSR build passes | PASS | Vite SSR build |
| 91 | Nitro/Cloudflare build passes | PASS | Cloudflare-module Nitro output |
| 92 | Desktop QA passes | PASS | 1440x900 |
| 93 | Tablet QA passes | PASS | 1024x768 |
| 94 | Mobile QA passes | PASS | 390x844 |
| 95 | Browser console is clean | PASS | No warnings/errors captured |
| 96 | No page-level overflow | PASS | All three viewport checks |
| 97 | Performance fixture executes | PASS | 10-tenant/50-branch fixture |
| 98 | No P0/P1 security issue remains | PASS | Pass 9 security review |
| 99 | Production hardcode audit remains clean | PASS | Pass 9 hardcode audit |
| 100 | Documentation and completion report exist | PASS | Pass 9 document set |

## Validation

- Tests: **288/288 passed** across 15 files. Pass 9 contributes 41 functional/security tests and one load fixture.
- TypeScript: **PASS**, no diagnostics.
- Lint: **PASS**, zero errors; 15 existing Fast Refresh warnings in shared pre-Pass-9 files.
- Production client: **PASS**, 2,793 modules, 12.57 seconds; `/ai` chunk 23.55 kB (6.82 kB gzip).
- SSR: **PASS**, 362 modules, 9.94 seconds.
- Nitro/Cloudflare: **PASS**, `cloudflare-module` output and Wrangler configuration generated.
- Database: **PASS**, migrations 0001-0010 and repository/invariant coverage included in the full suite.
- Concurrency: **PASS**, tenant isolation and quota reservation scenarios pass.
- Browser: **PASS**, grounded Ask flow, evidence dialog, History, Usage/admin, provider outage/recovery, EOD unavailable-worker state, 1440x900, 1024x768, and 390x844. No console errors or page overflow.

The local browser run intentionally had no durable queue binding. Brief generation therefore showed `Durable intelligence worker queue unavailable` and did not pretend to generate a brief. The durable queue, retry, dead-letter, and idempotency paths pass in automated worker tests.

## Migration

`0010_seramet_intelligence_copilot.sql` adds 11 tenant-scoped tables, 11 permissions, query indexes, append-only protections for usage/evidence/prompt records, and schema version 10. The development seed enables the isolated deterministic test provider and grants demo branch-manager permissions without adding production business data.

Tables:

- `intelligence_provider_configs`
- `intelligence_sessions`
- `intelligence_messages`
- `intelligence_evidence_refs`
- `intelligence_usage_events`
- `intelligence_briefs`
- `intelligence_feedback`
- `intelligence_answer_cache`
- `intelligence_prompt_versions`
- `intelligence_action_proposals`
- `intelligence_provider_health`

## Architecture Result

The Intelligence API owns authentication, authorization, validation, rate limits, evidence retrieval, provider invocation, grounding, persistence, usage, and audit. Providers receive only a minimized structured evidence package. They cannot query the database, execute SQL, infer an actor's permissions, or invoke ERP commands.

The implemented live-spec surface is the provider-neutral `IntelligenceProviderAdapter` and managed `SERAMET_AI_GATEWAY` boundary. **No commercial AI provider adapter or live provider connection is claimed.** The deterministic provider is explicitly development/test-only.

The allowlisted evidence layer covers branch summaries and health, management actions, finance, food-cost bridges, inventory, procurement, kitchen, supplier, menu, and close-readiness facts. Each tool requires both intelligence permission and its source-domain permission.

Grounding validates evidence references, money, quantities, percentages, named entities, causal claims, data quality, unexplained remainder, staff judgements, sanitized text, and action risk before persistence or rendering.

Morning, EOD, owner, and management briefs share the same evidence and grounding boundary. Durable workers handle generation, retry, dead letter, and idempotency. Brief quality and limitations remain visible.

The only executable suggestion is a low-risk acknowledgement of an existing management action. It requires an explicit five-minute confirmation token, note, actor/branch/domain permission revalidation, and audit. Finance posting, period close, stock adjustment, payment credentials, and go-live approval are structurally unavailable through AI.

## Privacy And Security

PII, customer/staff identity, contact details, transaction references, secrets, and prompt-injection text are removed or neutralized before provider invocation. Provider secrets are resolved server-side and never returned by admin, diagnostics, evidence, logs, or browser APIs. Output is schema-validated and sanitized before rendering.

Security result: **no open P0 or P1 finding**. The threat model covers tenant leakage, authorization bypass, prompt injection, data exfiltration, hallucinated finance, cache confusion, quota races, unsafe actions, provider outage, and secret exposure.

## Performance Fixture

Environment: local SQLite-compatible test adapter and deterministic provider; these are engineering measurements, not production scale claims.

Facts: 10 tenants, 50 branches, 20 users, 18,250 branch-day metrics, 150 channel facts, 150 supplier facts, 2,000 menu facts, 1,000 inventory facts, and 250 concurrent requests.

| Operation | Time |
|---|---:|
| Planner | 88.75 ms |
| Evidence retrieval | 230.37 ms |
| Deterministic provider roundtrip | 8.33 ms |
| Grounding | 338.99 ms |
| Full request set | 1,984.23 ms |
| Cache retrieval | 52.37 ms |
| Brief generation | 78.71 ms |

## Files

Created:

- `docs/PASS_9_THREAT_MODEL.md`
- `docs/PASS_9_SERAMET_INTELLIGENCE_COPILOT.md`
- `docs/PASS_9_GO_LIVE_CHECKLIST.md`
- `docs/PASS_9_SECURITY_REVIEW.md`
- `docs/PASS_9_HARDCODE_AUDIT.md`
- `docs/PASS_9_COMPLETION_REPORT.md`
- `migrations/0010_seramet_intelligence_copilot.sql`
- `migrations/seed/pass9-demo.sql`
- `src/intelligence/types.ts`
- `src/intelligence/schemas.ts`
- `src/intelligence/privacy.ts`
- `src/intelligence/query-planner.ts`
- `src/intelligence/grounding.ts`
- `src/intelligence/provider-registry.ts`
- `src/intelligence/evidence-tools.ts`
- `src/intelligence/intelligence-service.ts`
- `src/intelligence/use-intelligence.ts`
- `src/intelligence/pass-9-intelligence.test.ts`
- `src/intelligence/pass-9-load.test.ts`
- `src/server/intelligence-api.ts`

Modified:

- `package.json`
- `src/components/app/AppShell.tsx`
- `src/components/app/nav.ts`
- `src/inventory/pass-6-inventory-intelligence.test.ts`
- `src/lib/seramet-api.ts`
- `src/management/pass-7-management-intelligence.test.ts`
- `src/onboarding/onboarding-service.ts`
- `src/onboarding/pass-8-commercial-productization.test.ts`
- `src/platform/permissions.ts`
- `src/routes/ai.tsx`
- `src/server/database/local-development-database.ts`
- `src/server/database/sqlite-test-adapter.ts`
- `src/server/environment.ts`
- `src/server/pass-5-production-foundation.test.ts`
- `src/server/workers.ts`

## Known Limitations And Pilot Blockers

- A production AI vendor/gateway, credentials, data-processing agreement, region/retention decision, and model approval are still required before live AI is enabled.
- Production must bind the durable queue and managed secret store. Readiness must remain failed closed without them.
- The deterministic provider is a test renderer, not a live AI implementation.
- The planner intentionally supports an allowlisted restaurant-management question set; unsupported questions fail closed instead of falling back to arbitrary retrieval.
- No streaming capability is declared.
- External delivery of scheduled briefs is outside Pass 9; persisted brief generation is implemented.
- Real pilot data must be reviewed for evidence completeness, recipe coverage, branch permissions, retention, quotas, latency, and financial/staff signoff before enabling Copilot for restaurant users.

These are deployment/configuration dependencies, not unresolved grounding, isolation, permission, secret, action-safety, outage, P0, or P1 defects.
