# Pass 12 Completion Report

Date: 2026-09-09

Status: **PASS 12 COMPLETE**

## Validation Summary

| Gate                              | Result                                             |
| --------------------------------- | -------------------------------------------------- |
| Acceptance criteria               | 188/188 PASS                                       |
| Focused Pass 12 tests             | 90/90 PASS                                         |
| Full Pass 1-12 regression         | 446/446 PASS across 24 files                       |
| Database integration              | 19/19 PASS                                         |
| Concurrency/idempotency selection | 20 PASS, 73 intentionally skipped by name filter   |
| TypeScript                        | PASS - `tsc --noEmit`                              |
| Lint                              | PASS - 0 errors, 18 existing Fast Refresh warnings |
| Production client                 | PASS                                               |
| SSR                               | PASS                                               |
| Nitro/Cloudflare                  | PASS - `cloudflare-module` output generated        |
| Dependency audit                  | PASS - 0 production vulnerabilities                |
| Browser QA                        | PASS - 1440x900, 1024x768, 390x844, 360x800        |

## Required Completion Response

1. Acceptance criteria: 188/188 PASS.
2. Tests: 446/446 full regression; 90/90 focused Pass 12 including the named hierarchy-actor module/API matrix.
3. Historical Pass 1-11 regression: PASS within the 446-test run.
4. Historical DB coverage: retained; schema-version checks now expect migration 15.
5. TypeScript: PASS.
6. Lint: PASS, zero errors and 18 non-blocking existing Fast Refresh warnings.
7. Production client: PASS.
8. SSR: PASS.
9. Nitro/Cloudflare: PASS, `cloudflare-module` output generated.
10. Database tests: 19/19 PASS.
11. Concurrency/idempotency: 20 selected tests PASS.
12. Browser QA: PASS at desktop, tablet, and two mobile sizes; console clean.
13. Files created: listed in Implementation Inventory.
14. Files modified: listed in Implementation Inventory.
15. Migration: version 15; migration 13 adds 32 enterprise tables, migration 14 adds access revisioning and explicit view permissions, and migration 15 separates primary branch assignment from branch-switch authority.
16. Organization Hierarchy: server-authoritative closure-table hierarchy.
17. Legal Entities: distinct tenant-scoped legal/fiscal records.
18. Brands/Regions: configurable nodes with branch/warehouse relationships.
19. Scope Resolver: effective allow/deny, no upward privilege climb.
20. Enterprise RBAC: granular server permissions and scoped assignments.
21. Delegated Administration: possession, allowlist, and maximum-scope enforcement.
22. Temporary Access: effective-dated and server-expiring.
23. Policy Engine: versioned, effective-dated, traced resolution.
24. Policy Inheritance: deterministic child-to-ancestor resolution.
25. Policy Locks/Overrides: lock, range, approval, exception, and expiry enforced.
26. Central Menu: existing authoritative catalog retained.
27. Central Pricing: existing branch price settings plus controlled rollout.
28. Recipe Governance: Pass 6 recipe service enforces central locks.
29. Rollouts: preview, hash confirmation, approval, durable claim, per-target result.
30. Branch Templates: immutable versions, previewed adoption, and atomic new-branch provisioning.
31. Central Procurement: approved requisition aggregation using Pass 6 UOM/procurement.
32. Supplier Contracts: effective-dated scoped terms and price data.
33. Central Warehouse: existing inventory warehouse model retained.
34. Inter-Branch Transfers: staged dispatch/receipt with visible variance and lot evidence.
35. Intercompany Foundation: fail-closed mapping boundary; no invented tax/statutory treatment.
36. Central Kitchen/Commissary: Pass 6 production ledger plus staged distribution.
37. Franchise Model: separate legal parties, brand, branches, agreement, lifecycle.
38. Royalties: deterministic configured basis/rate with source facts and quality.
39. Marketing/Other Fees: distinct configured fee definitions.
40. Franchise Compliance: deterministic evidence with UNKNOWN for missing facts.
41. HQ Command Centre: scoped management KPIs, readiness, rollout, and exception views.
42. Branch Benchmarking: deterministic metrics with data quality.
43. Enterprise Finance: attributed management aggregation only.
44. Multi-Currency Handling: separate totals unless authoritative FX is configured.
45. Payment/Provider Governance: existing Pass 2/4 connections, scopes, and secrets retained.
46. CRM/Loyalty Governance: existing Pass 10 domains retained behind enterprise scope.
47. Document/Device Governance: inherited policies/readiness without exposing credentials.
48. Enterprise Readiness: evidence-backed worker-calculated states.
49. Enterprise Audit: scoped filtering, append-only material change history, export.
50. Bulk Actions: live price rollout only; generic foundation is not called implemented.
51. Exception Workflows: requested, reviewed, approved/rejected/revoked, expired, audited.
52. AI Integration: read-only scoped enterprise evidence with financial labeling.
53. Workers: durable rollout, policy maintenance, fee, readiness, and export jobs.
54. Performance: 500-branch local fixture; measurements below.
55. Security: zero open P0/P1; dedicated review exists.
56. Hardcode Audit: CLEAN for Pass 12 production logic.
57. Known Limitations: SSO boundary-only, SCIM required, no statutory consolidation/FX.
58. Pilot/Launch Blockers: infrastructure, identity, legal/accounting, and operational certification listed below.

