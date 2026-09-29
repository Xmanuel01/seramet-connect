# Pass 12 - Enterprise, Franchise, HQ and Central Operations

## Scope

Pass 12 extends the authoritative Pass 1-11 platform. It does not introduce alternate order,
payment, inventory, CRM, guest, or accounting ledgers. Enterprise services provide scope,
governance, orchestration, and management read models over those existing domains.

## Architecture

```text
Authenticated actor
  -> tenant + branch assignments + permission set
  -> enterprise hierarchy scope resolver
  -> policy / target resolver
  -> existing domain command or management read model
  -> authoritative D1/SQLite-compatible database
  -> append-only audit and durable worker outbox
```

The server derives tenant scope from the authenticated actor. Browser-supplied tenant, role,
permission, price, accounting, and policy values are never treated as authority.

## Hierarchy And Legal Entities

`enterprise_nodes` supports `GROUP`, `LEGAL_ENTITY`, `BRAND`, `REGION`, `AREA`, `BRANCH`,
`WAREHOUSE`, and `COMMISSARY`. The closure table makes ancestor/descendant checks deterministic.
Legal entities, brands, and operating branches remain separate records. Tenant-scoped foreign keys
and unique branch/warehouse ownership prevent cross-tenant or duplicate hierarchy attachment.

Node status is effective operational state, not deletion. Supported lifecycle transitions retain
history and audit. Closing, suspending, or temporarily closing a node does not erase finance,
orders, inventory, CRM, or guest records.

## Scope And RBAC

Effective access combines:

- authenticated tenant;
- server-loaded role permissions;
- branch assignments;
- effective-dated enterprise role assignments;
- explicit `ALLOW` / `DENY` records;
- optional descendant inheritance;
- delegated-administration constraints.

Permission does not climb from a branch to its parent. Explicit deny removes a descendant from an
otherwise inherited scope. Delegated administrators cannot grant roles containing permissions they
do not possess, roles outside the configured allowlist, or scopes broader than the configured
maximum scope type. Temporary assignments expire by server timestamp.

## Module, Screen And Action Access

`src/platform/module-access-registry.ts` is the single module-access contract for staff navigation,
direct routes, server data retrieval, screen actions, hierarchy scope, entitlements, feature flags,
and effective module policies. It declares separate navigation, route, read, create, edit, approve,
and sensitive permissions for every major Seramet module. The Settings access matrix renders this
registry directly; it does not infer authority from a role name.

`RouteAccessBoundary` rejects unauthorized direct URLs independently of sidebar visibility.
Operational pagination and all enterprise endpoints resolve the current server profile before data
or action access. Existing domain services remain the final, more specific permission and scope
boundary. Database revision triggers invalidate client access profiles after role, branch, hierarchy,
or delegation changes. The complete contract is documented in
`docs/ENTERPRISE_MODULE_ACCESS_MATRIX.md`.

## Policy Engine

Policies are definitions plus append-only, effective-dated assignments. Supported states are:

- `INHERIT`
- `LOCAL_VALUE`
- `LOCKED`
- `ALLOWED_OVERRIDE`
- `ALLOWED_WITHIN_RANGE`
- `APPROVAL_REQUIRED`
- `NOT_APPLICABLE`

Resolution follows the target node toward its ancestors and returns an evidence trace. Runtime
validation enforces the configured JSON type/enum subset. Locked and range policies are enforced in
the server services. Approval-required changes need a valid, approved, unexpired exception.
Exception events and policy versions are append-only. A durable maintenance job expires bounded
exceptions and releases due, confirmed rollouts.

The existing Pass 6 services now enforce enterprise controls directly:

- `PROCUREMENT.APPROVED_SUPPLIERS` is checked before purchase-order persistence;
- `RECIPE:<resourceId>` blocks local branch recipe creation/versioning when locked;
- menu prices continue through the authoritative menu branch settings and rollout policy checks.

## Targets And Benchmarking

Metric targets are effective-dated and append-only. They inherit through the hierarchy and support
locked, allowed, range, and approval-required overrides. Daily branch metrics remain the source for
group and branch management dashboards. Missing quality remains visible. Mixed-currency scopes do
not produce a monetary total without an authoritative FX basis.

The dashboard is explicitly a management aggregation. It is not statutory consolidated financial
reporting.

## Controlled Rollouts

Price rollout follows:

```text
request -> preview targets -> target hash -> explicit confirmation
        -> optional independent approval -> durable execution -> per-branch result
```

Execution recomputes the target hash and policy watermark. Scope or policy mutation after preview
invalidates execution. Conditional claiming prevents two workers from applying the same rollout.
Per-branch states retain blocked, failed, skipped, and successful outcomes; completion is never
reported while a required target failed.

Branch templates are immutable versions. Publishing a new version does not mutate an adopted branch.
Application requires a server-generated preview hash and an idempotency key. The assignment records
the exact adopted version. A published template with a complete, validated `operatingProfile` can
also provision a new authoritative branch, operating profile, hierarchy node/closure, and template
assignment in one database batch. Identity, timezone, cutoff, currency, brand, legal entity, and
parent scope are explicit request data; no branch defaults are inferred. Setup/readiness remains
owned by the Pass 8 workflow.

## Central Procurement

Approved branch requisitions are aggregated by item after item-specific UOM conversion to the base
unit. Source requisition lines remain linked through `central_requisition_allocations`. Supplier
contracts are effective-dated, scoped commercial metadata; Seramet does not claim legal contract
execution.

