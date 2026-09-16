PRAGMA foreign_keys = ON;

INSERT INTO permissions (code,description) VALUES
  ('setup.historical_sales.import','Preview and commit the one-time previous POS sales migration')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'setup.historical_sales.import'
FROM role_permissions WHERE permission_code='setup.import'
ON CONFLICT(tenant_id,role_id,permission_code) DO NOTHING;

CREATE TABLE historical_sales_migrations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALIDATED','REJECTED','COMMITTING','COMMITTED','SKIPPED','FAILED')),
  source_system TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_checksum TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  valid_count INTEGER NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  gross_sales_minor INTEGER NOT NULL DEFAULT 0 CHECK (gross_sales_minor >= 0),
  net_sales_minor INTEGER NOT NULL DEFAULT 0 CHECK (net_sales_minor >= 0),
  order_count INTEGER NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  report_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  committed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key)
);

CREATE TABLE historical_sales_migration_rows (
  tenant_id TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  row_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALID','WARNING','ERROR','COMMITTED')),
  normalized_json TEXT NOT NULL,
  errors_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id,migration_id,row_number),
  UNIQUE (tenant_id,migration_id,row_key),
  FOREIGN KEY (tenant_id,migration_id) REFERENCES historical_sales_migrations(tenant_id,id)
);

CREATE TABLE historical_sales_records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  external_sale_reference TEXT NOT NULL,
  business_date TEXT NOT NULL,
  occurred_at TEXT,
  currency TEXT NOT NULL,
  gross_sales_minor INTEGER NOT NULL CHECK (gross_sales_minor >= 0),
  discounts_minor INTEGER NOT NULL DEFAULT 0 CHECK (discounts_minor >= 0),
  refunds_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunds_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  service_charge_minor INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_minor >= 0),
  net_sales_minor INTEGER NOT NULL CHECK (net_sales_minor >= 0),
  order_count INTEGER NOT NULL DEFAULT 1 CHECK (order_count > 0),
  channel_code TEXT,
  payment_method_reference TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,source_system,external_sale_reference),
  FOREIGN KEY (tenant_id,migration_id) REFERENCES historical_sales_migrations(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE UNIQUE INDEX idx_historical_sales_one_committed_migration
  ON historical_sales_migrations(tenant_id) WHERE status='COMMITTED';

CREATE INDEX idx_historical_sales_preview_status
  ON historical_sales_migrations(tenant_id,status,created_at DESC);

CREATE INDEX idx_historical_sales_reporting
  ON historical_sales_records(tenant_id,branch_id,business_date,currency);

CREATE TRIGGER historical_sales_records_immutable_update
BEFORE UPDATE ON historical_sales_records
BEGIN
  SELECT RAISE(ABORT,'Historical sales records are append-only');
END;

CREATE TRIGGER historical_sales_records_immutable_delete
BEFORE DELETE ON historical_sales_records
BEGIN
  SELECT RAISE(ABORT,'Historical sales records are append-only');
END;

INSERT INTO schema_migrations (version,name,checksum,applied_at)
VALUES (19,'historical-sales-migration','sha256:historical-sales-migration-v1',CURRENT_TIMESTAMP);