## Acceptance Matrix

1. PASS - Pass 1-11 historical regression passes.
2. PASS - Historical database suites remain included.
3. PASS - The authenticated tenant boundary is unchanged.
4. PASS - Organisation hierarchy is authoritative server data.
5. PASS - A tenant with one branch still resolves normally.
6. PASS - Group, brand, region, area, branch, warehouse, and commissary hierarchy works.
7. PASS - Legal entity, brand, and operational branch remain distinct.
8. PASS - Scope resolution is deterministic through the closure table and effective assignments.
9. PASS - Group permission descends only when configured.
10. PASS - Branch permission does not climb upward.
11. PASS - Franchise scope cannot read another franchise relationship.
12. PASS - Regional scope cannot read another region.
13. PASS - Branch scope cannot read HQ-only data.
14. PASS - Delegated administrators cannot grant undelegated authority.
15. PASS - Temporary access expires using server time.
16. PASS - An authorized GM can grant branch-scoped access.
17. PASS - Policy inheritance resolves from target to ancestors.
18. PASS - Locked policy cannot be overridden.
19. PASS - Explicitly allowed override works.
20. PASS - Range override rejects an out-of-range value.
21. PASS - Approval-required override requires a valid approved exception.
22. PASS - Policy trace identifies every considered scope and source.
23. PASS - Effective-dated policy activates at the correct time.
24. PASS - Append-only versions preserve policy history.
25. PASS - Feature flags do not bypass enterprise policy.
26. PASS - AI evidence cannot bypass policy or execute a mutation.
27. PASS - Central menu governance reuses the authoritative menu catalog.
28. PASS - Menu rollout updates branch settings without duplicating catalog items.
29. PASS - Branch menu activation is policy governed.
30. PASS - Central pricing reuses authoritative branch price settings.
31. PASS - Fixed/locked price cannot be changed locally.
32. PASS - Allowed local price works.
33. PASS - Price range enforcement works.
34. PASS - Price proposal/exception approval works with audit history.
35. PASS - Price rollout preview reports the exact target set.
36. PASS - Price rollout retries are idempotent.
37. PASS - Per-branch failures produce PARTIAL rather than false success.
38. PASS - A failed branch remains visible as failed.
39. PASS - Central recipe governance uses the Pass 6 recipe model.
40. PASS - Recipe lock is enforced inside the existing recipe service.
41. PASS - Recipe local override requires the configured policy path.
42. PASS - Supplier policy is inherited.
43. PASS - Locked approved-supplier list is enforced in existing PO creation.
44. PASS - Existing branch requisition workflow remains operational.
45. PASS - Requisition aggregation normalizes item-specific UOM exactly.
46. PASS - Central PO remains the existing procurement engine.
47. PASS - Central receiving remains the existing inventory ledger.
48. PASS - Warehouse transfer uses append-only movements.
49. PASS - Dispatch creates an in-transit shipment.
50. PASS - Destination stock does not increase at dispatch.
51. PASS - Partial transfer receipt works.
52. PASS - Missing, damaged, and rejected quantities remain visible.
53. PASS - Duplicate transfer receipt is idempotent and DB-capped.
54. PASS - Same-entity transfer is classified separately from intercompany.
55. PASS - Cross-entity transfer requires effective intercompany configuration.
56. PASS - Missing intercompany configuration blocks before source movement.
57. PASS - Central kitchen continues to use the Pass 6 production ledger.
58. PASS - Prepared inventory can use the staged transfer path.
59. PASS - Production distribution preserves configured lot and expiry evidence.
60. PASS - Franchise relationship is tenant scoped.
61. PASS - Franchisee isolation is enforced.
62. PASS - Royalty configuration is stored data.
63. PASS - Royalty calculation uses authoritative sales facts and integer arithmetic.
64. PASS - Royalty rate is not hardcoded.
65. PASS - Royalty quality reflects incomplete data.
66. PASS - Marketing levy is a distinct fee type.
67. PASS - Fixed and other fees are configuration driven.
68. PASS - Franchise statement is explicitly a management statement, not a statutory invoice.
69. PASS - Compliance checks are deterministic.
70. PASS - Missing compliance evidence is UNKNOWN, not compliant.
71. PASS - Franchise exceptions feed the existing Action Centre.
72. PASS - Branch template versions are immutable.
73. PASS - Publishing a template does not mutate an adopted branch.
74. PASS - A new branch can be provisioned atomically from a published template.
75. PASS - Provisioned branch setup/readiness remains owned by Pass 8.
76. PASS - Existing-branch template adoption requires preview hash.
77. PASS - HQ overview exposes authorized setup/readiness states.
78. PASS - HQ Command Centre respects effective scope.
79. PASS - Group KPI uses existing daily finance facts.
80. PASS - Branch benchmarking is deterministic.
81. PASS - Missing benchmark data remains visible through quality state.
82. PASS - Region targets inherit through effective-dated hierarchy.
83. PASS - Branch target override obeys lock/range/approval state.
84. PASS - Multi-entity management aggregation retains attribution and labeling.
85. PASS - Management aggregation is not claimed as statutory consolidation.
86. PASS - Mixed currencies are not silently aggregated without an FX basis.
87. PASS - HQ payment visibility requires read permission.
88. PASS - Enterprise views do not expose drawer mutation operations.
89. PASS - Payment/provider credentials remain in the server secret boundary.
90. PASS - Provider credential scope is configuration data.
91. PASS - Marketplace capability and outbox architecture is unchanged.
92. PASS - Customer data remains tenant/permission scoped.
93. PASS - Franchise scope cannot access unauthorized group CRM facts.
94. PASS - Loyalty scope remains configured in the existing CRM/loyalty domain.
95. PASS - Campaign governance continues to enforce consent.
96. PASS - Document policy can inherit through the enterprise policy engine.
97. PASS - Device requirements feed readiness evidence.
98. PASS - Missing device evidence remains UNKNOWN.
99. PASS - Security policy inherits through the same locked policy path.
100. PASS - Enterprise SSO is honestly reported as boundary-only.
101. PASS - No live SAML/OIDC/SCIM capability is fabricated.
102. PASS - Enterprise export requires explicit authorized scope.
103. PASS - Cross-region export fails without scope.
104. PASS - Export field allowlists and redaction exclude secrets.
105. PASS - Enterprise audit is tenant scoped.
106. PASS - Audit actor, branch, domain, action, time, and correlation filters work.
107. PASS - Bulk rollout requires permission.
108. PASS - Bulk rollout requires preview and confirmation.
109. PASS - Bulk rollout records explicit target branches.
110. PASS - Bulk retry is idempotent.
111. PASS - Two-person approval works for configured high-impact rollout.
112. PASS - Branch exception request works.
113. PASS - Exception approval is independently audited.
114. PASS - Exception expiry is server/durable-worker driven.
115. PASS - Operating-standard compliance uses stored evidence.
116. PASS - Enterprise readiness calculation is deterministic.
117. PASS - Readiness blockers carry evidence and remediation text.
118. PASS - Enterprise exceptions appear in existing manager actions.
119. PASS - AI HQ query is limited to authorized group scope.
120. PASS - AI regional query is limited to authorized region scope.
121. PASS - AI franchise query cannot cross franchise scope.
122. PASS - AI labels management aggregation and statutory limitation.
123. PASS - AI has no royalty mutation capability.
124. PASS - AI has no rollout approval capability.
125. PASS - AI has no policy override capability.
126. PASS - Policy maintenance worker is idempotent.
127. PASS - Rollout claiming/retry/dead-letter path is durable and idempotent.
128. PASS - Franchise fee recalculation is idempotent by period/source hash.
129. PASS - Readiness recalculation worker uses the durable queue.
130. PASS - Persisted export authorization fingerprints include effective scope.
131. PASS - No cross-scope reusable enterprise result cache exists.
132. PASS - Concurrent policy creation is protected by constraints and immutable versions.
133. PASS - Policy override race resolves against current effective state.
134. PASS - Concurrent transfer receipt cannot exceed dispatch or duplicate movement.
135. PASS - Concurrent rollout claims produce one branch effect.
136. PASS - Cross-tenant hierarchy access fails.
137. PASS - Cross-entity unauthorized access fails.
138. PASS - Cross-brand unauthorized access fails.
139. PASS - Cross-region unauthorized access fails.
140. PASS - Cross-branch unauthorized access fails.
141. PASS - Franchise-to-franchise access fails.
142. PASS - Delegated administration escalation fails.
143. PASS - Policy lock bypass fails.
144. PASS - Rollout target tampering fails.
145. PASS - Intercompany safety boundary cannot be bypassed.
146. PASS - Client-supplied royalty amount cannot replace authoritative facts.
147. PASS - Export leakage tests fail closed.
148. PASS - AI scope leakage tests fail closed.
149. PASS - Secret-like template values and export fields are rejected/redacted.
150. PASS - TypeScript passes.
151. PASS - Lint passes with zero errors.
152. PASS - Full test suite passes.
153. PASS - Database integration tests pass.
154. PASS - Concurrency/idempotency tests pass.
155. PASS - Production client build passes.
156. PASS - SSR build passes.
157. PASS - Nitro Cloudflare-module build passes.
158. PASS - Desktop browser QA passes at 1440x900.
159. PASS - Tablet browser QA passes at 1024x768.
160. PASS - Mobile browser QA passes at 390x844 and 360x800.
161. PASS - Browser console is clean.
162. PASS - No page-level horizontal overflow was observed.
163. PASS - Representative 500-branch performance fixture executes.
164. PASS - Security review has no open P0/P1.
165. PASS - Production hardcode audit is clean.
166. PASS - Enterprise threat model exists.
167. PASS - Enterprise architecture documentation exists.
168. PASS - Go-live checklist exists.
169. PASS - This completion report exists.
170. PASS - Unsupported capabilities and launch dependencies are disclosed below.
171. PASS - One authoritative registry defines every major staff module.
172. PASS - Navigation visibility uses the registry's explicit navigation requirement.
173. PASS - Direct staff URL access independently enforces route permission.
174. PASS - Server data retrieval independently enforces current read permission and scope.
175. PASS - Enterprise API actions independently enforce create, edit, approve, or sensitive authority.
176. PASS - View, create, edit, approve, and sensitive permissions remain separate decisions.
177. PASS - Edit authority does not imply approval or destructive authority.
178. PASS - Branch actors operate only assigned/effective descendant branches.
179. PASS - Regional authority descends only through authorized hierarchy nodes.
180. PASS - Franchise authority cannot cross into another franchise scope.
181. PASS - Branch authority cannot climb to region, legal entity, group, or HQ.
182. PASS - Delegated administrators cannot add or remove authority outside their grant boundary.
183. PASS - Role templates provide defaults; role names are not authorization inputs.
184. PASS - Permission and scope changes increment a server access revision and refresh cached UI decisions.
185. PASS - Temporary access is evaluated and expires using server time.
186. PASS - Role-permission and enterprise-delegation changes retain authoritative audit evidence.
187. PASS - Actor-class tests cover navigation, direct route, direct API, allowed action, and denied action behavior.
188. PASS - Entitlement, feature flag, and enterprise policy remain independent access constraints.

