CREATE TABLE inventory_adjustment_requests (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL CHECK (quantity_minor <> 0),
  unit_cost_minor INTEGER,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  idempotency_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decision_reason TEXT,
  posted_movement_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id)
);

CREATE INDEX idx_inventory_adjustment_requests_branch_status
  ON inventory_adjustment_requests(tenant_id,branch_id,status,created_at DESC);

CREATE INDEX idx_inventory_adjustment_requests_warehouse_item
  ON inventory_adjustment_requests(tenant_id,branch_id,warehouse_id,inventory_item_id,created_at DESC);

CREATE TRIGGER inventory_adjustment_terminal_immutable
BEFORE UPDATE ON inventory_adjustment_requests
WHEN OLD.status IN ('APPROVED','REJECTED','CANCELLED')
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_ADJUSTMENT_TERMINAL_IMMUTABLE');
END;

CREATE TRIGGER inventory_adjustment_terminal_no_delete
BEFORE DELETE ON inventory_adjustment_requests
WHEN OLD.status IN ('APPROVED','REJECTED')
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_ADJUSTMENT_TERMINAL_IMMUTABLE');
END;

CREATE INDEX idx_wastage_branch_status_created
  ON wastage(tenant_id,branch_id,status,created_at DESC);

CREATE INDEX idx_breakages_branch_status_created
  ON breakages(tenant_id,branch_id,status,created_at DESC);

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (24,'inventory_operations_control','inventory-operations-control-0024-v1',CURRENT_TIMESTAMP);
