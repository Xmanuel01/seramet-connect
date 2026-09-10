PRAGMA foreign_keys = ON;

INSERT INTO permissions (code,description) VALUES
  ('enterprise.view','View enterprise hierarchy and command centre'),
  ('enterprise.organisation.manage','Manage enterprise nodes and legal entities'),
  ('enterprise.access.manage','Manage scoped enterprise access'),
  ('enterprise.access.delegate','Delegate approved scoped access'),
  ('enterprise.policy.view','View enterprise policies and resolution traces'),
  ('enterprise.policy.manage','Manage enterprise policy assignments'),
  ('enterprise.policy.approve','Approve enterprise policy exceptions'),
  ('enterprise.rollout.view','View enterprise rollouts'),
  ('enterprise.rollout.manage','Create and execute enterprise rollouts'),
  ('enterprise.rollout.approve','Approve high-impact enterprise rollouts'),
  ('enterprise.procurement.view','View central procurement'),
  ('enterprise.procurement.manage','Manage central procurement'),
  ('enterprise.transfer.manage','Manage enterprise inventory transfers'),
  ('enterprise.franchise.view','View authorized franchise facts'),
  ('enterprise.franchise.manage','Manage franchise configuration'),
  ('enterprise.finance.view','View enterprise management finance'),
  ('enterprise.audit.view','Search enterprise audit events'),
  ('enterprise.export','Create scoped enterprise exports'),
  ('enterprise.readiness.view','View enterprise readiness and compliance')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

ALTER TABLE stock_transfer_lines ADD COLUMN source_lot_id TEXT;
ALTER TABLE stock_transfer_lines ADD COLUMN lot_number TEXT;
ALTER TABLE stock_transfer_lines ADD COLUMN expiry_date TEXT;

CREATE TABLE legal_entities (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  trading_name TEXT,
  registration_reference TEXT,
  tax_identifiers_json TEXT NOT NULL DEFAULT '{}',
  country_code TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  fiscal_configuration_json TEXT NOT NULL DEFAULT '{}',
  accounting_configuration_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED','CLOSED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE enterprise_nodes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('GROUP','LEGAL_ENTITY','BRAND','REGION','AREA','BRANCH','WAREHOUSE','COMMISSARY')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  legal_entity_id TEXT,
  brand_id TEXT,
  branch_id TEXT,
  warehouse_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','TEMPORARILY_CLOSED','SUSPENDED','CLOSED')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  timezone TEXT,
  currency TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code),
  UNIQUE (tenant_id,branch_id),
  UNIQUE (tenant_id,warehouse_id),
  FOREIGN KEY (tenant_id,parent_id) REFERENCES enterprise_nodes(tenant_id,id),
  FOREIGN KEY (tenant_id,legal_entity_id) REFERENCES legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id,brand_id) REFERENCES brands(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((node_type='LEGAL_ENTITY' AND legal_entity_id IS NOT NULL) OR node_type<>'LEGAL_ENTITY'),
  CHECK ((node_type='BRANCH' AND branch_id IS NOT NULL) OR node_type<>'BRANCH'),
  CHECK ((node_type='WAREHOUSE' AND warehouse_id IS NOT NULL) OR node_type<>'WAREHOUSE')
);

