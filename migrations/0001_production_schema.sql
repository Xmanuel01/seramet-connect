PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  trading_name TEXT NOT NULL,
  default_currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  locale TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE brands (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE branches (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  brand_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  business_day_cutoff_minutes INTEGER NOT NULL DEFAULT 240,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brands(tenant_id, id)
);

CREATE TABLE warehouses (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE departments (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE stations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  station_type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE service_areas (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE restaurant_tables (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_area_id TEXT,
  code TEXT NOT NULL,
  seats INTEGER NOT NULL CHECK (seats >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, service_area_id) REFERENCES service_areas(tenant_id, id)
);

CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE roles (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE role_permissions (
  tenant_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (tenant_id, role_id, permission_code),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id)
);

CREATE TABLE users (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  email TEXT,
  name TEXT NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, email)
);

CREATE TABLE user_roles (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, role_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id)
);

CREATE TABLE user_branches (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, branch_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE auth_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  ip_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

CREATE TABLE hardware_devices (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('POS_TERMINAL','TABLET','KDS','PRINTER_BRIDGE','MANAGER_DEVICE','SELF_SERVICE','PRINTER','SCANNER','CASH_DRAWER','OTHER')),
  name TEXT NOT NULL,
  trust_status TEXT NOT NULL CHECK (trust_status IN ('PENDING','ACTIVE','REVOKED')),
  registered_by TEXT,
  registered_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE provider_connections (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  provider_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  status TEXT NOT NULL,
  secret_reference TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE payment_methods (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  category TEXT NOT NULL,
  provider_connection_id TEXT,
  settlement_account_id TEXT,
  clearing_account_id TEXT,
  receivable_account_id TEXT,
  cash_account_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, provider_connection_id) REFERENCES provider_connections(tenant_id, id)
);

CREATE TABLE order_channels (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE accounts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE document_sequences (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  format TEXT NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1 CHECK (next_value > 0),
  block_size INTEGER NOT NULL DEFAULT 1 CHECK (block_size > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, document_type, period_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE orders (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  display_number TEXT,
  status TEXT NOT NULL,
  channel_id TEXT,
  business_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  correlation_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, display_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, channel_id) REFERENCES order_channels(tenant_id, id)
);

CREATE TABLE order_items (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL CHECK (quantity_minor > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  station_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id)
);

CREATE TABLE order_modifiers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  modifier_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_item_id) REFERENCES order_items(tenant_id, id)
);

CREATE TABLE order_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id)
);

CREATE TABLE order_station_status (
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, order_id, station_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id),
  FOREIGN KEY (tenant_id, station_id) REFERENCES stations(tenant_id, id)
);

CREATE TABLE invoices (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL,
  business_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, invoice_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE invoice_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  order_id TEXT,
  description TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id)
);

CREATE TABLE receipts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  payment_transaction_id TEXT,
  business_date TEXT NOT NULL,
  original INTEGER NOT NULL DEFAULT 1,
  reprint_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, receipt_number),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id)
);

CREATE TABLE payment_intents (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  invoice_id TEXT,
  payment_method_id TEXT NOT NULL,
  provider_connection_id TEXT,
  merchant_reference TEXT NOT NULL,
  amount_requested_minor INTEGER NOT NULL CHECK (amount_requested_minor > 0),
  amount_collected_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_collected_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, merchant_reference),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_method_id) REFERENCES payment_methods(tenant_id, id),
  FOREIGN KEY (tenant_id, provider_connection_id) REFERENCES provider_connections(tenant_id, id)
);

CREATE TABLE payment_transactions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  intent_id TEXT,
  payment_method_id TEXT NOT NULL,
  provider_connection_id TEXT,
  direction TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  unallocated_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (unallocated_amount_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_transaction_id TEXT,
  merchant_reference TEXT NOT NULL,
  original_transaction_id TEXT,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (provider_connection_id, provider_transaction_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, intent_id) REFERENCES payment_intents(tenant_id, id),
  FOREIGN KEY (tenant_id, original_transaction_id) REFERENCES payment_transactions(tenant_id, id)
);

CREATE TABLE payment_allocations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payment_transaction_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, payment_transaction_id, invoice_id, id),
  FOREIGN KEY (tenant_id, payment_transaction_id) REFERENCES payment_transactions(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id)
);

CREATE TABLE payment_collections (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payment_transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  collection_state TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  collected_at TEXT NOT NULL,
  settled_at TEXT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, payment_transaction_id),
  FOREIGN KEY (tenant_id, payment_transaction_id) REFERENCES payment_transactions(tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id)
);

