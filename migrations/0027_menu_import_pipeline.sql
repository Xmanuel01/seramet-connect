-- Durable menu import approval, batching and publication state.
ALTER TABLE stored_objects ADD COLUMN scan_evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE stored_objects ADD COLUMN object_version TEXT NOT NULL DEFAULT '';
ALTER TABLE stored_objects ADD COLUMN scan_evidence_id TEXT;

ALTER TABLE setup_imports ADD COLUMN source_object_id TEXT;
ALTER TABLE setup_imports ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','FAILED'));
ALTER TABLE setup_imports ADD COLUMN scan_evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE setup_imports ADD COLUMN approved_plan_digest TEXT;
ALTER TABLE setup_imports ADD COLUMN approved_by TEXT;
ALTER TABLE setup_imports ADD COLUMN approved_at TEXT;
ALTER TABLE setup_imports ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 20
  CHECK (batch_size BETWEEN 10 AND 25);
ALTER TABLE setup_imports ADD COLUMN publish_status TEXT NOT NULL DEFAULT 'NOT_READY'
  CHECK (publish_status IN ('NOT_READY','READY','PUBLISHING','PUBLISHED','FAILED'));
ALTER TABLE setup_imports ADD COLUMN publish_idempotency_key TEXT;
ALTER TABLE setup_imports ADD COLUMN published_at TEXT;
ALTER TABLE setup_imports ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE setup_imports ADD COLUMN pipeline_state TEXT NOT NULL DEFAULT 'STAGED'
  CHECK (pipeline_state IN (
    'STAGED','APPROVED','COMMITTING','VERIFYING','READY_TO_PUBLISH',
    'PUBLISHING','PUBLISHED','VALIDATION_FAILED','COMMIT_FAILED',
    'VERIFICATION_FAILED','CANCELLED'
  ));

ALTER TABLE setup_import_rows ADD COLUMN materialized_at TEXT;
ALTER TABLE setup_import_rows ADD COLUMN published_at TEXT;
ALTER TABLE setup_import_rows ADD COLUMN publication_verified_at TEXT;
ALTER TABLE worker_jobs ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE menu_import_staged_items (
  tenant_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','SKIP','NO_CHANGE')),
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  code TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  category_code TEXT NOT NULL,
  description TEXT,
  selling_price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  tax_rule_id TEXT,
  service_charge_applicable INTEGER NOT NULL DEFAULT 0,
  recipe_reference TEXT,
  modifier_group_reference TEXT,
  barcode TEXT,
  sellable INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,import_id,menu_item_id),
  FOREIGN KEY (tenant_id,import_id) REFERENCES setup_imports(tenant_id,id)
);

CREATE TABLE menu_import_staged_branch_settings (
  tenant_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  after_json TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  selling_price_minor INTEGER,
  available INTEGER NOT NULL DEFAULT 1,
  channel_availability_json TEXT NOT NULL DEFAULT '{}',
  station_id TEXT,
  kitchen_printer_group TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  source_station_normalized TEXT,
  reference_alias_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,import_id,branch_id,menu_item_id),
  FOREIGN KEY (tenant_id,import_id) REFERENCES setup_imports(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE manual_menu_item_requests (
  tenant_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,request_key),
  FOREIGN KEY (tenant_id,menu_item_id) REFERENCES menu_catalog_items(tenant_id,id)
);

CREATE TABLE file_import_state_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  job_id TEXT,
  import_id TEXT,
  object_id TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'QUARANTINED','SCAN_PENDING','SCANNED_CLEAN','PARSING','STAGED','APPROVED',
    'COMMITTING','VERIFYING','READY_TO_PUBLISH','PUBLISHING','PUBLISHED',
    'REJECTED_INFECTED','SCAN_FAILED','VALIDATION_FAILED','COMMIT_FAILED',
    'VERIFICATION_FAILED','CANCELLED'
  )),
  attempt INTEGER NOT NULL DEFAULT 1,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,import_id) REFERENCES setup_imports(tenant_id,id),
  FOREIGN KEY (tenant_id,object_id) REFERENCES stored_objects(tenant_id,id)
);

CREATE INDEX idx_setup_import_pipeline
  ON setup_imports(tenant_id,scan_status,status,publish_status,updated_at);
CREATE INDEX idx_setup_import_rows_batch
  ON setup_import_rows(tenant_id,import_id,materialized_at,published_at,row_number);
CREATE UNIQUE INDEX idx_stored_object_scan_evidence
  ON stored_objects(tenant_id,scan_evidence_id) WHERE scan_evidence_id IS NOT NULL;
CREATE INDEX idx_file_import_state_events
  ON file_import_state_events(tenant_id,job_id,import_id,created_at);
CREATE INDEX idx_menu_import_staged_items
  ON menu_import_staged_items(tenant_id,import_id,source_row_number);
CREATE INDEX idx_menu_import_staged_branches
  ON menu_import_staged_branch_settings(tenant_id,import_id,source_row_number);

CREATE TRIGGER setup_import_publish_guard
BEFORE UPDATE OF publish_status ON setup_imports
WHEN NEW.publish_status='PUBLISHED'
BEGIN
  SELECT CASE WHEN NEW.status<>'COMMITTED'
    OR NEW.verification_status<>'VERIFIED'
    OR NEW.approved_plan_digest IS NULL
    OR EXISTS (
      SELECT 1 FROM setup_import_rows r
      WHERE r.tenant_id=NEW.tenant_id AND r.import_id=NEW.id
        AND r.status='COMMITTED' AND r.publication_verified_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM menu_import_staged_items s
      LEFT JOIN menu_catalog_items m
        ON m.tenant_id=s.tenant_id AND m.id=s.menu_item_id
      WHERE s.tenant_id=NEW.tenant_id AND s.import_id=NEW.id
        AND (s.plan_digest<>NEW.approved_plan_digest OR m.id IS NULL
          OR m.code<>s.code OR m.name<>s.name OR m.category_code<>s.category_code
          OR m.selling_price_minor<>s.selling_price_minor OR m.currency<>s.currency)
    )
    OR EXISTS (
      SELECT 1 FROM menu_import_staged_branch_settings s
      LEFT JOIN menu_item_branch_settings b
        ON b.tenant_id=s.tenant_id AND b.branch_id=s.branch_id
       AND b.menu_item_id=s.menu_item_id
      WHERE s.tenant_id=NEW.tenant_id AND s.import_id=NEW.id
        AND (s.plan_digest<>NEW.approved_plan_digest OR b.menu_item_id IS NULL
          OR COALESCE(b.selling_price_minor,-1)<>COALESCE(s.selling_price_minor,-1)
          OR b.available<>s.available
          OR COALESCE(b.station_id,'')<>COALESCE(s.station_id,''))
    )
  THEN RAISE(ABORT,'menu import publication invariant failed') END;
END;

CREATE TRIGGER file_import_state_events_no_update
BEFORE UPDATE ON file_import_state_events
BEGIN
  SELECT RAISE(ABORT,'file import state history is append-only');
END;

CREATE TRIGGER file_import_state_events_no_delete
BEFORE DELETE ON file_import_state_events
BEGIN
  SELECT RAISE(ABORT,'file import state history is append-only');
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (27,'menu_import_pipeline','menu-import-pipeline-0027-v2',CURRENT_TIMESTAMP);
