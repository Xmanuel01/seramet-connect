PRAGMA foreign_keys = ON;

-- Pass 7 contains recalculable management read models. Authoritative orders,
-- payments, journals, inventory movements and procurement documents remain in
-- the Pass 1-6 tables. Money is integer minor units; ratios are basis points.

CREATE TABLE metric_threshold_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  metric_code TEXT NOT NULL,
  comparison TEXT NOT NULL CHECK (comparison IN ('GREATER_THAN','LESS_THAN','ABSOLUTE_GREATER_THAN')),
  severity TEXT NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  threshold_value INTEGER NOT NULL,
  value_unit TEXT NOT NULL CHECK (value_unit IN ('MINOR','BPS','COUNT','MILLISECONDS','MICRO')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  reopen_after_minutes INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,metric_code,severity,effective_from),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE branch_targets (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  metric_code TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  value_unit TEXT NOT NULL CHECK (value_unit IN ('MINOR','BPS','COUNT','MILLISECONDS','MICRO')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,metric_code,effective_from),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE management_actions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  action_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  status TEXT NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DISMISSED')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  condition_key TEXT NOT NULL,
  business_date TEXT,
  metric_value INTEGER,
  threshold_value INTEGER,
  value_unit TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  assigned_user_id TEXT,
  assigned_role_id TEXT,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_actor_id TEXT,
  resolution_note TEXT,
  correlation_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,condition_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE management_action_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  management_action_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,management_action_id) REFERENCES management_actions(tenant_id,id)
);

CREATE TABLE daily_branch_metrics (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  gross_sales_minor INTEGER NOT NULL DEFAULT 0,
  discounts_minor INTEGER NOT NULL DEFAULT 0,
  refunds_minor INTEGER NOT NULL DEFAULT 0,
  net_sales_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  service_charge_minor INTEGER NOT NULL DEFAULT 0,
  net_revenue_minor INTEGER NOT NULL DEFAULT 0,
  marketplace_commission_minor INTEGER NOT NULL DEFAULT 0,
  payment_processing_fees_minor INTEGER NOT NULL DEFAULT 0,
  delivery_fees_minor INTEGER NOT NULL DEFAULT 0,
  cogs_minor INTEGER NOT NULL DEFAULT 0,
  gross_profit_minor INTEGER NOT NULL DEFAULT 0,
  gross_margin_bps INTEGER NOT NULL DEFAULT 0,
  food_cost_bps INTEGER NOT NULL DEFAULT 0,
  labour_cost_minor INTEGER NOT NULL DEFAULT 0,
  labour_cost_bps INTEGER NOT NULL DEFAULT 0,
  operating_expenses_minor INTEGER NOT NULL DEFAULT 0,
  contribution_minor INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  average_order_value_minor INTEGER NOT NULL DEFAULT 0,
  average_prep_time_ms INTEGER,
  payment_variance_minor INTEGER NOT NULL DEFAULT 0,
  wastage_minor INTEGER NOT NULL DEFAULT 0,
  inventory_variance_minor INTEGER NOT NULL DEFAULT 0,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  source_watermark TEXT,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE financial_summary_periods (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('DAY','WEEK_TO_DATE','MONTH_TO_DATE','CUSTOM')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  currency TEXT NOT NULL,
  gross_sales_minor INTEGER NOT NULL,
  discounts_minor INTEGER NOT NULL,
  refunds_minor INTEGER NOT NULL,
  net_sales_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  service_charge_minor INTEGER NOT NULL,
  net_revenue_minor INTEGER NOT NULL,
  cogs_minor INTEGER NOT NULL,
  gross_profit_minor INTEGER NOT NULL,
  gross_margin_bps INTEGER NOT NULL,
  labour_cost_minor INTEGER NOT NULL,
  operating_expenses_minor INTEGER NOT NULL,
  marketplace_commission_minor INTEGER NOT NULL,
  payment_processing_fees_minor INTEGER NOT NULL,
  delivery_fees_minor INTEGER NOT NULL,
  contribution_minor INTEGER NOT NULL,
  flash_operating_result_minor INTEGER NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('COMPLETE','PARTIAL','INSUFFICIENT_DATA')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,period_type,period_start,period_end),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE daily_channel_metrics (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  channel_id TEXT,
  channel_label TEXT NOT NULL,
  currency TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  refund_count INTEGER NOT NULL DEFAULT 0,
  gross_sales_minor INTEGER NOT NULL DEFAULT 0,
  discounts_minor INTEGER NOT NULL DEFAULT 0,
  refunds_minor INTEGER NOT NULL DEFAULT 0,
  net_sales_minor INTEGER NOT NULL DEFAULT 0,
  commission_minor INTEGER NOT NULL DEFAULT 0,
  provider_fees_minor INTEGER NOT NULL DEFAULT 0,
  delivery_fees_minor INTEGER NOT NULL DEFAULT 0,
  cogs_minor INTEGER NOT NULL DEFAULT 0,
  contribution_minor INTEGER NOT NULL DEFAULT 0,
  contribution_bps INTEGER NOT NULL DEFAULT 0,
  average_order_value_minor INTEGER NOT NULL DEFAULT 0,
  cancellation_bps INTEGER NOT NULL DEFAULT 0,
  refund_bps INTEGER NOT NULL DEFAULT 0,
  average_fulfilment_ms INTEGER,
  settlement_difference_minor INTEGER,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date,channel_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,channel_id) REFERENCES order_channels(tenant_id,id)
);

CREATE TABLE daily_station_metrics (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  station_id TEXT NOT NULL,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  late_count INTEGER NOT NULL DEFAULT 0,
  average_prep_ms INTEGER,
  median_prep_ms INTEGER,
  p90_prep_ms INTEGER,
  average_ready_pickup_ms INTEGER,
  throughput_per_hour_milli INTEGER,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date,station_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,station_id) REFERENCES stations(tenant_id,id)
);

