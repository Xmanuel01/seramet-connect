# Pass 9 Hardcode Audit

## Result

Pass 9 introduces no restaurant, branch, supplier, channel, provider-vendor, payment-method display-name, or role-name business logic.

## Allowed constants

- permission codes and intelligence intent/tool enum values;
- provider-neutral capability values;
- server status and quality enums;
- route paths to existing Seramet workflows;
- development-only identifiers under `migrations/seed/pass9-demo.sql`;
- `DETERMINISTIC_TEST`, explicitly gated to development/test;
- centrally defined default timeouts, quotas, and retention durations, all tenant-configurable through authoritative provider configuration; and
- curated product-help text.

## Checks

- Provider selection uses `provider_key` data and registry resolution.
- Source tools query configured tenant and branch records.
- Channel analysis groups persisted `channel_key`, `channel_id`, and `channel_label` data.
- Payment names do not participate in intelligence business logic.
- Branch and owner scope comes from authenticated assignments.
- Suggested mutations use permission codes and existing domain services.
- Demo seed is loaded only by the explicit local-development database path.
