# Phase 1 hardening corrections

Baseline: `54a0b241e606dc01c0f24812e3c7996acf1b2823`.
Scope: the owner's five Phase 1 corrections only. No phase progression,
merges, deployments, database writes, provider calls or invitations are authorized
by this change.

## Main-branch release input

The owner requested required checks and approval before automatic production
promotion. The existing Cloudflare main-branch build remains the only automatic
production path; no additional deployment workflow was introduced.

GitHub main protection was applied from
`certification/main-branch-protection.json` and independently read back:

- Required GitHub Actions checks: `validate`, `postgres-crm`,
  `postgres-recovery-fixture`, tied to the GitHub Actions app ID `15368`.
- Branch must be up to date before merge.
- One independent approval, stale approvals dismissed after new commits,
  and approval of the most recent push required.
- Administrators must obey these rules. Force pushes and deletion are disabled;
  review conversations must be resolved.

This gates entry to main before native Cloudflare automation starts. It does not
make Cloudflare wait for the later redundant main-push CI run, certify the live
application, or restrict a Cloudflare administrator's separate manual actions.
The existing path-selected browser/finance/POS workflows remain in place; the
three always-running core checks above are the enforced branch contexts. Their
names must remain unique and stable.

At configuration time, `Xmanuel01` was the only repository collaborator.
GitHub authors cannot approve their own PRs: a second qualified reviewer with
write access is needed before these changes can merge. No collaborator was
invited, approval fabricated, or bypass configured. Adding that reviewer remains
an owner decision. Updating this JSON alone does not update GitHub settings;
future policy changes require separate authorization and read-back verification.

## Development-tool advisories

Vitest and its matching package family are patched from 4.1.11 to 4.1.12.
CI retains its production-only audit and now also checks all dependencies at the
moderate threshold. No application framework upgrade or forced audit fix is used.

## Midnight fixture

The general guest suite fixes only the JavaScript Date clock at a known open
instant; real timers remain active and Date is restored after every test.
Explicit 23:58:30, 23:59:30 and 00:00 Nairobi cases verify that configured
opening-hour enforcement remains intact, including rejection near closing.
No guest-service production logic or operating hours were changed.

## Installed dependency tree

A clean `npm ci` reproduced the invalid peer mapping: Nitro's
`unstorage@2.0.0-alpha.7` optional `lru-cache` peer requires `^11.2.6` but resolved
Babel's version 5. This was not fixed by reinstalling the old lockfile.

The existing toolchain peer is now explicit as development dependency
`lru-cache@11.5.3`. Babel keeps its compatible private 5.1.1; Nitro resolves
11.5.3. This makes the previously optional toolchain peer reproducible
without replacing Nitro or changing runtime application logic. CI now runs
`npm ls --all` after its clean install.

## Staging write ordering

The existing exact-SHA, verified-backup, backlog and Data API approval gate now
runs immediately after Node setup, before dependency installation, Cloudflare
resource discovery and scanner queue creation. Migration/security checks remain
unchanged. The gate's regression test checks its ordering ahead of installation,
queue creation, migrations, Hyperdrive updates and deployment commands, and
rejects a skipped/ignored approval step. No staging workflow was dispatched.

## Verification scope

Targeted local evidence: 25 guest cases including the three boundary cases;
eight release-policy/staging-gate tests; both cache versions resolve correctly;
full dependency-tree validation passes; all-scope audit reports zero findings.
Full CI is justified once because the patched Vitest family affects all unit
assertions and the dependency tree affects builds. Browser and PostgreSQL jobs
remain disposable software evidence, not live acceptance or production approval.

The authoritative six-phase matrix remains the external Phase 1 validation
report. Source fixes in this PR are not changes already released to main.
