# Production Registration And Onboarding

## Separation of responsibilities

Registration, guided onboarding and the Setup Centre are separate workflows:

1. `/register` creates or verifies the administrator identity, then captures only the restaurant
   identity: administrator name, trading name, optional legal name and public slug.
2. Registration creates a neutral provisional tenant shell. Country, currency, timezone and
   operating decisions are not accepted from the public registration payload.
3. `/seramet-setup` resumes the authoritative guided onboarding wizard at its last server-saved
   step.
4. After onboarding is complete, the same route opens the detailed Setup Centre for menu,
   inventory, tax, payment, printer, device and go-live configuration.
5. Onboarding completion does not mean the tenant is ready for production. Go-live remains a
   separate readiness decision with explicit blockers.

## Guided onboarding

The wizard stores progress in `onboarding_wizard_progress` and append-only evidence in
`onboarding_wizard_events`. A user can go back, resume on another browser and revalidate changed
answers. Steps cannot be skipped by submitting a future step number.

Location is selected from `country_reference` by a named country entry. Calling codes are shown as
supporting information and are never accepted as country identifiers. The user enters the
country-specific first administrative level, city and address, then confirms the location on a
separate page. Only that confirmation applies the reference-backed timezone, locale and domestic
currency suggestion.

The user explicitly selects one base currency and may select optional secondary tender currencies.
Changing the base currency is rejected after authoritative financial activity exists. Secondary
currencies do not become usable merely by being selected: they also require branch/payment-method
eligibility and a current authoritative rate.

## Clean tenant rule

The local server applies versioned migrations to `.seramet/development.sqlite` without importing
sample restaurant operations. A new tenant has no orders, customers, payments, stock, journals,
reservations or demo provider records. Test fixtures remain under test-only modules and are not
loaded by runtime routes.

A previous browser snapshot or development database is never ingested automatically. Any legacy
migration must be explicit, validated and reconciled before use.

## Security

The public registration endpoint revalidates the verified identity, same-origin request, rate
limit, strict schema and idempotency key. Raw access tokens remain in HttpOnly cookies. The server
derives tenant, actor and branch scope from the authenticated identity; UI fields do not confer
authority.

Go-live still requires complete catalog, inventory/recipe, tax, account, payment, station,
document, device and opening-stock setup plus current schema, backups, security checks and tested
production infrastructure.
