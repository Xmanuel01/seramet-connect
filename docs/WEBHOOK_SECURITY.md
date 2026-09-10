# Webhook Security

## Gateway

Provider callbacks enter through:

`POST /api/seramet/integrations/webhooks/:providerCode/:connectionId`

The connection determines the tenant. A supplied tenant header is treated only as an assertion and must match the connection. Provider ID and connection ID must belong together. Unknown, disabled and unconfigured connections are rejected.

## Raw body handling

The route reads `request.arrayBuffer()` exactly once and passes its bytes to the adapter before JSON parsing. The default maximum body is 1 MiB; adapters may declare a lower limit. Oversized requests are rejected.

## Signature verification

Signature verification is adapter owned because providers use different mechanisms. `verifyWebhook` receives:

- exact raw body bytes;
- normalized request headers;
- the tenant connection;
- server-resolved credentials.

HMAC comparisons use constant-time comparison. Uber Eats verifies the documented lower-case HMAC-SHA256 body signature in `X-Uber-Signature` and rejects an `X-Environment` that does not match the connection environment. No universal HMAC rule is applied to other providers.

## Idempotency and replay prevention

The runtime prefers the provider's immutable event ID. Without one, it derives a SHA-256 key from normalized immutable fields and the raw body hash. The tenant/connection/key claim is persisted before event processing. Repeated delivery returns the existing result and does not create another event, order, payment, refund, cancellation or stock effect.

Manual replay creates a new event and replay audit record. It retains the original payload and result. Existing external resource mappings prevent duplicate domain records.

## Secret handling

Browser configuration stores `secretReference`, never credentials. The server resolves references through `CredentialResolver`. Provider tokens remain in the server token service. Request/response payloads and logs recursively redact authorization, cookie, password, secret, token, private key, passkey, client secret and API key fields.

Errors returned by the gateway include a typed code, safe message and retryability; provider secrets and raw authorization responses are never exposed.

## Failure behavior

- Invalid signature: reject with 401 before event persistence.
- Unknown provider/connection: reject without revealing credentials.
- Wrong tenant or provider/connection pair: reject.
- Duplicate event: acknowledge safely using the persisted result.
- Malformed payload: permanent validation failure.
- Timeout, 429 or 5xx: retryable typed failure.
- Exhausted processing: immutable dead-letter record.
- Unknown store/item: mapping exception; no random branch or recipe is created.

Provider callbacks should use TLS, provider IP/network controls where officially supported, and a production queue worker for asynchronous processing after acknowledgement.
