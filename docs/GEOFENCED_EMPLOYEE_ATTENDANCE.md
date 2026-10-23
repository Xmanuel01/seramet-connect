# Geofenced attendance: implementation and release contract

## Release status

Draft PR [137](https://github.com/Xmanuel01/seramet-connect/pull/137), with the
coherent dependency patch reviewed separately in prerequisite
[136](https://github.com/Xmanuel01/seramet-connect/pull/136). No merge or protected
deployment is authorized. CI and simulated location do not certify physical GPS.
The final exact-commit CI evidence is recorded in the PR, not inferred from older runs.

## Workflow and permissions

| Operation                                                                       | Server-enforced authority                                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Own attendance, history, CSV, IN/OUT                                            | `attendance.use`, active employment, assigned active branch           |
| Roster, historical records, reasoned exceptions/corrections, recurring schedule | `staff.manage`, authorized branch scope                               |
| Geofence settings                                                               | FULL account authentication, `staff.manage`, `settings.branch.manage` |
| Employee register                                                               | `users.view`                                                          |
| Create employee/PIN and creation-status lookup                                  | FULL authentication, `users.manage`, `employee.credentials.manage`    |

Use People -> Attendance for clocking; Schedule uses the same authoritative
schedule editor. Employee sign-in does not clock IN. Closing a tab never clocks
OUT. Supervisor exceptions use a separate endpoint and are never labelled GPS
verified. Unrecorded employees are not automatically marked absent.

People and Attendance statistics count distinct employees server-side. A return
to work on the same business date creates a separate session; it does not count
as a second employee. Live register/roster reads are bounded to 500 records;
history provides 200-session pages over at most 31 business dates. CSV has an
explicit 5,000-session cap; narrow filters rather than silently truncate.

## Authentication and personal phones

Attendance has a dedicated route permission decision; `attendance.use` does not
grant `staff.view`, employee administration, scheduling, payroll or POS access.
An explicit existing staff-module DENY still denies the attendance route.
Employee register navigation follows `users.view`, matching its API.
Its dedicated decision retains explicit staff/users policy denials without
changing permission decisions for unrelated settings pages.
Configuration bootstrap returns only the caller's employee identity unless
`users.view` or `staff.manage` permits the roster; hiding navigation alone would
not protect other employees' identity data.

Trusted-device PIN authentication remains mandatory for POS terminals. An
attendance-only role can use an authorized terminal without receiving POS,
payment or financial permissions. The verified role permissions determine the
post-login destination. Inactive roles no longer contribute permissions; expired
employment and revoked/expired sessions are denied during server revalidation.

The POS login is the shared employee entry, including attendance-only staff.
The only alternate link there is **Use administrator account**, leading to
`/login?account=1` for administrator sign-in or restaurant registration.

The existing invitation-linked account route is retained for an employee whose
external account is **already explicitly linked** to that authoritative employee
identity and whose role permits attendance. It does not enroll the phone as a POS
terminal and is not advertised as a second login on the POS entry page.

**Bounded BYOD limitation:** Add Employee creates a PIN identity, not a Supabase
account/invitation or an external-identity link. Entering an email does not prove
ownership and must not auto-link it. A newly created PIN-only employee cannot
self-enroll an arbitrary phone. Secure employee invitations/account linking need
a separately reviewed identity workflow; this PR does not claim universal BYOD.

## Add Employee

The button requires both management permissions and FULL authentication. It
explains missing authority instead of granting it. Account-owner assignment is
excluded; ownership transfer remains a distinct guarded operation. Assigned roles
cannot exceed the creator's permissions, and branch assignments remain scoped.

Blank optional contact fields are omitted, not sent as invalid email strings.
Creation uses one stable key and effective timestamp. After an uncertain response,
the same authenticated creator can check the stored result before retrying the
unchanged request. Identity uniqueness and transaction rollback protect different
keys racing for the same employee code. PINs remain in transient form memory and
are never persisted in browser draft storage. A reload clears that sensitive form;
check the authoritative roster before attempting new creation. Temporary PIN
change and existing PIN hashing/rate-limit protections are retained.
Temporary PIN sessions cannot authorize ordinary protected APIs. The employee
must replace the PIN on the matching enrolled device, confirm the existing PIN,
and pass the existing PIN policy. Completion atomically archives the prior
credential, replaces its hash, revokes setup sessions and audits the change.
The employee signs in again with the new PIN; no secret is saved in browser drafts.

## API contract

All paths below are under `/api/seramet/attendance`; authenticated tenant/branch
headers are selectors, never authority. Reads are `no-store`. Writes require
same-origin requests and per-actor rate limits.

| Path                           | Behavior                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /?branchId=`              | Own latest/open session, recurring schedule, branch business date/timezone; authorized managers also receive roster and distinct counts   |
| `POST /punch`                  | Own IN/OUT only; fresh GPS, UUID key, authoritative server timestamp                                                                      |
| `GET /requests/:key?branchId=` | Own actor-scoped acknowledgement recovery; no key hashes or GPS exposed                                                                   |
| `POST /supervisor`             | IN/OUT now, CORRECT_IN/CORRECT_OUT for exact session+expected version, or EXPLAIN without changing timestamps; meaningful reason required |
| `PUT /geofence`                | Full-account policy CAS and immutable old/new audit                                                                                       |
| `PUT /schedule`                | Recurring start/end/OFF assignment CAS and immutable old/new audit                                                                        |
| `GET /records`                 | Date, employee, status, source and bounded offset filters; employee sees self only                                                        |
| `GET /sessions/:id/history`    | Authorized employee/manager immutable revision history, original/corrected values and operator reason                                     |
| `GET /export`                  | Same filters and authorization, local timezone plus UTC columns, spreadsheet-formula escaping, immutable access audit                     |

Export failures do not claim successful delivery. Export audit records record
authorized access/issuance, not proof that the user opened the downloaded file.

## Geofence policy

New branches start disabled with no guessed coordinates. Authorized configuration
defines latitude/longitude, radius 10-500 m, maximum accuracy 1-100 m, maximum
reading age 5-120 s, and late grace 0-120 min. Revision/last editor/time are visible
to authorized managers. Policy and schedule changes use optimistic concurrency.

The distance test requires the location's uncertainty circle to fit inside the
radius; a marginal/inconclusive fix is rejected. Stale/future/invalid coordinates,
poor accuracy, disabled configuration, unauthorized branch and inactive employee
fail closed. IP location, Wi-Fi and selected branch are not presence evidence.
The browser uses foreground high-accuracy location only on an explicit punch.
Permissions Policy permits same-origin geolocation with user consent; camera,
microphone and payment capabilities remain disabled. No background GPS polling.

A 10 m indoor policy often rejects genuine staff; validate at the actual entrance.
GPS is spoofable and is not cryptographic proof of presence. Stronger controls
require proportional owner/privacy review, not covert tracking.

## Scheduling and calculations

Assignments are **recurring**, not a fabricated weekly/date-specific roster.
Start/end and OFF are explicit. No schedule means lateness/early departure is
unavailable, not invented zero. Each new session snapshots its schedule, timezone,
cutoff and grace. Later policy changes do not rewrite recorded assessments.
Historical rows without these snapshots retain nulls.

Business dates use the existing branch timezone/cutoff helper. Starts before the
cutoff belong to the next calendar morning of the business date. Open sessions
stay visible after midnight/cutoff. Closed sessions can be followed by a genuine
split shift; only the first recorded daily arrival is assessed against shift start.
Corrections cannot overlap another session or move the original business date.
Correction input explicitly identifies the operator browser timezone before UTC
conversion; records/exports display the selected branch timezone and UTC.

Worked minutes are whole elapsed UTC minutes between actual timestamps. Early
departure is a per-session scheduled-end comparison, **not a wage deduction or a
final day absence decision**. Across a DST offset transition, that scheduled
comparison is unavailable until a disambiguation policy is approved; actual UTC
duration remains valid. Overtime is unavailable: no approved overtime/break/payroll
policy is invented. Legacy payroll remains separately labelled historical.

## Integrity, migration and recovery

Migration 28 is unchanged. Additive migration 29 preserves existing session/event
identities and hashes while removing the one-session-per-date restriction. It
rebuilds only the two attendance tables inside the existing official migration
transaction, retains one-open-session uniqueness, adds schedule snapshots and
end/OFF, and adds employee revision/claim and export-audit tables. All eight
attendance tables enable PostgreSQL RLS; appropriate grants still belong to the
existing guarded lockdown, not client code. No live migration was executed.

Every employee mutation claims the next unique employee revision in the same
transaction as session and event writes. A deferred foreign key requires the
claimed immutable event to exist at commit. This serializes corrections against
new split sessions as well as same-session edits. Losers roll back without orphan
events/claims. Session-event and management revision uniqueness remain enforced.
Same-key semantic replay returns the prior result; altered key reuse is rejected.
Fresh GPS may be reacquired for retrying the same self-command.
Clock-out commands bind the exact open session ID and expected revision. A stale
terminal cannot close a newer return-to-work session; pending retry storage keeps
the original target, and same-key replay acknowledges the original closed session.

Foreground status refresh is bounded, single-flight and pauses while hidden or
mutating; it never navigates/reloads the application or requests GPS. Background
reads preserve policy/exception inputs. Selected correction revisions are captured
and checked server-side. A timeout is not confirmation. Non-sensitive self-punch
keys survive reload in session-scoped storage, and status is checked before retry.
Offline punches are **not** queued as proof of attendance.

Draft storage is tenant/branch/user/device/session scoped with an eight-hour TTL
and an allowlist (selection, reason, correction input, pending key). No coordinates,
PINs, tokens or credentials are stored. Successful logout removes attendance drafts;
storage unavailability must not grant authority. Branch switches discard visible
state and stale responses; they cannot import another cashier's draft.
Confirmed permission/authentication-level changes also change the visible-data
scope. A demoted supervisor cannot use an old request key to retrieve another
employee's session.

Owner-approved release procedure: review both PRs and exact CI -> establish current
recovery/restore evidence -> review migrations 28 then 29 against the actual schema
and dedicated Worker role -> authorize protected execution separately -> verify
RLS/grants/Worker compatibility -> configure each branch intentionally -> run the
physical pilot. This document does not authorize any step or promise automatic
rollback of committed migrations. Never erase the immutable ledger to repair a
punch; use an authorized reasoned correction.

## Privacy and owner decisions

Retain distance/accuracy and decision/audit evidence, not precise raw GPS fixes.
Exports and history are scoped; no permanent public links, no real notifications.
Provide staff with notice of purpose, required fields, rejection/exception path,
authorized recipients, storage provider/location and access/correction contact.

Before use, the owner must approve a documented attendance/audit/export retention
period and lawful deletion/anonymization procedure, accounting for employment
record obligations. Append-only audit must not be disabled by a UI deletion action;
no destructive purge is introduced here. Review processor/cross-border arrangements
and whether a DPIA or registration is applicable. This is not a compliance opinion.
Primary references: [ODPC rights](https://www.odpc.go.ke/rights-of-a-data-subject/),
[guidelines](https://www.odpc.go.ke/guidelines-2/), and
[Kenya data-protection laws](https://www.odpc.go.ke/data-protection-laws-kenya/).

## Physical pilot (not certified by Chromium)

1. With disposable employees/authorized roles, test iPhone Safari and Android
   Chrome over HTTPS: precise permission, denied permission, approximate GPS,
   timeout and reload. Confirm no automatic punch on sign-in/tab close.
2. At the entrance and kitchen, field-test accuracy against the configured radius;
   verify inconclusive fixes reject and supervisor exceptions remain visibly manual.
3. Test wrong/unassigned branch, new temporary PIN on an enrolled device, linked
   account on a phone, revoked identity and missing permission. PIN-only BYOD is
   intentionally unavailable.
4. Clock IN/OUT, return for a split shift, work overnight and verify branch cutoff;
   preserve original timestamps through a reasoned explanation/correction.
5. Interrupt acknowledgement, reload and check the pending request; verify one
   session/event and safe retry. Compare manager history/CSV in the branch timezone.
6. Approve privacy/retention and scheduling/payroll boundaries before collecting
   real workforce data. Owner review and physical acceptance remain release gates.