## Implementation Inventory

### Files Created

- `migrations/0013_enterprise_franchise_hq.sql`
- `migrations/0014_enterprise_module_access.sql`
- `migrations/0015_branch_context_authority.sql`
- `migrations/seed/pass12-demo.sql`
- `src/enterprise/types.ts`
- `src/enterprise/schemas.ts`
- `src/enterprise/enterprise-service.ts`
- `src/enterprise/use-enterprise.ts`
- `src/enterprise/pass-12-enterprise.test.ts`
- `src/enterprise/pass-12-load.test.ts`
- `src/server/enterprise-api.ts`
- `src/server/module-access-service.ts`
- `src/server/module-access-service.test.ts`
- `src/platform/module-access-registry.ts`
- `src/platform/module-access-registry.test.ts`
- `src/components/app/RouteAccessBoundary.tsx`
- `src/routes/enterprise.tsx`
- `docs/PASS_12_ENTERPRISE_FRANCHISE_HQ.md`
- `docs/PASS_12_ENTERPRISE_THREAT_MODEL.md`
- `docs/PASS_12_SECURITY_REVIEW.md`
- `docs/PASS_12_HARDCODE_AUDIT.md`
- `docs/PASS_12_GO_LIVE_CHECKLIST.md`
- `docs/PASS_12_COMPLETION_REPORT.md`
- `docs/ENTERPRISE_MODULE_ACCESS_MATRIX.md`

