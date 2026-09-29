# Identity, Device and Branch Migration Runbook

## Migration

Apply migration `0020_identity_device_branch_hardening.sql` through the normal forward migration command. It upgrades the schema to version 20 and adds branch lifecycle/version fields, account ownership, POS policies, protected PIN credentials/history, device credentials, POS sessions, authentication attempts, idempotency records, duplicate reviews and readiness tasks.

The migration does not delete branches. It marks one branch as bootstrap `DRAFT` only for an incomplete, transaction-free onboarding tenant. Existing tenants with orders, invoices, payment transactions or inventory movements retain active trading branches.

## Preflight

1. Back up the authoritative database.
2. Confirm application binaries support schema version 20.
3. Confirm the external identity provider and HTTPS origin configuration.
4. Run the PostgreSQL migration compatibility test.
5. Review current branch duplicates before changing status.

## Apply and verify

```text
npm run migrate:postgres
npm run test:commercial
npm run test:identity
npm run test:database
```

Verify:

- `schema_migrations` reports version 20.
- Every tenant with a verified identity has at least one active owner.
- No plaintext PIN column exists.
- Existing active devices were mapped to `ACTIVE`; pending and revoked devices retained equivalent lifecycle state.
- Normalized email, employee code and branch-code uniqueness succeeds without collisions.

## Duplicate branch reconciliation

Use `GET /api/seramet/setup/branches/duplicate-review` under full account authentication and `branches.reconcile`. The response compares code, normalized name and stored address and includes order, invoice, payment, inventory-movement and device counts.

Only an empty candidate may be closed through `POST /api/seramet/setup/branches/{id}/deactivate-empty-duplicate` with a reason. Any operational dependency blocks automatic action. If both branches contain data, leave both intact and prepare a reviewed migration preserving source branch IDs and audit history.

## Rollback

Migration 20 is forward-only. Do not drop credential or ownership tables in place. If deployment verification fails, restore the pre-migration database backup and the prior application release together. Device activation performed after migration must be repeated because restored data will not know the issued credentials.

