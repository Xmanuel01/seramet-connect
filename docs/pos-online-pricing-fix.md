# POS online pricing correction

Date: 2026-11-14. Branch: `codex/marketplace-operations`. Not deployed.

The channel's `useOnlinePrice` setting and menu item's `onlinePriceMinor` were saved,
but the POS catalogue discarded the online price. POS instead applied a legacy
`priceMultiplier` defaulting to 1, independently of the setting.

The catalogue now exposes only the validated online-price field, alongside existing
display fields. POS uses that exact minor-unit amount when the selected channel opts in.
Otherwise it uses the normal branch price. Missing/invalid online prices fall back to
normal pricing; explicit zero and fractional-currency precision are preserved.
Channel status text now reflects the saved setting rather than assuming all marketplaces
use online pricing. Successful menu edits invalidate the in-tab POS cache, including
isolation from older in-flight requests.

Verified locally:
- 42 focused tests across POS workflow, menu rendering/pricing, cache and channel settings.
- One database-backed authenticated API test for online-price projection and branch isolation.
- TypeScript, targeted ESLint and production build.
- Playwright: create local item, view price, edit online price in the real menu editor,
  navigate back to POS, switch online/normal channels (KES 1,090 / KES 900), save a held
  draft and verify its persisted price after reload. Screenshot: `.seramet/online-price/pos.png`.

Only disposable local QA data was used. No production records, migrations, printing
configuration, marketplace credentials or live provider calls were changed.

## Online Orders eligibility

Online Orders now uses the same explicit `metadata.useOnlinePrice === true` setting
as POS pricing, rather than excluding a hardcoded list of channel types. Disabled
channels are excluded. Stable IDs/codes take precedence over legacy display names.
Switching the setting changes visibility only; existing orders and prices remain intact.

The extended local Playwright test passed: a custom OTHER channel appears in Online
Orders, disappears after its persisted flag is disabled, and reappears after re-enabling.
The saved held order remains KES 1,090. Evidence: `.seramet/online-price-browser.log`
and `.seramet/online-price/online-orders.png`. Focused channel/pricing/cache/settings
tests and TypeScript also passed. Full exact-commit CI and protected production
approval remain required before merge and deployment.
