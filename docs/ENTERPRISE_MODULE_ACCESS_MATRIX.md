# Enterprise Module Access Matrix

## Purpose

Seramet has one authoritative module registry in
`src/platform/module-access-registry.ts`. It is shared by navigation, staff-route guards,
server data APIs, enterprise API actions, and the role-access editor. Role names are display and
template data; they are never authorization inputs.

Effective access is evaluated in this order:

```text
server-authenticated permissions
  + effective hierarchy scope
  + active commercial entitlement
  + tenant feature flag
  + effective enterprise module policy
  = navigation, route, read, create, edit, approve and sensitive decisions
```

Passing one layer does not bypass another. Navigation visibility is only a user-experience result.
The route boundary evaluates route access independently, and server APIs evaluate data/action
access again using current database state.

## Registry Contract

Every registered module has:

- a stable module key and display label;
- separate navigation and route permission requirements;
- `READ`, `CREATE`, `EDIT`, `APPROVE`, and `SENSITIVE` action requirements;
- supported organizational node types;
- an optional feature entitlement and feature flag;
- an enterprise policy code;
- exact staff routes and optional bounded route prefixes.

Requirements may be one permission, all listed permissions, any listed permission, or not
applicable. A not-applicable action is denied.

## Registered Modules

| Area           | Module keys                                                                                                                                       | Scope class                                                       | Optional commercial gate                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Service        | `dashboard`, `pos`, `orders`, `invoices`, `receipts`, `payments`                                                                                  | Branch hierarchy                                                  | None                                            |
| Guest          | `guest-operations`, `delivery`                                                                                                                    | Branch hierarchy                                                  | None                                            |
| Kitchen        | `kitchen`, `production`, `cost-control`                                                                                                           | Branch/stock hierarchy                                            | None                                            |
| Stock          | `inventory`, `warehouses`, `transfers`, `procurement`                                                                                             | Branch, warehouse, commissary                                     | None                                            |
| Customer       | `crm`, `loyalty`, `marketing`                                                                                                                     | Branch hierarchy                                                  | `crm.enabled` feature flag                      |
| People         | `staff`                                                                                                                                           | Branch hierarchy                                                  | None                                            |
| Finance        | `finance`, `accounting`, `reports`, `management`, `audit`                                                                                         | Branch hierarchy                                                  | None                                            |
| Administration | `users`, `setup`, `hardware`, `integrations`                                                                                                      | Branch hierarchy                                                  | None                                            |
| Intelligence   | `ai`                                                                                                                                              | Branch hierarchy                                                  | `intelligence.basic` and `intelligence.enabled` |
| Enterprise     | `hq-command`, `organization`, `franchises`, `policies`, `rollouts`, `central-procurement`, `compliance`, `enterprise-finance`, `enterprise-audit` | Group, legal entity, brand, region or area as declared per module | None                                            |

The source registry is the normative per-module permission matrix. The Settings screen renders that
same registry rather than maintaining a second page-role list.

## Organizational Scope

Branch-scoped modules accept authorized branch descendants. Inventory modules additionally support
warehouse and commissary nodes. HQ modules exclude branch-only authority. Effective-dated
`enterprise_role_assignments`, closure-table descendants, explicit denies, and branch assignments
produce the scope set. Authority never climbs from branch to region, brand, legal entity, or group.

An all-branch permission provides compatibility for tenants that have not yet provisioned enterprise
hierarchy nodes. It does not create cross-tenant authority.

Branch context is additionally constrained by `user_primary_branches` and `branches.switch`.
`scope.branches.all` grants broad reporting scope but does not independently allow a user to switch
the active operating branch. See `docs/BRANCH_CONTEXT_ACCESS.md`.

## Delegation And Change Propagation

Role permission writes use the server endpoint
`PUT /api/seramet/access/roles/:roleId/permissions`. The database transaction replaces the role set,
writes an audit event with added/removed codes and reason, and increments the tenant access revision.

Actors with explicit `enterprise.access.manage` authority may manage the tenant permission catalog.
Other role administrators may add or remove only permissions they themselves hold. Scoped
enterprise assignments remain subject to the existing delegated role/permission allowlists and
maximum organizational scope. Configuration imports apply the same changed-permission constraint.

Database triggers increment `access_control_revisions` for role permissions, user-role links,
user-branch links, enterprise role assignments, and delegated administration changes, including
deletion. Staff sessions refresh on revision change and window focus. Every API request still loads
current server permissions, so a stale browser decision cannot authorize server data or mutation.

## Enforcement Surfaces

- `getVisibleNavGroups` filters sidebar items through registry navigation decisions.
- `RouteAccessBoundary` independently rejects direct staff-route access.
- paged operational APIs require the corresponding module `READ` decision.
- enterprise APIs map endpoints and HTTP methods to module action decisions before domain service
  permission and hierarchy checks.
- screen controls use action decisions for sensitive actions, including enterprise audit export.
- existing domain services retain their more specific permission, branch, tenant, state-machine,
  idempotency, and audit checks.

## Validation Matrix

Automated tests cover waiter/service, branch manager, regional, franchise, finance, and group/HQ
profiles. They verify expected navigation, prohibited navigation, direct route denial, direct API
denial, action separation, entitlement/feature denial, policy denial, temporary expiry, revision
invalidation, constrained permission changes, audit evidence, and absence of role-name authority.

The registry coverage test fails if a staff route or navigation target is introduced without a
module definition. Guest/public routes remain governed by the separate Pass 11 guest security
boundary.

## Operational Rule

Changing a checkbox changes a role default, not an unconditional grant. Effective access can still
be denied by organizational scope, entitlement, feature state, or enterprise policy. Pilot access
must therefore be tested with real users at each hierarchy level, including a direct URL and direct
API request, before go-live.
