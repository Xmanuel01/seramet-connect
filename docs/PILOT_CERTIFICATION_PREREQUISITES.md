# Pilot certification prerequisites

These fixes precede the daily-closing stack; they do not alter closing rules.

## Publication confirmation

Run 38927975870 failed waiting for publication confirmation, while the independent
browser run on the same commit passed. The failed runner did not retain its trace,
so the exact timing of that occurrence cannot be reconstructed.

The page nevertheless contained a reproducible state-ordering defect: COMMITTED /
VERIFIED matched the staging presentation even when publishStatus was PUBLISHING.
Detached progress inspections could also apply an older snapshot after a subsequent
poll. Publication now takes precedence and inspections are serialized within the
single active poll. No timeout, scanner, worker, authorization or database behavior
is relaxed. Existing recovery, duplicate publication and POS visibility acceptance
tests remain required on the final combined candidate.

## Dependency advisory GHSA-qx66-fv34-fjm8

Source: https://github.com/advisories/GHSA-qx66-fv34-fjm8

| Package                      | Previous installed | Vulnerable range (npm audit)  | Selected patched |
| ---------------------------- | ------------------ | ----------------------------- | ---------------- |
| @tanstack/react-start        | 1.168.32           | 1.142.10 or 1.143.12–1.168.59 | 1.168.60         |
| @tanstack/start-server-core  | 1.169.17           | 1.143.12–1.169.38             | 1.169.39         |
| @tanstack/react-start-server | 1.167.22           | 1.143.12–1.167.45             | 1.167.46         |
| @tanstack/react-start-rsc    | 0.1.31             | <=0.1.58 (transitive)         | 0.1.59           |
| @tanstack/start-plugin-core  | 1.171.24           | 1.142.10 or 1.143.12–1.171.48 | 1.171.49         |

The five audit entries represent one underlying unauthenticated reflected-XSS
advisory and its dependency chain, not five independent vulnerabilities. The
server-function response path is present in the Start runtime; no claim of
unreachability is used to waive the finding. A crafted link can execute script on
the application's origin if opened by a victim.

Pin the minimum patched Start release and its declared React Router dependency
1.170.41. No major upgrade, forced audit fix, overrides or advisory suppression.
Align the application's router plugin to 1.168.42, the exact version declared by
patched Start, so every router-core resolves to 1.171.34. Retaining plugin 1.168.23
left an older root core 1.171.15 and caused missing SSR exports in the production
build. Validate typecheck,
SSR build, authentication, routing and browser workflows against the resolved tree.
The patched Router correctly types thrown values as unknown; the root error
boundary now uses its exported ErrorComponentProps rather than assuming Error.
The lockfile is also validated with Actions' npm 10.9.9: npm 11 omitted Nitro's
optional lru-cache peer, causing npm ci to stop before any certification executed.
Regenerating with npm 10 adds only that required optional entry; no scan is bypassed.
Final certification evidence belongs in DAILY_CLOSING_CERTIFICATION.md.
