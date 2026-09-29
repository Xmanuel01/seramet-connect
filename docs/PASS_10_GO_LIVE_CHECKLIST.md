# Pass 10 Go-Live Checklist

Use this checklist per tenant and environment. A checked software control does not replace legal, commercial-provider or operational approval.

## Data And Identity

- [ ] Migration 0011 applied after migrations 0001-0010 and schema version verified as 11.
- [ ] Customer source systems, tenant mapping and branch mapping reviewed.
- [ ] Phone country calling code and normalization policy configured.
- [ ] Duplicate-customer review completed; no bulk auto-merge performed.
- [ ] Customer import preview totals, duplicates and invalid records approved before commit.
- [ ] Historical order/customer backfill executed idempotently and reconciled.
- [ ] Retention, privacy-request and anonymization policies approved by legal counsel.
- [ ] Staff with contact-PII access are limited to operational need.

## Consent And Communications

- [ ] Transactional and marketing communication purposes are documented separately.
- [ ] Existing consent provenance is validated; unknown consent was not converted to granted.
- [ ] Opt-out/suppression path tested end to end for every enabled channel.
- [ ] Campaign templates, variables, approval workflow and audience preview approved.
- [ ] Campaign frequency/rate limits configured.
- [ ] Attribution window and non-causal reporting wording approved.
- [ ] Live communication provider adapter has passed vendor certification.
- [ ] Provider uses a managed secret reference; no credential exists in browser or exported config.
- [ ] Provider webhooks, delivery callbacks, idempotency and signature verification tested if supported.
- [ ] Test provider and demo campaign data are disabled in production.

## Loyalty And Rewards

- [ ] Loyalty scope selected: TENANT, BRAND or BRANCH.
- [ ] Earning, redemption, expiry, refund and tier rules approved.
- [ ] Liability/revenue/expense account mappings reviewed by finance.
- [ ] Reward inventory/capacity constraints configured where applicable.
- [ ] Concurrent earn/redeem/refund test completed in staging.
- [ ] Receipt display text and privacy exposure reviewed.
- [ ] Offline policy confirmed: value redemption requires authoritative server access.

## Vouchers And Gift Cards

- [ ] Voucher branch/channel/customer/usage/stacking policies verified.
- [ ] Voucher refund-restoration policy tested for full and partial refunds.
- [ ] Gift-card token issuance, masking and recovery procedure documented.
- [ ] Gift-card liability, collection and redemption accounts configured.
- [ ] Currency mismatch, replay and concurrent overspend tests passed.
- [ ] Staff permissions for issue, block, adjust and redeem are least privilege.
- [ ] Gift-card and voucher terms, expiry and local-law requirements approved.

## Operations

- [ ] Durable CRM, campaign, expiry, privacy and import workers healthy.
- [ ] Dead-letter monitoring and replay procedure assigned.
- [ ] CRM API pagination and aggregate performance measured using tenant-like volume.
- [ ] Database backup and restore include all migration 0011 tables.
- [ ] Audit export and retention include CRM material events without secrets.
- [ ] Manager Action Centre receives campaign, privacy, redemption and worker exceptions.
- [ ] Desktop, tablet and mobile workflows tested with tenant-specific permissions.
- [ ] POS customer search/link/create and anonymous checkout tested.
- [ ] Receipt loyalty output verified; KOT remains free of loyalty/PII detail.
- [ ] Refund/reversal paths reconciled with loyalty, voucher, gift-card and journal ledgers.

## Release Gate

- [ ] Full historical and Pass 10 suite passes.
- [ ] TypeScript, lint, client, SSR and Nitro/Cloudflare builds pass.
- [ ] Tenant/branch isolation and concurrent redemption tests pass.
- [ ] Security review has no open P0/P1 finding.
- [ ] Hardcode and secret scans are clean for production core.
- [ ] Known limitations are accepted by the pilot owner.

