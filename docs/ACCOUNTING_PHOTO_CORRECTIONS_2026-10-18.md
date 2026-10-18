# Accounting photo corrections

Date: 18 October 2026

Checkout: `seramet-pilot-completion`, branch `codex/pilot-staff-integration`.
Base candidate: `b142d72501597a6a6766ea5e6b91346ff1aec144`.
Corrections are local and uncommitted. No live database was inspected or changed.

## Photo findings

| Photo | Finding                                                                        | Outcome                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Generic route error; no URL, page name or exception is visible.                | NOT VERIFIED. Asked which page failed. No crash cause or fix is claimed from the photograph.                                                                                                                                            |
| 2     | Tax Centre reports missing chart, journal evidence and cash classification.    | These safeguards remain. Added readable issue titles, next steps and an accounting-mapping link. Tax filing remains explicitly unavailable, not fabricated.                                                                             |
| 3     | Daily Sales Journal offers warnings and navigation but no actual journal rows. | Added the existing authorized, server-paginated ledger read model, clearly labelled as all posted sources rather than a calculated sales journal.                                                                                       |
| 4     | Sidebar includes Budgets, Cost Centres, Credit & Debit Notes and Depreciation. | The current local candidate already excludes these four unsupported modules from navigation. No additional removal or claim of completed functionality was necessary. The deployed photograph is not proof this candidate was deployed. |

## Confirmed calculation defect

`FinancialLedgerService.statement()` used lifetime debit/credit movement to decide
whether the selected period had posted journals. Older opening balances therefore
suppressed `NO_POSTED_LEDGER_ENTRIES` for an empty period. The check now uses period
debits/credits only. Opening balances, statement amounts and immutable journals
are unchanged. A regression preserves a 1,000-minor-unit opening cash balance
while proving the following empty period reports no current journal activity.

## Boundaries and remaining configuration

- The photographs indicate incomplete accounting configuration; the actual live
  database state was not independently queried during this correction.
- Setup Centre's accounting section maps existing accounts and records finance
  sign-off. It does not create a chart of accounts. The new guidance states this
  explicitly; the link is not represented as a complete setup wizard.
- A payment method named Cash does not prove that a ledger account is classified
  as `CASH` or `BANK`.
- Posted journals, approved account mappings and source-linked revenue coverage
  must be established through an authorized accounting workflow. This correction
  neither backfills revenue nor posts balancing entries.
- Tax returns require verified jurisdiction-specific configuration and input-tax
  evidence. This work does not implement filing or present unavailable values as
  zero tax liability.
- Existing tenant/branch authorization and read-only finance APIs are reused.
  Invalid date filters produce inline errors, not an application crash.
- The earlier site-audit manifest describes the earlier unchanged candidate,
  not the application after these corrections.

## Targeted evidence

- 17/17 tests passed across financial-ledger-service, finance-issue-guidance and
  finance-period-state.
- TypeScript typecheck passed.
- Production build passed.
- Formatting and `git diff --check` passed.
- Focused ESLint passed with zero errors; the two existing mixed-export
  Fast Refresh warnings in `finance-ui.tsx` remain.
- Accounting browser acceptance: 1/1 passed. Exercises Daily Sales Journal,
  Tax Centre and General Ledger at 1440x1000 and 390x844, preserves missing-setup
  warnings, checks empty-journal pagination, checks the setup link, and verifies
  invalid-date errors and recovery. No uncaught page errors or document overflow.
- Six screenshots: `.seramet/accounting-photo-fixes/`.
- No comprehensive certification rerun, live migration, merge or deployment.

Photo 1 still requires the failing route and a reproducible exception before a
targeted crash correction can be made. These changes are not a claim that all
four photographed concerns or the full accounting lifecycle are resolved.
