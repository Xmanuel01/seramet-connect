# Pass 7 Go-Live Checklist

## Finance configuration

- [ ] Inventory account mappings exist for every perpetual-accounting branch.
- [ ] COGS, marketplace commission, payment-processing fee, delivery-fee and operating-expense reporting categories are configured on tenant accounts.
- [ ] Finance has reconciled inventory subledger value to the configured inventory GL account.
- [ ] Inventory/GL tolerance is approved and stored as an effective threshold; zero is used only when exact matching is required.
- [ ] Finance has signed off the flash P&L definition, service-charge handling and tax exclusion.

## Targets and actions

- [ ] Daily/monthly sales, food cost, labour cost, wastage, prep time, margin and inventory variance targets are effective dated.
- [ ] Tenant defaults and required branch overrides have been reviewed.
- [ ] Threshold comparison, severity, tolerance and reopen interval are configured per policy.
- [ ] Action ownership/assignment policy is documented for each severity.
- [ ] Managers can acknowledge, investigate and resolve actions with an audit reason.

## Access control

- [ ] `management.view` is assigned only to intended operational viewers.
- [ ] `management.finance.view` is restricted to authorized finance/management users.
- [ ] `management.actions.manage` and `management.targets.manage` are separately approved.
- [ ] User branch assignments and all-branch permission have been tested by direct API calls.
- [ ] Production bearer authentication, session revocation and trusted-device policy from Pass 5 are active.

## Operational data quality

- [ ] Channel definitions identify channel type and, where relevant, provider connection.
- [ ] Provider commission, fee, delivery and settlement records are normalized into Pass 3/4 tables.
- [ ] Labour rates and attendance timestamps are complete for the pilot branches.
- [ ] Stations and prep targets are configured; KDS timestamps are being persisted.
- [ ] Supplier receipt, rejection, expected/received timing and invoice-match history is sufficient.
- [ ] Pass 6 recipe and theoretical-cost coverage has been reviewed for all material menu sales.
- [ ] Missing-data quality states are accepted by management; no team treats them as zero.

## Close readiness

- [ ] Reconciliation, settlement, refund, stock-count, supplier-invoice and worker blockers match local close policy.
- [ ] Managers understand this screen is advisory and cannot close/reopen an accounting period.
- [ ] Closed-period protections and authorized reopen audit have been retested.
- [ ] Failed/dead-letter job escalation has an operational owner.

## Workers and operations

- [ ] Migration 0008 is applied and schema version 8 is reported by readiness.
- [ ] Durable queue and worker health are green.
- [ ] Hourly management recalculation and event-driven branch recalculation have executed successfully.
- [ ] Duplicate recalculation delivery has been tested without duplicate actions/read models.
- [ ] Management API latency and database aggregate timings have been measured in staging with representative data.

## Pilot signoff

- [ ] Finance validates one daily branch metric against invoices, refunds and posted journals.
- [ ] Kitchen validates one station P50/P90 trace against persisted KDS timestamps.
- [ ] Procurement validates one supplier lead-time/fill-rate/price-variance trace.
- [ ] Management validates one food-cost bridge and its unexplained remainder.
- [ ] Owner validates branch comparison scope and insufficient-data behavior.
- [ ] Desktop 1440x900, tablet 1024x768 and mobile 390x844 show no page-level overflow or console error.
- [ ] Backup/restore, security, monitoring and rollback checks from the Pass 5 production checklist remain green.
