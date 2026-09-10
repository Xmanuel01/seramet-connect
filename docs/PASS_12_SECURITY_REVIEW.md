# Pass 12 Security Review

Date: 2026-09-09

## Result

No open P0 or P1 finding was identified in the implemented Pass 12 surface. This review covers
the enterprise hierarchy, delegated administration, policies, rollouts, templates, central
procurement, staged transfers, franchise calculations, exports, evidence tools, workers, and the
Enterprise staff UI. It does not certify an external identity provider, a statutory consolidation
engine, or jurisdiction-specific intercompany tax treatment.

## Reviewed Trust Boundaries

- Browser to authenticated enterprise API.
- Authenticated actor to tenant, branch, and enterprise-node scope resolution.
- Delegated administrator to role and scope grants.
- Policy author to inherited branch behavior.
- Rollout creator, confirmer, approver, and durable worker.
- Source warehouse dispatch to destination warehouse receipt.
- Franchise fact inputs to management fee statements.
- Enterprise export request to durable export result.
- Pass 9 intelligence request to scoped evidence query.
- Sidebar and direct staff route to the authoritative module-access decision.
- Module-access editor to audited server role-permission replacement and cache revisioning.

## Findings

| Severity | Status | Finding                                                | Evidence / treatment                                                                                                                                                               |
| -------- | ------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | CLOSED | Cross-tenant enterprise access                         | Authenticated tenant scope is injected server-side; tenant-qualified foreign keys and repository predicates reject cross-tenant references.                                        |
| P0       | CLOSED | Rollout target or policy tampering                     | Confirmation binds the target hash; execution recomputes target and policy watermarks and rejects drift.                                                                           |
| P0       | CLOSED | Transfer double receipt or premature destination stock | Dispatch removes source only; receipt lines are idempotent and DB-capped; accepted quantity alone creates destination movement.                                                    |
| P0       | CLOSED | Franchise fee manipulation through client totals       | Fee periods derive from authoritative daily sales facts using integer minor units/basis points and persist their source hash.                                                      |
| P1       | CLOSED | Delegated administration escalation                    | Grantor possession, role allowlists, permission allowlists, maximum scope type, effective dates, and explicit deny are enforced server-side.                                       |
| P1       | CLOSED | Policy lock bypass                                     | Effective inherited lock/range/approval state is enforced by enterprise services and the existing pricing, recipe, and procurement commands.                                       |
| P1       | CLOSED | Unauthorized bulk execution                            | Rollouts require manage permission, explicit scope preview, confirmation hash, optional independent approval, conditional claim, and idempotent branch items.                      |
| P1       | CLOSED | Enterprise export leakage                              | Export types and fields are allowlisted, rows are bounded, authorization fingerprints include current scope, and workers rehydrate current authorization.                          |
| P1       | CLOSED | AI cross-scope disclosure or mutation                  | Enterprise evidence requires the underlying permission and scope. Intelligence remains read-only and labels management aggregation limitations.                                    |
| P1       | CLOSED | Secret disclosure                                      | Templates reject credential-like values, exports use field allowlists, and provider secrets remain behind the Pass 5 server secret boundary.                                       |
| P1       | CLOSED | Hidden-tab authorization bypass                        | Every staff route is registered and independently guarded; operational and enterprise APIs re-evaluate current permission, hierarchy scope, entitlement, feature and policy state. |
| P1       | CLOSED | Role-permission escalation or stale access             | Non-enterprise administrators cannot add or remove permissions they do not hold; writes are atomic/audited and database triggers increment the tenant access revision.             |

## Control Review

### Authentication And Authorization

All enterprise routes use `authenticateSerametRequest`. Tenant IDs, permissions, branches, and
session identity are derived from validated server identity. Enterprise access adds node-scoped,
effective-dated allow/deny assignments without weakening Pass 5 branch authorization. Permission
checks are server-side; navigation visibility is convenience only.

The module registry coverage test fails when a staff route or sidebar destination has no declared
access boundary. Separate action permissions permit read-only access without create, edit, approve,
or sensitive authority. Role display names are not inputs to any registry decision.

### Delegation

A delegated administrator cannot grant a role whose permissions exceed their own. Active delegated
policy must cover the requested node, role, permission set, and maximum scope type. Branch scope
does not climb to parent, region, legal entity, or group scope. Temporary grants expire against
server time.

### Change Control

Policy versions, rollout events, exception events, and metric targets are append-only. High-impact
rollouts support two-person approval and prohibit creator self-approval. Target and policy changes
between preview and execution invalidate the rollout. Posted franchise fee periods remain
immutable except through explicit follow-up workflow.

### Inventory And Intercompany

Transfer dispatch and receipt use the existing append-only Pass 6 inventory movement ledger.
Database constraints prevent receipt quantities from exceeding dispatch. Source lot ownership,
item identity, status, and remaining quantity are validated. Cross-entity dispatch fails closed
without effective configured due-from/due-to account mappings and a transfer-price policy
reference. Tax and statutory postings are not inferred.

### Exports And Evidence

Exports have an explicit node scope, allowlisted fields, a maximum row count, an authorization
fingerprint, redaction, durable generation, and current-auth revalidation. Enterprise AI tools use
the same scope resolver and factual management read models; no mutation capability is exposed.

## Security Test Coverage

Focused tests cover tenant/branch/region/franchise isolation, explicit deny, delegated escalation,
temporary access expiry, lock/range/approval enforcement, target tampering, duplicate rollout,
concurrent transfer receipt, missing intercompany configuration, export authorization/redaction,
AI evidence scoping, immutable history, idempotent workers, route registry completeness, actor-class
navigation, direct route/API denial, action separation, entitlement/policy denial, access revision
invalidation, and audited permission replacement.

## Residual Risks And External Work

- OIDC and SAML are adapter boundaries only. Configure and certify a real provider before enabling
  enterprise federation.
- SCIM is `SPEC_REQUIRED`; no directory provisioning endpoint is presented as live.
- A production penetration test and deployment-specific authorization review remain required.
- Jurisdiction-specific franchise documents, intercompany tax, transfer pricing, and statutory
  consolidation require qualified accounting/legal implementation outside this pass.
- Production alert routing, retention, backups, and disaster recovery must be verified in the pilot
  environment using the Pass 5 deployment controls.

## Severity Conclusion

Open P0: 0. Open P1: 0. The residual items above are certification, infrastructure, or explicitly
unsupported capability boundaries rather than hidden live implementations.
