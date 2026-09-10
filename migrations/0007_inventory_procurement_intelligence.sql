PRAGMA foreign_keys = ON;

-- Pass 6 extends the Pass 5 inventory/procurement tables. Quantities use integer
-- micro-units (1 base unit = 1,000,000) and money uses integer minor units.

ALTER TABLE inventory_items ADD COLUMN code TEXT;
ALTER TABLE inventory_items ADD COLUMN description TEXT;
ALTER TABLE inventory_items ADD COLUMN category_id TEXT;
ALTER TABLE inventory_items ADD COLUMN base_unit_id TEXT;
ALTER TABLE inventory_items ADD COLUMN purchase_unit_id TEXT;
ALTER TABLE inventory_items ADD COLUMN storage_unit_id TEXT;
ALTER TABLE inventory_items ADD COLUMN issue_unit_id TEXT;
ALTER TABLE inventory_items ADD COLUMN track_inventory INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inventory_items ADD COLUMN track_expiry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN preferred_supplier_id TEXT;
ALTER TABLE inventory_items ADD COLUMN default_warehouse_id TEXT;
ALTER TABLE inventory_items ADD COLUMN barcode TEXT;
ALTER TABLE inventory_items ADD COLUMN updated_at TEXT;

ALTER TABLE inventory_balances ADD COLUMN quantity_reserved_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_balances ADD COLUMN average_unit_cost_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_balances ADD COLUMN total_value_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_balances ADD COLUMN last_movement_at TEXT;

ALTER TABLE inventory_movements ADD COLUMN unit_cost_minor INTEGER;
ALTER TABLE inventory_movements ADD COLUMN total_cost_minor INTEGER;
ALTER TABLE inventory_movements ADD COLUMN business_date TEXT;
ALTER TABLE inventory_movements ADD COLUMN occurred_at TEXT;
ALTER TABLE inventory_movements ADD COLUMN actor_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN reason TEXT;
ALTER TABLE inventory_movements ADD COLUMN lot_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN negative_override INTEGER NOT NULL DEFAULT 0;

ALTER TABLE recipes ADD COLUMN name TEXT;
ALTER TABLE recipes ADD COLUMN branch_override_id TEXT;
ALTER TABLE recipes ADD COLUMN production_item_id TEXT;
ALTER TABLE recipes ADD COLUMN current_version_id TEXT;
ALTER TABLE recipes ADD COLUMN updated_at TEXT;

ALTER TABLE purchase_orders ADD COLUMN supplier_id TEXT;
ALTER TABLE purchase_orders ADD COLUMN warehouse_id TEXT;
ALTER TABLE purchase_orders ADD COLUMN requisition_id TEXT;
ALTER TABLE purchase_orders ADD COLUMN expected_at TEXT;
ALTER TABLE purchase_orders ADD COLUMN submitted_by TEXT;
ALTER TABLE purchase_orders ADD COLUMN approved_by TEXT;
ALTER TABLE purchase_orders ADD COLUMN approval_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN approved_at TEXT;
ALTER TABLE purchase_orders ADD COLUMN received_at TEXT;

ALTER TABLE purchase_order_lines ADD COLUMN purchase_unit_id TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN conversion_id TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN ordered_purchase_quantity_minor INTEGER;
ALTER TABLE purchase_order_lines ADD COLUMN received_purchase_quantity_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_lines ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_lines ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;

ALTER TABLE goods_receipts ADD COLUMN supplier_id TEXT;
ALTER TABLE goods_receipts ADD COLUMN warehouse_id TEXT;
ALTER TABLE goods_receipts ADD COLUMN received_by TEXT;
ALTER TABLE goods_receipts ADD COLUMN business_date TEXT;

CREATE TABLE unit_definitions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('MASS','VOLUME','COUNT','LENGTH','OTHER')),
  base_scale_numerator INTEGER NOT NULL DEFAULT 1 CHECK (base_scale_numerator > 0),
  base_scale_denominator INTEGER NOT NULL DEFAULT 1 CHECK (base_scale_denominator > 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE item_unit_conversions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  from_unit_id TEXT NOT NULL,
  to_unit_id TEXT NOT NULL,
  factor_numerator INTEGER NOT NULL CHECK (factor_numerator > 0),
  factor_denominator INTEGER NOT NULL CHECK (factor_denominator > 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, inventory_item_id, from_unit_id, effective_from),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, from_unit_id) REFERENCES unit_definitions(tenant_id, id),
  FOREIGN KEY (tenant_id, to_unit_id) REFERENCES unit_definitions(tenant_id, id)
);

