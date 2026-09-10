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

Implemented paths are OAuth, M-Pesa Express request/query, dynamic QR request and STK/C2B callback normalization. Production remains unconfigured until credentials, shortcode, passkey, callback routing and merchant certification pass live verification. The adapter deliberately does not claim refunds, reversals, balances or payouts.

## Pesapal boundary

Only API 3.0 paths are used: RequestToken, RegisterIPN, SubmitOrderRequest, GetTransactionStatus and RefundRequest. An IPN causes authoritative status retrieval. Refund request acceptance maps to PROCESSING. Additional restricted operations remain configuration/certification dependent.

## TendePay boundary

Public product pages describe tills, collections and reconciliation, but they are not a callable merchant API specification. The adapter exposes no live capability and all network operations return `SPEC_REQUIRED` without creating Seramet transactions.

## Test provider boundary

The test provider is a deterministic fixture. Its capabilities must never be shown as a real connection or used in production.
