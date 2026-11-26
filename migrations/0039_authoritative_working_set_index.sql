-- The transaction state's working set (open and recent records) is read by entity type,
-- status and date instead of loading a tenant's whole history
-- (src/server/database/authoritative-transaction-repository.ts, loadWorkingSet).
-- The index holds only transaction-state rows: idempotency records, provider events, setup
-- and CRM rows share this table and are never part of that read. Its predicate is repeated
-- word for word in the query so the planner can use it.
CREATE INDEX IF NOT EXISTS idx_authoritative_records_working_set
  ON authoritative_records(tenant_id, entity_type, status, business_date, updated_at)
  WHERE entity_type LIKE 'state:%' OR entity_type LIKE 'payments:%';
INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(39,'authoritative_working_set_index','authoritative-working-set-index-0039-v1',CURRENT_TIMESTAMP);
