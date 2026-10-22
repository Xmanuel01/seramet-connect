# POS Connectivity And Draft Stability

## Verified Baseline

Baseline: `753117fa5ef31d981b420955cfe0afaaf3c169a8` (`origin/main`).
All reproduction and acceptance data are disposable loopback fixtures. Neither staging nor
production was queried or mutated.

An untouched baseline instance was given one HTTP 503 on `/auth/session` during focus:

| Observation                   | Before |
| ----------------------------- | ------ |
| Failed authentication checks  | 1      |
| Browser navigations           | 0      |
| Original input still attached | No     |
| Remaining draft inputs        | 0      |
| Full-screen session error     | Yes    |

This reproduces an application unmount, not a document reload. The source confirms that
the 60-second/focus revalidation replaced `ConfiguredAppProvider` with `SessionGate` on
every exception. Its retry button explicitly reloaded the browser. Separately,
`authenticatedFetch` treated refresh-server errors/timeouts as revoked sessions and
performed a document redirect. No registered service worker, deployment-update reload
listener or automatic router invalidation was found. Fatal route recovery and explicit
sign-in/sign-out navigation are different lifecycles and remain intentional.

Additional confirmed causes/risks:

- A hidden command palette mounted a second transaction reader/replayer on every page.
- Replay locks were per hook, so reconnecting readers could submit the same queue together.
- An isolated transport failure immediately marked the terminal offline. HTTP rejections
  were already distinguished from transport failures, but had no shared recovery policy.
- Background snapshots advanced the global revision while recalled cashier input retained
  older values. A later save could therefore overwrite another terminal's edit without
  using the original editing baseline.
- Cart recovery was memory-only, so a legitimate browser refresh discarded safe input.
- IndexedDB failures in startup replay incorrectly changed online backend health.

## Corrected Contract

One application-owned monitor revalidates the authenticated session silently. Unchanged
actors reuse their context; restaurant configuration still refreshes on explicit request,
actor/access changes and a bounded five-minute interval. Recoverable failures retain the
mounted application. Confirmed 401/403 session rejection still removes access and clears
interactive draft recovery. Every server command retains its existing authorization.

Connection health has ONLINE, DEGRADED, OFFLINE and RECONNECTING transitions. The UI derives
scope-specific SYNC_CONFLICT from authoritative revision conflicts, independently of link
reachability. One transport failure degrades health; three consecutive transport failures
or an actual browser offline signal mark it offline. HTTP 503 never means Wi-Fi disconnected.
Recovery requires authenticated verification and two successful checks after an outage.
Checks are single-flight, focus-throttled, deadline-bounded and use capped exponential
backoff with jitter. Background checks never display a full-screen loader.

Saving, pending queue entries, replay activity and unavailable offline storage are separate
from connection health. An idle queue makes no replay request. There is no perpetual
SYNCING state. The hidden command palette no longer starts a transaction reader.

Realtime/focus events retain the existing one-active/one-trailing coordinator. Authenticated,
authorized revision checks omit full transaction snapshots when unchanged. Pending local
commands retain their optimistic snapshot. Commands and responses are actor/device/branch
scoped; late responses cannot populate a different scope.

Replay uses a shared in-tab lock and Web Locks across same-origin tabs where available.
It filters to the current actor, device and branch, uses batches of at most 50 and preserves
original idempotency identities. Only PENDING/SYNCING commands replay automatically;
rejected/failed/conflicting outcomes remain unresolved for review. Missing acknowledgements
are never success. Existing server offline policy, financial validation, CAS commits and
KOT obligations are unchanged. IndexedDB writes await transaction completion, not just the
individual put request. Storage denial leaves online authoritative operation usable but
does not enable an in-memory substitute for durable offline commands.

New offline commands require a trusted device and authentication verified within five
minutes. This bounded queuing window is not permanent cached permission: replay always
reauthenticates and reauthorizes on the server. Longer outages require verification before
further queued work; already persisted commands are retained.

