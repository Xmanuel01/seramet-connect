# Hardcode Audit

Audit completed on 29 August 2026 after the Pass 1 refactor.

## Search

The final audit searched the entire `src` tree for the original restaurant, branch, marketplace, payment and printer examples. The architecture-focused command excluded only demo fixtures, adapter implementation folders, tests and compatibility re-export files:

```powershell
rg -n -i "Mona Swahili|Westlands|Ngong Road|Uber Eats|Glovo|Bolt Food|M-Pesa|TendePay|Front Printer|Kitchen Printer|Bar Printer|Office Printer|All Branches" src `
  --glob '!src/platform/demo/**' `
  --glob '!src/integrations/payments/**' `
  --glob '!src/**/*.test.*' `
  --glob '!src/data/mock.ts' `
  --glob '!src/lib/import-datasets.ts' `
  --glob '!src/lib/payment-providers.ts'
```

## Removed from normal application logic

- Restaurant and branch names are no longer embedded in routes or print-service business logic.
- Branch selection and filtering use branch IDs and `BranchScope` rather than a fake "All Branches" record.
- POS, invoices and pending settlement no longer own fixed payment arrays or payment-name unions.
- POS and online-order screens no longer compare marketplace names.
- Branch printer names, till data, bank details and document identity are resolved from configuration.
- Authorization no longer depends on role-name allowlists.
- Fixed branch weighting and name parsing were removed from app context.
- Provider-specific classes are not imported by core payment screens or generic API routing.

## Allowed matches

| Location                                | Classification              | Reason                                                                                                                             |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/platform/demo/**`                  | Demo/legacy data            | Isolated sample tenant and migrated UI fixtures. Core services do not compare these values.                                        |
| `src/integrations/payments/**`          | Adapter implementation      | Provider-specific code and environment variables are permitted inside provider adapters and legacy aliases.                        |
| `src/integrations/provider-registry.ts` | Adapter registration        | Registers concrete adapters; feature screens resolve generic capabilities.                                                         |
| `src/integrations/runtime-env.ts`       | Server environment boundary | Names server-only provider environment inputs; no browser secret persistence.                                                      |
| `src/**/*.test.*`                       | Test fixtures               | Verifies migration and backwards compatibility using representative legacy values.                                                 |
| `src/lib/app-context.tsx`               | Display text                | "All branches" is a UI label derived from `{ type: "ALL" }`, not business data.                                                    |
| print and setup modules                 | Generic output roles        | "Front printer", "kitchen printer" and similar phrases describe output roles or missing-route messages, not required device names. |
| analytical subtitles                    | Presentation copy           | "All branches" describes aggregation and is not used as a branch identifier.                                                       |

## Demo boundary result

Restaurant, named branch and named marketplace data is confined to:

- `src/platform/demo/default-demo-data.ts`
- `src/platform/demo/legacy-ui-fixtures.ts`
- `src/platform/demo/legacy-import-datasets.ts`
- provider adapter/legacy alias modules
- acceptance and compatibility tests

The compatibility files `src/data/mock.ts`, `src/lib/import-datasets.ts` and `src/lib/payment-providers.ts` only re-export the isolated modules so existing imports can migrate incrementally.

## Configuration safety

`ConfigurationRepository.upsertConnection` removes every provider-declared secret field before persistence. Connection records store `secretReference`; actual secrets are expected through the server environment or a future secret manager.

Missing tenant, branch, payment, channel, document, provider or printer configuration produces an explicit configuration error. Normal application code does not fall back to the demo restaurant's identity.

## Pass 5 addendum - 30 August 2026

The Pass 5 audit repeated the search after adding production persistence, identity, workers and offline sync. New server code uses tenant/branch IDs, payment method account mappings, provider capabilities and configured document sequences. Restaurant/branch/provider display names remain confined to demo data, provider adapter boundaries, compatibility fixtures and tests. Production seeds contain no Mona-specific records; `migrations/seed/demo.sql` remains an explicit demo-only artifact.

Development identity values exist only in the localhost development-auth boundary. Production authentication resolves tenant, user, roles, permissions, branches and device from verified JWT/session/database records. No normal business rule compares a restaurant, branch, provider or payment display name.

## Pass 6 addendum - 31 August 2026

The Pass 6 audit searched the new inventory domain, server API, workers, migration and production routes for restaurant, branch, supplier, ingredient and menu examples. Named ingredients and suppliers exist only in deterministic tests and documentation examples. Production logic resolves items, recipes, suppliers, branches, warehouses, accounts, units and marketplace connections by configured IDs.

No business rule compares an item name, supplier name, menu category or unit display text. Purchase-unit conversion is item data, document identities come from the Pass 5 sequence service, business date comes from server branch configuration, and marketplace availability goes through the generic Pass 3 outbox boundary.
