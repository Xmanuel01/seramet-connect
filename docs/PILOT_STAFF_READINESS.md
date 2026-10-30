# Staff pilot integration candidate

## Release boundary

This draft candidate integrates the existing closing, printing, POS stability,
attendance and security branches locally. It does not authorize their merge,
deployment or application of migrations to a protected database.

The new staff workflows require migration `0030_staff_pilot_workflows.sql` after
the existing migrations. SQLite fixtures and disposable PostgreSQL certification
use the official repository migration mechanisms. No production or staging data
is seeded by this implementation.

## Workflow and authorization contract

| Actor / surface                   | Allowed                                                                                 | Not granted                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Every assigned active employee    | Attendance, own delay history, report expected delay                                    | Clock-in outside the configured geofence, attendance fabrication                         |
| Chef phone                        | Published cookbook, assigned preparation tickets                                        | Sales, financial records, purchasing approval, unpublished recipes                       |
| Head chef phone                   | Chef workflow, recipe edit/publish, production, stock requests                          | Sales, purchasing approval, employee administration                                      |
| Bartender phone                   | Published food/cocktail cookbook, assigned bar tickets, stock requests                  | Sales, purchasing approval, other stations                                               |
| Cashier phone                     | Read-only branch orders, attendance                                                     | Order writes, dispatch, invoices, payments, cash drawer writes, financial offline replay |
| Enrolled active sales terminal    | Existing permissions and POS device policy                                              | Another branch's sales commands, ungranted operations                                    |
| Active account owner, any browser | POS, sales and payments in the active branch, as on an enrolled terminal                | Another branch's sales commands; not extended to other administrators or managers        |
| Supervisor                        | Branch attendance/delay inbox and decisions, configured management access               | Self-approval of a delay, implicit financial permissions                                 |
| Authorized employee administrator | Existing Add Employee, explicit role presets, station assignments, invite/status/revoke | Automatic account linking by matching email, silent privilege escalation                 |

These are explicit permission presets, not checks against role names. Existing
module-level denials still apply. Applying a preset replaces a selected role's
permissions only after explicit administrator confirmation through the existing
access API. Review every role assignment before rollout. Closing and finance
permissions must be assigned explicitly; the supervisor preset is not an owner
or finance-administrator shortcut.

### Delay reporting

`Attendance → Report a delay → expected arrival + reason → branch supervisor
inbox/badge → review → approve/reject with note → employee history`.

No location is required to report an expected delay. The server computes the
request's business date from its expected arrival using branch timezone/cutoff.
Submission keys and payload fingerprints are durable. One pending request per
employee/branch/business date is permitted. Concurrent decisions use a revision
claim and append-only audit event; one supervisor wins. Read receipts belong to
the reviewing supervisor. The shared foreground poller is single-flight and
never navigates, reloads or invalidates POS drafts.

Approval does not create attendance, change actual arrival, excuse recorded
lateness, or change payroll. Geofence radius/location remain authorized branch
configuration. The out-of-radius message uses the configured radius:

> Unable to check in or out. You must be within 10 metres of your workplace.
> Move closer and try again, or contact your supervisor.

`10` above is an example, not a fixed application limit. Delay requests are
server-acknowledged, not silently queued as successful offline attendance.

### Personal-phone identity

`Authorized administrator creates employee → assigns role/branches/stations →
invites individual email → provider verifies email → employee activates password
→ fresh sign-in at /staff-login → assigned restaurant → Attendance`.

The existing terminal PIN/device activation flow is retained. Phone credentials
are not shared terminal PINs. Invitation tokens remain in component memory;
URL fragments are removed immediately and refresh tokens are discarded.
Activation binds the provider's verified subject/email to an active employee and
the original branch-assignment snapshot. It requires a fresh login afterward.

Server-only prerequisites, not provisioned by this PR:

- Existing Supabase identity provider, verified HTTPS public origin and project URL.
- Existing publishable key and separately protected
  `SERAMET_SUPABASE_INVITATION_SECRET` with invite capability. Never expose this
  key in browser configuration, source, logs or reports.
