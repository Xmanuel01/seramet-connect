# Staging recovery point

The staging Supabase organization was verified as Free. Provider daily backup/PITR
coverage is not established. The existing public-schema snapshot is retained as
AES-256-GCM authenticated ciphertext in private GitHub Actions artifacts, alongside
encrypted snapshot evidence. No plaintext dump is uploaded.

## Administrator preparation

Generate 32 cryptographically random bytes encoded as base64. Save the key in an
owner-controlled password manager outside GitHub, then add the same value as the
staging environment secret `SERAMET_STAGING_BACKUP_KEY`. Never paste it into a
comment, command argument, log or PR. Set staging environment variable
`SERAMET_STAGING_BACKUP_KEY_ESCROW_VERIFIED=true` only after confirming the offline
copy can be retrieved. Keep old keys until their backups expire.

After review and separately authorized merge, set `SERAMET_STAGING_APPROVED_SHA`
to the merged main SHA. The manual `verify-backup-restore` operation creates one
consistent snapshot, encrypts it, uploads it, downloads the retained artifact,
authenticates/decrypts both files and compares them byte-for-byte with the source.
The isolated PostgreSQL restore uses that downloaded copy and the existing
schema/row/integrity and migration/lockdown compatibility verifiers.

Artifacts are named `staging-recovery-<commit>-<run-id>` and expire after seven
days. Remediation requires successful retention/download/decryption steps and a
nonempty unexpired artifact with at least 24 hours remaining, in addition to the
existing two-hour certification freshness rule. Deleting the artifact blocks
remediation. Do not delete a recovery point while an incident remains unresolved;
download the ciphertext into owner-controlled secure storage before expiry.
Runner-local plaintext and ciphertext are removed on success or failure; hosted
runner teardown removes the ephemeral filesystem. This is not a physical secure
erase guarantee. Failed verification artifacts are never accepted for remediation.

## Recovery after partial remediation

1. Stop mutations and background processing under separate operator authorization.
   Record the failed run, exact checkpoint and retained backup run ID. Migration
   and lockdown commit separately; a later failure does not undo either commit.
2. Download the named artifact from the private repository Actions run as its
   authorized owner. Retrieve the matching key from offline escrow and supply it
   through `SERAMET_STAGING_BACKUP_KEY` in a secure local process environment.
3. Decrypt with `node scripts/staging-recovery-envelope.mjs open <encrypted-dir>
<private-output-dir>`. Wrong keys or modified ciphertext fail authentication.
4. Restore into isolated PostgreSQL 17 using the established recovery workflow's
   `pg_restore --exit-on-error --no-owner --no-privileges` procedure, then run
   `verify-staging-backup-restore.mjs` against the decrypted snapshot evidence.
   Validate the actual checkpoint before deciding on repair or restoration.
5. Any live restoration or privilege repair requires a separate reviewed plan and
   authorization. Do not automatically reset staging or replay jobs. The retained
   archive preserves public-schema ownership/ACL metadata, but the isolated test
   intentionally omits applying ACLs. Exact live ACL recovery is not certified by
   this test and must be reviewed separately; do not reinstate unsafe public grants.

Scope: public application schema and records only. Auth, other schemas, database
role passwords, R2/Storage objects and external queues are outside this recovery
point. No production recovery claim is made. Concurrent application writes after
the snapshot are not included; GitHub concurrency locks do not pause the Worker.

GitHub read access permits downloading ciphertext; only key holders can decrypt
it. A sole administrator can alter workflows, delete artifacts or rotate secrets;
this is not independent approval or immutable off-site storage. Retention and
storage consume existing Actions quota, with no new paid service. If quota or
permissions prevent upload/download, certification fails closed.
