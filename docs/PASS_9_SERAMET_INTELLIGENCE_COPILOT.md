# Pass 9: Seramet Intelligence and Restaurant Copilot

## Purpose

Seramet Intelligence explains authoritative Pass 3-8 facts. It is not an order, stock, payment, accounting, identity, integration, or configuration system. The model cannot query the database, execute SQL, or write operational records.

## Request architecture

```text
Authenticated user
  -> server permission and entitlement checks
  -> deterministic intent and business-period planner
  -> allowlisted evidence tools
  -> tenant and authorized-branch queries against Pass 3-8 read models
  -> quality-aware evidence package
  -> PII, secret, reference, and injection minimization
  -> provider-neutral structured generation boundary
  -> runtime schema validation
  -> deterministic grounding checks
  -> persisted answer, evidence references, usage, health, and audit metadata
```

Failure at any security, permission, evidence, provider, schema, or grounding stage fails closed. Core ERP services do not depend on an intelligence provider.

## Provider abstraction

`IntelligenceProviderAdapter` exposes structured generation and optional health. `IntelligenceProviderRegistry` resolves a tenant provider configuration. Provider display names, model identifiers, limits, role restrictions, features, retention policy, and managed secret references are configuration data.

The production path is a managed server gateway supplied through `SERAMET_AI_GATEWAY`. The gateway resolves credentials from the Pass 5 `SecretStore`; credential values are not returned to clients or persisted in intelligence messages. `DETERMINISTIC_TEST` is registered only in development and test, and production configuration rejects it.

No live vendor-specific provider adapter is claimed in this pass. A production gateway binding and approved provider credentials remain deployment requirements.

## Permissions and branch scope

Pass 9 adds:

- `intelligence.ask`
- `intelligence.management`
- `intelligence.finance`
- `intelligence.inventory`
- `intelligence.staff`
- `intelligence.owner`
- `intelligence.briefs.view`
- `intelligence.briefs.manage`
- `intelligence.actions.suggest`
- `intelligence.usage.view`
- `intelligence.admin`

Each evidence tool requires its intelligence permission and all source-domain permissions. For example, finance intelligence cannot bypass `management.finance.view`, and staff intelligence cannot bypass `staff.manage`. Owner comparison additionally requires all-branch scope. Session and cache permission fingerprints invalidate prior context when permissions change.

## Allowlisted evidence tools

| Tool                    | Authoritative source                                             |
| ----------------------- | ---------------------------------------------------------------- |
| Branch/owner summary    | `daily_branch_metrics` and branch configuration                  |
| Flash P&L               | `financial_summary_periods`                                      |
| Food-cost bridge        | Pass 7 `ManagementIntelligenceService.foodCostBridge`            |
| Channel profitability   | `daily_channel_metrics`                                          |
| Menu profitability      | `daily_menu_item_metrics`                                        |
| Inventory risk          | `inventory_balances`, availability, and data-quality read models |
| Purchase recommendation | Pass 6 `purchase_recommendations`                                |
| Supplier performance    | `daily_supplier_metrics` and supplier master                     |
| Kitchen performance     | `daily_station_metrics` and station master                       |
| Staff operations        | `daily_staff_metrics`                                            |
| Payment reconciliation  | `reconciliation_exceptions`                                      |
| Settlement exceptions   | `settlement_batches`                                             |
| Management actions      | `management_actions`                                             |
| Close readiness         | `close_readiness_snapshots`                                      |
| Branch health           | `branch_health_snapshots`                                        |
| Setup readiness         | `setup_readiness_results`                                        |
| Integration health      | configured `provider_connections`                                |
| Product help            | curated static Seramet help only                                 |

There is no raw database tool and no natural-language SQL path.

## Evidence package

Every package includes intent, authorized branch IDs and labels, server-authoritative period and timezone, typed metrics, evidence-classified findings, immutable source references, source calculation timestamps and hashes, quality, configuration gaps, limitations, and an evidence watermark. Currency is minor-unit based and financial calculations remain in Pass 6/7 services and SQL aggregates.

Quality values are `HIGH`, `MEDIUM`, `LOW`, `INSUFFICIENT_DATA`, `COMPLETE`, or `PARTIAL`. Empty or incomplete read models lower quality; the provider cannot upgrade the evidence quality. Managerial Flash P&L is explicitly labelled non-statutory.