CREATE TABLE daily_staff_metrics (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  shift_count INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  labour_cost_minor INTEGER NOT NULL DEFAULT 0,
  orders_handled INTEGER NOT NULL DEFAULT 0,
  net_sales_minor INTEGER NOT NULL DEFAULT 0,
  average_order_value_minor INTEGER NOT NULL DEFAULT 0,
  average_service_ms INTEGER,
  void_requests INTEGER NOT NULL DEFAULT 0,
  approved_discounts INTEGER NOT NULL DEFAULT 0,
  refund_involvement INTEGER NOT NULL DEFAULT 0,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date,employee_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);

CREATE TABLE daily_supplier_metrics (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  purchase_value_minor INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  average_lead_time_minutes INTEGER,
  on_time_bps INTEGER,
  fill_rate_bps INTEGER,
  rejected_quantity_micro INTEGER NOT NULL DEFAULT 0,
  price_variance_minor INTEGER NOT NULL DEFAULT 0,
  return_value_minor INTEGER NOT NULL DEFAULT 0,
  invoice_match_exceptions INTEGER NOT NULL DEFAULT 0,
  outstanding_payable_minor INTEGER NOT NULL DEFAULT 0,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date,supplier_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES suppliers(tenant_id,id)
);

CREATE TABLE daily_menu_item_metrics (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  net_revenue_minor INTEGER NOT NULL DEFAULT 0,
  theoretical_cost_minor INTEGER NOT NULL DEFAULT 0,
  contribution_minor INTEGER NOT NULL DEFAULT 0,
  food_cost_bps INTEGER NOT NULL DEFAULT 0,
  sales_mix_bps INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL CHECK (classification IN ('STAR','WORKHORSE','PUZZLE','LOW_PERFORMER','INSUFFICIENT_DATA')),
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date,menu_item_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE inventory_gl_reconciliations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT,
  business_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  subledger_value_minor INTEGER NOT NULL,
  gl_value_minor INTEGER NOT NULL,
  difference_minor INTEGER NOT NULL,
  tolerance_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('MATCHED','VARIANCE','MISSING_CONFIGURATION')),
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,warehouse_id,business_date),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id)
);

CREATE TABLE close_readiness_snapshots (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY_TO_CLOSE','NOT_READY','CLOSED')),
  blocker_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  blockers_json TEXT NOT NULL DEFAULT '[]',
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE branch_health_snapshots (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('HEALTHY','WATCH','AT_RISK','CRITICAL')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,business_date),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE approval_inbox_items (
  tenant_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  branch_id TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT,
  requested_at TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,source_type,source_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE management_recalculation_events (
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
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE INDEX idx_management_actions_queue
  ON management_actions(tenant_id,branch_id,status,severity,last_detected_at DESC);
CREATE INDEX idx_management_actions_source
  ON management_actions(tenant_id,source_type,source_id);
CREATE INDEX idx_action_events_action
  ON management_action_events(tenant_id,management_action_id,created_at);
CREATE INDEX idx_threshold_effective
  ON metric_threshold_policies(tenant_id,branch_id,metric_code,effective_from,effective_to,active);
CREATE INDEX idx_targets_effective
  ON branch_targets(tenant_id,branch_id,metric_code,effective_from,effective_to,active);
CREATE INDEX idx_daily_branch_period
  ON daily_branch_metrics(tenant_id,branch_id,business_date DESC);
CREATE INDEX idx_financial_summary_period
  ON financial_summary_periods(tenant_id,branch_id,period_end DESC,period_type);
CREATE INDEX idx_channel_period
  ON daily_channel_metrics(tenant_id,branch_id,business_date DESC,channel_key);
CREATE INDEX idx_station_period
  ON daily_station_metrics(tenant_id,branch_id,business_date DESC,station_id);
CREATE INDEX idx_staff_period
  ON daily_staff_metrics(tenant_id,branch_id,business_date DESC,employee_id);
CREATE INDEX idx_supplier_period
  ON daily_supplier_metrics(tenant_id,branch_id,business_date DESC,supplier_id);
CREATE INDEX idx_menu_period
  ON daily_menu_item_metrics(tenant_id,branch_id,business_date DESC,contribution_minor DESC);
CREATE INDEX idx_inventory_gl_status
  ON inventory_gl_reconciliations(tenant_id,branch_id,business_date DESC,status);
CREATE INDEX idx_close_readiness_status
  ON close_readiness_snapshots(tenant_id,branch_id,business_date DESC,status);
CREATE INDEX idx_branch_health_status
  ON branch_health_snapshots(tenant_id,business_date DESC,status);
CREATE INDEX idx_approval_inbox
  ON approval_inbox_items(tenant_id,branch_id,status,requested_at);
CREATE INDEX idx_management_recalc_pending
  ON management_recalculation_events(status,created_at);

CREATE TRIGGER management_action_events_no_update
BEFORE UPDATE ON management_action_events
BEGIN
  SELECT RAISE(ABORT,'MANAGEMENT_ACTION_EVENT_IMMUTABLE');
END;

CREATE TRIGGER management_action_events_no_delete
BEFORE DELETE ON management_action_events
BEGIN
  SELECT RAISE(ABORT,'MANAGEMENT_ACTION_EVENT_IMMUTABLE');
END;

CREATE TRIGGER management_actions_no_delete
BEFORE DELETE ON management_actions
BEGIN
  SELECT RAISE(ABORT,'MANAGEMENT_ACTION_IMMUTABLE_HISTORY');
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (8,'management_intelligence_finance','pass7-0008-v1',CURRENT_TIMESTAMP);
