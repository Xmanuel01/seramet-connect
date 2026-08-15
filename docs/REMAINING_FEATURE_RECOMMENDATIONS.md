# Remaining Feature Recommendations

## Critical Before Pilot

| Feature                                   | Why needed                                                                       | Source project | NexusCore implementation                                                     | Backend only | Frontend change required      | Risk                             | Complexity |
| ----------------------------------------- | -------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------- | ------------ | ----------------------------- | -------------------------------- | ---------- |
| Production persistence API                | Local storage is not enough for real restaurant records                          | ERPNext/Frappe | Replace local transaction storage with authenticated service endpoints       | Yes          | No major redesign             | Data loss if delayed             | High       |
| Real M-Pesa/TendePay provider credentials | Payment prompts and external reconciliation cannot go live without verified APIs | Provider docs  | Implement live adapters behind `PaymentService` and `ReconciliationProvider` | Yes          | Minimal configuration screens | Payment misstatement if invented | High       |
| Branch permission enforcement on backend  | Cashiers must not alter branch or completed transactions                         | Frappe/Odoo    | Server-side policy checks for every transaction mutation                     | Yes          | Existing role UI can remain   | Fraud/manipulation               | High       |
| Fiscal/tax receipt compliance             | Receipts and invoices may need local statutory rules                             | ERPNext/Odoo   | Fiscal templates and tax posting rules                                       | Mostly       | Print template fields         | Compliance                       | High       |

## High Value

| Feature                           | Why needed                                                         | Source project | NexusCore implementation                    | Backend only | Frontend change required | Risk   | Complexity |
| --------------------------------- | ------------------------------------------------------------------ | -------------- | ------------------------------------------- | ------------ | ------------------------ | ------ | ---------- |
| Bank/card settlement batch import | Completes reconciliation beyond cash and till                      | ERPNext/Odoo   | Feed adapters and settlement batch model    | Mostly       | Reconciliation filters   | Medium | Medium     |
| Daily close workflow              | Forces branch-level review of sales, payments, cash and exceptions | OSPOS/NexoPOS  | `DailyCloseService` over transaction engine | No           | Daily close route/panel  | Medium | Medium     |
| Credit notes and reversals        | Needed for controlled refunds and voids                            | ERPNext/Odoo   | Formal reversal documents and GL links      | Mostly       | Refund detail drawer     | Medium | Medium     |

## Medium Value

| Feature                             | Why needed                                                 | Source project | NexusCore implementation | Backend only | Frontend change required | Risk   | Complexity |
| ----------------------------------- | ---------------------------------------------------------- | -------------- | ------------------------ | ------------ | ------------------------ | ------ | ---------- |
| Scheduled report subscriptions      | Management reporting should be automated and branch scoped | ERPNext/Odoo   | Async delivery jobs      | Mostly       | Report schedule UI       | Low    | Medium     |
| Inventory valuation and landed cost | Needed for richer gross margin                             | ERPNext/Odoo   | Stock valuation service  | Mostly       | Inventory reports        | Medium | High       |
| Approval delegation                 | Managers need controlled absence coverage                  | Frappe         | Approval policy service  | Mostly       | Approvals settings       | Low    | Medium     |

## Future

- Accounting period close and audit locks.
- Multi-currency supplier payments.
- Advanced customer statements.
- Batch/lot and expiry tracking where restaurants need it.

## Not Needed

- Replacing the Seramet frontend with ERPNext, Odoo, NexoPOS, Dolibarr or OSPOS UI.
- Combining multiple ERP accounting engines into one app.
- Designing Seramet as custodian of merchant funds.