## Grounding and hallucination controls

Provider output must match the strict structured schema. Unknown fields and malformed output are rejected. The grounding validator rejects:

- evidence references not present in the package;
- numeric or percentage claims absent from typed metrics or authoritative evidence text;
- named branches, suppliers, staff, stations, or channels absent from evidence;
- confirmed causal claims without a matching confirmed persisted finding;
- removal of an `UNEXPLAINED` remainder;
- staff character or misconduct judgments;
- unconfirmed authoritative commands; and
- any high-risk command.

HTML tags and control characters are removed before rendering. The UI renders plain text, not provider HTML.

## Prompt-injection and privacy controls

Supplier names, menu text, order notes, and other records are untrusted data. Before provider transfer Seramet removes secret-like keys, customer/staff identities, Kenyan phone numbers, email addresses, payment references, control characters, and known instruction/secret-exfiltration phrases. The tenant ID is removed from the provider evidence payload. The provider receives no arbitrary database access or tool execution authority.

Retention is tenant-configurable:

- `EPHEMERAL`: content is not retained beyond operational metadata.
- `SHORT`: content expires after 7 days.
- `STANDARD`: content expires after 30 days.

The retention worker redacts expired message content and deletes expired answer cache entries while preserving append-only usage and evidence references.

## Query planner and why analysis

Intent classification and date resolution are deterministic. Business periods use the Pass 5 server-authoritative branch timezone and cutoff. Why-analysis can only repeat causes already persisted in Pass 6/7 evidence. Food-cost residuals remain `UNEXPLAINED`; supplier, menu, channel, inventory, and kitchen explanations use their persisted read models.

## Briefs

Morning, EOD, owner, and management briefs use the same authorization, evidence, provider, and grounding pipeline as interactive questions. Brief preparation has a deterministic generation key. Durable Pass 5 workers claim, retry, and dead-letter jobs; generated briefs retain evidence, quality, provider, model, prompt, correlation, and completion metadata.

## Suggested actions

Read-only route suggestions may navigate to existing Seramet workflows. The only executable Pass 9 command is `ACKNOWLEDGE_MANAGEMENT_ACTION`, classified low risk. It requires:

1. `intelligence.actions.suggest` and `management.actions.manage`;
2. an existing authorized management action;
3. an existing grounded answer;
4. a five-minute hashed confirmation token;
5. an explicit confirmation note; and
6. a second domain permission and branch check at execution.

Financial posting, period close, stock adjustment, refund, payment credential change, and go-live approval are unavailable through the intelligence action boundary.

## Usage, caching, and observability

Usage reservations and outcomes are server-side append-only events with tenant, user, branch, provider, model, units, optional cost, latency, status, error category, and correlation ID. Per-minute, daily, monthly, and per-user daily limits are enforced in authoritative persistence.

Cache keys include normalized question, intent, period, tenant-scoped storage, branch-scope hash, permission fingerprint, evidence watermark, prompt version, and model identifier. Entries expire after five minutes.

Provider health is observed by the provider adapter and persisted separately. Admin responses expose health and whether a secret reference exists, never the reference or value. Structured logs use existing redaction and correlation infrastructure.

## UI

`/ai` preserves the Seramet application shell and supplies Ask, Morning Brief, EOD Brief, History, and Usage views. It provides branch scope, honest loading/error/empty states, provider metadata, quality, limitations, evidence details, feedback, and permission-aware questions. Authorized admins can update provider metadata, managed secret reference, model, limits, retention, feature restrictions, and role restrictions without exposing secret values.

## Limitations

- No live model vendor is bundled or claimed. Production requires a managed gateway implementation and approved provider configuration.
- Streaming is not declared by the current adapter contract implementation.
- Intent classification is deterministic and allowlisted; unsupported phrasing may require a clearer question.
- Evidence quality depends on Pass 6/7 data completeness and recalculation freshness.
- Scheduled brief enablement uses configured feature markers and worker schedules; tenant-specific delivery channels are outside this pass.
- Intelligence provides operational explanations, not audited financial statements, employment judgments, or autonomous actions.