CREATE TABLE suppliers (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT,
  phone TEXT,
  email TEXT,
  tax_number TEXT,
  address TEXT,
  payment_terms_days INTEGER,
  currency TEXT,
  lead_time_days INTEGER,
  minimum_order_minor INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE supplier_items (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  supplier_sku TEXT,
  purchase_unit_id TEXT NOT NULL,
  conversion_id TEXT,
  last_price_minor INTEGER,
  contract_price_minor INTEGER,
  minimum_quantity_minor INTEGER,
  lead_time_days INTEGER,
  preferred INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, supplier_id, inventory_item_id, purchase_unit_id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_unit_id) REFERENCES unit_definitions(tenant_id, id),
  FOREIGN KEY (tenant_id, conversion_id) REFERENCES item_unit_conversions(tenant_id, id)
);

CREATE TABLE supplier_item_price_history (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  branch_id TEXT,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  unit_id TEXT NOT NULL,
  normalized_base_unit_price_minor INTEGER NOT NULL CHECK (normalized_base_unit_price_minor >= 0),
  effective_at TEXT NOT NULL,
  source_purchase_order_id TEXT,
  source_goods_receipt_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_definitions(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE purchase_requisitions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  requisition_number TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('LOW_STOCK','MANUAL_REQUEST','FORECAST')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_ORDERED','ORDERED','REJECTED','CANCELLED')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  approval_reason TEXT,
  required_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, requisition_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id)
);

CREATE TABLE purchase_requisition_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  requisition_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  requested_quantity_minor INTEGER NOT NULL CHECK (requested_quantity_minor > 0),
  unit_id TEXT NOT NULL,
  ordered_quantity_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, requisition_id) REFERENCES purchase_requisitions(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_definitions(tenant_id, id)
);

CREATE TABLE purchase_quotes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  requisition_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  other_cost_minor INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  lead_time_days INTEGER,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, requisition_id) REFERENCES purchase_requisitions(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id)
);

CREATE TABLE purchase_quote_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL CHECK (quantity_minor > 0),
  unit_id TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES purchase_quotes(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE goods_receipt_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  goods_receipt_id TEXT NOT NULL,
  purchase_order_line_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  purchase_unit_id TEXT NOT NULL,
  received_purchase_quantity_minor INTEGER NOT NULL CHECK (received_purchase_quantity_minor > 0),
  accepted_purchase_quantity_minor INTEGER NOT NULL CHECK (accepted_purchase_quantity_minor >= 0),
  rejected_purchase_quantity_minor INTEGER NOT NULL DEFAULT 0 CHECK (rejected_purchase_quantity_minor >= 0),
  converted_base_quantity_minor INTEGER NOT NULL CHECK (converted_base_quantity_minor >= 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  total_cost_minor INTEGER NOT NULL CHECK (total_cost_minor >= 0),
  lot_number TEXT,
  expiry_date TEXT,
  quality_status TEXT NOT NULL DEFAULT 'ACCEPTED',
  price_variance_minor INTEGER NOT NULL DEFAULT 0,
  price_variance_bps INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, goods_receipt_id, purchase_order_line_id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES goods_receipts(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_line_id) REFERENCES purchase_order_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_unit_id) REFERENCES unit_definitions(tenant_id, id)
);

CREATE TABLE supplier_invoices (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  purchase_order_id TEXT,
  goods_receipt_id TEXT,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','REVIEW','APPROVED','POSTED','PARTIALLY_PAID','PAID','DISPUTED')),
  journal_entry_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, supplier_id, invoice_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES goods_receipts(tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries(tenant_id, id)
);

CREATE TABLE supplier_invoice_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  supplier_invoice_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL,
  unit_id TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_invoice_id) REFERENCES supplier_invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE supplier_returns (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  goods_receipt_id TEXT NOT NULL,
  return_number TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_CREDIT','CREDIT_POSTED','CANCELLED')),
  total_cost_minor INTEGER NOT NULL CHECK (total_cost_minor >= 0),
  credit_note_number TEXT,
  journal_entry_id TEXT,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  returned_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, return_number),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, supplier_id, credit_note_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES goods_receipts(tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries(tenant_id, id)
);

