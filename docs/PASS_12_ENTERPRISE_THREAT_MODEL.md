# Pass 12 Enterprise Threat Model

## Scope and assumptions

This model covers the enterprise hierarchy, scoped authorization, policy inheritance,
rollouts, central procurement and inventory distribution, franchise obligations,
management aggregation, enterprise exports, workers, caches, and AI evidence added in
Pass 12. The existing tenant remains the hard security boundary. Legal entities,
brands, regions, branches, warehouses, commissaries, and franchise relationships are
authorization scopes inside one tenant; Pass 12 does not introduce cross-tenant joins.

Production is assumed to use the bearer/JWT, authoritative database, durable queue,
server-side secrets, append-only audit, and fail-closed environment checks documented
by Pass 5. Enterprise SSO and SCIM are capability boundaries only unless a verified
provider adapter is configured. Management aggregation is not statutory consolidation.

## System and trust boundaries

1. **Browser to Seramet API.** Staff requests cross an untrusted network boundary.
   Authentication is resolved by `src/lib/seramet-auth.ts`; tenant, branch, permissions,
   and session/device state must come from the verified server identity, never payloads.
2. **Enterprise API to scope resolver.** Requested node, rollout, export, policy, and
   franchise scopes are untrusted until intersected with the actor's effective
   assignments and descendant scope.
3. **Enterprise orchestration to authoritative domains.** Menu, recipe, procurement,
   inventory, finance, CRM, provider, and audit services remain authoritative. Enterprise
   code may coordinate them but must not bypass their invariants.
4. **API and scheduler to durable workers.** Rollout, policy activation, readiness,
   royalty, export, and aggregation jobs are at-least-once deliveries. Claiming,
   idempotency, status transitions, and dead letters protect integrity.
5. **Database and caches/read models.** The database is authoritative. Cache keys must
   include tenant, actor authorization fingerprint, resolved scope, policy version, and
   data watermark. Cached results never expand access.
6. **Seramet to external identity/export/provider systems.** Secrets remain in the
   server secret boundary. Export destinations and identity metadata are configuration,
   not proof that a live protocol is implemented.
7. **HQ to franchise/local operations.** HQ visibility and mutation rights are explicit
   permissions. A franchise scope cannot read peers or corporate-only data; a local
   assignment cannot climb to ancestors.

## Assets

- Tenant, legal-entity, franchisee, customer, payroll, finance, inventory, and sales data.
- Effective policy values, locks, exceptions, approvals, templates, and rollout state.
- Role assignments, delegated-administration limits, temporary access, sessions, and devices.
- Inventory transfers, supplier contracts, royalty facts, fees, intercompany mappings,
  journals, reconciliations, and management aggregations.
- Provider/SSO metadata, server-side secret references, exports, audit records, queue
  messages, cache entries, and AI evidence.

## Attacker capabilities

Credible attackers include an authenticated branch or franchise user altering object
identifiers, a delegated administrator trying to grant broader authority, a compromised
HQ session, a worker retry racing another worker, and an external party obtaining an
export URL or API request. Attackers can replay requests and tamper with payload scope,
amounts, rates, policy versions, and status transitions. They cannot directly read the
authoritative database or managed secrets without a separate infrastructure compromise.

## Priority threats and controls

