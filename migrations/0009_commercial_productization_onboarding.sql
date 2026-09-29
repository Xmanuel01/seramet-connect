-- Pass 8: commercial productization, onboarding and tenant readiness.
-- This migration extends existing configuration, inventory, integration and worker foundations.

-- Canonical server permission catalog. Tenant role assignments remain tenant-owned data.
INSERT INTO permissions (code,description) VALUES
  ('dashboard.view','View operational dashboards'),
  ('orders.create','Create orders'),
  ('orders.update','Update orders'),
  ('orders.cancel','Cancel orders'),
  ('orders.serve','Serve orders'),
  ('kitchen.operate','Operate kitchen workflows'),
  ('inventory.view','View inventory'),
  ('inventory.count','Count inventory'),
  ('inventory.count.approve','Approve inventory counts'),
  ('inventory.adjust','Adjust inventory'),
  ('inventory.adjust.approve','Approve inventory adjustments'),
  ('inventory.transfer','Transfer inventory'),
  ('inventory.wastage.record','Record inventory wastage'),
  ('inventory.wastage.approve','Approve inventory wastage'),
  ('costcontrol.view','View cost control'),
  ('costcontrol.manage','Manage cost control'),
  ('procurement.requisition.create','Create purchase requisitions'),
  ('procurement.requisition.approve','Approve purchase requisitions'),
  ('procurement.po.create','Create purchase orders'),
  ('procurement.po.approve','Approve purchase orders'),
  ('procurement.po.cancel','Cancel purchase orders'),
  ('procurement.po.receive','Receive purchase orders'),
  ('procurement.invoice.approve','Approve supplier invoices'),
  ('production.plan','Plan production'),
  ('production.start','Start production'),
  ('production.complete','Complete production'),
  ('production.adjust','Adjust production'),
  ('inventory.waste.record','Record waste'),
  ('inventory.waste.approve','Approve waste'),
  ('attendance.use','Use attendance'),
  ('payroll.manage','Manage payroll'),
  ('delivery.riders.manage','Manage delivery riders'),
  ('delivery.dispatch','Dispatch deliveries'),
  ('payments.record','Record payments'),
  ('payments.view','View payments'),
  ('payments.collect','Collect payments'),
  ('payments.manual_confirm','Manually confirm payments'),
  ('payments.match','Match payments'),
  ('payments.confirm','Confirm payments'),
  ('payments.refund.request','Request refunds'),
  ('payments.refund.approve','Approve refunds'),
  ('payments.reconcile','Reconcile payments'),
  ('invoices.manage','Manage invoices'),
  ('cash.close','Close cash drawers'),
  ('cash.open','Open cash drawers'),
  ('cash.adjust','Adjust cash drawers'),
  ('reconciliation.view','View reconciliation'),
  ('reconciliation.manage','Manage reconciliation'),
  ('reconciliation.approve','Approve reconciliation'),
  ('dayclose.reopen','Reopen a day close'),
  ('settlements.import','Import settlements'),
  ('settlements.post','Post settlements'),
  ('finance.journal.view','View journals'),
  ('finance.journal.post','Post journals'),
  ('reports.view','View reports'),
  ('finance.manage','Manage finance'),
  ('management.view','View management intelligence'),
  ('management.actions.manage','Manage management actions'),
  ('management.targets.manage','Manage targets'),
  ('management.finance.view','View management finance'),
  ('setup.view','View setup and readiness'),
  ('setup.manage','Manage setup configuration'),
  ('setup.import','Preview and commit setup imports'),
  ('setup.opening_stock','Prepare opening stock'),
  ('setup.opening_stock.approve','Approve opening stock'),
  ('setup.accounting.manage','Manage setup accounting'),
  ('setup.go_live.approve','Approve go-live transitions'),
  ('setup.go_live.override','Override eligible readiness blockers'),
  ('setup.export','Export tenant data'),
  ('setup.entitlements.manage','Manage entitlements'),
  ('setup.demo.reset','Reset explicit demo tenants'),
  ('setup.diagnostics.view','View support diagnostics'),
  ('platform.tenants.provision','Provision tenants'),
  ('marketing.manage','Manage marketing'),
  ('staff.manage','Manage staff'),
  ('audit.view','View audit records'),
  ('settings.organisation.manage','Manage organisation settings'),
  ('settings.branch.manage','Manage branch settings'),
  ('settings.warehouse.manage','Manage warehouse settings'),
  ('settings.integration.manage','Manage integration settings'),
  ('integrations.orders.view','View integration orders'),
  ('integrations.orders.manage','Manage integration orders'),
  ('integrations.menu.sync','Synchronize integration menus'),
  ('integrations.mapping.manage','Manage provider mappings'),
  ('integrations.store.manage','Manage provider stores'),
  ('integrations.connection.manage','Manage provider connections'),
  ('settings.payment.manage','Manage payment settings'),
  ('settings.hardware.manage','Manage hardware settings'),
  ('settings.role.manage','Manage role settings'),
  ('settings.channel.manage','Manage channel settings'),
  ('scope.branches.all','Access all assigned tenant branches')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