## Draft Recovery And Conflicts

Session-storage recovery is tenant/branch/cashier/device scoped and expires after 12 hours.
Only quantities, preparation notes, selected order/table/channel, an opaque customer ID and
the editing baseline are persisted. Payments, PINs, access tokens, contact details and
provider references are not serialized. Customer identity is reloaded through the authorized
CRM endpoint; unresolved customer recovery blocks saving rather than silently dropping it.
Logout/confirmed session rejection clears draft recovery. Storage failure cannot crash the
mounted editor. Non-POS forms retain their existing in-memory state during silent checks;
this is not a generic persistence mechanism for every form in the application.

A recalled order retains a SHA-256 digest and authoritative revision for its editing
baseline. A changed remote order forces the existing server CAS conflict instead of
submitting old input against the newer background revision. Unrelated order updates do not
force that conflict. Explicit recall/review can load the latest order; no automatic merge
or automatic retry of conflicted financial commands is introduced. Historical accounting,
payment, authorization, branch boundaries and print recovery remain unchanged.

## Evidence And Repeatability

The browser suite records bounded, memory-only lifecycle entries with random correlation
IDs, event kinds, timestamps and numerical counters. It records no URLs, credentials,
customer data, SQL or command bodies. Playwright separately observes document navigations
and tracks component identities. React development StrictMode's initial effect probe is
distinguished from a later component replacement; post-entry unmounts still fail acceptance.

Commands:

```sh
node scripts/run-pilot-e2e.mjs tests/e2e/pos-stability.spec.ts tests/e2e/pilot-two-terminal.spec.ts
node scripts/run-pilot-e2e.mjs tests/e2e/pos-session-soak.spec.ts
```

The soak runs for 15 actual minutes, not an accelerated clock, and is an explicit acceptance
run rather than a hidden skipped test in ordinary CI. It asserts no unexpected navigation,
remount, full snapshot download, idle replay or lost input, with repeated focus/blur and
authenticated checks. CI runs the shorter failure/recovery suite plus existing multi-terminal
and PostgreSQL gates. Sanitized JSON evidence is retained for 14 days by the browser workflow.
Raw Playwright traces may contain disposable authentication fixtures and are not included in
that artifact. Local evidence is under `.seramet/pos-stability/`.

Final test results and exact candidate SHA are recorded in the PR. A local engineering pass
does not certify real restaurant networking, physical printers, live providers or production.
No merge, manual deployment or live database operation is part of this change.

### Recorded Acceptance

Application candidate: `8e03bfe5918e38080ddaeff52e856891d5ab9f65`.
The subsequent correction only makes the browser fixture search for its seeded meal after
the existing import test adds 41 items to the paginated menu; application code is unchanged.

- 56 focused unit/security/persistence tests passed, including offline authorization,
  duplicate replay, revoked device rejection and authorized unchanged-revision reads.
- Typecheck, repository lint (warnings only), build, bundle audit and diff checks passed.
- Ten browser acceptance scenarios passed together on the unchanged application candidate,
  including the three existing multi-terminal/clock/branch tests and six new failure,
  recovery, IndexedDB and stale-order-conflict cases.
- The soak lasted 903,200 milliseconds: zero navigations, zero idle replay requests,
  zero full snapshot downloads, 16 authenticated session checks and 32 revision checks.
  No post-entry application/POS unmount or input loss occurred.
- Sanitized before/after traces are committed in `docs/evidence/pos-stability/`.
- The first full CI browser run passed the twelve existing scenarios but could not locate
  the seeded meal in any of the six new scenarios after menu-import pagination. The fixture
  now searches explicitly, as the existing two-terminal test does. Assertions are unchanged.
- The required dependency audit still reports five critical TanStack dependency findings
  associated with `GHSA-qx66-fv34-fjm8`. This is not suppressed or fixed by unrelated changes.

Final CI and PostgreSQL outcomes are reported separately in the PR. They must not be inferred
from the successful local soak, and the outstanding dependency-security check blocks release.
