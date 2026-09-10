# Seramet implementation pass — 18 Aug 2026

This pass intentionally keeps the current Seramet visual language and route structure. The focus is to replace mock/preview-only behaviour in the restaurant operating flow with shared transactional behaviour, and to make the agreed restaurant print designs executable instead of decorative.

## Implemented in this pass

### 1. Persistent kitchen and bar production status

- Added station-level production states to transaction lines: `NEW`, `PREPARING`, `READY`, `SERVED`, `CANCELLED`.
- Kitchen and Bar screens now derive tickets from the same persistent transaction orders used by POS and billing rather than the old ticket mock array.
- A station can move independently through production. The parent order becomes `READY` only when every active production station is ready/served.
- Added auditable `setProductionStationStatus` and `markOrderServed` transaction mutations and server authorization.
- Billing can now be requested while an order is in production, ready, or served.

### 2. Unified online/delivery order views

- Online Orders now reads the shared transaction engine instead of the old mock order feed.
- Uber Eats, Glovo, Bolt Food, direct online and own-delivery orders are represented as normal Seramet orders.
- Delivery view is derived from those same orders, so kitchen, orders, billing and delivery no longer display unrelated sample records.
- Own-delivery tasks now persist rider assignment and dispatch states (`ASSIGNED`, `PICKED_UP`, `OUT_FOR_DELIVERY`, `DELIVERED`) on the order itself, with audit events.
- The Riders screen now reads the persisted employee/attendance/order state, calculates live workload, and can add a rider to a branch roster. Wycliff and Francis are included in the Westlands seed roster.
- Real provider webhooks/credentials are intentionally not faked; adapters remain a separate integration step.

### 3. Branch Manager operations intelligence

- Added a restaurant operations derivation layer that turns operational state into manager actions and health signals.
- Dashboard Management Alerts now link directly to the relevant workflow (KDS, PAR, reconciliation, refunds, attendance, printers, menu).
- Health/readiness checks include production hardware, cash drawer, critical PAR, staff coverage and menu availability.
- Reports preview now uses transaction state for branch sales/order/payment-completion numbers instead of the old hard-coded branch preview.

### 4. Restaurant print engine and physical bridge

- Preserved the approved KOT / Bar Ticket / unpaid Bill / paid Receipt / A4 Invoice document families.
- KOT and Bar Ticket formatting supports station-only items, modifiers, special requests, requested-by, printed time, ticket number and amendment banners.
- Bills remain payment requests; receipts are generated as paid documents with payment method/reference/breakdown; A4 invoices retain business and service information.
- Added actual installed-bridge configuration (endpoint/token) to Hardware Setup.
- Print queue now sends jobs to the installed local bridge when configured instead of always simulating a successful print.
- Windows bridge now respects the mapped Windows printer name. Linux/macOS uses the CUPS printer target.
- Runtime fallback routing is attempted when a mapped printer rejects a job.
- Invoice preview Print and Receipt register Print now feed the Seramet print queue rather than only calling browser `window.print()`.
- Receipt reprints now create a transaction/audit entry with user, timestamp and reason.

### 5. Hardware setup persistence

- Branch hardware profiles can now be saved to the client profile store rather than the setup wizard only changing its own screen state.
- Saved POS terminal count, kitchen mode, capabilities and printer role footprint are read by the print service on later calls.
- Hardware Setup now also edits the branch print identity used by bills, receipts and A4 invoices: business/receipt name, address, phone, email, KRA PIN, M-Pesa till, bank details and receipt footer.
- One-printer branches consolidate enabled print roles onto the single device.

### 6. Time and actor correctness

- Removed the fixed 14 Aug 2026 transaction timestamp from newly created operational records; new activity now uses the actual current time.
- New receipt reprint and invoice-settlement audit entries use the active Seramet user instead of hard-coded sample operator names where changed in this pass.

### 7. Inventory, recipes, PAR and automatic 86 availability

- Inventory is now part of the shared persisted Seramet transaction state instead of the Inventory and PAR screens only reading `mock.ts`.
- Added branch-level stock, PAR, average cost, supplier and stock-movement records.
- Recipe cards are stored in the same state and are costed against current branch average inventory cost.
- Serving or fully paying a mapped recipe posts theoretical ingredient consumption once per order and records auditable stock movements.
- POS availability now derives an available-portion count from recipe ingredients. A mapped menu item becomes 86'd when a required ingredient can no longer produce one portion.
- Inventory, PAR and Recipe screens now read this live operational state.

