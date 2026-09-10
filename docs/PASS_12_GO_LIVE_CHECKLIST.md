# Pass 12 Enterprise Go-Live Checklist

## Organization And Scope

- [ ] Confirm every legal entity and registration reference.
- [ ] Confirm brand, region, area, branch, warehouse, and commissary hierarchy.
- [ ] Confirm each branch and warehouse has exactly one intended enterprise node.
- [ ] Test group, region, franchise, and branch access with real pilot users.
- [ ] Test explicit deny and temporary assignment expiry.
- [ ] Review delegated-administration role and maximum-scope allowlists.
- [ ] Remove development/demo assignments from the pilot tenant.

## Screen, Route And Action Access

- [ ] Review every module row in the authoritative access matrix with security and operations.
- [ ] Test waiter, cashier, supervisor, branch, regional, franchise, finance, GM, and owner profiles.
- [ ] For each pilot profile verify visible tabs, absent tabs, direct URLs, direct APIs, permitted actions, and denied actions.
- [ ] Confirm branch users cannot climb to region/HQ or access sibling branches.
- [ ] Confirm region and franchise grants descend only into intended children.
- [ ] Confirm view, edit, approve, and sensitive permissions are assigned independently.
- [ ] Test an access change while the affected user is signed in and verify server-side effect immediately.
- [ ] Test temporary assignment expiry using server time.
- [ ] Review `ROLE_PERMISSIONS_CHANGED` and delegation audit events with reason and actor.

## Policies And Rollouts

- [ ] Approve policy definitions, schemas, values, and effective dates.
- [ ] Confirm locked, range, local, and approval-required behavior with pilot data.
- [ ] Test policy exceptions, two-person approval, expiry, and audit.
- [ ] Preview each rollout and verify target count/hash before confirmation.
- [ ] Confirm high-impact rollout approval is assigned to a different authorized person.
- [ ] Test worker retry, partial failure, and dead-letter operating procedure.
- [ ] Verify template versions contain references, never secret values.
- [ ] Verify a template update does not mutate adopted branches.

## Procurement And Transfers

- [ ] Load approved suppliers and effective supplier contracts.
- [ ] Test an unapproved supplier is blocked by the existing PO API.
- [ ] Verify item-specific UOM conversion for central requisition aggregation.
- [ ] Test central PO, direct-to-branch receiving, supplier invoice, and payable linkage.
- [ ] Configure source/destination legal entities for every cross-entity route.
- [ ] Configure due-from/due-to accounts and transfer-price policy references.
- [ ] Confirm unconfigured cross-entity transfer fails before inventory movement.
- [ ] Test dispatch, in-transit, partial receipt, final receipt, and duplicate retry.
- [ ] Verify damaged, rejected, and missing transfer quantities remain visible.
- [ ] Test lot/expiry transfer for commissary output.

## Franchise

- [ ] Confirm franchisee/franchisor entities, brand, branches, agreement reference, and dates.
- [ ] Confirm royalty, marketing levy, and other fee bases and rates with finance/legal advisers.
- [ ] Verify fee source facts, exclusions, currency, quality, and integer calculation.
- [ ] Do not use the management franchise statement as a statutory invoice.
- [ ] Configure settlement/allocation workflow before expecting an outstanding franchise balance.
- [ ] Review compliance check definitions and `UNKNOWN` evidence.
- [ ] Test suspension/termination history and access revocation.

## Finance And Reporting

- [ ] Confirm branch and legal-entity account mappings.
- [ ] Verify management aggregation labels on all HQ reports.
- [ ] Configure an authoritative FX source before enabling cross-currency monetary totals.
- [ ] Reconcile branch source facts to Pass 7 finance reports.
- [ ] Confirm audit retention, export retention, and approval evidence policy.
- [ ] Test scoped export after user permission revocation.

## Infrastructure And Security

- [ ] Run production authentication with development headers disabled.
- [ ] Confirm authoritative database, queue, secret store, HTTPS callback base, and signing keys.
- [ ] Apply schema migrations 13, 14 and 15 and verify checksums/report.
- [ ] Set a primary branch for every active user and review all `branches.switch` grants.
- [ ] Verify database backup and restore in staging.
- [ ] Test worker outage, restart, retry, and dead-letter recovery.
- [ ] Run cross-tenant, cross-region, cross-franchise, and privilege-escalation tests.
- [ ] Review rate limits for enterprise mutations and exports.
- [ ] Confirm support users receive only explicit, time-bounded scope.
- [ ] Verify logs and exports redact secrets and customer-sensitive fields.

## User Acceptance

- [ ] Validate HQ Command Centre at desktop, tablet, and mobile widths.
- [ ] Validate hierarchy search and scope switching with large pilot hierarchy.
- [ ] Validate policies, rollouts, templates, procurement, franchises, readiness, and audit screens.
- [ ] Train operators on preview, confirmation, approval, partial failure, and reversal procedures.
- [ ] Obtain finance, procurement, operations, security, and franchise pilot signoff.
- [ ] Record rollback owner, database restore point, and deployment version.

## Explicit Pilot Boundaries

- [ ] OIDC/SAML adapter selection and provider certification remain external deployment work.
- [ ] SCIM is not available.
- [ ] Statutory consolidated accounts are not available.
- [ ] Authoritative FX is not configured by Pass 12.
- [ ] Intercompany and royalty tax/legal conclusions require jurisdiction-specific review.