| ID | Abuse path and impact | Likelihood | Impact | Priority | Required controls |
|---|---|---:|---:|---:|---|
| ENT-01 | Change tenant/node/franchise IDs to read another tenant, legal entity, region, branch, or franchise. | High | High | Critical | Tenant from verified actor; tenant-qualified foreign keys; one authoritative scope resolver; descendant checks; negative tests at API and DB layers. |
| ENT-02 | A branch or delegated admin grants group-level or finance authority they do not possess. | Medium | High | High | Grantor must hold both target permission and delegation right over the target scope; prevent upward scope; effective dates server-checked; audit every grant/revoke. |
| ENT-03 | Local mutation bypasses a locked or range-limited parent policy through direct API, feature flag, worker, AI, or support tooling. | High | High | Critical | Resolve policy server-side on every governed mutation; validate lock/range/approval state; no role-based bypass; emergency exception needs permission, reason, expiry, approval, and audit. |
| ENT-04 | Rollout payload broadens target scope or retries duplicate price/menu/template changes. | Medium | High | High | Immutable explicit targets from preview; authorization fingerprint and policy watermark; idempotency key; item-level states; bounded batches; PARTIAL on any required failure. |
| ENT-05 | Duplicate dispatch/receipt creates extra inventory or hides transfer loss. | Medium | High | High | Existing append-only inventory ledger; transfer-specific idempotency; in-transit state; accepted/damaged/rejected quantities; atomic state transition; no destination stock before receipt. |
| ENT-06 | Cross-legal-entity transfer posts as intra-entity and corrupts finance. | Medium | High | High | Resolve legal entity for both nodes; require configured due-to/due-from/transfer accounts; fail closed when mapping or currency basis is missing; balanced journal tests. |
| ENT-07 | Royalty rate, basis, exclusions, or source facts are tampered with to understate obligations. | Medium | High | High | Effective-dated formula config; integer arithmetic; immutable source snapshot/hash; deterministic recalculation; quality state; approvals and audit for changes. |
| ENT-08 | Franchisee or regional cache entry is served to another actor/scope. | Medium | High | High | Cache key includes tenant, permission fingerprint, authorized node set, policy version, and watermark; reauthorize on cache hit; no shared unscoped dashboard cache. |
| ENT-09 | Enterprise export or audit search leaks data outside authorized scope or includes secrets. | Medium | High | High | Resolve scope before enqueue and again in worker; bounded fields/rows; secret redaction; short-lived protected download; audit request and access. |
| ENT-10 | AI prompt asks for another franchise/region or tricks evidence tools into unscoped queries. | Medium | High | High | Evidence tools receive server actor and resolved scope; no tenant/scope from prompt; permission-filter sources; cache isolation; AI cannot execute enterprise mutations. |
| ENT-11 | Bulk action or support impersonation changes many branches without informed approval. | Medium | High | High | Preview, target count, explicit confirmation, permission, optional two-person approval, idempotency, audit correlation, and immutable result summary. Support access is time-bound and visible. |
| ENT-12 | SSO/directory misconfiguration maps an external identity to the wrong tenant or scope, or leaks client secrets. | Low | High | High | Provider-neutral metadata only until verified adapter exists; issuer/audience/tenant allowlist; secret references only; fail closed; never infer enterprise scope from unverified claims. |
| ENT-13 | Management aggregation is presented as statutory consolidation or silently combines currencies. | Medium | High | High | Label as management aggregation; preserve legal-entity and currency dimensions; require authoritative FX basis; expose incomplete/unsupported state; do not auto-post eliminations. |
| ENT-14 | Destructive tenant-wide closure, rollout, or offboarding deletes history. | Low | High | High | Lifecycle status changes only; explicit high-impact confirmation/approval; preserve finance, orders, inventory, CRM, and audit history; reversible workflow where supported. |
| ENT-15 | Large hierarchy queries, rollouts, or exports exhaust API/database/worker capacity. | Medium | Medium | Medium | Pagination/lazy tree loading, bounded targets and exports, durable batches, rate limits, leases, query indexes, quotas, cancellation, and measured performance fixtures. |

## Security invariants

- Every enterprise row is tenant-scoped; cross-tenant references fail in the database.
- An actor's effective scope is the intersection of active assignments, permission,
  descendant policy, explicit deny where configured, and the requested resource scope.
- Descendant authority never implies ancestor authority.
- Policy locks outrank role permission, feature flags, workers, AI, and support tooling.
- Financial and inventory effects use existing authoritative ledgers and idempotency.
- Cross-entity accounting fails closed without explicit mappings and currency basis.
- Rollouts and bulk actions never report COMPLETE after partial required failure.
- Secrets are referenced, not returned; exports are scoped, bounded, redacted, and audited.
- Enterprise AI is read-only for sensitive actions and cannot broaden its evidence scope.

## Validation plan

Automated coverage must include cross-tenant/entity/brand/region/branch/franchise denial,
delegation escalation, temporary expiry, policy lock/range/approval enforcement, rollout
scope tampering and retries, transfer double receipt, intercompany mapping absence,
royalty input tampering, export/AI/cache isolation, and worker races. Browser QA must
exercise unauthorized and partial-failure states without exposing identifiers or secrets.

## Residual assumptions

- Identity-provider protocol certification, statutory consolidation, authoritative FX,
  tax treatment, and franchise contract interpretation remain deployment-specific.
- A compromised tenant-wide administrator can perform operations they are explicitly
  authorized to perform; optional two-person approval and short-lived access reduce that
  risk but do not replace external governance.
- Infrastructure-level database or signing-key compromise is outside this application
  pass and requires platform backup, key management, monitoring, and penetration testing.