CREATE TABLE payment_refunds (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  original_transaction_id TEXT NOT NULL,
  provider_connection_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, original_transaction_id) REFERENCES payment_transactions(tenant_id, id)
);

CREATE TABLE payment_disputes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, transaction_id) REFERENCES payment_transactions(tenant_id, id)
);

CREATE TABLE cash_drawer_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT,
  employee_id TEXT NOT NULL,
  status TEXT NOT NULL,
  opening_float_minor INTEGER NOT NULL CHECK (opening_float_minor >= 0),
  expected_cash_minor INTEGER NOT NULL DEFAULT 0,
  counted_cash_minor INTEGER,
  variance_minor INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE cash_movements (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, drawer_session_id) REFERENCES cash_drawer_sessions(tenant_id, id)
);

CREATE TABLE bank_transactions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  account_id TEXT NOT NULL,
  provider_connection_id TEXT,
  external_transaction_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, account_id, external_transaction_id)
);

CREATE TABLE marketplace_receivables (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  gross_amount_minor INTEGER NOT NULL CHECK (gross_amount_minor >= 0),
  outstanding_minor INTEGER NOT NULL CHECK (outstanding_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (connection_id, external_order_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id)
);

CREATE TABLE marketplace_charges (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  charge_type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id)
);

CREATE TABLE settlement_batches (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  connection_id TEXT NOT NULL,
  external_settlement_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_minor INTEGER NOT NULL,
  net_expected_minor INTEGER NOT NULL,
  net_settled_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_id, external_settlement_id)
);

CREATE TABLE settlement_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  settlement_batch_id TEXT NOT NULL,
  line_type TEXT NOT NULL,
  external_order_id TEXT,
  order_id TEXT,
  receivable_id TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, settlement_batch_id) REFERENCES settlement_batches(tenant_id, id)
);

CREATE TABLE reconciliation_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  reconciliation_type TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE reconciliation_matches (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  left_type TEXT NOT NULL,
  left_id TEXT NOT NULL,
  right_type TEXT NOT NULL,
  right_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, left_type, left_id, right_type, right_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES reconciliation_sessions(tenant_id, id)
);

CREATE TABLE reconciliation_exceptions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE journal_entries (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  posted_at TEXT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, source_type, source_id)
);

CREATE TABLE journal_lines (
  tenant_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, journal_entry_id, line_number),
  CHECK ((debit_minor = 0) <> (credit_minor = 0)),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries(tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id)
);

CREATE TABLE day_closes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, business_date)
);

CREATE TABLE inventory_items (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, sku)
);

CREATE TABLE inventory_balances (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, branch_id, warehouse_id, item_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE inventory_movements (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE recipes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  yield_minor INTEGER NOT NULL CHECK (yield_minor > 0),
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, menu_item_id)
);

CREATE TABLE recipe_components (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  quantity_minor INTEGER NOT NULL CHECK (quantity_minor > 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES recipes(tenant_id, id),
  FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE wastage (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE breakages (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE purchase_orders (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_order_number TEXT NOT NULL,
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, purchase_order_number)
);

CREATE TABLE purchase_order_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  ordered_quantity_minor INTEGER NOT NULL CHECK (ordered_quantity_minor > 0),
  received_quantity_minor INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity_minor >= 0),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id)
);

CREATE TABLE goods_receipts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, receipt_number),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id)
);

CREATE TABLE employees (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  employee_number TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, employee_number)
);

CREATE TABLE attendance (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id)
);

CREATE TABLE print_routes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  primary_device_id TEXT NOT NULL,
  fallback_device_id TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, primary_device_id) REFERENCES hardware_devices(tenant_id, id)
);

CREATE TABLE document_identities (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE document_templates (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  document_type TEXT NOT NULL,
  layout_version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, branch_id, document_type, layout_version)
);

CREATE TABLE audit_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT,
  actor_id TEXT NOT NULL,
  device_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  session_id TEXT,
  ip_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE authoritative_records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  branch_id TEXT,
  business_date TEXT,
  status TEXT,
  payload_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);

CREATE TABLE tenant_state_read_models (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mutation_commits (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  device_id TEXT,
  correlation_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  new_revision INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, base_revision)
);

INSERT INTO schema_migrations(version, name, checksum, applied_at)
VALUES (1, 'production_schema', 'pass5-0001-v1', CURRENT_TIMESTAMP);
