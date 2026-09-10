PRAGMA foreign_keys = ON;

CREATE TABLE identity_accounts (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1)),
  linked_at TEXT NOT NULL,
  last_authenticated_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id,provider,subject),
  UNIQUE (tenant_id,user_id,provider),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

CREATE INDEX identity_accounts_subject_idx
  ON identity_accounts(provider,subject,tenant_id);

CREATE TABLE restaurant_registration_attempts (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  tenant_id TEXT,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider,subject,idempotency_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX restaurant_registration_tenant_idx
  ON restaurant_registration_attempts(tenant_id,created_at);

CREATE TABLE stored_objects (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  object_key TEXT NOT NULL,
  object_class TEXT NOT NULL CHECK (object_class IN ('PUBLIC_ASSET','PRIVATE_DOCUMENT','IMPORT_QUARANTINE','EXPORT','BACKUP_METADATA','OTHER')),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_SCAN','ACTIVE','QUARANTINED','DELETED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id,id),
  UNIQUE (object_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE INDEX stored_objects_scope_idx
  ON stored_objects(tenant_id,branch_id,object_class,status,created_at);

CREATE TABLE realtime_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  topic TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE INDEX realtime_events_scope_idx
  ON realtime_events(tenant_id,branch_id,topic,created_at,id);

CREATE TRIGGER identity_account_no_repoint
BEFORE UPDATE ON identity_accounts
WHEN OLD.tenant_id<>NEW.tenant_id OR OLD.user_id<>NEW.user_id OR OLD.provider<>NEW.provider OR OLD.subject<>NEW.subject
BEGIN SELECT RAISE(ABORT,'identity account ownership is immutable'); END;

CREATE TRIGGER realtime_event_no_update
BEFORE UPDATE ON realtime_events
BEGIN SELECT RAISE(ABORT,'real-time event history is append-only'); END;

CREATE TRIGGER realtime_event_no_delete
BEFORE DELETE ON realtime_events
BEGIN SELECT RAISE(ABORT,'real-time event history is append-only'); END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (16,'commercial_launch_foundation','production-launch-0016-v1',CURRENT_TIMESTAMP);