CREATE TABLE tenant_onboarding_profiles (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  country_code TEXT,
  accounting_mode TEXT CHECK (accounting_mode IN ('PERPETUAL','PERIODIC') OR accounting_mode IS NULL),
  tax_configuration_reference TEXT,
  logo_asset_reference TEXT,
  default_document_footer TEXT,
  fiscal_settings_json TEXT NOT NULL DEFAULT '{}',
  contact_json TEXT NOT NULL DEFAULT '{}',
  legal_identifiers_json TEXT NOT NULL DEFAULT '{}',
  document_branding_json TEXT NOT NULL DEFAULT '{}',
  go_live_state TEXT NOT NULL DEFAULT 'SETUP'
    CHECK (go_live_state IN ('SETUP','READY_FOR_REVIEW','READY_FOR_GO_LIVE','LIVE','SUSPENDED')),
  demo_mode INTEGER NOT NULL DEFAULT 0 CHECK (demo_mode IN (0,1)),
  demo_reset_allowed INTEGER NOT NULL DEFAULT 0 CHECK (demo_reset_allowed IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE branch_operating_profiles (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  accounting_mode_override TEXT
    CHECK (accounting_mode_override IN ('PERPETUAL','PERIODIC') OR accounting_mode_override IS NULL),
  negative_stock_policy TEXT NOT NULL DEFAULT 'ALLOW_WITH_ALERT'
    CHECK (negative_stock_policy IN ('ALLOW_WITH_ALERT','BLOCK','MANAGER_OVERRIDE')),
  operating_hours_json TEXT NOT NULL DEFAULT '{}',
  service_modes_json TEXT NOT NULL DEFAULT '[]',
  required_device_roles_json TEXT NOT NULL DEFAULT '[]',
  payments_required INTEGER NOT NULL DEFAULT 1 CHECK (payments_required IN (0,1)),
  inventory_enabled INTEGER NOT NULL DEFAULT 1 CHECK (inventory_enabled IN (0,1)),
  recipes_required INTEGER NOT NULL DEFAULT 1 CHECK (recipes_required IN (0,1)),
  printing_required INTEGER NOT NULL DEFAULT 1 CHECK (printing_required IN (0,1)),
  kds_required INTEGER NOT NULL DEFAULT 0 CHECK (kds_required IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE setup_section_weights (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  section_key TEXT NOT NULL,
  weight_bps INTEGER NOT NULL CHECK (weight_bps BETWEEN 0 AND 10000),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,section_key)
);

CREATE TABLE setup_stage_snapshots (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  scope_key TEXT NOT NULL,
  section_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('NOT_STARTED','IN_PROGRESS','READY','BLOCKED','COMPLETE')),
  readiness_status TEXT NOT NULL CHECK (readiness_status IN ('READY','WARNING','BLOCKED','NOT_APPLICABLE')),
  progress_bps INTEGER NOT NULL CHECK (progress_bps BETWEEN 0 AND 10000),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,scope_key,section_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE setup_readiness_results (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  scope_key TEXT NOT NULL,
  section_key TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY','WARNING','BLOCKED','NOT_APPLICABLE')),
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL','SECURITY','SCHEMA')),
  message TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  recommended_action TEXT NOT NULL,
  source_entity_type TEXT,
  source_entity_id TEXT,
  override_allowed INTEGER NOT NULL DEFAULT 0 CHECK (override_allowed IN (0,1)),
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,scope_key,code),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE setup_imports (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('MENU','INVENTORY','SUPPLIER','STAFF','OPENING_STOCK','CONFIGURATION')),
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_checksum TEXT NOT NULL,
  duplicate_strategy TEXT NOT NULL CHECK (duplicate_strategy IN ('CREATE','UPDATE','SKIP','ERROR')),
  status TEXT NOT NULL CHECK (status IN ('PREVIEW','VALIDATED','COMMITTING','COMMITTED','REJECTED','FAILED')),
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  committed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE setup_import_rows (
  tenant_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  row_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALID','WARNING','ERROR','COMMITTED','SKIPPED')),
  normalized_json TEXT NOT NULL,
  errors_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  committed_entity_type TEXT,
  committed_entity_id TEXT,
  PRIMARY KEY (tenant_id,import_id,row_number),
  UNIQUE (tenant_id,import_id,row_key),
  FOREIGN KEY (tenant_id,import_id) REFERENCES setup_imports(tenant_id,id)
);

CREATE TABLE menu_catalog_items (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  category_code TEXT NOT NULL,
  description TEXT,
  selling_price_minor INTEGER NOT NULL CHECK (selling_price_minor >= 0),
  currency TEXT NOT NULL,
  tax_rule_id TEXT,
  service_charge_applicable INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_applicable IN (0,1)),
  station_id TEXT,
  recipe_reference TEXT,
  modifier_group_reference TEXT,
  barcode TEXT,
  sellable INTEGER NOT NULL DEFAULT 1 CHECK (sellable IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code),
  UNIQUE (tenant_id,sku),
  FOREIGN KEY (tenant_id,station_id) REFERENCES stations(tenant_id,id)
);

CREATE TABLE menu_item_branch_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  selling_price_minor INTEGER,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  channel_availability_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,menu_item_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,menu_item_id) REFERENCES menu_catalog_items(tenant_id,id)
);

