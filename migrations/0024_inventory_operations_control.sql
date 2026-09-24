PRAGMA foreign_keys = ON;

CREATE TABLE inventory_adjustments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL CHECK (quantity_minor <> 0),
  unit_cost_minor INTEGER,
  estimated_value_minor INTEGER NOT NULL DEFAULT 0,
  reason_code TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  idempotency_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  rejected_by TEXT,
  decision_reason TEXT,
  posted_movement_id TEXT,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id)
);

ALTER TABLE wastage ADD COLUMN warehouse_id TEXT;
ALTER TABLE wastage ADD COLUMN inventory_item_id TEXT;
ALTER TABLE wastage ADD COLUMN quantity_minor INTEGER;
ALTER TABLE wastage ADD COLUMN reason_code TEXT;
ALTER TABLE wastage ADD COLUMN estimated_cost_minor INTEGER;
ALTER TABLE wastage ADD COLUMN movement_id TEXT;
ALTER TABLE wastage ADD COLUMN requested_by TEXT;
ALTER TABLE wastage ADD COLUMN approved_by TEXT;
ALTER TABLE wastage ADD COLUMN rejected_by TEXT;
ALTER TABLE wastage ADD COLUMN decision_reason TEXT;
ALTER TABLE wastage ADD COLUMN business_date TEXT;
ALTER TABLE wastage ADD COLUMN updated_at TEXT;
ALTER TABLE wastage ADD COLUMN decided_at TEXT;

UPDATE wastage
SET updated_at=COALESCE(updated_at,created_at),
    requested_by=COALESCE(requested_by,json_extract(payload_json,'$.employeeId')),
    warehouse_id=COALESCE(warehouse_id,json_extract(payload_json,'$.warehouseId')),
    inventory_item_id=COALESCE(inventory_item_id,json_extract(payload_json,'$.inventoryItemId')),
    quantity_minor=COALESCE(quantity_minor,json_extract(payload_json,'$.quantityMicro')),
    reason_code=COALESCE(reason_code,json_extract(payload_json,'$.reasonCode')),
    estimated_cost_minor=COALESCE(estimated_cost_minor,json_extract(payload_json,'$.estimatedCostMinor')),
    movement_id=COALESCE(movement_id,json_extract(payload_json,'$.movementId')),
    business_date=COALESCE(business_date,json_extract(payload_json,'$.businessDate'));

ALTER TABLE breakages ADD COLUMN warehouse_id TEXT;
ALTER TABLE breakages ADD COLUMN asset_name TEXT;
ALTER TABLE breakages ADD COLUMN quantity_minor INTEGER;
ALTER TABLE breakages ADD COLUMN unit_label TEXT;
ALTER TABLE breakages ADD COLUMN reason_code TEXT;
ALTER TABLE breakages ADD COLUMN estimated_value_minor INTEGER;
ALTER TABLE breakages ADD COLUMN requested_by TEXT;
ALTER TABLE breakages ADD COLUMN approved_by TEXT;
ALTER TABLE breakages ADD COLUMN rejected_by TEXT;
ALTER TABLE breakages ADD COLUMN decision_reason TEXT;
ALTER TABLE breakages ADD COLUMN business_date TEXT;
ALTER TABLE breakages ADD COLUMN updated_at TEXT;
ALTER TABLE breakages ADD COLUMN decided_at TEXT;

UPDATE breakages
SET updated_at=COALESCE(updated_at,created_at),
    requested_by=COALESCE(requested_by,json_extract(payload_json,'$.requestedBy')),
    warehouse_id=COALESCE(warehouse_id,json_extract(payload_json,'$.warehouseId')),
    asset_name=COALESCE(asset_name,json_extract(payload_json,'$.item')),
    quantity_minor=COALESCE(quantity_minor,CAST(json_extract(payload_json,'$.quantity') AS INTEGER)*1000000),
    unit_label=COALESCE(unit_label,json_extract(payload_json,'$.unit')),
    reason_code=COALESCE(reason_code,json_extract(payload_json,'$.reason')),
    estimated_value_minor=COALESCE(estimated_value_minor,CAST(json_extract(payload_json,'$.value') AS INTEGER)*100),
    business_date=COALESCE(business_date,json_extract(payload_json,'$.businessDate'));

ALTER TABLE warehouses ADD COLUMN location_type TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE warehouses ADD COLUMN created_at TEXT;
ALTER TABLE warehouses ADD COLUMN updated_at TEXT;
ALTER TABLE warehouses ADD COLUMN archived_at TEXT;

UPDATE warehouses
SET location_type=COALESCE(NULLIF(json_extract(payload_json,'$.type'),''),'OTHER'),
    created_at=COALESCE(created_at,CURRENT_TIMESTAMP),
    updated_at=COALESCE(updated_at,CURRENT_TIMESTAMP);

ALTER TABLE stock_transfers ADD COLUMN approval_reason TEXT;
ALTER TABLE stock_transfers ADD COLUMN cancelled_by TEXT;
ALTER TABLE stock_transfers ADD COLUMN cancelled_at TEXT;
ALTER TABLE stock_transfers ADD COLUMN cancellation_reason TEXT;

CREATE INDEX idx_inventory_adjustments_branch_status
  ON inventory_adjustments(tenant_id,branch_id,status,created_at DESC);
CREATE INDEX idx_wastage_branch_status
  ON wastage(tenant_id,branch_id,status,created_at DESC);
CREATE INDEX idx_breakages_branch_status
  ON breakages(tenant_id,branch_id,status,created_at DESC);
CREATE INDEX idx_warehouses_branch_active
  ON warehouses(tenant_id,branch_id,active,name);
CREATE INDEX idx_stock_transfers_destination_status
  ON stock_transfers(tenant_id,destination_branch_id,status,created_at DESC);

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (24,'inventory_operations_control','inventory-operations-control-0024-v1',CURRENT_TIMESTAMP);
