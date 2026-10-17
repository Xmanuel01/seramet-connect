# Geofenced employee attendance — implementation and release contract

## Status
Draft PR #137. **Do not deploy before migration 0028, security audit resolution and physical-device pilot**. This implementation records verified attendance separately from the legacy demonstration transaction-state attendance model. It does **not** automatically amend payroll, deduct wages or certify that browser GPS is tamper-proof.

## User workflows
1. A person with `staff.manage` and `settings.branch.manage`, using **full administrator authentication**, configures accurate coordinates, a 10–500 m radius, maximum GPS uncertainty, maximum reading age, and grace minutes in **People → Attendance**. The feature remains disabled on every branch until deliberately configured. A conservative 10 m radius generally fails in buildings; field-test and select a radius based on real GPS accuracy.
2. An authenticated active employee with `attendance.use` and a branch assignment visits **Attendance** on HTTPS, consents to a one-time precise location request, and taps Clock In / Clock Out. The server verifies location, fixes the authoritative UTC time, applies the branch business date and assigned shift start, persists a session and audit event transactionally, and acknowledges success. If the location fails, no punch is recorded.
3. A supervisor with `staff.manage` may enter a reasoned manual punch or correct an existing punch using record-version optimistic concurrency. All exceptions carry the supervisor identity, reason and immutable append-only event. Location is **not forged** for these exceptions. The supervisor may assign a start time for each employee and download a CSV of the authenticated attendance register.
4. **People → Add Employee** opens the existing authorized Employees workflow. If the logged-in user lacks `users.manage` or `employee.credentials.manage`, the action is present but disabled, with the missing permissions visible. It is **not** safe to auto-grant PIN/identity management to every staff role.

## Privacy and security controls
- Explicit foreground geolocation only. No tracking on sign-in, no background geolocation, no map surveillance, no location history, no raw coordinates saved in punch records. Only verification distance and uncertainty are retained for audit.
- Location data is untrusted browser evidence: GPS can be spoofed or proxied, particularly on jailbroken phones. 10 m cannot be a cryptographic proof of presence. Strict accuracy, age, tenant/branch checks and supervisor exceptions mitigate—not eliminate—this.
- Access is server-side and uses authenticated actor identity, branch assignment and permissions. The browser cannot choose the user for its own punch. All backend times are server generated. Supervisor overrides are separate permission-gated endpoints.
- Unique employee/business-date sessions, stable idempotency keys, closed-state constraints and optimistic version updates prevent double punches and stale overwrites. Session and management events are append-only. Report reads are limited to the actor unless staff management is authorized.
- Secure HTTPS and foreground device location consent are required. POS PIN login currently requires an approved device. **Personal-phone (BYOD) login without trusted-device enrollment is not enabled here**; use existing full authentication or establish a separate secure employee identity/enrollment workflow. Do not disable trusted-device controls to make it work.
- Retention periods, employment notices, branch coordinates and access governance need tenant/legal review before live employee tracking. No default payroll deductions.

## Compatibility and limitations
- Legacy API actions `clockInEmployee` and `clockOutEmployee` are explicitly rejected (HTTP 410) so staff cannot bypass location policy via the old mutation endpoint. Internal legacy `TransactionEngine` demo records and mock schedule data are not authoritative for verified punches. This feature uses `users`/employee login identities and dedicated database tables. Payroll import/reconciliation must be implemented, reconciled and approved before presenting verified attendance as a payslip source.
- One attendance session per employee and business date. Multiple split shifts on one business date are not supported. Clock out uses the employee's open session, including overnight shifts. Supervisor corrections must maintain time order and business-date integrity.
- GPS failure on restricted iOS browser settings, indoors, without HTTPS, or with imprecise permission is an exception flow, **not** a reason to mark the person absent automatically.
- Branch geofence configuration is disabled initially; no automatic IP/Wi-Fi geofencing and no fabricated coordinates. The server never infers that a person's login is a clock-in.

## Validation matrix / launch gate
- SQLite migration 28 and PostgreSQL migration compiler/real PostgreSQL disposable migration job.
- Validate permissions, branch scope, self-only identity, geo stale/inaccurate/out-of-zone denials, disabled default, duplicate keys, double IN, double OUT, overnight shift and supervisor reason requirement.
- Confirm atomic punch and audit event insertion, concurrent two-device same-key and distinct-key conflicts, supervisor correction CAS, management edit CAS and audit immutability.
- Browser test on iOS Safari and Android Chrome (precise/off/denied GPS), Wi-Fi outage, transient auth failure, idle app and newly registered employee.
- Test geofence accuracy in the actual kitchen and at the entrance, from multiple devices, with GPS error logs **without saving raw coordinates**. Ensure the ability to enter authorized exceptions while the GPS is unavailable.
- Check the existing **five critical TanStack advisory findings** and full CI; do not classify a build as releasable with the required security gate failing.
- Complete merge review for pending POS stability and daily-closing PRs; avoid route/remount or migration collisions. Production migrations require explicit owner approval; no live migrations or deployment were performed in this PR.
