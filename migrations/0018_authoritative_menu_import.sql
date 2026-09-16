ALTER TABLE setup_imports ADD COLUMN template_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE setup_imports ADD COLUMN preview_fingerprint TEXT;
ALTER TABLE setup_imports ADD COLUMN importer_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE setup_imports ADD COLUMN target_mode TEXT NOT NULL DEFAULT 'TENANT_MASTER'
  CHECK (target_mode IN ('TENANT_MASTER','SELECTED_BRANCHES','ROW_BRANCHES'));
ALTER TABLE setup_imports ADD COLUMN target_branch_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE setup_imports ADD COLUMN column_map_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE setup_imports ADD COLUMN reference_map_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE setup_imports ADD COLUMN catalogue_revision TEXT;
ALTER TABLE setup_imports ADD COLUMN expires_at TEXT;
ALTER TABLE setup_imports ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (verification_status IN ('PENDING','VERIFIED','FAILED'));
ALTER TABLE setup_imports ADD COLUMN verification_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE setup_import_rows ADD COLUMN action TEXT NOT NULL DEFAULT 'CREATE'
  CHECK (action IN ('CREATE','UPDATE','SKIP','ERROR','NO_CHANGE'));
ALTER TABLE setup_import_rows ADD COLUMN before_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE setup_import_rows ADD COLUMN after_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE menu_item_branch_settings ADD COLUMN station_id TEXT;
ALTER TABLE menu_item_branch_settings ADD COLUMN kitchen_printer_group TEXT;
ALTER TABLE menu_item_branch_settings ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE setup_import_reference_aliases (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  reference_type TEXT NOT NULL CHECK (reference_type IN ('STATION','CATEGORY','TAX','BRANCH')),
  source_value_normalized TEXT NOT NULL,
  branch_id TEXT,
  target_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,reference_type,source_value_normalized,branch_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE UNIQUE INDEX idx_setup_import_preview_fingerprint
ON setup_imports(tenant_id,preview_fingerprint)
WHERE preview_fingerprint IS NOT NULL;

CREATE INDEX idx_setup_import_status_created
ON setup_imports(tenant_id,status,created_at DESC);

CREATE INDEX idx_setup_import_alias_lookup
ON setup_import_reference_aliases(tenant_id,reference_type,source_value_normalized,branch_id,active);

CREATE TRIGGER menu_branch_station_insert_guard
BEFORE INSERT ON menu_item_branch_settings
WHEN NEW.station_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM stations s
  WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id AND s.id=NEW.station_id AND s.active=1
)
BEGIN SELECT RAISE(ABORT,'MENU_BRANCH_STATION_SCOPE_VIOLATION'); END;

CREATE TRIGGER menu_branch_station_update_guard
BEFORE UPDATE OF station_id ON menu_item_branch_settings
WHEN NEW.station_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM stations s
  WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id AND s.id=NEW.station_id AND s.active=1
)
BEGIN SELECT RAISE(ABORT,'MENU_BRANCH_STATION_SCOPE_VIOLATION'); END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (18,'authoritative_menu_import','authoritative-menu-import-0018-v1',CURRENT_TIMESTAMP);
