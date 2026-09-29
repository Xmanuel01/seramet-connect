# Marketplace Provider Matrix

Status values are evidence based:

- `IMPLEMENTED`: adapter, runtime path and automated contract coverage exist.
- `SUPPORTED_NOT_CONFIGURED`: official capability exists but Seramet has not enabled the operation.
- `SPEC_REQUIRED`: no precise official merchant contract was available during implementation.
- `NOT_SUPPORTED`: the reviewed provider contract does not expose the operation used by Seramet.

| Capability                   | Uber Eats                | Glovo                                  | Bolt Food     |
| ---------------------------- | ------------------------ | -------------------------------------- | ------------- |
| OAuth/client credentials     | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Verified order webhook       | IMPLEMENTED              | IMPLEMENTED (configured secret header) | SPEC_REQUIRED |
| Retrieve order               | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Recover missed active orders | IMPLEMENTED              | NOT_SUPPORTED                          | SPEC_REQUIRED |
| Accept order                 | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Reject order                 | IMPLEMENTED              | NOT_SUPPORTED                          | SPEC_REQUIRED |
| Restaurant cancellation      | IMPLEMENTED              | NOT_SUPPORTED                          | SPEC_REQUIRED |
| Mark ready                   | IMPLEMENTED              | IMPLEMENTED (Glovo courier orders)     | SPEC_REQUIRED |
| Update ready time            | IMPLEMENTED              | NOT_SUPPORTED                          | SPEC_REQUIRED |
| Incoming order edits         | SUPPORTED_NOT_CONFIGURED | IMPLEMENTED                            | SPEC_REQUIRED |
| Product catalog read         | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Full menu upload             | IMPLEMENTED              | NOT_SUPPORTED                          | SPEC_REQUIRED |
| Category synchronization     | IMPLEMENTED              | SUPPORTED_NOT_CONFIGURED               | SPEC_REQUIRED |
| Modifier synchronization     | IMPLEMENTED              | NOT_SUPPORTED                          | SPEC_REQUIRED |
| Item price update            | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Item availability/86         | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Quantity update              | NOT_SUPPORTED            | IMPLEMENTED                            | SPEC_REQUIRED |
| Read store status            | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Open/pause store             | IMPLEMENTED              | IMPLEMENTED                            | SPEC_REQUIRED |
| Provider settlement import   | SUPPORTED_NOT_CONFIGURED | SUPPORTED_NOT_CONFIGURED               | SPEC_REQUIRED |
| Production connection        | SUPPORTED_NOT_CONFIGURED | SUPPORTED_NOT_CONFIGURED               | SPEC_REQUIRED |

## Official references

- Uber Eats authentication: https://developer.uber.com/docs/eats/guides/authentication
- Uber Order Fulfillment API: https://developer.uber.com/docs/eats/references/api/order_suite
- Uber Store API: https://developer.uber.com/docs/eats/references/api/store_suite
- Uber v2 Menu API: https://developer.uber.com/docs/eats/references/api/v2/put-eats-stores-storeid-menu
- Uber active created orders: https://developer.uber.com/docs/eats/references/api/v1/get-eats-stores-storeid-createdorders
- Glovo Partner API overview: https://qcommerce.developer.glovoapp.com/en/documentation/api-partner-api-overview
- Glovo Partner API v2.0.2 reference: https://partner-api-docs-tmp.s3.us-east-2.amazonaws.com/redoc-glovo.html
- Bolt developer portal: https://developer.bolt.eu/api/food
