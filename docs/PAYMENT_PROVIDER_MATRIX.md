# Payment Provider Matrix

Status meanings:

- `IMPLEMENTED`: code follows an official current operation and is wired through the integration runtime.
- `SUPPORTED_NOT_CONFIGURED`: official capability is represented but requires tenant credentials, approval or account configuration before it can be live.
- `SPEC_REQUIRED`: no sufficiently precise official merchant contract was available; the operation fails closed.
- `NOT_SUPPORTED`: the adapter does not declare the capability.

| Capability                      | Daraja                   | Pesapal API 3.0          | TendePay      | Test Provider           |
| ------------------------------- | ------------------------ | ------------------------ | ------------- | ----------------------- |
| Server authentication           | IMPLEMENTED              | IMPLEMENTED              | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Create payment intent           | IMPLEMENTED              | IMPLEMENTED              | SPEC_REQUIRED | IMPLEMENTED (test only) |
| STK/payment prompt              | IMPLEMENTED              | IMPLEMENTED              | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Dynamic QR                      | IMPLEMENTED              | NOT_SUPPORTED            | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Card present                    | NOT_SUPPORTED            | NOT_SUPPORTED            | SPEC_REQUIRED | NOT_SUPPORTED           |
| Card not present                | NOT_SUPPORTED            | IMPLEMENTED              | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Webhook/IPN normalization       | IMPLEMENTED              | IMPLEMENTED              | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Authoritative transaction query | IMPLEMENTED              | IMPLEMENTED              | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Refund request                  | NOT_SUPPORTED            | IMPLEMENTED              | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Partial refund                  | NOT_SUPPORTED            | SUPPORTED_NOT_CONFIGURED | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Reversal                        | NOT_SUPPORTED            | NOT_SUPPORTED            | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Transaction sync                | SUPPORTED_NOT_CONFIGURED | SUPPORTED_NOT_CONFIGURED | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Settlement sync                 | NOT_SUPPORTED            | SUPPORTED_NOT_CONFIGURED | SPEC_REQUIRED | IMPLEMENTED (test only) |
| Balance query                   | NOT_SUPPORTED            | NOT_SUPPORTED            | SPEC_REQUIRED | NOT_SUPPORTED           |
| Payout/B2C/B2B                  | NOT_SUPPORTED            | SUPPORTED_NOT_CONFIGURED | SPEC_REQUIRED | NOT_SUPPORTED           |
| Payment link                    | NOT_SUPPORTED            | SUPPORTED_NOT_CONFIGURED | SPEC_REQUIRED | NOT_SUPPORTED           |

## Daraja boundary

Implemented paths are OAuth, M-Pesa Express request/query for Paybill and Till (Buy Goods, authorised by the store number), dynamic QR (BG for tills, PB for Paybills), C2B URL registration and STK/C2B callback normalization.

Each restaurant connects its own till or Paybill in Setup Centre. Its Daraja keys are stored encrypted (AES-256-GCM, bound to the restaurant's credential reference) in object storage under `SERAMET_CREDENTIAL_ENCRYPTION_KEY`, never in the database. Platform-wide `SERAMET_MPESA_*` values apply to sandbox connections only. Safaricom cannot send a signature header, so each connection's callback address ends in a random key; a wrong or missing key is refused. Payments customers make straight to the till or Paybill are kept as confirmed, unallocated M-Pesa collections for reconciliation, or linked to a bill when the account reference and exact amount both match an open request. A receipt is recorded once even if it arrives as both an STK result and a C2B notification. Production remains unconfigured until credentials, shortcode, passkey, callback routing and merchant certification pass live verification. The adapter deliberately does not claim refunds, reversals, balances or payouts.

### M-Pesa matching (`src/payments/mpesa-matching.ts`)

Money is applied to a bill automatically only with proof:

- **Receipt code**: a cashier types the M-Pesa code at the POS. If that receipt already reached the till it is applied to the bill at once; if not, the code is held as unverified and the later notification verifies it (a different amount is flagged, not accepted).
- **Account reference**: a Paybill account number naming exactly one open bill whose balance equals the payment.

Everything else is listed in Payment Control > M-Pesa with open bills of exactly the same balance billed up to 90 minutes before (or 15 minutes after) the payment, for a person to confirm (`applyUnallocatedPayment`, `payments.match`). Applying a received payment links it to the bill and issues the receipt without posting the money again.

Unanswered prompts are checked every minute (and on demand) with the STK query. Cancelled, timed-out, wrong-PIN and insufficient-balance prompts are marked failed with a plain reason so the cashier can send again. A query saying "paid" carries no receipt, so it is noted but never counted as money; the receipt arrives by callback or notification.

## Pesapal boundary

Only API 3.0 paths are used: RequestToken, RegisterIPN, SubmitOrderRequest, GetTransactionStatus and RefundRequest. An IPN causes authoritative status retrieval. Refund request acceptance maps to PROCESSING. Additional restricted operations remain configuration/certification dependent.

## TendePay boundary

Public product pages describe tills, collections and reconciliation, but they are not a callable merchant API specification. The adapter exposes no live capability and all network operations return `SPEC_REQUIRED` without creating Seramet transactions.

## Test provider boundary

The test provider is a deterministic fixture. Its capabilities must never be shown as a real connection or used in production.