CREATE TABLE supplier_return_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  supplier_return_id TEXT NOT NULL,
  goods_receipt_line_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  returned_base_quantity_minor INTEGER NOT NULL CHECK (returned_base_quantity_minor > 0),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  total_cost_minor INTEGER NOT NULL CHECK (total_cost_minor >= 0),
  movement_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, supplier_return_id, goods_receipt_line_id),
  UNIQUE (tenant_id, movement_id),
  FOREIGN KEY (tenant_id, supplier_return_id) REFERENCES supplier_returns(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_line_id) REFERENCES goods_receipt_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, movement_id) REFERENCES inventory_movements(tenant_id, id)
);

CREATE TABLE procurement_matches (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  goods_receipt_id TEXT,
  supplier_invoice_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('MATCHED','QUANTITY_VARIANCE','PRICE_VARIANCE','TAX_VARIANCE','MISSING_DOCUMENT','REVIEW_REQUIRED')),
  ordered_total_minor INTEGER NOT NULL,
  received_total_minor INTEGER NOT NULL,
  invoiced_total_minor INTEGER NOT NULL,
  variance_minor INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, purchase_order_id, goods_receipt_id, supplier_invoice_id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES goods_receipts(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_invoice_id) REFERENCES supplier_invoices(tenant_id, id)
);

CREATE TABLE stock_transfers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  transfer_number TEXT NOT NULL,
  source_branch_id TEXT NOT NULL,
  source_warehouse_id TEXT NOT NULL,
  destination_branch_id TEXT NOT NULL,
  destination_warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','PICKED','IN_TRANSIT','RECEIVED','CANCELLED')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  received_by TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, transfer_number),
  FOREIGN KEY (tenant_id, source_branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, source_warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, destination_branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, destination_warehouse_id) REFERENCES warehouses(tenant_id, id)
);

CREATE TABLE stock_transfer_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  requested_quantity_minor INTEGER NOT NULL CHECK (requested_quantity_minor > 0),
  sent_quantity_minor INTEGER NOT NULL DEFAULT 0,
  received_quantity_minor INTEGER NOT NULL DEFAULT 0,
  shortage_quantity_minor INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, transfer_id) REFERENCES stock_transfers(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE recipe_versions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  yield_quantity_minor INTEGER NOT NULL CHECK (yield_quantity_minor > 0),
  yield_unit_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  packaging_cost_minor INTEGER NOT NULL DEFAULT 0,
  production_overhead_minor INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, recipe_id, version),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES recipes(tenant_id, id),
  FOREIGN KEY (tenant_id, yield_unit_id) REFERENCES unit_definitions(tenant_id, id)
);

CREATE TABLE recipe_version_components (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  recipe_version_id TEXT NOT NULL,
  inventory_item_id TEXT,
  sub_recipe_id TEXT,
  quantity_minor INTEGER NOT NULL CHECK (quantity_minor > 0),
  unit_id TEXT NOT NULL,
  waste_factor_bps INTEGER NOT NULL DEFAULT 0 CHECK (waste_factor_bps >= 0),
  optional INTEGER NOT NULL DEFAULT 0,
  station_id TEXT,
  PRIMARY KEY (tenant_id, id),
  CHECK ((inventory_item_id IS NOT NULL) <> (sub_recipe_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, recipe_version_id) REFERENCES recipe_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, sub_recipe_id) REFERENCES recipes(tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_definitions(tenant_id, id)
);

CREATE TABLE production_batches (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  recipe_version_id TEXT NOT NULL,
  planned_quantity_minor INTEGER NOT NULL,
  actual_output_quantity_minor INTEGER,
  output_item_id TEXT NOT NULL,
  station_id TEXT,
  employee_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  idempotency_key TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  business_date TEXT NOT NULL,
  expected_yield_minor INTEGER NOT NULL,
  yield_variance_bps INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_version_id) REFERENCES recipe_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, output_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE production_prep_recommendations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  recipe_version_id TEXT NOT NULL,
  output_item_id TEXT NOT NULL,
  forecast_required_minor INTEGER NOT NULL,
  prepared_available_minor INTEGER NOT NULL,
  safety_buffer_minor INTEGER NOT NULL DEFAULT 0,
  recommended_batch_minor INTEGER NOT NULL,
  due_at TEXT,
  station_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECOMMENDED' CHECK (status IN ('RECOMMENDED','APPROVED','ADJUSTED','STARTED','COMPLETED','DISMISSED')),
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  explanation_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, business_date, recipe_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES recipes(tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_version_id) REFERENCES recipe_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, output_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE portion_standards (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  menu_item_id TEXT,
  inventory_item_id TEXT,
  expected_quantity_minor INTEGER NOT NULL CHECK (expected_quantity_minor > 0),
  unit_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK ((menu_item_id IS NOT NULL) <> (inventory_item_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_definitions(tenant_id, id)
);

CREATE TABLE portion_checks (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  portion_standard_id TEXT NOT NULL,
  expected_quantity_minor INTEGER NOT NULL CHECK (expected_quantity_minor > 0),
  actual_quantity_minor INTEGER NOT NULL CHECK (actual_quantity_minor > 0),
  variance_quantity_minor INTEGER NOT NULL,
  employee_id TEXT,
  station_id TEXT,
  checked_by TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, portion_standard_id) REFERENCES portion_standards(tenant_id, id)
);

CREATE TABLE stock_count_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','COUNTING','SUBMITTED','REVIEW','POSTED','CANCELLED')),
  scope_json TEXT NOT NULL DEFAULT '{}',
  blind_count INTEGER NOT NULL DEFAULT 0,
  started_by TEXT NOT NULL,
  approved_by TEXT,
  approval_reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id)
);

