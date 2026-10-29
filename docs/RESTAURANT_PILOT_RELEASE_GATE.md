# Seramet restaurant pilot and integrated release gate

**Status:** owner acceptance plan only. Writing this plan does not attest to passing a physical pilot, resolve conflicts between open PRs, or authorize any deployment.

## In-scope draft/review PRs

| Feature | PR | Independent acceptance |
|---|---|---|
| Geofenced attendance and Add Employee | #137 | Automated validation and browser tests on final SHA; physical GPS and employee-owned-phone login remain field gates |
| POS transient authentication, sync and cart stability | #134 | Full suite + separate 2-terminal and real-device overnight soak |
| Supervisor and cashier daily closing | #131 → #132 → #133 | **Ordered stacked changes**: drawer reconciliation, confirmation/PDF, durable email |
| Printer templates | #129 | Real 58mm/80mm printer/kitchen and customer slip evidence |

Never combine these branches through file copying without examining their **diffs and migrations**. Test a disposable integration branch based on fresh main; integrate dependencies in PR stack order. Do not merge or deploy on the strength of individual green checks alone.

## Controlled testing rules

- Use a freshly created demo/isolated tenant and disposable SQLite/PostgreSQL databases. Avoid real customer names, phones, payroll or payment credentials.
- Label all evidence with branch name, commit SHA, test device, timestamp, timezone and test scenario.
- Do not use the Cloudflare production-build success indicator as a deployment or approval signal.
- Gate every candidate using `npm ci`, `npm audit --omit=dev --audit-level=high`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, real disposable PostgreSQL contract checks, and the repo's actual E2E scripts. No audit suppression or forced dependency upgrades.
- Record failed, skipped, unrun or flaky tests truthfully. Do not turn off assertions to get a passing badge.

## Attendance real-device acceptance — owner or authorized pilot operator

On an actual restaurant site and **on real iOS Safari and Android Chrome devices**:
1. Before testing, identify a test employee account, assigned branch, operational role, branch timezone and branch business-day cutoff. Explain the limited foreground location collection to the tester.
2. Confirm the employee can sign in from their *own unregistered phone* without admin/cashier permissions; if they cannot, mark **BYOD LOGIN BLOCKED**. Never relax POS device enrollment as a workaround.
3. Keep geofencing **disabled until coordinates are independently checked**. Only an authorized manager configures coordinates and enables the policy in a disposable/pilot environment.
4. At the actual entrance, obtain multiple fresh device fixes and record pass/fail reason and reported accuracy without writing precise personal GPS readings to the attendance history. Repeat indoors (kitchen, cashier, tables), near geofence boundary, and outside. Compare a strict 10m setting with a manager-approved radius based on measured accuracy.
5. Check denied location, approximate-only location, GPS timeout, Wi-Fi interruption, low-accuracy fix, expired reading and wrong-branch assignment. No failure may silently create a verified punch.
6. Verify clock-in/out times against authoritative server time and actual scheduled start; verify a late arrival and grace minutes. Do not automatically dock wages.
7. Test two concurrent punches (same and different request IDs), an acknowledgement timeout followed by retry, employee logout/session expiry, overnight and split-shift policy boundaries.
8. Test a supervisor-created reasoned exception, correction and audit history; it must remain visibly **SUPERVISOR** rather than `GEOFENCE`.
9. Create a test employee through **People → Add Employee** while signed in as the configured account owner. Confirm appropriate role, branch, temporary credential workflow and attendance-only authorization. Verify a second lower-permission employee cannot create or edit identities.
10. Confirm personally identifying attendance details and CSV exports are restricted by tenant, branch and role. Confirm the operator's privacy notice and retention plan are approved.

**Fail conditions:** GPS accuracy rejects on-site personnel without a workable supervisor exception; employee-owned-phone sign-in unsupported but advertised; fake GPS verification; stale/unconfirmed punches shown as successful; cross-tenant access; unreviewed payroll deduction; raw GPS logs retained without policy.

## POS stability and printing — physical terminal acceptance

- Cashier creates a draft order, adds/removes menu items, enters modifiers and notes, and moves among order/checkout/recall screens without losing work.
- While keeping the draft, interrupt Wi-Fi, simulate recoverable authorization 503, restore service and verify no forced logout, entire-app remount or repeated sync flap.
- Two independent terminals race on one draft: one authoritative revision wins, loser receives a safe conflict and neither duplicates checkout nor kitchen tickets.
- Run an actual **15+ minute idle soak**, background/foreground cycling and intermittent connectivity.
- On actual 58/80mm thermal printers, check invoice identity, logo/receipt styling, currency, VAT/tax totals, rounded cash and noncash amounts, item modifiers, cut/feed, KOT station routing and retries; an uncertain print acknowledgement must not duplicate food production.
- Preserve POS printing, kitchen, bar, menu import and guest ordering regression evidence; compare serial output bytes and actual paper.

## Daily close — financial acceptance

- Confirm the intended mode (`SUPERVISOR_DAILY_CLOSE` default or configured `MULTI_CASHIER_SHIFTS`). Use explicit roles and the business date.
- Reconcile opening float, cash sales, cash expenses, payouts, M-Pesa/card/provider tenders, discounts, taxes and service charges based on real immutable transactions; test missing/invalid evidence and large reconciliation discrepancies.
- Two devices concurrently initiate close: only one commit and one authoritative report/event chain; retries return the original outcome; conflicts never double-post accounting.
- PDF must derive totals from authoritative closing snapshot and include business date, branch, supervisor, tender reconciliation and exception comments.
- Durable email delivery must use a configured approved provider. Test transient failure, retries, deduplication and final receipt in an isolated mailbox. A queued email is **not** proof of delivery.
- Closing must not erase unsent POS orders, unreconciled drawer differences, unposted expense records or cashier work.

## Owner approval checkpoint

Provide a single signed-off release matrix with feature/PR/SHA, test result, actual device location, acceptance operator, known risks, migration plan, rollback plan and explicit go/no-go. Do not change protected branches, deploy, activate geofences or send real emails until the owner authorizes each operation.
