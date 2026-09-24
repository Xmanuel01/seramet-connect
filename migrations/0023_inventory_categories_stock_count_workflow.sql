PRAGMA foreign_keys = ON;

CREATE TABLE inventory_categories (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code),
  UNIQUE (tenant_id,name)
);

CREATE INDEX idx_inventory_categories_active
  ON inventory_categories(tenant_id,active,name);

INSERT INTO inventory_categories
  (tenant_id,id,code,name,description,active,created_by,created_at,updated_at)
SELECT DISTINCT
  tenant_id,
  category_id,
  UPPER(REPLACE(REPLACE(category_id,' ','-'),'_','-')),
  category_id,
  'Backfilled from existing inventory item category',
  1,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM inventory_items
WHERE category_id IS NOT NULL
  AND TRIM(category_id) <> ''
ON CONFLICT DO NOTHING;

ALTER TABLE stock_count_sessions ADD COLUMN snapshot_at TEXT;
ALTER TABLE stock_count_sessions ADD COLUMN submitted_by TEXT;
ALTER TABLE stock_count_sessions ADD COLUMN submitted_at TEXT;
ALTER TABLE stock_count_sessions ADD COLUMN cancelled_by TEXT;
ALTER TABLE stock_count_sessions ADD COLUMN cancelled_at TEXT;
ALTER TABLE stock_count_sessions ADD COLUMN cancellation_reason TEXT;
ALTER TABLE stock_count_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

UPDATE stock_count_sessions
SET snapshot_at=COALESCE(snapshot_at,created_at);

ALTER TABLE stock_count_lines ADD COLUMN counted INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stock_count_lines ADD COLUMN unit_cost_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_count_lines ADD COLUMN counted_at TEXT;

CREATE INDEX idx_stock_count_sessions_branch_status
  ON stock_count_sessions(tenant_id,branch_id,status,created_at DESC);

CREATE INDEX idx_stock_count_sessions_warehouse_status
  ON stock_count_sessions(tenant_id,branch_id,warehouse_id,status,created_at DESC);

CREATE INDEX idx_stock_count_lines_session_counted
  ON stock_count_lines(tenant_id,stock_count_session_id,counted,inventory_item_id);

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (23,'inventory_categories_stock_count_workflow','inventory-categories-stock-count-workflow-0023-v1',CURRENT_TIMESTAMP);