CREATE TABLE enterprise_node_closure (
  tenant_id TEXT NOT NULL,
  ancestor_id TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth INTEGER NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (tenant_id,ancestor_id,descendant_id),
  FOREIGN KEY (tenant_id,ancestor_id) REFERENCES enterprise_nodes(tenant_id,id),
  FOREIGN KEY (tenant_id,descendant_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE TABLE enterprise_role_assignments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  descend_to_children INTEGER NOT NULL DEFAULT 1 CHECK (descend_to_children IN (0,1)),
  effect TEXT NOT NULL DEFAULT 'ALLOW' CHECK (effect IN ('ALLOW','DENY')),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  granted_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,user_id,role_id,scope_node_id,valid_from),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,role_id) REFERENCES roles(tenant_id,id),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE delegated_admin_policies (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  delegator_user_id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  allowed_role_ids_json TEXT NOT NULL DEFAULT '[]',
  allowed_permission_codes_json TEXT NOT NULL DEFAULT '[]',
  maximum_scope_type TEXT,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,delegator_user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE TABLE enterprise_policy_definitions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  value_schema_json TEXT NOT NULL DEFAULT '{}',
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE enterprise_policy_assignments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  value_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('INHERIT','LOCAL_VALUE','LOCKED','ALLOWED_OVERRIDE','ALLOWED_WITHIN_RANGE','APPROVAL_REQUIRED','NOT_APPLICABLE')),
  minimum_value_minor INTEGER,
  maximum_value_minor INTEGER,
  approval_policy_json TEXT NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  supersedes_assignment_id TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,policy_id,scope_node_id,version),
  FOREIGN KEY (tenant_id,policy_id) REFERENCES enterprise_policy_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id),
  FOREIGN KEY (tenant_id,supersedes_assignment_id) REFERENCES enterprise_policy_assignments(tenant_id,id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (minimum_value_minor IS NULL OR maximum_value_minor IS NULL OR minimum_value_minor <= maximum_value_minor)
);

CREATE TABLE enterprise_policy_versions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,assignment_id,version),
  FOREIGN KEY (tenant_id,assignment_id) REFERENCES enterprise_policy_assignments(tenant_id,id)
);

CREATE TABLE enterprise_policy_exceptions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  requested_value_json TEXT,
  request_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED','REVOKED')),
  valid_from TEXT,
  valid_until TEXT,
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,policy_id) REFERENCES enterprise_policy_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE TABLE enterprise_policy_exception_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  exception_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED','REVOKED')),
  actor_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,exception_id,status),
  FOREIGN KEY (tenant_id,exception_id) REFERENCES enterprise_policy_exceptions(tenant_id,id)
);

CREATE TABLE branch_templates (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  brand_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code),
  FOREIGN KEY (tenant_id,brand_id) REFERENCES brands(tenant_id,id)
);

CREATE TABLE branch_template_versions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  configuration_json TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,template_id,version),
  FOREIGN KEY (tenant_id,template_id) REFERENCES branch_templates(tenant_id,id)
);

CREATE TABLE branch_template_assignments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  idempotency_key TEXT,
  preview_hash TEXT,
  adoption_status TEXT NOT NULL CHECK (adoption_status IN ('PENDING','VALIDATING','READY','APPLIED','PARTIAL','FAILED')),
  applied_by TEXT,
  applied_at TEXT,
  differences_json TEXT NOT NULL DEFAULT '[]',
  blockers_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,template_version_id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,template_version_id) REFERENCES branch_template_versions(tenant_id,id)
);

CREATE TABLE enterprise_rollouts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  rollout_type TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','VALIDATING','READY','SCHEDULED','RUNNING','PARTIAL','COMPLETE','FAILED','CANCELLED')),
  change_json TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  policy_watermark TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0,1)),
  confirmation_hash TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  scheduled_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE TABLE enterprise_rollout_items (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rollout_id TEXT NOT NULL,
  branch_id TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','BLOCKED','RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  warning_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  applied_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,rollout_id,branch_id,resource_type,resource_id),
  FOREIGN KEY (tenant_id,rollout_id) REFERENCES enterprise_rollouts(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE enterprise_rollout_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rollout_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,rollout_id) REFERENCES enterprise_rollouts(tenant_id,id)
);

CREATE TABLE supplier_contracts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  contract_reference TEXT NOT NULL,
  inventory_item_id TEXT,
  category_reference TEXT,
  purchase_unit_id TEXT,
  negotiated_price_minor INTEGER CHECK (negotiated_price_minor IS NULL OR negotiated_price_minor >= 0),
  currency TEXT,
  minimum_quantity_micro INTEGER CHECK (minimum_quantity_micro IS NULL OR minimum_quantity_micro >= 0),
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','SUSPENDED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,supplier_id,scope_node_id,contract_reference),
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES suppliers(tenant_id,id),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id),
  FOREIGN KEY (tenant_id,purchase_unit_id) REFERENCES unit_definitions(tenant_id,id)
);