CREATE TABLE opening_stock_batches (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','REVIEW','APPROVED','POSTED','REJECTED')),
  total_value_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_value_minor >= 0),
  idempotency_key TEXT NOT NULL,
  approval_reason TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id)
);

CREATE TABLE opening_stock_lines (
  tenant_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  quantity_micro INTEGER NOT NULL CHECK (quantity_micro >= 0),
  base_quantity_micro INTEGER NOT NULL CHECK (base_quantity_micro >= 0),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  total_cost_minor INTEGER NOT NULL CHECK (total_cost_minor >= 0),
  movement_id TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,batch_id,inventory_item_id),
  FOREIGN KEY (tenant_id,batch_id) REFERENCES opening_stock_batches(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id),
  FOREIGN KEY (tenant_id,unit_id) REFERENCES unit_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,movement_id) REFERENCES inventory_movements(tenant_id,id)
);

CREATE TABLE setup_account_mappings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  scope_key TEXT NOT NULL,
  mapping_key TEXT NOT NULL,
  requirement TEXT NOT NULL CHECK (requirement IN ('REQUIRED','OPTIONAL')),
  account_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('MISSING','CONFIGURED','INVALID')),
  finance_signoff_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (finance_signoff_status IN ('PENDING','APPROVED','REJECTED')),
  signed_off_by TEXT,
  signed_off_at TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,scope_key,mapping_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES accounts(tenant_id,id)
);

CREATE TABLE tax_service_rules (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('TAX','SERVICE_CHARGE')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  calculation_mode TEXT NOT NULL CHECK (calculation_mode IN ('INCLUSIVE','EXCLUSIVE')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  account_id TEXT,
  rounding_mode TEXT NOT NULL DEFAULT 'HALF_AWAY_FROM_ZERO',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,code,effective_from),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES accounts(tenant_id,id)
);

CREATE TABLE setup_signoffs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  signoff_type TEXT NOT NULL CHECK (signoff_type IN ('FINANCE','OPERATIONS','HARDWARE','INTEGRATIONS','PILOT')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reason TEXT,
  signed_by TEXT,
  signed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,signoff_type),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE setup_test_runs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  test_type TEXT NOT NULL CHECK (test_type IN ('PRINT','ORDER','INTEGRATION','DEVICE')),
  target_type TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUCCESS','FAILED','TIMEOUT','DEVICE_OFFLINE','UNKNOWN')),
  test_marker TEXT NOT NULL DEFAULT '*** TEST ***',
  result_json TEXT NOT NULL DEFAULT '{}',
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE device_health_snapshots (
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  health_status TEXT NOT NULL CHECK (health_status IN ('ONLINE','OFFLINE','DEGRADED','UNKNOWN')),
  last_seen_at TEXT,
  last_successful_operation_at TEXT,
  warning TEXT,
  version TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,device_id),
  FOREIGN KEY (tenant_id,device_id) REFERENCES hardware_devices(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE provider_secret_metadata (
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  secret_reference TEXT NOT NULL,
  active_version TEXT,
  previous_version TEXT,
  rotated_at TEXT,
  credentials_age_days INTEGER,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,connection_id),
  FOREIGN KEY (tenant_id,connection_id) REFERENCES provider_connections(tenant_id,id)
);

