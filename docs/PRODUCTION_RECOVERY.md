# Production Recovery Gate

Status: **IMPLEMENTED, NOT YET EXECUTED AGAINST PRODUCTION**. No production
restore, migration, role creation or secret provisioning is performed by this change.

The dedicated production project currently has no application tables, no native
backup recovery points and no enabled point-in-time recovery. An empty project
and successful PostgreSQL tests are not evidence of production recoverability.

## Manual Verification

The Production encrypted recovery verification workflow requires the repository
owner as both original actor and rerun initiator, main branch, the protected
production environment and an exact approved revision. Missing setup fails closed.
The job cannot migrate, deploy, restore production or create database roles there.

The source uses a dedicated `seramet_production_backup` login on the exact approved
Supabase project, direct connection or session pooler on port 5432. Owner/migration
credentials and transaction pooling are rejected. Certificate and hostname
verification remain enabled for both Node and PostgreSQL clients. A separately
verified CA certificate and fingerprint are required; URL trust overrides are rejected.

The source transaction is repeatable-read/read-only and exports the snapshot used
by `pg_dump`. Source schema CREATE and table write privileges, superuser, role
creation, database creation and replication privileges are rejected. Provisioning
the dedicated role and any required read access is a separate reviewed operation;
the workflow never changes grants. All required rows must be readable: RLS must
not silently filter the backup. `row_security=off` makes insufficient access fail
rather than certifying an incomplete capture. Review any required BYPASSRLS
privilege independently and keep this credential away from the application runtime.

Both dump and manifest are encrypted with AES-256-GCM and separate random nonces.
Only encrypted files enter private GitHub artifacts, retained for 14 days. The
workflow downloads those artifacts again, authenticates them and restores only to
the fixed disposable PostgreSQL 17 database on loopback port 54329. The restore
step receives neither the source credential nor the encryption key. It compares
table identities, counts, full persisted-row digests and application schema evidence.
Evidence is bound to the approved project/revision and expires after two hours.

## Reviewed Setup Required

In GitHub environment **production**, configure only after independent review:

| Kind     | Name                                     | Purpose                               |
| -------- | ---------------------------------------- | ------------------------------------- |
| Variable | `SERAMET_PRODUCTION_APPROVED_SHA`        | Exact reviewed main revision          |
| Variable | `SERAMET_PRODUCTION_PROJECT_REF`         | Dedicated production project          |
| Secret   | `SERAMET_PRODUCTION_BACKUP_POSTGRES_URL` | Dedicated read-only backup login      |
| Secret   | `SERAMET_PRODUCTION_POSTGRES_CA_PEM`     | Verified production CA                |
| Secret   | `SERAMET_PRODUCTION_POSTGRES_CA_SHA256`  | Independently verified CA fingerprint |
| Secret   | `SERAMET_PRODUCTION_BACKUP_KEY`          | 32 random bytes in canonical base64   |

Keep the encryption key separately recoverable outside GitHub and restrict access
to artifacts, repository administration and workflow changes. Loss of both key
copies makes the backups unusable. A sole-administrator environment is not
independent approval. Do not reuse staging credentials or change its guards.

## Limits And Release Implications

- This is a **public application schema** logical recovery point, not a full
  Supabase project backup. Auth users, storage objects, other schemas, role
  passwords, grants and ACLs are not included. A complete operational disaster
  recovery plan must cover those separately before a real-customer launch.
- Restored policy roles are inert NOLOGIN roles in the isolated target only.
  Privileges must be reconstructed and negative authorization checks independently
  certified before any production recovery. Successful logical restore does not
  certify the deployed application's effective permissions.
- Capacity limits fail closed above 100,000 total rows, 64 MiB of serialized data
  in one table or 512 MiB per file. This bounded pilot implementation must be
  replaced with streaming/scalable digest verification before exceeding the limit;
  it never silently truncates evidence.
- The workflow is manual, not a scheduled backup service. Fourteen-day artifact
  retention is not an agreed recovery-point or recovery-time objective. An
  independently retained, monitored backup schedule and retention policy remain
  required for sustained live sales.
- No automatic restore or rollback of production financial records exists here.
  Restoring live data requires a separately approved recovery procedure with
  financial reconciliation and provider-side payment reconciliation.
- The current release remains **NO-GO** until this gate runs successfully on the
  reviewed revision, schema/permissions are certified, and the remaining launch
  acceptance checks pass. Do not bypass this gate using the bootstrap credential.