CREATE TABLE central_requisition_batches (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  required_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','AGGREGATING','READY','ORDERED','PARTIAL','CLOSED','CANCELLED')),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE TABLE central_requisition_allocations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  requisition_id TEXT NOT NULL,
  requisition_line_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  quantity_micro INTEGER NOT NULL CHECK (quantity_micro > 0),
  unit_id TEXT NOT NULL,
  purchase_order_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ALLOCATED','ORDERED','FULFILLED','CANCELLED')),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,batch_id,requisition_line_id),
  FOREIGN KEY (tenant_id,batch_id) REFERENCES central_requisition_batches(tenant_id,id),
  FOREIGN KEY (tenant_id,requisition_id) REFERENCES purchase_requisitions(tenant_id,id),
  FOREIGN KEY (tenant_id,requisition_line_id) REFERENCES purchase_requisition_lines(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id),
  FOREIGN KEY (tenant_id,unit_id) REFERENCES unit_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES purchase_orders(tenant_id,id)
);

CREATE TABLE inventory_transfer_shipments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  source_legal_entity_id TEXT,
  destination_legal_entity_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','APPROVED','DISPATCHED','IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  idempotency_key TEXT NOT NULL,
  dispatched_by TEXT,
  dispatched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,transfer_id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,transfer_id) REFERENCES stock_transfers(tenant_id,id),
  FOREIGN KEY (tenant_id,source_legal_entity_id) REFERENCES legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id,destination_legal_entity_id) REFERENCES legal_entities(tenant_id,id)
);

CREATE TABLE inventory_transfer_receipts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  receipt_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  received_json TEXT NOT NULL,
  variance_json TEXT NOT NULL DEFAULT '[]',
  received_by TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  UNIQUE (tenant_id,shipment_id,receipt_reference),
  FOREIGN KEY (tenant_id,shipment_id) REFERENCES inventory_transfer_shipments(tenant_id,id)
);

CREATE TABLE inventory_transfer_receipt_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  transfer_line_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  received_quantity_micro INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity_micro >= 0),
  damaged_quantity_micro INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity_micro >= 0),
  rejected_quantity_micro INTEGER NOT NULL DEFAULT 0 CHECK (rejected_quantity_micro >= 0),
  missing_quantity_micro INTEGER NOT NULL DEFAULT 0 CHECK (missing_quantity_micro >= 0),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,receipt_id,transfer_line_id),
  FOREIGN KEY (tenant_id,receipt_id) REFERENCES inventory_transfer_receipts(tenant_id,id),
  FOREIGN KEY (tenant_id,shipment_id) REFERENCES inventory_transfer_shipments(tenant_id,id),
  FOREIGN KEY (tenant_id,transfer_line_id) REFERENCES stock_transfer_lines(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id),
  CHECK (received_quantity_micro + damaged_quantity_micro + rejected_quantity_micro + missing_quantity_micro > 0)
);

CREATE TABLE intercompany_configurations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_legal_entity_id TEXT NOT NULL,
  destination_legal_entity_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  due_from_account_id TEXT NOT NULL,
  due_to_account_id TEXT NOT NULL,
  inventory_account_id TEXT,
  revenue_account_id TEXT,
  cogs_account_id TEXT,
  transfer_price_policy_reference TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,source_legal_entity_id,destination_legal_entity_id,currency,effective_from),
  FOREIGN KEY (tenant_id,source_legal_entity_id) REFERENCES legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id,destination_legal_entity_id) REFERENCES legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id,due_from_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,due_to_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,revenue_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,cogs_account_id) REFERENCES accounts(tenant_id,id)
);

CREATE TABLE franchise_relationships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  franchisee_legal_entity_id TEXT NOT NULL,
  franchisor_legal_entity_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  agreement_reference TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('PROSPECT','ONBOARDING','ACTIVE','SUSPENDED','TERMINATED','EXPIRED')),
  reporting_scope_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,franchisee_legal_entity_id,brand_id,agreement_reference),
  FOREIGN KEY (tenant_id,franchisee_legal_entity_id) REFERENCES legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id,franchisor_legal_entity_id) REFERENCES legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id,brand_id) REFERENCES brands(tenant_id,id),
  CHECK (franchisee_legal_entity_id <> franchisor_legal_entity_id)
);

