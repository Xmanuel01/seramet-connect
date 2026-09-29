PRAGMA foreign_keys = ON;

CREATE TABLE integration_runtime_records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('IDEMPOTENCY', 'HEALTH', 'REPLAY')),
  id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind, id)
);

CREATE INDEX idx_integration_runtime_records
  ON integration_runtime_records(tenant_id, kind, updated_at DESC);

CREATE TRIGGER authoritative_audit_record_no_update
BEFORE UPDATE ON authoritative_records
WHEN OLD.entity_type IN ('state:auditEvents', 'payments:auditEvents')
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITATIVE_AUDIT_IMMUTABLE');
END;

CREATE TRIGGER authoritative_audit_record_no_delete
BEFORE DELETE ON authoritative_records
WHEN OLD.entity_type IN ('state:auditEvents', 'payments:auditEvents')
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITATIVE_AUDIT_IMMUTABLE');
END;

CREATE TRIGGER authoritative_confirmed_payment_no_update
BEFORE UPDATE ON authoritative_records
WHEN OLD.entity_type = 'payments:transactions'
  AND OLD.status IN ('CONFIRMED', 'REVERSED')
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITATIVE_PAYMENT_IMMUTABLE');
END;

CREATE TRIGGER authoritative_payment_no_delete
BEFORE DELETE ON authoritative_records
WHEN OLD.entity_type IN ('payments:transactions', 'payments:allocations')
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITATIVE_PAYMENT_IMMUTABLE');
END;

INSERT INTO schema_migrations(version, name, checksum, applied_at)
VALUES (4, 'runtime_metadata', 'pass5-0004-v1', CURRENT_TIMESTAMP);