### Files Modified For Pass 12

- `package.json`
- `src/components/app/nav.ts`
- `src/components/app/AppShell.tsx`
- `src/lib/app-context.tsx`
- `src/routeTree.gen.ts`
- `src/lib/seramet-api.ts`
- `src/routes/__root.tsx`
- `src/routes/settings.tsx`
- `src/routes/enterprise.tsx`
- `src/server/configuration-api.ts`
- `src/server/operations-api.ts`
- `src/platform/permissions.ts`
- `src/server/workers.ts`
- `src/server/database/local-development-database.ts`
- `src/server/database/sqlite-test-adapter.ts`
- `src/inventory/types.ts`
- `src/inventory/schemas.ts`
- `src/inventory/inventory-intelligence-service.ts`
- `src/inventory/pass-6-inventory-intelligence.test.ts`
- `src/intelligence/types.ts`
- `src/intelligence/query-planner.ts`
- `src/intelligence/evidence-tools.ts`
- `src/intelligence/intelligence-service.ts`
- `src/intelligence/pass-9-intelligence.test.ts`
- Pass 5-12 test files whose schema-version assertion moved to 15.

The formatter also normalized source files to the repository's configured CRLF/Prettier policy;
those edits are formatting-only and do not change domain behavior.

## Migration 13

