# Complete validated POS candidate

Prepared 26 October 2026 on `codex/validated-release-candidate`.

## Release inputs

This candidate is based on main `54a0b241e606dc01c0f24812e3c7996acf1b2823`
and contains the exact current heads of the authorized release stack:

- PR 154: `290fe297ff0550e1c136db71e1d7d6886df8bd42` (Phase 1 tooling and release controls).
- PR 155: `edc619970acbc57fd9b85068afc118407d4d592b` (owner checklist and closing corrections).
- Local Phase 2: `32d1da4080fe439db3f49a47a8b91cde9697bbb9` (cashier/channel, delivery and recovery corrections).

Git ancestry was checked, not inferred from branch names. Older overlapping
PRs are not additional inputs. This combined main-targeted candidate lets the
security correction and the tested application changes be reviewed together;
do not promote a vulnerable prerequisite merely to advance the old stack.

## Zod security correction

The former direct dependency 3.25.76 is affected by
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Pin Zod 4.6.7, beyond the advisory's fixed version 4.6.6, with its npm integrity
recorded in the lockfile. Existing transitive 4.6.7 copies deduplicate; no other
package version was upgraded. No audit suppression or legacy v3 import is used.

The [official migration guide](https://zod.dev/v4/changelog) requires explicit
record keys. Nineteen existing record definitions in five source files now use
string-key schemas and preserve the existing value validation, strict objects,
optional properties and defaults. No permissions, financial rules, routes,
database schema or provider credentials were changed by this dependency fix.

Five focused regression cases verify oversized constrained-array rejection
before element traversal, validation within the limit, enterprise defaults and
strictness, contact dictionaries and import mappings. They use bounded local
inputs and do not perform a denial-of-service test against a deployed service.

## Evidence and boundaries

Before publication, the all-dependency moderate-level audit reports zero
vulnerabilities; `npm ls --all` reports no dependency-tree problems. The five
new schema regressions plus two existing delivery regressions pass. TypeScript
passes after the compatibility correction. Fresh full CI on this exact
candidate is required; these focused checks are not substituted for it.

Prior Phase 2 evidence is local/disposable: 51 unique Chromium scenarios covered
across documented runs, a final affected 14-scenario Chromium run, and 1,203 unit
tests before this dependency change. The dependency migration invalidates reuse
of those results as final candidate-wide acceptance, so fresh CI must execute
the broader suite, browser and PostgreSQL checks. Windows WebKit image capture
has a separately reproduced display-scaling limitation; no physical iPhone,
Android, real-payment-provider or printer acceptance is claimed.

No production migration, provider transaction or manual deployment is part of
this candidate. The repository's independent/latest-push approval and required
checks must remain enforced. A code assistant or automated review is not a
substitute for the required independent approval.

Phase 3 database and financial validation, subsequent integration acceptance,
and launch certification remain separately evidenced gates. Local software
results are not permission to begin real customer sales.
