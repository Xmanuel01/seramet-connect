# Channel-configured rider delivery

## Workflow

1. An authorized manager enables **Rider delivery** when creating or editing an order channel in Settings > POS and restaurant. This is independent of the channel name, marketplace and online-price setting.
2. POS shows a **Delivery amount** field beside the delivery contact details. The saved amount is a separate charge, never a food/menu line. Existing configured rates can still be selected. Advanced settings retain fee beneficiary, cash collection owner, scheduling and rate controls.
3. Saving an order persists the fee with the shared delivery task. Seramet's Delivery page shows the fee, customer, address, phone and door/unit. Existing rider assignment and operational permissions remain in place.
4. The existing bill/invoice/receipt component path includes the charge in the total and prints the available delivery details. Printer transport, device configuration and kitchen print behavior are unchanged.
5. Daily closing snapshots include invoiced delivery charges, business-owned delivery revenue and rider fee liability, plus per-rider amounts. The HTML/email sections and PDF include the same frozen summary. The Riders roster shows today's invoiced rider fees.

## Accounting and access boundaries

- Existing permissions control channel settings and order mutations. Direct amount entry is permitted only when enabled on that channel. Manual overrides still require their existing permission and reason.
- Amounts use integer minor units. Invalid, negative, unsafe and mismatched-beneficiary charges are rejected server-side. Provider-originated charges cannot be overwritten with a second local charge.
- Closing totals use recorded invoice components, not menu names. Split/merged invoice parents are excluded; component allocations conserve minor units. Tenant, branch, business date, timezone and cutoff scope are applied.
- Stable rider identities from custody records or an unambiguous employee match are used when available. Same-name legacy assignments are marked unresolved rather than credited to both employees.
- These are **invoiced fees before refunds and rider settlements**, not proof that a rider has been paid. This change does not implement automatic payouts, fee retention/remittance decisions or net payout reconciliation.
- Existing delivery-as-product items and historical records are not automatically converted or deleted. Do not add both an old delivery menu item and a separate fee to a new order.
- Disabling rider delivery does not rewrite existing orders. An editable held order retains its visible saved fee until explicitly removed; clearing the fee stays consistent after JSON transport and reload.
- Existing approved `DELIVERY_PAYABLE` / `DELIVERY_FEES` ledger mappings are required for invoice posting where applicable. No production accounts or mappings are created automatically.
- The integration target is Seramet's existing Delivery/Riders views. A separate external rider application has not been identified or connected.

## Release and verification

Based on main `2640019`, on `codex/channel-rider-delivery`. No migration, production data mutation, provider activation or deployment is part of this implementation.

Targeted tests cover channel permissions and persistence, fee validation, separate food/fee components, protected provider amounts, bill output, split/merged totals, local cutoffs, ambiguous rider names and immutable closing PDFs. The local Playwright test covers the real Settings checkbox, POS fee entry, invalid amount rejection, held-order reopening, delivery-task details and desktop/mobile overflow.

Browser testing requires the repository's disposable local E2E fixture and a valid local test session. `SERAMET_E2E_BROWSER_CHANNEL=chrome` selects installed Chrome when the bundled Chromium is unavailable. Tests reject non-local hosts and non-E2E fixture tenants. No production test orders are required.

Physical printer output and a live external rider portal remain outside the local verification boundary. Merge and deployment must use the repository's protected release process and fresh CI.
