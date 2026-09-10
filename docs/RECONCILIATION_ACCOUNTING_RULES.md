# Reconciliation and Accounting Rules

All values below are integer minor units in one currency. Account IDs come from tenant payment methods, provider connections or settlement mappings. Every generated journal is rejected unless total debits equal total credits.

## Sale recognition

Invoice creation continues to use the existing tax/order engine:

| Event                                 | Debit                  | Credit                                                                           |
| ------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| Restaurant sale                       | Customer receivable    | Configured food/beverage revenue and tax/service-charge liabilities from invoice |
| Marketplace externally collected sale | Marketplace receivable | Configured gross revenue and invoice tax liabilities                             |

Payment services do not recalculate invoice tax.

## Collections

| Event                                    | Debit                                           | Credit                               |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Cash collection                          | Configured cash-on-hand account                 | Invoice/customer receivable          |
| Digital collection confirmed by provider | Configured mobile/card/gateway clearing account | Invoice/customer receivable          |
| Manual terminal collection               | Configured card clearing account                | Invoice/customer receivable          |
| Confirmed bank collection                | Configured bank/clearing account                | Invoice/customer receivable          |
| Payment clearing reconciled to bank      | Configured bank account                         | Original configured clearing account |

Intent creation, provider prompt submission, browser redirect, an unverified reference and bank screenshot do not generate a confirmed collection journal.

## Marketplace

For gross orders 100,000, commission 20,000, promotion 5,000 and bank receipt 75,000:

| Account                |  Debit |  Credit |
| ---------------------- | -----: | ------: |
| Bank                   | 75,000 |       0 |
| Commission expense     | 20,000 |       0 |
| Promotion expense      |  5,000 |       0 |
| Marketplace receivable |      0 | 100,000 |

The order's gross revenue journal remains unchanged. A variance prevents posting.

## Refund and reversal

| Event            | Debit                                                     | Credit                                           |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Confirmed refund | Invoice/customer receivable or configured refunds account | Original payment collection/clearing account     |
| Reversal         | Exact inverse of original posted payment journal          | Exact inverse of original posted payment journal |

Provider refund request acceptance remains REQUESTED/PROCESSING until authoritative confirmation. Cash refunds also reduce expected drawer cash.

## Customer credit

| Event                  | Debit                                 | Credit                           |
| ---------------------- | ------------------------------------- | -------------------------------- |
| House-account sale     | Configured accounts receivable        | Configured revenue/tax treatment |
| Later customer payment | Configured cash/bank/clearing account | Accounts receivable              |

No fake payment is created when an invoice is put on account.

## Gift cards, vouchers and loyalty

| Event                   | Debit                  | Credit                            |
| ----------------------- | ---------------------- | --------------------------------- |
| Gift card/voucher issue | Collection account     | Configured stored-value liability |
| Redemption              | Stored-value liability | Invoice/customer receivable       |

Issue is not restaurant sales revenue. Loyalty uses its separately configured liability/accounting behavior and is not represented as cash settlement.

## Cash drawer

Expected cash is opening float plus sales and paid-in/additions, less refunds, paid-out, drops and petty cash. Cash tendered is not the drawer sale value when change is given. Drawer variance is counted cash minus expected cash and is not silently forced to zero.

## Posting locks

Posted settlement and reconciliation journals are immutable. Corrections require a linked reversal or adjusting journal and a new reconciliation event. External provider reference uniqueness is enforced per provider connection across branches.