### 8. Procurement and receiving workflow

- PAR shortfalls can generate purchase orders grouped by supplier and branch.
- Duplicate open supplier POs are blocked so repeated clicks do not create the same replenishment commitment.
- Purchase orders support pending approval, approved, partial and received states.
- Receiving now works from approved POs, accepts partial quantities, updates PO progress, posts stock receipts and recalculates average cost.
- Inventory shows open incoming-stock value from approved/partial POs.

### 9. Wastage, breakage and approval workflow

- Wastage and breakage records now persist in the shared operational state.
- Wastage requests require approval before stock is reduced; approval posts a stock movement and audit event.
- Breakage requests and manager approvals are recorded and surfaced consistently on both Wastage & Breakage and Breakages screens.
- Day-end close now checks for unresolved wastage/breakage approvals instead of always showing this step as pending.

### 10. Attendance and lateness-linked payroll preview

- Employee and attendance records are now in persisted Seramet state.
- Attendance supports clock-in/clock-out actions, late minutes, overtime minutes, branch scope and CSV timesheet export.
- The payroll preview calculates an hourly and per-minute rate from each employee's configured monthly net pay, work days and standard daily hours.
- Late minutes feed an automatic lateness deduction and adjusted net-pay preview. Branch managers can update the base net pay used by the calculation.
- Statutory payroll posting is deliberately still blocked rather than being presented as complete without the required Kenya payroll/compliance configuration.

## Important remaining work

The source still contains modules that are visually complete but backed by arrays in `src/data/mock.ts`. Those screens should not be presented as production ERP persistence yet. Priority next passes:

1. Complete procurement downstream of receiving: supplier invoice matching, payable creation, payment approval and three-way PO/GRN/bill matching.
2. Extend recipe coverage from the seeded/high-priority dishes to the complete restaurant cookbook, then add physical stock counts and actual-vs-theoretical variance.
3. Complete shift-roster editing, leave, overtime approval and Kenya statutory payroll configuration/posting. The lateness deduction calculation is implemented; statutory compliance is not faked.
4. Extend end-of-day into a full guided cashier close with cash-count capture, exception resolution and automatic journal posting. The current close already reads live open orders, drawers, payment reconciliation, journals and waste/breakage approvals.
5. Production provider adapters for Uber Eats, Glovo and Bolt Food feeding the shared order engine; own-rider assignment and dispatch persistence are implemented, while route/geo optimization and external rider notifications remain future integration work.
6. Replace remaining report/dashboard mock charts and long-range KPIs with queryable transactional aggregates.
7. Move branch hardware/profile configuration from local browser storage into the authenticated backend once the configuration API is added.
8. Production-grade ESC/POS/raster printing for logos and richer thermal typography. Current installed bridge reliably routes the approved textual layouts through the OS spooler; printer-driver output may not reproduce raster logos until raw/raster support is added.
9. Concurrency hardening: the backend supports D1 snapshots and idempotent mutation endpoints, but much of the UI still writes full snapshots. High-volume multi-terminal operation should progressively use server mutations to avoid last-write-wins conflicts.
10. Provider production access: Uber Eats, Glovo, Bolt Food, M-Pesa and other external integrations require approved credentials and real webhook configuration; no credentials are embedded in this source.

## Validation performed in this environment

- `node --check local-print-bridge/server.mjs` passed.
- Modified TypeScript/TSX files were parsed with the global TypeScript compiler using `--noResolve`; no syntax errors were found.
- Pure transaction-engine runtime smoke tests covered PAR -> PO -> approval -> receiving, recipe consumption, 86 availability, wastage approval, attendance/payroll derivation, rider roster creation, own-rider assignment, delivery status progression and state persistence logic.
- Full `npm ci`, build, lint and Vitest could not be completed in this sandbox because the Lovable/Vite dependency set could not finish downloading within the environment timeout. Run the normal project checks on a machine with dependency access before production deployment:

```bash
npm ci
npm run build
npm run lint
npm test
```

## UI policy followed

Existing Seramet components, layout language, typography, spacing, cards, tables, navigation and route names were retained. Functional changes were implemented under the existing screens unless a new internal helper/service was required.