CREATE TABLE stock_count_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  stock_count_session_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  counter_id TEXT NOT NULL,
  expected_quantity_minor INTEGER NOT NULL,
  counted_quantity_minor INTEGER NOT NULL,
  variance_quantity_minor INTEGER NOT NULL,
  variance_value_minor INTEGER NOT NULL,
  reason TEXT,
  posted_movement_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, stock_count_session_id, inventory_item_id),
  FOREIGN KEY (tenant_id, stock_count_session_id) REFERENCES stock_count_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE inventory_lots (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  lot_number TEXT NOT NULL,
  goods_receipt_line_id TEXT,
  received_at TEXT NOT NULL,
  expiry_date TEXT,
  quantity_received_minor INTEGER NOT NULL,
  quantity_remaining_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, inventory_item_id, lot_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_line_id) REFERENCES goods_receipt_lines(tenant_id, id)
);

CREATE TABLE inventory_par_policies (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  minimum_quantity_minor INTEGER NOT NULL DEFAULT 0,
  target_quantity_minor INTEGER NOT NULL DEFAULT 0,
  maximum_quantity_minor INTEGER,
  reorder_point_minor INTEGER NOT NULL DEFAULT 0,
  safety_stock_minor INTEGER NOT NULL DEFAULT 0,
  day_of_week INTEGER CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  negative_stock_policy TEXT NOT NULL DEFAULT 'ALLOW_WITH_ALERT' CHECK (negative_stock_policy IN ('ALLOW_WITH_ALERT','BLOCK','MANAGER_OVERRIDE')),
  recommendation_mode TEXT NOT NULL DEFAULT 'RECOMMEND' CHECK (recommendation_mode IN ('MANUAL','RECOMMEND','AUTO_REQUISITION')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, warehouse_id, inventory_item_id, day_of_week),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE UNIQUE INDEX uq_inventory_par_default
ON inventory_par_policies(tenant_id, branch_id, warehouse_id, inventory_item_id)
WHERE day_of_week IS NULL;

CREATE TABLE inventory_forecasts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  forecast_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('MOVING_AVERAGE','WEIGHTED_MOVING_AVERAGE','SAME_WEEKDAY_AVERAGE')),
  lookback_days INTEGER NOT NULL,
  forecast_quantity_minor INTEGER NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  inputs_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, warehouse_id, inventory_item_id, forecast_date, method),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE purchase_recommendations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  supplier_id TEXT,
  forecast_quantity_minor INTEGER NOT NULL,
  safety_stock_minor INTEGER NOT NULL,
  target_closing_quantity_minor INTEGER NOT NULL,
  on_hand_quantity_minor INTEGER NOT NULL,
  incoming_quantity_minor INTEGER NOT NULL,
  recommended_base_quantity_minor INTEGER NOT NULL,
  recommended_purchase_quantity_minor INTEGER NOT NULL,
  purchase_unit_id TEXT NOT NULL,
  recommended_order_date TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  explanation_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWED','CONVERTED','DISMISSED')),
  generated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_unit_id) REFERENCES unit_definitions(tenant_id, id)
);

