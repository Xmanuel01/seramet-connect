# Pass 12 Hardcode Audit

Date: 2026-09-09

## Scope

The audit covered production Pass 12 code in:

- `src/enterprise/**`
- `src/server/enterprise-api.ts`
- `src/routes/enterprise.tsx`
- enterprise integrations added to `src/inventory/**`
- `migrations/0013_enterprise_franchise_hq.sql`

Tests, development seeds, and documentation examples were excluded because named fixtures are
permitted outside production business logic.

## Searches

The production paths were searched case-insensitively for restaurant, branch, marketplace,
payment-provider, currency, and example-value names, including `Mona Swahili`, `Westlands`,
`Ngong Road`, named marketplace/payment brands, `KES`, and `KSh`. Conditional logic was also
reviewed for display-name comparisons involving provider, branch, brand, restaurant, or currency.

## Result

No production business decision depends on a named restaurant, branch, marketplace, payment
provider, table, legal entity, supplier, or currency. The only search hits were generic validation
messages and the explicit UI disclaimer that management aggregation is not statutory
consolidation.

## Configuration-Driven Decisions

- Organisation shape comes from `enterprise_nodes` and its closure table.
- Legal entity, brand, branch, warehouse, and commissary identifiers are tenant data.
- Permission and delegation decisions use permission codes and stored scope policies.
- Menu, pricing, recipe, supplier, document, device, loyalty, CRM, payment, and marketplace rules
  resolve through configured policy/reference records.
- Currency is stored on nodes, contracts, metrics, transfers, and fee facts; mixed currency is not
  silently aggregated.
- Royalties and fees use stored fee type, basis, rate basis points/fixed minor units, exclusions,
  scope, currency, and effective dates.
- Branch templates contain versioned configuration data and reject secret values.
- Intercompany transfers require stored entity/account/policy mappings.

## Allowed Examples

Named restaurants, branches, providers, and currencies remain only in tests, development seed
data, and documentation examples. They do not affect production control flow.

## Conclusion

Status: CLEAN for Pass 12 production logic. Future providers, currencies, brands, regions,
franchisees, and branches can be added as tenant configuration without changing enterprise core
business logic.