Migration 13 adds 32 authoritative tables spanning legal entities, hierarchy/closure, scoped role
assignment, delegation, policy definitions/assignments/versions/exceptions/events, templates,
rollouts/events/items, supplier contracts, requisition aggregation, staged transfer shipments and
normalized receipt lines, intercompany configuration, franchise relationships/branches/fees/
periods/compliance, metric targets, readiness, exports, and bulk-operation foundation.

It adds source lot/number/expiry columns to transfer lines, query indexes for effective scopes and
worker queues, unique rollout-event constraints, append-only triggers for policy/template/target/
event history, a transfer receipt quantity cap, atomic source-lot validation/consumption, posted-fee
immutability, and hierarchy cycle prevention.

## Migration 14

Migration 14 adds `access_control_revisions`, explicit read/navigation permission codes, and a
compatibility backfill from prior coarse permissions. Database triggers advance the tenant revision
when role permissions, user roles, branch assignments, enterprise role assignments, or delegated
administration policies are inserted, changed, or removed. The authoritative role-permission API
replaces a role set atomically and writes the added/removed codes and reason to the audit log.

## Architecture And Operational Traces

### Scope And Policy

Authenticated actor -> tenant/branch permissions -> enterprise node closure -> effective allow/deny
assignment -> inherited policy trace -> existing domain command. A branch grant cannot climb; a
deny removes access beneath an otherwise allowed ancestor.

