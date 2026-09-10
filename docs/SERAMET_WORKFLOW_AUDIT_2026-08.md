# Seramet Workflow Audit — 15 Aug 2026

Source of truth: the current Seramet codebase. This document records what the master
specification asks for, what the project already does, what was safely added in this pass,
and the decisions that are still owed by the business owner.

## 1. Already implemented (no change made)

| Spec area                                                                 | Where it lives                                                        |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| POS, order lifecycle, hold, send-to-kitchen                               | `src/routes/pos.tsx`, `src/lib/transaction-engine.ts`                 |
| Bill / invoice / receipt distinction, merge, split                        | `src/routes/invoices.tsx`, `pending.tsx`, `receipts.tsx`              |
| Payments, split payment, refunds, reversal                                | `src/lib/payment-providers.ts`, `src/routes/refunds.tsx`              |
| Reconciliation (cash, till, bank, external)                               | `src/routes/reconciliation.tsx`                                       |
| Printer routing, KOT, reprint, fallback                                   | `src/lib/seramet-print-service.ts`, `src/routes/seramet-printers.tsx` |
| Inventory hierarchy, receiving, transfers, counts, wastage, breakage, PAR | Inventory routes                                                      |
| Recipes, food cost, production, prep                                      | Kitchen routes                                                        |
| Procurement, requisitions, PO, supplier bills and performance             | Procurement routes                                                    |
| CRM, Customer 360, loyalty, complaints                                    | Customer routes                                                       |
| HR overview, employees, attendance, schedule, payroll                     | People routes                                                         |
| Finance: P&L, balance sheet, cash flow, AP, AR, expenses, assets          | Finance routes                                                        |
| Approvals, audit trail, command centre, AI, reports                       | Management/Intelligence routes                                        |

## 2. Added in this pass (additive only — no existing screen changed)

| Spec section                                                 | New screen                               |
| ------------------------------------------------------------ | ---------------------------------------- |
| 55–60 Delivery engine, rider eligibility, status, assignment | `/delivery`, `/riders`                   |
| 62 CRM campaigns and segments                                | `/campaigns`, `/segments`                |
| 79, 83 Leave, performance, recruitment                       | `/leave`, `/performance`, `/recruitment` |
| 87 Chart of accounts, journals, trial balance                | `/general-ledger`                        |
| 104 Notification log                                         | `/notifications`                         |
| 115 Provider adapters                                        | `/integrations`                          |

All new screens are branch-scoped through `useAppContext` / `useBranchRows` and reuse the
existing Seramet design system. No existing route, component, token or data file was altered
other than adding the new links to `src/components/app/nav.ts`.

## 3. GAP DECISION REQUIRED

### GAP-001 — Rider assignment strategy default
**Module:** Delivery.
**Current Seramet behavior:** No dispatch strategy is stored; assignment is manual.
**Expected workflow from specification:** Configurable strategy per branch (manual, round-robin,
first available, least active, first to accept).
**Gap:** No default is defined and the spec forbids inventing one.
**Why this matters:** Auto-assignment changes rider pay, delivery times and accountability.
**Decision needed:** Which strategy is the default per branch, and who may change it?

### GAP-002 — Marketplace orders and own riders
**Module:** Delivery.
**Current Seramet behavior:** Marketplace channels are recorded as delivery tasks with a
platform courier.
**Expected workflow:** One delivery engine for all sources.
**Gap:** Unclear whether Uber Eats / Glovo / Bolt orders may ever be handed to an own rider.
**Why this matters:** Affects commission, liability and rider payment.
**Decision needed:** Allowed, blocked, or manager-approved exception?

### GAP-003 — Leave approval levels
**Module:** HR.
**Current Seramet behavior:** Single approval state on each request.
**Expected workflow:** Manager approval, then HR approval "if required".
**Gap:** The rule for when HR approval is required is undefined.
**Why this matters:** Payroll and shift cover depend on the final approver.
**Decision needed:** Which leave types or day thresholds trigger the second approval?

### GAP-004 — Accounting posting depth
**Module:** Finance.
**Current Seramet behavior:** Financial statements are produced from the transaction engine;
`/general-ledger` now presents the account structure and journal shape.
**Expected workflow:** Full double-entry with fiscal periods, budgets, cost centres,
depreciation, credit/debit notes and statements.
**Gap:** Period close, budgets, depreciation schedules and statement generation are not posted.
**Why this matters:** Statutory reporting and audit.
**Decision needed:** Should Seramet own the ledger, or export to an external accounting system?

### GAP-005 — Fiscal / tax receipt compliance
**Module:** Sell.
**Current Seramet behavior:** Receipts and A4 invoices print business identity and totals.
**Expected workflow:** Local fiscal rules where applicable.
**Gap:** No fiscal signature, control unit or tax posting rules.
**Why this matters:** Compliance risk on every sale.
**Decision needed:** Which tax regime and device/API must Seramet integrate with?

### GAP-006 — Notification retry policy
**Module:** Notifications.
**Current Seramet behavior:** Retry count and failure reason are logged; retry is manual.
**Expected workflow:** Log created / sent / delivered / failed with retries.
**Gap:** Automatic retry limits and escalation are undefined.
**Why this matters:** Silent message failure loses revenue and rider dispatches.
**Decision needed:** Retry count, interval and who is alerted after final failure?

### GAP-007 — Persistence
**Module:** Platform.
**Current Seramet behavior:** Operational state is held client-side.
**Expected workflow:** Permanent, auditable records that never disappear.
**Gap:** No server-side database or authenticated API yet.
**Why this matters:** Order history, audit and accounting must survive the browser.
**Decision needed:** Approve enabling the managed backend so records persist.
