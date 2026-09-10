# Production Backup And Restore Runbook

## Policy inputs

Record owner, retention, encryption, region, RPO, RTO and legal hold policy per environment. Git is
not a data backup. PostgreSQL, R2, configuration metadata and managed secrets require separate
recovery plans.

## Backup

1. Verify automated Supabase PostgreSQL backups and, where required, point-in-time recovery.
2. Create an encrypted logical export before schema releases and major imports.
3. Enable appropriate R2 object versioning/lifecycle or an approved replicated export procedure.
4. Export non-secret Seramet configuration and retain the schema/build identifiers.
5. Record a `backup_records` entry only after the external backup operation succeeds.

## Restore rehearsal

1. Restore into an isolated recovery project, never over production.
2. Apply no newer application build until the restored schema is identified.
3. Validate schema version, tenant counts, order/payment/inventory totals, balanced journals, object
   metadata and sampled R2 checksums.
4. Run tenant-isolation and authentication smoke tests.
5. Measure recovery point and elapsed recovery time against approved objectives.
6. Mark the backup verified only after sign-off; attach the external evidence reference without
   storing credentials.

## Failure handling

If verification fails, keep the tenant go-live state blocked, preserve the failed attempt, correct the
backup pipeline and repeat with a new recovery environment. Never mark a checklist item complete
from a provider dashboard screenshot alone.