CREATE TABLE inventory_consumption_periods (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  theoretical_quantity_minor INTEGER NOT NULL,
  actual_quantity_minor INTEGER NOT NULL,
  variance_quantity_minor INTEGER NOT NULL,
  variance_value_minor INTEGER NOT NULL,
  explained_quantity_minor INTEGER NOT NULL DEFAULT 0,
  unexplained_quantity_minor INTEGER NOT NULL,
  drivers_json TEXT NOT NULL DEFAULT '[]',
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  generated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, warehouse_id, inventory_item_id, period_start, period_end),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE menu_profitability_snapshots (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  quantity_sold INTEGER NOT NULL,
  net_revenue_minor INTEGER NOT NULL,
  theoretical_cost_minor INTEGER NOT NULL,
  contribution_minor INTEGER NOT NULL,
  food_cost_bps INTEGER NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('STAR','PLOWHORSE','PUZZLE','DOG','INSUFFICIENT_DATA')),
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  generated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, menu_item_id, period_start, period_end)
);

CREATE TABLE inventory_data_quality_issues (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  issue_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','IGNORED')),
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, issue_code, entity_type, entity_id, status)
);

CREATE TABLE menu_inventory_availability (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  available_portions INTEGER NOT NULL CHECK (available_portions >= 0),
  available INTEGER NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING','QUEUED','SYNCED')),
  calculated_at TEXT NOT NULL,
  last_queued_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, branch_id, menu_item_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE inventory_account_mappings (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  inventory_category_id TEXT,
  inventory_account_id TEXT NOT NULL,
  opening_balance_account_id TEXT,
  accounts_payable_account_id TEXT NOT NULL,
  cogs_account_id TEXT NOT NULL,
  wastage_account_id TEXT NOT NULL,
  variance_account_id TEXT NOT NULL,
  recoverable_tax_account_id TEXT,
  accounting_mode TEXT NOT NULL DEFAULT 'PERPETUAL' CHECK (accounting_mode IN ('PERPETUAL','PERIODIC')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_account_id) REFERENCES accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, opening_balance_account_id) REFERENCES accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, accounts_payable_account_id) REFERENCES accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, cogs_account_id) REFERENCES accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, wastage_account_id) REFERENCES accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, variance_account_id) REFERENCES accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, recoverable_tax_account_id) REFERENCES accounts(tenant_id, id)
);

CREATE TABLE inventory_recalculation_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','PROCESSED','FAILED')),
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  processed_at TEXT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX idx_supplier_items_item ON supplier_items(tenant_id, inventory_item_id, preferred);
CREATE INDEX idx_supplier_prices_item_date ON supplier_item_price_history(tenant_id, inventory_item_id, effective_at DESC);
CREATE INDEX idx_requisitions_branch_status ON purchase_requisitions(tenant_id, branch_id, status, required_at);
CREATE INDEX idx_receipt_lines_item ON goods_receipt_lines(tenant_id, inventory_item_id, created_at DESC);
CREATE INDEX idx_supplier_invoices_status ON supplier_invoices(tenant_id, branch_id, status, due_date);
CREATE INDEX idx_supplier_returns_status ON supplier_returns(tenant_id, branch_id, status, business_date);
CREATE INDEX idx_supplier_return_lines_receipt ON supplier_return_lines(tenant_id, goods_receipt_line_id);
CREATE INDEX idx_transfer_status ON stock_transfers(tenant_id, source_branch_id, destination_branch_id, status);
CREATE UNIQUE INDEX uq_stock_transfer_idempotency
ON stock_transfers(tenant_id, json_extract(payload_json,'$.idempotencyKey'))
WHERE json_extract(payload_json,'$.idempotencyKey') IS NOT NULL;
CREATE INDEX idx_recipe_versions_effective ON recipe_versions(tenant_id, recipe_id, effective_from DESC);
CREATE INDEX idx_production_status ON production_batches(tenant_id, branch_id, status, business_date);
CREATE INDEX idx_portion_checks_branch_date ON portion_checks(tenant_id, branch_id, checked_at DESC);
CREATE INDEX idx_stock_counts_status ON stock_count_sessions(tenant_id, branch_id, warehouse_id, status, business_date);
CREATE INDEX idx_inventory_lots_expiry ON inventory_lots(tenant_id, branch_id, expiry_date, status);
CREATE INDEX idx_forecasts_date ON inventory_forecasts(tenant_id, branch_id, forecast_date);
CREATE INDEX idx_recommendations_status ON purchase_recommendations(tenant_id, branch_id, status, recommended_order_date);
CREATE INDEX idx_consumption_period ON inventory_consumption_periods(tenant_id, branch_id, period_end DESC);
CREATE INDEX idx_inventory_quality_open ON inventory_data_quality_issues(tenant_id, branch_id, status, severity);
CREATE INDEX idx_menu_inventory_availability_sync ON menu_inventory_availability(tenant_id, sync_status, calculated_at);
CREATE INDEX idx_inventory_recalc_pending ON inventory_recalculation_events(status, created_at);