Purchase orders, goods receipts, supplier invoices, payables, and inventory journals continue to use
the Pass 6 services. This preserves approval, conversion, valuation, idempotency, and accounting
behavior. Locked approved-supplier policy is enforced inside that existing purchase-order service.

## Staged Transfers And Commissary

The staged transfer path is separate from the legacy immediate-transfer command but uses the same
`stock_transfers`, `stock_transfer_lines`, and append-only inventory movements.

```text
dispatch
  -> intercompany safety check
  -> source TRANSFER_OUT
  -> shipment IN_TRANSIT
  -> destination unchanged

partial/final receipt
  -> normalized receipt lines
  -> accepted quantity TRANSFER_IN
  -> damaged/rejected/missing variance retained
  -> shipment PARTIALLY_RECEIVED or RECEIVED
```

Database constraints cap cumulative receipt quantities at dispatched quantity. Receipt idempotency
prevents retries from duplicating destination stock. Selected source lot identity and expiry are
validated and carried to the destination lot; only accepted quantity enters destination stock.

Same-entity transfers are classified as intra-entity. A cross-entity dispatch fails before movement
unless an effective `intercompany_configurations` record provides due-from, due-to, currency, and a
transfer-price policy reference. Seramet does not invent tax or statutory intercompany treatment.

Central production remains the Pass 6 production ledger. Prepared items can use the staged transfer
path, retaining cost and optional lot/expiry evidence without double-consuming recipe inputs.

## Franchise Governance

Franchise relationships link separate franchisee/franchisor legal entities, a brand, authorized
branches, effective dates, reporting scope, and lifecycle. Suspending or terminating preserves
history and revokes active scoped assignments beneath the franchisee legal entity.

Fee definitions are data-driven:

- fee types: royalty, marketing levy, fixed, or other;
- bases: gross sales, net sales, configured revenue, or fixed periodic;
- integer basis-point or fixed-minor-unit calculation;
- effective dates, exclusions, currency, and optional account mapping metadata.

Fee periods persist source facts, source hash, amount, quality, and status. No-data periods are
`INSUFFICIENT_DATA`; incomplete periods are `PARTIAL` or `LOW`. Posted fee periods are immutable
except through the explicit reversal state.

The franchise statement is labeled `MANAGEMENT_FRANCHISE_STATEMENT`, with `statutoryInvoice=false`.
Where no authoritative franchise settlement allocation exists, payment and outstanding balance are
reported unavailable rather than fabricated.

Compliance workers write factual checks with `COMPLIANT`, `WARNING`, `NON_COMPLIANT`,
`NOT_APPLICABLE`, or `UNKNOWN`, then open or resolve existing Manager Action Centre records.

## Workers

Pass 5 durable queue semantics are reused for:

- rollout execution;
- policy maintenance and scheduled rollout release;
- franchise fee recalculation;
- franchise compliance recalculation;
- enterprise readiness recalculation;
- scoped export generation.

Jobs are allowlisted, persistent, retried, dead-lettered by the existing worker runtime, and
deduplicated by tenant/idempotency key. Export workers rehydrate the requesting user's current
authority before producing data.

## Enterprise UI

`/enterprise` preserves the Seramet shell and design system. It provides Overview, Organisation,
Policies, Rollouts, Procurement, Franchises, Readiness, and Audit views. Scope selection changes
server queries. The hierarchy is searchable; large tables scroll within their surface. Audit export
uses the bounded server export workflow.

## Audit And Exports

Enterprise mutations create authoritative audit events with actor, tenant, correlation, entity, and
timestamp. Audit queries support bounded scope, actor, branch, domain, action, date, and correlation
filters. Sensitive metadata keys are redacted.

Exports are allowlisted by type and field, capped at 10,000 rows, scoped to authorized descendants,
and bound to an actor/scope/permission fingerprint. A permission or scope change before execution
causes failure rather than stale-authority export.

## Capability Boundaries

| Capability                            | Status         | Notes                                                           |
| ------------------------------------- | -------------- | --------------------------------------------------------------- |
| OIDC configuration                    | BOUNDARY_ONLY  | No custom identity protocol implementation                      |
| SAML configuration                    | BOUNDARY_ONLY  | No custom SAML implementation                                   |
| SCIM                                  | SPEC_REQUIRED  | Not implemented without an authoritative provider specification |
| Authoritative FX                      | NOT_CONFIGURED | Mixed-currency monetary totals fail closed                      |
| Statutory consolidation               | NOT_SUPPORTED  | Management aggregation only                                     |
| Supplier legal contract execution     | NOT_SUPPORTED  | Commercial metadata only                                        |
| Intercompany statutory/tax compliance | NOT_SUPPORTED  | Configuration and blocking boundary only                        |

## Validation Evidence

- Full suite: 405 tests across 21 files passed.
- Pass 12 focused suite: 54 tests passed.
- Database suite: 19 tests passed.
- Concurrency/idempotency selection: 20 tests passed, 73 nonmatching tests skipped.
- Enterprise load fixture: 500 branches, 511 nodes, and 500 daily metrics.
- TypeScript: passed.

Lint completed with zero errors, the production client/SSR/Nitro Cloudflare build passed, and
desktop/tablet/mobile browser QA was console-clean with no page-level overflow. Security and
hardcode evidence is recorded in the dedicated reviews and completion report.