CREATE TABLE franchise_branch_assignments (
  tenant_id TEXT NOT NULL,
  franchise_relationship_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id,franchise_relationship_id,branch_id),
  UNIQUE (tenant_id,branch_id),
  FOREIGN KEY (tenant_id,franchise_relationship_id) REFERENCES franchise_relationships(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE franchise_fee_definitions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  franchise_relationship_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('ROYALTY','MARKETING_LEVY','FIXED','OTHER')),
  basis_type TEXT NOT NULL CHECK (basis_type IN ('GROSS_SALES','NET_SALES','CONFIGURED_REVENUE','FIXED_PERIODIC')),
  rate_bps INTEGER CHECK (rate_bps IS NULL OR rate_bps BETWEEN 0 AND 10000),
  fixed_amount_minor INTEGER CHECK (fixed_amount_minor IS NULL OR fixed_amount_minor >= 0),
  currency TEXT,
  exclusions_json TEXT NOT NULL DEFAULT '[]',
  account_mapping_json TEXT NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,franchise_relationship_id,code,effective_from),
  FOREIGN KEY (tenant_id,franchise_relationship_id) REFERENCES franchise_relationships(tenant_id,id),
  CHECK ((basis_type='FIXED_PERIODIC' AND fixed_amount_minor IS NOT NULL) OR (basis_type<>'FIXED_PERIODIC' AND rate_bps IS NOT NULL))
);

CREATE TABLE franchise_fee_periods (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  fee_definition_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  currency TEXT NOT NULL,
  basis_minor INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','PARTIAL','INSUFFICIENT_DATA')),
  source_facts_json TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CALCULATED','REVIEW','APPROVED','POSTED','REVERSED')),
  calculated_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,fee_definition_id,period_start,period_end),
  FOREIGN KEY (tenant_id,fee_definition_id) REFERENCES franchise_fee_definitions(tenant_id,id),
  CHECK (period_end >= period_start)
);

CREATE TABLE franchise_compliance_results (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  franchise_relationship_id TEXT NOT NULL,
  branch_id TEXT,
  check_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLIANT','WARNING','NON_COMPLIANT','NOT_APPLICABLE','UNKNOWN')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,franchise_relationship_id,branch_id,check_code),
  FOREIGN KEY (tenant_id,franchise_relationship_id) REFERENCES franchise_relationships(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE enterprise_metric_targets (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  metric_code TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  value_unit TEXT NOT NULL,
  override_state TEXT NOT NULL CHECK (override_state IN ('LOCKED','ALLOWED_OVERRIDE','ALLOWED_WITHIN_RANGE','APPROVAL_REQUIRED')),
  minimum_value INTEGER,
  maximum_value INTEGER,
  approval_reference TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,scope_node_id,metric_code,effective_from),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE TABLE enterprise_readiness_results (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  branch_id TEXT,
  check_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY','WARNING','BLOCKED','NOT_APPLICABLE','UNKNOWN')),
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  message TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  recommended_action TEXT,
  source TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,scope_node_id,branch_id,check_code),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE enterprise_export_jobs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  export_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('PENDING','CLAIMED','COMPLETE','FAILED','EXPIRED')),
  row_limit INTEGER NOT NULL CHECK (row_limit BETWEEN 1 AND 100000),
  authorization_fingerprint TEXT NOT NULL,
  result_reference TEXT,
  result_json TEXT,
  manifest_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE TABLE enterprise_bulk_operations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  scope_node_id TEXT NOT NULL,
  target_count INTEGER NOT NULL CHECK (target_count >= 0),
  target_hash TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PREVIEW','AWAITING_APPROVAL','APPROVED','RUNNING','PARTIAL','COMPLETE','FAILED','CANCELLED')),
  idempotency_key TEXT NOT NULL,
  confirmation_hash TEXT,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,scope_node_id) REFERENCES enterprise_nodes(tenant_id,id)
);