CREATE TABLE subscription_lifecycle_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED')),
  effective_at TEXT NOT NULL,
  reason TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,subscription_id,effective_at),
  FOREIGN KEY (tenant_id,subscription_id) REFERENCES tenant_subscriptions(tenant_id,id)
);

CREATE TABLE support_diagnostic_exports (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','READY','FAILED','EXPIRED')),
  scope_json TEXT NOT NULL DEFAULT '{}',
  redacted_payload_json TEXT,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key)
);

CREATE TABLE tenant_data_export_jobs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','READY','FAILED','EXPIRED')),
  entity_types_json TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  row_limit INTEGER NOT NULL CHECK (row_limit BETWEEN 1 AND 1000000),
  result_reference TEXT,
  manifest_json TEXT,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key)
);

CREATE TABLE go_live_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  readiness_score_bps INTEGER NOT NULL CHECK (readiness_score_bps BETWEEN 0 AND 10000),
  blocker_codes_json TEXT NOT NULL DEFAULT '[]',
  override_used INTEGER NOT NULL DEFAULT 0 CHECK (override_used IN (0,1)),
  reason TEXT,
  approved_by TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id)
);

CREATE TABLE setup_recalculation_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  last_error TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE INDEX idx_setup_stage_scope ON setup_stage_snapshots(tenant_id,scope_key,section_key);
CREATE INDEX idx_setup_readiness_blockers ON setup_readiness_results(tenant_id,status,severity,section_key);
CREATE INDEX idx_setup_import_status ON setup_imports(tenant_id,status,created_at DESC);
CREATE INDEX idx_setup_import_rows_status ON setup_import_rows(tenant_id,import_id,status,row_number);
CREATE INDEX idx_catalog_category ON menu_catalog_items(tenant_id,category_code,active,name);
CREATE INDEX idx_catalog_station ON menu_catalog_items(tenant_id,station_id,active);
CREATE INDEX idx_catalog_branch ON menu_item_branch_settings(tenant_id,branch_id,available);
CREATE INDEX idx_opening_stock_status ON opening_stock_batches(tenant_id,branch_id,status,business_date);
CREATE INDEX idx_account_mapping_status ON setup_account_mappings(tenant_id,branch_id,status,requirement);
CREATE INDEX idx_tax_rules_effective ON tax_service_rules(tenant_id,branch_id,rule_type,effective_from DESC);
CREATE INDEX idx_setup_test_target ON setup_test_runs(tenant_id,branch_id,test_type,target_id,created_at DESC);
CREATE INDEX idx_device_health_branch ON device_health_snapshots(tenant_id,branch_id,health_status);
CREATE INDEX idx_subscription_lifecycle ON subscription_lifecycle_events(tenant_id,subscription_id,effective_at DESC);
CREATE INDEX idx_diagnostic_status ON support_diagnostic_exports(tenant_id,status,created_at DESC);
CREATE INDEX idx_data_export_status ON tenant_data_export_jobs(tenant_id,status,created_at DESC);
CREATE INDEX idx_go_live_events ON go_live_events(tenant_id,created_at DESC);
CREATE INDEX idx_setup_recalc_pending ON setup_recalculation_events(status,created_at);

CREATE TRIGGER opening_stock_posted_immutable
BEFORE UPDATE ON opening_stock_batches
WHEN OLD.status='POSTED'
BEGIN
  SELECT RAISE(ABORT,'posted opening stock is immutable');
END;

CREATE TRIGGER opening_stock_posted_no_delete
BEFORE DELETE ON opening_stock_batches
WHEN OLD.status='POSTED'
BEGIN
  SELECT RAISE(ABORT,'posted opening stock cannot be deleted');
END;

CREATE TRIGGER go_live_events_no_update
BEFORE UPDATE ON go_live_events
BEGIN
  SELECT RAISE(ABORT,'go-live event history is append-only');
END;

CREATE TRIGGER go_live_events_no_delete
BEFORE DELETE ON go_live_events
BEGIN
  SELECT RAISE(ABORT,'go-live event history is append-only');
END;

CREATE TRIGGER subscription_lifecycle_no_update
BEFORE UPDATE ON subscription_lifecycle_events
BEGIN
  SELECT RAISE(ABORT,'subscription lifecycle history is append-only');
END;

CREATE TRIGGER subscription_lifecycle_no_delete
BEFORE DELETE ON subscription_lifecycle_events
BEGIN
  SELECT RAISE(ABORT,'subscription lifecycle history is append-only');
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (9,'commercial_productization_onboarding','pass8-0009-v1',CURRENT_TIMESTAMP);
