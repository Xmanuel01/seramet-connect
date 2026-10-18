# Front of House consolidation

## Changes

- Removed the standalone Tables sidebar entry. Front of House now opens `/tables`.
- The shared workspace orders its tabs as Tables, Reservations, Seating,
  Waiting List, Guest requests. Existing deep links remain registered.
- Front of House remains the active sidebar destination on all five tab URLs;
  the Sales group stays expanded. These are visual navigation aliases only,
  not permission aliases or redirects.
- Moved the existing table setup/edit controls into a reusable workspace panel,
  preserving their server endpoints and permission checks. Table and dining-area
  changes refresh the authoritative host projection without browser navigation.
- Tables use the existing host API's live status, not an assumed Available value.
  Removed unsupported placeholder amounts, waiter/time fields and a date filter
  that did not filter the live table data. No stored business data was removed.
- A failed host request remains an error, not a false empty reservations/table
  result. Metrics show unavailable values instead of invented zero totals.
- Each existing tab route now passes its own view to the shared component. A
  global pending location previously exposed the Seating form before the target
  route committed, allowing a later mount to reset newly entered guest details.
  Browser acceptance now asserts the guest name survives party/table selection.

## API failure correction

The host reservation query used SQLite `GROUP_CONCAT` and selected non-grouped
reservation fields while grouping only by ID. The PostgreSQL adapter neither
rewrites the aggregate nor provides this function. This is a confirmed
source-level PostgreSQL incompatibility consistent with the photographed 500.
Live database logs were not accessed; no claim is made that every possible
deployment/configuration failure has been eliminated.

The host query now reads at most the existing 500-reservation limit, then loads
their active table assignments in one parameterized, tenant/branch-scoped query.
Table codes are joined deterministically in application code. Released assignments
and wrong-branch table references are excluded. There is no N+1 query, dialect
specific aggregate, schema migration, fallback data or authorization bypass.

Browser acceptance also confirmed an independent error-propagation defect:
`handleGuestApi` returned `handleGuestAdmin` without awaiting it inside its try
block. Asynchronous permission denials escaped the existing `GuestDomainError`
handler and became generic 500 responses. The one-line `return await` correction
preserves the guard and returns its intended 403 (or validation status), without
allowing access. A focused API regression checks this exact failure.

## Focused validation

- 43 service/navigation/module-access tests passed, including permission-scoped
  data, branch rejection, active/released assignments and aggregation regression.
- Both browser scenarios passed, exercising all five tabs, table creation, walk-in seating,
  live occupancy, no full-document reload between tabs, narrow-screen overflow,
  branch isolation, and API failure/recovery without false empty states.
- Desktop/phone captures are in `.seramet/front-of-house-acceptance/`.
- Typecheck, focused ESLint, formatting, production build and diff checks passed.

Two initial browser assertions were corrected using actual evidence: the table
selector needed the combobox's accessible name, and the original negative
branch fixture was a legitimately all-branch manager. The corrected fixture then
exposed the genuine asynchronous error-propagation defect, which was fixed rather
than accepting a 500 as an authorization denial. The final branch denial
uses the existing branch-restricted account and asserts the specific branch
access error. No authorization policy or timeout was weakened.

Only disposable local data was used. No staging or production connection,
database mutation, merge, push or deployment was performed. Real PostgreSQL and
the deployed staging endpoint were not exercised in this change; verification
against the approved deployed candidate remains separate from local evidence.