CREATE INDEX idx_enterprise_node_parent ON enterprise_nodes(tenant_id,parent_id,node_type,status);
CREATE INDEX idx_enterprise_node_type ON enterprise_nodes(tenant_id,node_type,status,name);
CREATE INDEX idx_enterprise_closure_descendant ON enterprise_node_closure(tenant_id,descendant_id,depth);
CREATE INDEX idx_enterprise_assignment_user ON enterprise_role_assignments(tenant_id,user_id,valid_from,valid_until,revoked_at);
CREATE INDEX idx_enterprise_assignment_scope ON enterprise_role_assignments(tenant_id,scope_node_id,effect);
CREATE INDEX idx_enterprise_policy_effective ON enterprise_policy_assignments(tenant_id,policy_id,scope_node_id,effective_from,effective_to);
CREATE INDEX idx_enterprise_exception_queue ON enterprise_policy_exceptions(tenant_id,status,scope_node_id,created_at);
CREATE INDEX idx_enterprise_exception_events ON enterprise_policy_exception_events(tenant_id,exception_id,created_at);
CREATE INDEX idx_enterprise_rollout_queue ON enterprise_rollouts(tenant_id,status,scheduled_at,updated_at);
CREATE INDEX idx_enterprise_rollout_items ON enterprise_rollout_items(tenant_id,rollout_id,status,branch_id);
CREATE UNIQUE INDEX uq_enterprise_rollout_singleton_events
  ON enterprise_rollout_events(tenant_id,rollout_id,event_type)
  WHERE event_type IN ('PREVIEW_CREATED','CONFIRMED','APPROVED');
CREATE INDEX idx_supplier_contract_scope ON supplier_contracts(tenant_id,scope_node_id,supplier_id,status,effective_from);
CREATE INDEX idx_central_requisition_status ON central_requisition_batches(tenant_id,status,required_at);
CREATE INDEX idx_transfer_shipment_status ON inventory_transfer_shipments(tenant_id,status,updated_at);
CREATE INDEX idx_transfer_receipt_lines ON inventory_transfer_receipt_lines(tenant_id,shipment_id,transfer_line_id);
CREATE INDEX idx_franchise_status ON franchise_relationships(tenant_id,status,brand_id);
CREATE INDEX idx_franchise_fee_period ON franchise_fee_periods(tenant_id,period_end,status);
CREATE INDEX idx_enterprise_readiness_scope ON enterprise_readiness_results(tenant_id,scope_node_id,status,severity);
CREATE INDEX idx_enterprise_export_queue ON enterprise_export_jobs(tenant_id,status,created_at);