- Supabase redirect allowlist for the protected environment's `/staff-login`
  invitation callback and working invitation email delivery.
- Individual employee emails verified by the provider, appropriate permissions,
  active branch assignments and explicit preparation-station assignments.

An ambiguous provider response is recorded as FAILED or remains in-progress
after a process crash. There is no automatic resend or identity relink. An
administrator must inspect status/provider evidence and revoke an outstanding
invitation before an explicitly reviewed retry. Revocation prevents unfinished
activation; it is not presented as revocation of an already activated account.
Use the existing employee suspension/session-revocation controls for that case.

### Terminal and station enforcement

Server authentication derives device identity from the verified session. An
active, unrevoked `POS_TERMINAL` enrolled to the current branch is required for
sales writes. Headers, viewport, role names and printer discovery are not proof
of terminal enrollment. The same command authorization applies to offline replay.

Kitchen/bar mutations additionally resolve the exact active branch/station and
check explicit employee assignments. No assignment grants no station access.
Configured KDS operating modes and BAR_MODULE capability are not bypassed.
Phone transaction reads are projected to orders only; kitchen-only readers see
their station lines without financial/customer-private records. Zero-valued KDS
price fields are presentation redaction, never persisted accounting values.

Enrolled sales readers with order-view permission retain unchanged-revision
responses, including supervisors who also hold kitchen permissions. Phone and
station-filtered readers recheck their projection even when the transaction
revision is unchanged, because station/device access can change independently.
The combined browser gate caught and corrected an overly broad kitchen-permission
condition that had disabled the enrolled POS fast path.

### Stock requests and cookbook

The limited stock-request workspace lists active items/base units, authorized
warehouses and the employee's own requests. It uses the existing requisition
creation pipeline and a stable disposable/request identity through uncertainty.
It does not create purchases, approve requisitions or deduct stock.

Ordinary readers receive only published recipes. Head chefs/supervisors require
explicit cookbook manage/publish permissions for editing. Food and cocktail
content use the existing cookbook model; no parallel cookbook is introduced.
The owner-approved pilot recipe list and resolved cocktail measures/yields are
still required. No recipe content, operational quantities or selling prices
have been invented or published by this work.

## Validation evidence

Local and CI results must be read against the final candidate SHA in the PR.
Intermediate passing runs are not release certification of later changes.
The candidate includes focused delay, invitation, device/station, direct HTTP,
published-recipe and PostgreSQL concurrency cases plus mobile browser scenarios.
Live invitation email and physical printer delivery cannot be certified by the
mocked provider or browser emulator.

## Owner acceptance and remaining release gates

1. Review the combined draft, migrations and existing stacked prerequisites;
   approve merge/rollout separately. Keep imports fail-closed unless genuine
   authenticated malware evidence passes the existing scanner gate.
2. Through the existing protected release/recovery controls, authorize any
   schema rollout separately. This PR does not execute that rollout.
3. Configure staff invitation delivery securely; use disposable staff accounts
   to verify invitation, verified email, password setup, sign-in, revocation,
   logout/reload and changed/suspended assignments in the protected environment.
4. Apply explicit role presets and station assignments. Verify chef, head chef,
   bartender, cashier and supervisor on separate actual phones and terminal.
5. Supply the approved recipe shortlist/content, including cocktail measures and
   yields. Publish only reviewed records; do not treat fixtures as menu content.
6. Run one realistic shift: outside-radius denial; remote delay and supervisor
   decision; actual in-radius attendance; cashier phone write denial; enrolled
   POS order/KOT/payment; kitchen/bar preparation; stock request; published
   recipe reading; closing cash reconciliation and immutable closing PDF.
7. Separately verify physical ESC/POS paper, failure/uncertain delivery/reprint
   recovery, closing email provider and M-Pesa sandbox where credentials exist.

CI success is engineering evidence, not permission to modify live data or a
claim of restaurant operational certification. Physical output, real phones,
approved content and protected provider configuration remain explicit gates.