CREATE TRIGGER inventory_movement_scope_guard
BEFORE INSERT ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM warehouses
      WHERE tenant_id = NEW.tenant_id AND id = NEW.warehouse_id AND branch_id = NEW.branch_id
    ) THEN RAISE(ABORT, 'INVENTORY_WAREHOUSE_SCOPE_VIOLATION')
  END;
END;

CREATE TRIGGER inventory_negative_policy_guard
BEFORE INSERT ON inventory_movements
WHEN NEW.quantity_minor < 0
BEGIN
  SELECT CASE
    WHEN COALESCE((
      SELECT quantity_minor FROM inventory_balances
      WHERE tenant_id = NEW.tenant_id AND branch_id = NEW.branch_id
        AND warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id
    ), 0) + NEW.quantity_minor < 0
    AND COALESCE((
      SELECT negative_stock_policy FROM inventory_par_policies
      WHERE tenant_id = NEW.tenant_id AND branch_id = NEW.branch_id
        AND warehouse_id = NEW.warehouse_id AND inventory_item_id = NEW.item_id
      ORDER BY CASE WHEN day_of_week IS NULL THEN 1 ELSE 0 END LIMIT 1
    ), 'ALLOW_WITH_ALERT') = 'BLOCK'
    AND NEW.negative_override = 0
      THEN RAISE(ABORT, 'NEGATIVE_INVENTORY_BLOCKED')
  END;
END;

CREATE TRIGGER inventory_balance_from_movement
AFTER INSERT ON inventory_movements
BEGIN
  INSERT INTO inventory_balances
    (tenant_id, branch_id, warehouse_id, item_id, quantity_minor, quantity_reserved_minor,
     average_unit_cost_minor, total_value_minor, version, updated_at, last_movement_at, payload_json)
  VALUES
    (NEW.tenant_id, NEW.branch_id, NEW.warehouse_id, NEW.item_id, NEW.quantity_minor, 0,
     COALESCE(NEW.unit_cost_minor, 0), COALESCE(NEW.total_cost_minor, 0), 1,
     COALESCE(NEW.occurred_at, NEW.created_at), COALESCE(NEW.occurred_at, NEW.created_at), '{}')
  ON CONFLICT(tenant_id, branch_id, warehouse_id, item_id) DO UPDATE SET
    quantity_minor = inventory_balances.quantity_minor + NEW.quantity_minor,
    total_value_minor = inventory_balances.total_value_minor + COALESCE(NEW.total_cost_minor, 0),
    average_unit_cost_minor = CASE
      WHEN inventory_balances.quantity_minor + NEW.quantity_minor > 0
      THEN (
        (inventory_balances.total_value_minor + COALESCE(NEW.total_cost_minor, 0)) * 1000000
        + ((inventory_balances.quantity_minor + NEW.quantity_minor) / 2)
      ) / (inventory_balances.quantity_minor + NEW.quantity_minor)
      ELSE inventory_balances.average_unit_cost_minor
    END,
    version = inventory_balances.version + 1,
    updated_at = COALESCE(NEW.occurred_at, NEW.created_at),
    last_movement_at = COALESCE(NEW.occurred_at, NEW.created_at);
END;

CREATE TRIGGER completed_production_immutable
BEFORE UPDATE ON production_batches
WHEN OLD.status = 'COMPLETED'
BEGIN
  SELECT RAISE(ABORT, 'COMPLETED_PRODUCTION_IMMUTABLE');
END;

CREATE TRIGGER posted_stock_count_immutable
BEFORE UPDATE ON stock_count_sessions
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_STOCK_COUNT_IMMUTABLE');
END;

