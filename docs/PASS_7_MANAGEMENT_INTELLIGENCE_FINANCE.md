# Pass 7 - Management Intelligence, Restaurant Finance and Multi-Branch Control

## Scope

Pass 7 adds recalculable management read models over the authoritative Pass 3-6 order, invoice, payment, settlement, journal, inventory, procurement, production and attendance records. It does not introduce another order, accounting or inventory ledger. Browser code reads server models and sends authenticated commands; it never computes an authoritative management result.

## Data flow

```text
Authoritative commands and provider events
  -> Pass 3-6 transaction tables
  -> durable MANAGEMENT_INTELLIGENCE_RECALCULATION job
  -> ManagementIntelligenceService
  -> daily and period read models
  -> persisted management actions / approval projections
  -> authenticated management API
  -> existing Seramet routes
```

Transaction mutations enqueue one tenant/branch recalculation with an idempotency key. Inventory recalculation also enqueues the affected management recalculation. An hourly scheduled job provides recovery for events that were not directly linked. Worker jobs retain the Pass 5 claim, retry and dead-letter semantics.

## Schema

Migration `0008_management_intelligence_finance.sql` adds 16 tenant-scoped tables:

- Configuration: `metric_threshold_policies`, `branch_targets`.
- Operations: `management_actions`, append-only `management_action_events`, `approval_inbox_items`, `management_recalculation_events`.
- Daily facts: `daily_branch_metrics`, `daily_channel_metrics`, `daily_station_metrics`, `daily_staff_metrics`, `daily_supplier_metrics`, `daily_menu_item_metrics`.
- Finance/control: `financial_summary_periods`, `inventory_gl_reconciliations`, `close_readiness_snapshots`, `branch_health_snapshots`.

Seventeen indexes cover branch/date, effective configuration, action queues, approvals and recalculation work. Triggers prohibit management-action event updates/deletes and action deletion. All money is stored as integer currency minor units, ratios as integer basis points, inventory quantities as Pass 6 integer micro-units, and duration as integer milliseconds/minutes.

## Financial formulas

- `net sales = gross sales - discounts - confirmed refunds`.
- `net revenue = net sales`; tax and service charge remain separately reported from the invoice facts.
- `gross profit = net revenue - COGS`.
- `gross margin bps = gross profit / net revenue * 10,000`.
- `food cost bps = configured COGS / net revenue * 10,000`.
- `contribution = gross profit - labour - marketplace commission - payment fees - delivery fees`.
- `flash operating result = contribution - mapped operating expenses`.
- `channel contribution = channel net sales - channel COGS - persisted commission - persisted provider fees - persisted delivery fees`.
- `inventory/GL difference = inventory balance read-model value - posted inventory-account balance`.

All division uses integer/BigInt helpers with centralized half-away rounding. P&L rows are `PARTIAL` or `INSUFFICIENT_DATA` when account mappings, labour, station timestamps or sales evidence are absent. The inventory/GL process never posts a balancing journal.

## Metric definitions

`daily_branch_metrics` reconciles invoice sales, confirmed refunds, configured journal categories, attendance labour, station timing, cash/reconciliation variance and inventory movement evidence for one server business date. Period summaries aggregate bounded daily rows for day, week-to-date and month-to-date views.

Targets and thresholds are effective-dated data. A branch override wins over a tenant default for the same metric and date. Threshold comparisons support greater-than, less-than and absolute-greater-than. A breached condition has one stable `condition_key`; recalculation updates detection evidence without duplicating the action. Resolution is audited and remains historical.

## Food-cost bridge

The bridge compares posted configured COGS between two periods. Supported drivers are persisted supplier price variance, recorded wastage/expiry, stock-count value variance and production-yield value variance. `unexplained = total COGS change - sum(supported drivers)`. Unsupported causes are never inferred. Missing account configuration lowers quality.

## Channel profitability

Channels come from `order_channels`; labels, types and provider connections are configuration. Charges come from `marketplace_charges`, COGS from linked sale-consumption movements, and settlement variance from `settlement_batches`. A configured marketplace connection without settlement facts returns a null settlement difference and `MISSING_SETTLEMENT_FACTS`, never an artificial zero.

## Kitchen metrics

Station rows use configured `stations` and persisted order-station timestamps. Average, median and P90 prep time, ready-to-pickup time, throughput and late counts are deterministic. Missing timestamps lower quality and remain visible.

## Staff metrics

Staff rows show persisted worked minutes, late minutes, configured labour cost, orders handled, net sales, average service time, void requests, approved discounts and refund involvement. Seramet does not create an opaque employee score or infer misconduct.

## Supplier metrics

Supplier facts use purchase orders, goods receipts, receipt lines, returns, invoice matches and supplier invoices. Metrics include purchase value, observed lead time, on-time rate, fill rate, rejected quantity, purchase-price variance, returns, match exceptions and outstanding payable. No supplier is automatically replaced.

## Menu profitability

Menu rows reuse Pass 6 profitability snapshots: quantity sold, net revenue, theoretical cost, contribution, food-cost rate and sales mix. Deterministic classification compares contribution and popularity with period medians. Missing recipe/cost evidence remains `INSUFFICIENT_DATA`.

## Branch health and owner control

Health is derived only from active management-action severities: critical actions or two high actions yield `CRITICAL`; one high yields `AT_RISK`; medium yields `WATCH`; otherwise `HEALTHY`. Evidence stores the unresolved severity counts. Owner comparison is limited to authenticated branch assignments and includes authorized branches with no metrics as explicit insufficient-data rows.

## Close readiness and approvals

Readiness projects open reconciliation exceptions, settlement exceptions, stock counts, supplier invoices, refunds, failed/dead-letter jobs and inventory/GL variance. It cannot close/reopen a period. The approval inbox projects original source IDs; it does not clone approval workflows or decisions.

## Security model

- Every query includes authenticated `tenant_id`; branch reads use server actor assignments.
- Finance endpoints require `management.finance.view`; target configuration and recalculation require `management.targets.manage`; action transitions require `management.actions.manage`.
- Runtime Zod schemas reject unknown/malformed mutation fields.
- Target, threshold and action transitions produce immutable authoritative audit events with correlation IDs.
- No secrets, provider credentials or card data are accepted or returned by management APIs.
- Browser dev headers remain subject to the Pass 5 production fail-closed authentication boundary.

## Quality model

Operational rows use `HIGH`, `MEDIUM`, `LOW` and `INSUFFICIENT_DATA`. Financial summaries use `COMPLETE`, `PARTIAL` and `INSUFFICIENT_DATA`. Each degraded row stores machine-readable reasons. Zero is used only when a persisted fact is genuinely zero; missing settlement, timestamp, recipe, mapping or branch facts are represented as missing/insufficient.

## Known limitations

- Flash P&L is management reporting, not a statutory financial statement.
- Operating-expense completeness depends on configured journal reporting categories.
- Menu classification requires Pass 6 snapshot history and is not a forecast.
- Close readiness is advisory; authoritative accounting-period commands remain in Pass 5.
- No AI, machine-learning claim, causal inference or subjective staff score is included.
