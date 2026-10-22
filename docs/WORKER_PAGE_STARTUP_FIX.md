# Cloudflare page startup correction

## Confirmed cause

Live requests to the POS homepage returned HTTP 500. Worker logs identified
`new PosConnectivity()` calling `crypto.randomUUID()` during SSR module loading.
Cloudflare rejects request-only randomness during module evaluation. The shared
router import therefore failed before the sign-in page could render.

## Correction

The connectivity monitor now allocates its correlation ID lazily on first use.
Construction, module import, subscription and snapshot reads do not require
randomness. Each active monitor still has a stable independent correlation ID.
No authorization, payment, reconciliation, polling or database behavior changed.

## Regression coverage

- A unit regression imports the module with randomness forbidden, constructs a
  monitor and reads the singleton snapshot without invoking randomness.
- Existing hysteresis, bounded verification and serialized replay tests remain.
- CI renders the compiled homepage, administrative login, employee POS login,
  staff login and registration pages inside workerd, not just Node.
- The pinned Wrangler emulator uses its supported May 3, 2026 compatibility
  baseline. This test-only override does not alter the production compatibility
  date or deployment settings. Live verification is additionally required.
- The compiled public-development API rejection check remains enabled.

## Operational scope

This fixes page rendering only. It does not certify production database bindings,
account creation, payment processing or a full sale-to-closing workflow. The main
website and demo changes are deferred. No customer data or email settings change.
