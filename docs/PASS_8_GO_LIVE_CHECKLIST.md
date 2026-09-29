# Pass 8 Go-Live Checklist

This checklist is operational evidence, not a substitute for the server readiness result. Do not move a tenant to `LIVE` while a non-overridable blocker exists.

## Deployment

- [ ] Production environment is selected and development auth/demo providers are disabled.
- [ ] HTTPS callback base URL, identity issuer/audience, signing keys, database, queue, and managed secret store pass readiness.
- [ ] Client, SSR, and configured Nitro/Cloudflare builds come from the approved release.
- [ ] Application/build identifiers are recorded in support diagnostics.
- [ ] Rollback artifact and operator are identified.

## Database and Recovery

- [ ] Versioned migrations are applied through deployment tooling.
- [ ] Current schema version equals required schema version.
- [ ] No migration failure or pending migration remains.
- [ ] Automated backup is configured and its latest success is verified.
- [ ] Restore rehearsal has a date, owner, result, and retained evidence.
- [ ] Migration rollback/recovery procedure has been reviewed.

## Tenant and Branches

- [ ] Legal/trading identity, country, currency, locale, timezone, and contacts are correct.
- [ ] Brand and every active branch are configured as data.
- [ ] Branch codes, timezones, business-day cutoffs, operating hours, service modes, and status are approved.
- [ ] Warehouses, stations, order channels, payment requirements, and negative-stock policies are configured.
- [ ] Document sequences and branch scope are verified.

## Authentication and People

- [ ] Production bearer authentication and session revocation are tested.
- [ ] At least one active tenant administrator has setup permissions.
- [ ] Every active branch has an assigned active user.
- [ ] Staff/role import rejects unknown branches, roles, passwords, and PINs.
- [ ] Cashier, manager, kitchen, finance, inventory, and support permissions are directly tested through APIs.
- [ ] Trusted POS/KDS/manager devices are registered and unauthorized devices are rejected.

## Menu, Inventory, and Recipes

- [ ] Menu import preview has no unresolved malformed or duplicate rows.
- [ ] Imported menu is visible through the authoritative POS catalog.
- [ ] Inventory UOMs, rational conversions, warehouse assignments, PAR, and supplier references validate.
- [ ] Recipe validation has no critical cycles, invalid conversions, missing yield, or double-consumption risk.
- [ ] Missing recipes/costs are resolved or explicitly accepted as eligible warnings.
- [ ] Marketplace item and modifier mappings have no ambiguous committed matches.

## Finance and Opening Stock

- [ ] Required account mappings are configured and finance approved.
- [ ] Tax and service-charge rules, effective dates, rounding, and accounts are signed off.
- [ ] Opening stock quantities, UOMs, valuation, branch, warehouse, and business date are reviewed.
- [ ] Opening stock is approved and posted once through append-only movements.
- [ ] Inventory subledger and opening accounting effect reconcile.
- [ ] Cash, clearing, receivable, payable, fee, commission, wastage, and variance accounts are verified.

## Payments

- [ ] Each configured payment method maps to the intended provider/account and branches.
- [ ] Live credentials are stored in the managed server secret store and masked metadata is visible.
- [ ] Provider environment is `LIVE`, not sandbox, for production methods.
- [ ] Callback/webhook URL and verification are tested.
- [ ] Payment intent, authoritative confirmation, allocation, receipt, journal, and reconciliation test passes.
- [ ] Offline POS cannot falsely confirm a digital payment.
- [ ] Refund, reversal, duplicate callback, and settlement behavior are tested.

## Delivery Integrations

- [ ] Provider adapter declares the required live capabilities.
- [ ] External store maps explicitly to the correct Seramet branch.
- [ ] Product/modifier/tax/order mappings are reviewed.
- [ ] Webhook, order ingestion, menu/availability outbox, retry, and dead-letter behavior are tested.
- [ ] Sandbox/live status and provider approval are recorded.
- [ ] Test order is isolated from production finance and inventory facts.

## Hardware and Documents

- [ ] Front, kitchen, bar, office, KDS, drawer, and display devices required by each branch are trusted.
- [ ] Device role, branch, station, local/network identifier, paper size, capability, and fallback route are correct.
- [ ] Device health/last seen is observed; `UNKNOWN` is investigated where hardware is required.
- [ ] Test KOT, bill, receipt, invoice, bar, fallback, and KDS routes succeed as applicable.
- [ ] Test output is visibly marked `*** TEST PRINT ***` and creates no financial fact.
- [ ] Logo, identity, tax ID, address, footer, payment instructions, QR, field visibility, width, and A4 layout are approved.
- [ ] Receipt/invoice/KOT designs match the approved Seramet templates.

## Workers and Integrations

- [ ] Durable queue and worker readiness pass.
- [ ] No critical dead letters remain.
- [ ] Large import commit, readiness recalculation, diagnostics export, and data export jobs complete.
- [ ] Worker crash/retry and idempotency tests pass.
- [ ] Provider, webhook, availability, payment, settlement, and scheduled jobs are healthy.

## Security and Isolation

- [ ] Cross-tenant and cross-branch setup tests fail closed.
- [ ] Unauthorized provider, export, entitlement, mapping, and go-live commands fail.
- [ ] Secret readback, diagnostics, export, logs, and audit payloads are redacted.
- [ ] File size/type/row/workbook limits and malformed imports are tested.
- [ ] No P0/P1 finding remains.
- [ ] Hardcode audit shows no production restaurant/branch/provider-name decision logic.

## Training and Sign-Off

- [ ] Restaurant administrators can complete Setup Centre without source-code changes.
- [ ] Cashiers complete order, split payment, receipt, offline/reconnect, and drawer training.
- [ ] Kitchen completes KDS/KOT, availability, addition/cancel, and fallback training.
- [ ] Store/procurement teams complete receiving, count, wastage, transfer, and opening-stock training.
- [ ] Finance signs off mappings, tax, payment reconciliation, settlements, EOD, and reporting.
- [ ] Operations signs off menu, recipes, branches, stations, devices, and service modes.
- [ ] Pilot dates, branch, support owner, rollback owner, and escalation path are recorded.

## Final Transition

- [ ] Server readiness has no critical blocker.
- [ ] Finance and operations sign-offs are authoritative records.
- [ ] Authorized approver moves `SETUP -> READY_FOR_REVIEW -> READY_FOR_GO_LIVE`.
- [ ] Final readiness is rerun immediately before `LIVE`.
- [ ] Any eligible override has permission, reason, evidence, and audit entry.
- [ ] No security/schema blocker is overridden.
- [ ] Go-live event and correlation ID are retained.
