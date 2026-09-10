PRAGMA foreign_keys = ON;

CREATE TABLE provider_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  connection_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  event_type TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  external_resource_id TEXT,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_id, provider_event_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES provider_connections(tenant_id, id)
);

CREATE TABLE provider_mappings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  connection_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  internal_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL,
  sync_status TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_id, resource_type, external_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES provider_connections(tenant_id, id)
);

CREATE TABLE integration_outbox (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  connection_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'RETRY_PENDING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES provider_connections(tenant_id, id)
);

CREATE TABLE integration_dead_letters (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  connection_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  original_payload_json TEXT NOT NULL,
  error TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'REQUEUED', 'RESOLVED')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, source_type, source_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES provider_connections(tenant_id, id)
);

CREATE TABLE worker_jobs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  job_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'RUNNING', 'RETRY_PENDING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  scheduled_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE offline_commands (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  client_created_at TEXT NOT NULL,
  client_sequence INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT')),
  server_result_json TEXT,
  conflict_code TEXT,
  conflict_details_json TEXT,
  correlation_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, device_id, client_sequence),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES hardware_devices(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES users(tenant_id, id)
);

CREATE TABLE rate_limit_buckets (
  scope_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, bucket, window_started_at)
);

CREATE TABLE secret_versions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  connection_id TEXT,
  secret_ref TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'GRACE', 'RETIRED')),
  activated_at TEXT NOT NULL,
  grace_expires_at TEXT,
  rotated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, secret_ref, version),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES provider_connections(tenant_id, id)
);

CREATE TABLE feature_flags (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  configuration_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE plan_definitions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tenant_subscriptions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plan_definitions(id),
  status TEXT NOT NULL CHECK (status IN ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE feature_entitlements (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  subscription_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  limits_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, subscription_id, feature_key),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES tenant_subscriptions(tenant_id, id)
);

CREATE TABLE retention_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  record_class TEXT NOT NULL,
  retention_days INTEGER,
  archive_required INTEGER NOT NULL DEFAULT 0 CHECK (archive_required IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, record_class)
);

CREATE TABLE backup_records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  backup_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED', 'VERIFIED')),
  storage_reference TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  verified_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE data_migration_runs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  source_schema TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PREVIEW', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  report_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, source_checksum)
);

INSERT INTO schema_migrations(version, name, checksum, applied_at)
VALUES (2, 'reliability_runtime', 'pass5-0002-v1', CURRENT_TIMESTAMP);