CREATE TRIGGER stock_count_same_item_period_guard
BEFORE INSERT ON stock_count_lines
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM stock_count_lines prior_line
      JOIN stock_count_sessions prior_session
        ON prior_session.tenant_id=prior_line.tenant_id
       AND prior_session.id=prior_line.stock_count_session_id
      JOIN stock_count_sessions current_session
        ON current_session.tenant_id=NEW.tenant_id
       AND current_session.id=NEW.stock_count_session_id
      WHERE prior_line.tenant_id=NEW.tenant_id
        AND prior_line.inventory_item_id=NEW.inventory_item_id
        AND prior_session.branch_id=current_session.branch_id
        AND prior_session.warehouse_id=current_session.warehouse_id
        AND prior_session.business_date=current_session.business_date
        AND prior_session.status='POSTED'
    ) THEN RAISE(ABORT, 'STOCK_COUNT_ITEM_ALREADY_POSTED_FOR_PERIOD')
  END;
END;

CREATE TRIGGER receipt_overage_guard
BEFORE INSERT ON goods_receipt_lines
BEGIN
  SELECT CASE
    WHEN NEW.accepted_purchase_quantity_minor + COALESCE((
      SELECT SUM(accepted_purchase_quantity_minor) FROM goods_receipt_lines
      WHERE tenant_id = NEW.tenant_id AND purchase_order_line_id = NEW.purchase_order_line_id
    ), 0) > COALESCE((
      SELECT ordered_purchase_quantity_minor FROM purchase_order_lines
      WHERE tenant_id = NEW.tenant_id AND id = NEW.purchase_order_line_id
    ), (
      SELECT ordered_quantity_minor FROM purchase_order_lines
      WHERE tenant_id = NEW.tenant_id AND id = NEW.purchase_order_line_id
    ))
    AND COALESCE(json_extract((
      SELECT po.payload_json FROM purchase_orders po
      JOIN purchase_order_lines pol ON pol.tenant_id = po.tenant_id AND pol.purchase_order_id = po.id
      WHERE pol.tenant_id = NEW.tenant_id AND pol.id = NEW.purchase_order_line_id
    ), '$.overReceiptPolicy'), 'REJECT_OVER_RECEIPT') = 'REJECT_OVER_RECEIPT'
      THEN RAISE(ABORT, 'OVER_RECEIPT_REJECTED')
  END;
END;

CREATE TRIGGER supplier_invoice_posted_immutable
BEFORE UPDATE ON supplier_invoices
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_SUPPLIER_INVOICE_IMMUTABLE');
END;

CREATE TRIGGER supplier_invoice_no_delete
BEFORE DELETE ON supplier_invoices
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_SUPPLIER_INVOICE_IMMUTABLE');
END;

CREATE TRIGGER supplier_return_overage_guard
BEFORE INSERT ON supplier_return_lines
BEGIN
  SELECT CASE
    WHEN NEW.returned_base_quantity_minor + COALESCE((
      SELECT SUM(returned_base_quantity_minor) FROM supplier_return_lines
      WHERE tenant_id=NEW.tenant_id AND goods_receipt_line_id=NEW.goods_receipt_line_id
    ), 0) > COALESCE((
      SELECT converted_base_quantity_minor FROM goods_receipt_lines
      WHERE tenant_id=NEW.tenant_id AND id=NEW.goods_receipt_line_id
    ), 0)
      THEN RAISE(ABORT, 'SUPPLIER_RETURN_EXCEEDS_ACCEPTED_QUANTITY')
  END;
END;

CREATE TRIGGER supplier_return_credit_immutable
BEFORE UPDATE ON supplier_returns
WHEN OLD.status = 'CREDIT_POSTED'
BEGIN
  SELECT RAISE(ABORT, 'SUPPLIER_RETURN_CREDIT_IMMUTABLE');
END;

CREATE TRIGGER supplier_return_credit_no_delete
BEFORE DELETE ON supplier_returns
WHEN OLD.status = 'CREDIT_POSTED'
BEGIN
  SELECT RAISE(ABORT, 'SUPPLIER_RETURN_CREDIT_IMMUTABLE');
END;

INSERT INTO schema_migrations(version, name, checksum, applied_at)
VALUES (7, 'inventory_procurement_intelligence', 'pass6-0007-v1', CURRENT_TIMESTAMP);