CREATE TRIGGER enterprise_policy_version_no_update BEFORE UPDATE ON enterprise_policy_versions
BEGIN SELECT RAISE(ABORT,'enterprise policy versions are append-only'); END;
CREATE TRIGGER enterprise_policy_version_no_delete BEFORE DELETE ON enterprise_policy_versions
BEGIN SELECT RAISE(ABORT,'enterprise policy versions are append-only'); END;
CREATE TRIGGER enterprise_policy_assignment_no_update BEFORE UPDATE ON enterprise_policy_assignments
BEGIN SELECT RAISE(ABORT,'enterprise policy assignments are append-only'); END;
CREATE TRIGGER enterprise_policy_assignment_no_delete BEFORE DELETE ON enterprise_policy_assignments
BEGIN SELECT RAISE(ABORT,'enterprise policy assignments are append-only'); END;
CREATE TRIGGER branch_template_version_no_update BEFORE UPDATE ON branch_template_versions
BEGIN SELECT RAISE(ABORT,'branch template versions are append-only'); END;
CREATE TRIGGER branch_template_version_no_delete BEFORE DELETE ON branch_template_versions
BEGIN SELECT RAISE(ABORT,'branch template versions are append-only'); END;
CREATE TRIGGER enterprise_metric_target_no_update BEFORE UPDATE ON enterprise_metric_targets
BEGIN SELECT RAISE(ABORT,'enterprise metric targets are effective-dated and append-only'); END;
CREATE TRIGGER enterprise_metric_target_no_delete BEFORE DELETE ON enterprise_metric_targets
BEGIN SELECT RAISE(ABORT,'enterprise metric targets are effective-dated and append-only'); END;
CREATE TRIGGER enterprise_policy_exception_event_no_update BEFORE UPDATE ON enterprise_policy_exception_events
BEGIN SELECT RAISE(ABORT,'enterprise policy exception events are append-only'); END;
CREATE TRIGGER enterprise_policy_exception_event_no_delete BEFORE DELETE ON enterprise_policy_exception_events
BEGIN SELECT RAISE(ABORT,'enterprise policy exception events are append-only'); END;
CREATE TRIGGER enterprise_rollout_event_no_update BEFORE UPDATE ON enterprise_rollout_events
BEGIN SELECT RAISE(ABORT,'enterprise rollout events are append-only'); END;
CREATE TRIGGER enterprise_rollout_event_no_delete BEFORE DELETE ON enterprise_rollout_events
BEGIN SELECT RAISE(ABORT,'enterprise rollout events are append-only'); END;
CREATE TRIGGER inventory_transfer_receipt_limit BEFORE INSERT ON inventory_transfer_receipt_lines
WHEN (
  SELECT COALESCE(SUM(
    received_quantity_micro + damaged_quantity_micro + rejected_quantity_micro + missing_quantity_micro
  ),0)
  FROM inventory_transfer_receipt_lines
  WHERE tenant_id=NEW.tenant_id AND transfer_line_id=NEW.transfer_line_id
) + NEW.received_quantity_micro + NEW.damaged_quantity_micro
  + NEW.rejected_quantity_micro + NEW.missing_quantity_micro > (
    SELECT sent_quantity_minor FROM stock_transfer_lines
    WHERE tenant_id=NEW.tenant_id AND id=NEW.transfer_line_id
  )
BEGIN SELECT RAISE(ABORT,'transfer receipt exceeds dispatched quantity'); END;
CREATE TRIGGER inventory_transfer_source_lot_guard BEFORE INSERT ON stock_transfer_lines
WHEN NEW.source_lot_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM inventory_lots l
  JOIN stock_transfers t ON t.tenant_id=NEW.tenant_id AND t.id=NEW.transfer_id
  WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.source_lot_id
    AND l.branch_id=t.source_branch_id AND l.warehouse_id=t.source_warehouse_id
    AND l.inventory_item_id=NEW.inventory_item_id AND l.status='AVAILABLE'
    AND l.quantity_remaining_minor>=NEW.sent_quantity_minor
)
BEGIN SELECT RAISE(ABORT,'transfer source lot unavailable or insufficient'); END;
CREATE TRIGGER inventory_transfer_source_lot_consume AFTER INSERT ON stock_transfer_lines
WHEN NEW.source_lot_id IS NOT NULL
BEGIN
  UPDATE inventory_lots SET
    quantity_remaining_minor=quantity_remaining_minor-NEW.sent_quantity_minor,
    status=CASE WHEN quantity_remaining_minor-NEW.sent_quantity_minor=0 THEN 'CONSUMED' ELSE status END,
    updated_at=CURRENT_TIMESTAMP
  WHERE tenant_id=NEW.tenant_id AND id=NEW.source_lot_id;
END;
CREATE TRIGGER franchise_fee_posted_immutable BEFORE UPDATE ON franchise_fee_periods
WHEN OLD.status='POSTED' AND NEW.status<>'REVERSED'
BEGIN SELECT RAISE(ABORT,'posted franchise fee period is immutable'); END;
CREATE TRIGGER enterprise_node_cycle_guard BEFORE UPDATE OF parent_id ON enterprise_nodes
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM enterprise_node_closure
  WHERE tenant_id=NEW.tenant_id AND ancestor_id=NEW.id AND descendant_id=NEW.parent_id
)
BEGIN SELECT RAISE(ABORT,'enterprise hierarchy cycle'); END;

INSERT INTO schema_migrations (version,name,checksum,applied_at)
VALUES (13,'enterprise_franchise_hq','pass12-0013-v2',CURRENT_TIMESTAMP);
