# Attendance completion findings

Baseline: PR #137 at `43b7a2dac3a41063a5d336b8a0695f13fd6800f1`.
Scope: attendance and employee identity; protected databases are not accessed.

| Area                        | Verified baseline                                                                                        | Required completion                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GPS and authorization       | Implemented; 14 browser scenarios and disposable PostgreSQL passed                                       | Expand negative mobile, identity and uncertain acknowledgement coverage                                                    |
| Session/event atomicity     | Implemented with revision uniqueness and one-open-session index                                          | Split-shift and cross-session correction rules                                                                             |
| Employee creation           | Server requires full authentication and both management permissions                                      | Blank optional email is submitted; retry changes effective date while retaining the key; verify actual creation in browser |
| Personal phones             | Device PIN deliberately requires an enrolled terminal; external accounts require existing identity links | Bounded existing-account attendance navigation; no PIN/device bypass or automatic identity linking                         |
| Scheduling                  | Only a recurring start is authoritative; Schedule page edits illustrative local state                    | Replace illustrative page with the same authoritative schedule editor; capture end/OFF explicitly                          |
| Reporting                   | Current register only; open overnight records included                                                   | Date filters, correct distinct-person metrics, work duration, correction history, audited scoped exports                   |
| Reliability                 | Scoped response guards and duplicate protection implemented                                              | Bounded requests, durable non-sensitive pending keys, acknowledged/unknown states and foreground reconciliation            |
| Privacy                     | No continuous location and no raw GPS punch retention                                                    | Export audit, employee notice and owner-approved retention procedure                                                       |
| Dependencies                | Five audit findings represent a vulnerable TanStack dependency chain                                     | Finish existing prerequisite PR #136, align plugin/core and certify the coherent graph                                     |
| Protected migration history | No live access authorized                                                                                | Owner confirmation required before editing unreleased migration 28; otherwise preserve history additively                  |

No payroll deductions, financial accounting, POS terminal trust, live migration or
notification delivery is authorized by this work.

## Corrections on the completion candidate

- Added split-shift sessions and immutable recorded schedule/timezone/cutoff
  snapshots in migration 29, without rewriting migration 28. Owner confirmed that
  28 has only been applied to disposable databases. Existing row/event identities
  are explicitly tested through the 28-to-29 upgrade.
- Serialized all attendance writes per employee, including corrections racing
  against another split session. The claim cannot commit without its audit event.
- Bound clock-out to the selected session and revision. An old terminal/request
  cannot close a newer split shift; recovery preserves the original target and
  acknowledges a repeated original request without mutating the new session.
- Added reason-only EXPLAIN, range/source/status history, exact-session revisions,
  UTC worked duration, conservative early departure, and audited CSV exports.
- Removed the illustrative local schedule grid; `/schedule` uses the authoritative
  recurring schedule editor. This is not a date-specific weekly rostering system.
- Corrected employee payloads, stable creation retry, creator-bound acknowledgement
  lookup, owner-role exclusion, full-auth UI gating and active-role/employment
  revalidation. No permissions were broadly granted to enable a button.
- Added scoped, bounded attendance drafts and acknowledgement recovery. Refresh
  remains foreground-only and does not navigate, poll GPS or reset active inputs.
- Linked-account attendance navigation is available without POS enrollment;
  automatic PIN-only personal-phone enrollment remains intentionally unavailable.
- The actual employee-creation browser journey exposed a category-wide navigation
  defect: attendance-only employees passed the API permission check but were denied
  the page by `staff.view`. A dedicated attendance route decision now permits that
  page without exposing People, Employees, Schedule, Payroll, Finance or POS, and
  inherits existing staff policy denials. Employee register uses `users.view`.
- The strict newly-created identity bootstrap assertion then exposed a stale
  configuration cache. Employee creation now invalidates the existing authoritative
  cache only after the creation service acknowledges; no assertion was relaxed.
- Security patch remains separately reviewable in existing PR #136. npm 11 drops
  Nitro's optional peer lock entry; retain that entry for the required npm 10 clean
  install. No audit suppression or forced major upgrade is used.
- Final credential review confirmed that the temporary-PIN flag was previously
  advisory only. Added a device-bound own-PIN completion flow and denied ordinary
  protected APIs until completion, with history-backed concurrency, setup-session
  revocation, rate limiting and a real service/API test plus browser UI acceptance.
- Aggregate CI exposed an unrelated printer assertion matching a table cell and
  a select option. Scoped the assertion to the printer cell; no printing code,
  timeout or duplicate-row assertion was weakened.
- The employee-register browser run exposed an initial-load readiness gap:
  Add Employee was enabled in server markup before the scoped load/hydration.
  It now starts disabled and remains disabled during loading; the browser holds
  that GET deliberately and verifies the disabled-to-enabled transition.

Certification is recorded against the final pushed SHA in PR #137. Earlier
784-test / 14-browser evidence is baseline evidence only, not proof of this new
candidate. Physical GPS, live identity-provider linking and owner-approved privacy
retention remain distinct operational gates.
