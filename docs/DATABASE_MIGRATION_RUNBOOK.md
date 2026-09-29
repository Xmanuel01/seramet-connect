# Database Migration Runbook

## New installation

1. Provision the authoritative D1 database for the target environment.
2. Back up any existing database before migration.
3. Apply `migrations/0001_production_schema.sql` through `0006_concurrency_guards.sql` in numeric order.
4. Verify `SELECT MAX(version) FROM schema_migrations` returns `6`.
5. Run database integration and concurrency tests against a production-like test database.
6. Apply `migrations/seed/development.sql` only to local development when needed.
7. Apply `migrations/seed/demo.sql` only to an explicitly isolated demo environment.
8. Never include either seed in a production migration run.

Migrations are forward-only. Application startup validates schema version and does not create production tables.

## Snapshot migration

Legacy browser data is never discovered or ingested automatically. An operator must export the old JSON and run the controlled `SnapshotMigrationService`:

1. select a target tenant;
2. map every source branch to an assigned target branch;
3. run preview;
4. review counts, duplicate IDs, invalid references, financial totals and inventory totals;
5. resolve every invalid branch/reference;
6. apply once with an authorized actor and correlation ID;
7. verify target counts and totals;
8. archive the `data_migration_runs.report_json` and source checksum securely.

Reapplying the same checksum is idempotent. The service records source schema, read/migrated/skipped records, duplicates, invalid references, pre/post invoice/payment/receipt/journal totals and inventory quantity.

## Rollback and recovery

Do not reverse a migration by deleting accounting data. Restore the pre-migration database backup into a separate recovery environment, validate it, and switch only through the deployment rollback procedure. Posted financial corrections use reversals/adjustments after go-live.

Backups must cover database, object/file storage and non-secret configuration. Secrets require separate managed-secret recovery. Record backup and restore verification in `backup_records`; source control is not a database backup.