### Controlled Rollout

Rollout request -> authoritative target preview -> target hash -> explicit confirmation -> optional
independent approval -> durable claim -> policy/target revalidation -> idempotent per-branch update ->
COMPLETE/PARTIAL/FAILED with append-only events.

### Branch Provisioning

Published template -> validated operating profile -> explicit brand/legal entity/parent/timezone/
currency -> one DB batch creates branch + operating profile + hierarchy node/closure + immutable
template assignment -> Pass 8 readiness owns remaining go-live checks. Retry returns the same branch.

### Staged Inventory Transfer

Dispatch -> cross-entity configuration check -> source lot validation -> one TRANSFER_OUT -> shipment
IN_TRANSIT -> partial/final receipt -> accepted quantity TRANSFER_IN -> destination lot with retained
expiry -> variance retained. Destination stock never increases before receipt.

### Franchise Fee

Effective fee definition -> authoritative daily sales facts -> configured basis/exclusions -> integer
basis-point/fixed calculation -> source hash and quality -> management fee period -> management
statement. No bank payment, statutory invoice, or tax treatment is invented.

## Capabilities And Limitations

- OIDC: `BOUNDARY_ONLY`.
- SAML: `BOUNDARY_ONLY`.
- SCIM: `SPEC_REQUIRED`.
- Statutory consolidation: `NOT_SUPPORTED`.
- Authoritative FX conversion: `NOT_CONFIGURED`; mixed currencies remain separate.
- Intercompany tax, transfer-pricing legality, and statutory journal treatment require configured,
  jurisdiction-specific implementation.
- Franchise statements are management statements. Authoritative invoice/payment allocation remains
  outside this pass.
- `enterprise_bulk_operations` is a forward-compatible foundation. Price rollout is the only live
  bulk mutation and it uses preview, confirmation, approval, audit, and durable execution.

## Performance

Representative local fixture: 500 branches, 511 nodes, 500 daily metrics, and 500 readiness rows.

- Hierarchy: 9.18 ms
- Dashboard: 12.00 ms
- Policy resolution: 3.43 ms
- Overview: 14.59 ms

These are local test measurements, not production capacity claims.

## Pilot And Launch Blockers

No open software P0/P1 remains in Pass 12. Before the first enterprise/franchise pilot:

1. Deploy migrations 13 and 14 to staging and production with backup/restore and rollback rehearsal.
2. Configure real legal entities, hierarchy, delegated scopes, policies, accounts, and currencies.
3. Obtain legal/accounting approval for franchise fees, intercompany treatment, tax, and documents.
4. Configure and certify an external identity provider if SSO is required; SCIM remains unavailable.
5. Validate production D1, queue, worker, audit retention, export storage, alerts, and disaster recovery.
6. Run deployment-specific penetration testing and authorization review.
7. Pilot branch templates and staged transfers with real hardware, lot policy, and operating data.

## Final Decision

Pass 12 meets all 188 acceptance criteria while keeping unsupported external and statutory
capabilities explicit. It is complete as an application pass; the listed environment, legal,
accounting, provider, and operational certification tasks remain before a live enterprise pilot.
