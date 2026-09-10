# Marketplace Go-Live Checklist

Complete this checklist for every provider connection and branch. A connection must not be marked `ACTIVE` on configuration alone.

## Provider approval

- [ ] Merchant/partner account is approved for the target country and brand.
- [ ] Production API application is approved.
- [ ] Required order, store, menu and webhook scopes are approved or whitelisted.
- [ ] Sandbox and production credentials are stored in the server secret manager.
- [ ] No credential is present in frontend configuration, logs or screenshots.

## Branch and catalog mapping

- [ ] Provider store/vendor ID maps to exactly one tenant branch ID.
- [ ] Order channel maps to the provider connection.
- [ ] Every sellable item is mapped by stable ID/SKU.
- [ ] Required modifier groups/options are mapped.
- [ ] Branch marketplace price list is reviewed.
- [ ] Images, tax behavior, hours and availability are validated in preview.
- [ ] Destructive menu changes receive explicit confirmation.

## Order operations

- [ ] Signed sandbox webhook is accepted and an invalid signature is rejected.
- [ ] Test order creates one Seramet order only.
- [ ] Accept and documented reject behavior are verified.
- [ ] Notes/modifiers appear on KDS/KOT/bar tickets.
- [ ] Multi-station READY sends provider READY once.
- [ ] Cancellation and supported edits produce production amendments.
- [ ] Scheduled orders release at the calculated time.
- [ ] Active-order recovery is tested where supported.

## Availability and store control

- [ ] 86/sold-out disables the correct provider item.
- [ ] Restock re-enables the item.
- [ ] Price updates affect only the intended branch/channel.
- [ ] Pause/open operations affect only the mapped store.
- [ ] Provider outage opens health/circuit alerts without blocking local POS.

## Financial boundary

- [ ] Externally collected order posts to marketplace receivable, not bank/cash.
- [ ] No receipt is created before a real restaurant settlement/payment event.
- [ ] Gross sale and provider charges remain separate.
- [ ] Provider receivable account is configured per connection.
- [ ] Settlement/report export method is documented for Pass 4 reconciliation.

## Monitoring and rollback

- [ ] Outbox worker and scheduled-order worker are deployed and monitored.
- [ ] Dead-letter ownership and response SLA are assigned.
- [ ] Rate limits, retry policy and provider support contacts are documented.
- [ ] Rollback can pause the mapped store without disabling local POS.
- [ ] First live orders are observed through order, KDS, READY and provider dispatch.
- [ ] Production health check succeeds before status is changed to `ACTIVE`.
