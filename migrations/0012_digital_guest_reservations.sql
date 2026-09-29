PRAGMA foreign_keys = ON;

-- Pass 11 digital guest and reservation foundation. Public capability tokens are
-- stored only as SHA-256 hashes. Money remains integer minor units. Orders and
-- payments remain in the existing authoritative transaction repositories.

INSERT INTO permissions (code,description) VALUES
  ('reservation.view','View reservations and reservation availability'),
  ('reservation.create','Create reservations'),
  ('reservation.modify','Modify reservations'),
  ('reservation.cancel','Cancel reservations'),
  ('reservation.seat','Seat reservations and walk-ins'),
  ('reservation.no_show','Record reservation no-shows'),
  ('reservation.deposit.manage','Manage reservation deposits and applications'),
  ('waitlist.view','View the branch waitlist'),
  ('waitlist.manage','Manage waitlist entries'),
  ('guest_order.view','View guest-originated orders'),
  ('guest_order.review','Review guest-originated orders'),
  ('guest_order.accept','Accept guest-originated orders'),
  ('guest_order.cancel','Cancel guest-originated orders'),
  ('guest_service.manage','Manage guest service requests'),
  ('table.manage','Manage table occupancy and blocks'),
  ('digital_menu.manage','Manage public menu and ordering configuration'),
  ('qr.manage','Generate, rotate, disable and print table QR tokens')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

CREATE TABLE public_branch_profiles (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  brand_id TEXT,
  branch_id TEXT NOT NULL,
  restaurant_slug TEXT NOT NULL,
  branch_slug TEXT NOT NULL,
  public_name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  cover_url TEXT,
  address TEXT NOT NULL,
  public_phone TEXT,
  public_email TEXT,
  currency TEXT NOT NULL,
  public_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (public_status IN ('OPEN','CLOSED','ORDERING_PAUSED','RESERVATIONS_ONLY','COMING_SOON')),
  service_modes_json TEXT NOT NULL DEFAULT '[]',
  operating_hours_json TEXT NOT NULL DEFAULT '{}',
  social_links_json TEXT NOT NULL DEFAULT '{}',
  branding_json TEXT NOT NULL DEFAULT '{}',
  legal_links_json TEXT NOT NULL DEFAULT '{}',
  minimum_order_minor INTEGER NOT NULL DEFAULT 0 CHECK (minimum_order_minor >= 0),
  ordering_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ordering_enabled IN (0,1)),
  reservations_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reservations_enabled IN (0,1)),
  publicly_enabled INTEGER NOT NULL DEFAULT 1 CHECK (publicly_enabled IN (0,1)),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id),
  UNIQUE (restaurant_slug,branch_slug),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,brand_id) REFERENCES brands(tenant_id,id)
);

CREATE TABLE guest_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT,
  table_session_id TEXT,
  session_type TEXT NOT NULL CHECK (session_type IN ('WEB','QR','KIOSK','PORTAL','RESERVATION')),
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','COMPLETED')),
  channel_code TEXT NOT NULL,
  source_qr_token_id TEXT,
  client_fingerprint_hash TEXT,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (token_hash),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE table_qr_tokens (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_last_four TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  mode TEXT NOT NULL CHECK (mode IN ('MENU_ONLY','ORDERING_ENABLED','ORDER_AND_PAY','CALL_WAITER_ONLY')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','ROTATED','DISABLED','EXPIRED')),
  expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_from_id TEXT,
  disabled_by TEXT,
  disabled_at TEXT,
  last_used_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (token_hash),
  UNIQUE (tenant_id,table_id,version),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,table_id) REFERENCES restaurant_tables(tenant_id,id),
  FOREIGN KEY (tenant_id,rotated_from_id) REFERENCES table_qr_tokens(tenant_id,id)
);

CREATE TABLE table_qr_token_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  qr_token_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED','USED','ROTATED','DISABLED','EXPIRED','PRINTED')),
  actor_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,qr_token_id) REFERENCES table_qr_tokens(tenant_id,id)
);

CREATE TABLE guest_table_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  reservation_id TEXT,
  customer_id TEXT,
  service_mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING','CLOSED','EXPIRED')),
  basket_policy TEXT NOT NULL DEFAULT 'SEPARATE' CHECK (basket_policy IN ('SHARED','SEPARATE')),
  payment_policy TEXT NOT NULL DEFAULT 'SEPARATE' CHECK (payment_policy IN ('SINGLE_FINAL_BILL','SEPARATE')),
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,table_id) REFERENCES restaurant_tables(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE guest_table_session_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  table_session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  guest_session_id TEXT,
  order_id TEXT,
  actor_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,table_session_id) REFERENCES guest_table_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id)
);

CREATE TABLE guest_service_requests (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  table_session_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('CALL_WAITER','REQUEST_WATER','REQUEST_BILL','NEED_ASSISTANCE')),
  status TEXT NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','COMPLETED','CANCELLED')),
  note TEXT,
  created_at TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  completed_by TEXT,
  completed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,table_session_id) REFERENCES guest_table_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id)
);

CREATE TABLE guest_checkout_quotes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  service_mode TEXT NOT NULL,
  currency TEXT NOT NULL,
  menu_watermark TEXT NOT NULL,
  cart_hash TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  pricing_json TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  service_charge_minor INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_minor >= 0),
  delivery_charge_minor INTEGER NOT NULL DEFAULT 0 CHECK (delivery_charge_minor >= 0),
  tip_minor INTEGER NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  amount_due_minor INTEGER NOT NULL CHECK (amount_due_minor >= 0),
  delivery_zone_id TEXT,
  scheduled_for TEXT,
  voucher_reference_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED','REPLACED')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id)
);

CREATE TABLE guest_order_submissions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  table_session_id TEXT,
  quote_id TEXT NOT NULL,
  order_id TEXT,
  service_mode TEXT NOT NULL,
  tracking_token_hash TEXT NOT NULL,
  receipt_token_hash TEXT,
  idempotency_key TEXT NOT NULL,
  customer_id TEXT,
  status TEXT NOT NULL,
  scheduled_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,guest_session_id,idempotency_key),
  UNIQUE (tenant_id,order_id),
  UNIQUE (tracking_token_hash),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,quote_id) REFERENCES guest_checkout_quotes(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE guest_order_tracking_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  public_status TEXT NOT NULL CHECK (public_status IN ('ORDER_RECEIVED','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
  source_status TEXT NOT NULL,
  message TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id)
);

CREATE TABLE reservation_policies (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  slot_interval_minutes INTEGER NOT NULL CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  default_duration_minutes INTEGER NOT NULL CHECK (default_duration_minutes BETWEEN 15 AND 720),
  buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 240),
  minimum_party_size INTEGER NOT NULL DEFAULT 1 CHECK (minimum_party_size > 0),
  maximum_party_size INTEGER NOT NULL CHECK (maximum_party_size >= minimum_party_size),
  advance_booking_days INTEGER NOT NULL DEFAULT 90 CHECK (advance_booking_days BETWEEN 0 AND 730),
  verification_policy TEXT NOT NULL CHECK (verification_policy IN ('NONE','EMAIL','PHONE','DEPOSIT','STAFF_CONFIRMATION')),
  anonymous_allowed INTEGER NOT NULL DEFAULT 1 CHECK (anonymous_allowed IN (0,1)),
  reservation_hours_json TEXT NOT NULL DEFAULT '{}',
  cancellation_policy_json TEXT NOT NULL DEFAULT '{}',
  deposit_type TEXT NOT NULL DEFAULT 'NONE' CHECK (deposit_type IN ('NONE','FIXED','PERCENTAGE','PER_GUEST')),
  deposit_value INTEGER NOT NULL DEFAULT 0 CHECK (deposit_value >= 0),
  deposit_liability_account_id TEXT,
  deposit_payment_method_id TEXT,
  hold_minutes INTEGER NOT NULL DEFAULT 10 CHECK (hold_minutes BETWEEN 1 AND 60),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,deposit_liability_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,deposit_payment_method_id) REFERENCES payment_methods(tenant_id,id)
);

CREATE TABLE table_combinations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  minimum_capacity INTEGER NOT NULL CHECK (minimum_capacity > 0),
  maximum_capacity INTEGER NOT NULL CHECK (maximum_capacity >= minimum_capacity),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,name),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE table_combination_members (
  tenant_id TEXT NOT NULL,
  combination_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id,combination_id,table_id),
  FOREIGN KEY (tenant_id,combination_id) REFERENCES table_combinations(tenant_id,id),
  FOREIGN KEY (tenant_id,table_id) REFERENCES restaurant_tables(tenant_id,id)
);

CREATE TABLE reservations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT,
  guest_session_id TEXT,
  guest_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  area_preference TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','CONFIRMED','SEATED','COMPLETED','CANCELLED','NO_SHOW','WAITLISTED')),
  source TEXT NOT NULL,
  confirmation_state TEXT NOT NULL CHECK (confirmation_state IN ('NOT_REQUIRED','PENDING','VERIFIED','STAFF_CONFIRMED')),
  manage_token_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  cancellation_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (manage_token_hash),
  UNIQUE (tenant_id,idempotency_key),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id)
);

CREATE TABLE reservation_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,reservation_id) REFERENCES reservations(tenant_id,id)
);

CREATE TABLE reservation_holds (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONVERTED','EXPIRED','RELEASED')),
  expires_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,guest_session_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,table_id) REFERENCES restaurant_tables(tenant_id,id)
);

CREATE TABLE reservation_table_assignments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  combination_id TEXT,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  released_at TEXT,
  release_reason TEXT,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,reservation_id) REFERENCES reservations(tenant_id,id),
  FOREIGN KEY (tenant_id,table_id) REFERENCES restaurant_tables(tenant_id,id),
  FOREIGN KEY (tenant_id,combination_id) REFERENCES table_combinations(tenant_id,id)
);

CREATE TABLE reservation_capacity_locks (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  slot_start TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('HOLD','RESERVATION','TABLE_SESSION')),
  owner_id TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,branch_id,table_id,slot_start),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,table_id) REFERENCES restaurant_tables(tenant_id,id)
);

CREATE TABLE reservation_deposits (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  payment_intent_id TEXT,
  payment_transaction_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  liability_account_id TEXT NOT NULL,
  payment_method_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUIRED','PENDING','CONFIRMED','APPLIED','REFUND_PENDING','REFUNDED','FORFEITED','FAILED')),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,reservation_id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,reservation_id) REFERENCES reservations(tenant_id,id),
  FOREIGN KEY (tenant_id,liability_account_id) REFERENCES accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,payment_method_id) REFERENCES payment_methods(tenant_id,id)
);

CREATE TABLE reservation_deposit_applications (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  deposit_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  payment_transaction_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,deposit_id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,deposit_id) REFERENCES reservation_deposits(tenant_id,id)
);

CREATE TABLE waitlist_entries (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT,
  guest_session_id TEXT,
  guest_name TEXT NOT NULL,
  contact_phone TEXT,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  area_preference TEXT,
  status TEXT NOT NULL CHECK (status IN ('WAITING','NOTIFIED','SEATED','CANCELLED','EXPIRED')),
  estimated_wait_minutes INTEGER CHECK (estimated_wait_minutes IS NULL OR estimated_wait_minutes >= 0),
  joined_at TEXT NOT NULL,
  notified_at TEXT,
  seated_at TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id)
);

CREATE TABLE waitlist_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  waitlist_entry_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,waitlist_entry_id) REFERENCES waitlist_entries(tenant_id,id)
);

CREATE TABLE delivery_zones (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('RADIUS','POLYGON','AREA','POSTAL','FLAT')),
  definition_json TEXT NOT NULL,
  minimum_order_minor INTEGER NOT NULL DEFAULT 0 CHECK (minimum_order_minor >= 0),
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  estimated_min_minutes INTEGER,
  estimated_max_minutes INTEGER,
  currency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,code),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE guest_addresses (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  customer_id TEXT,
  delivery_zone_id TEXT NOT NULL,
  address_text TEXT NOT NULL,
  instructions TEXT,
  retention_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,delivery_zone_id) REFERENCES delivery_zones(tenant_id,id)
);

CREATE TABLE guest_notification_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  guest_session_id TEXT,
  customer_id TEXT,
  purpose TEXT NOT NULL,
  channel TEXT NOT NULL,
  destination_hash TEXT,
  template_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','DEAD_LETTER','SUPPRESSED')),
  provider_connection_id TEXT,
  provider_reference TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  last_error TEXT,
  scheduled_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,provider_connection_id) REFERENCES provider_connections(tenant_id,id)
);

CREATE TABLE guest_funnel_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  guest_session_id TEXT,
  funnel_type TEXT NOT NULL CHECK (funnel_type IN ('ORDERING','RESERVATION')),
  stage TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  source_id TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,guest_session_id) REFERENCES guest_sessions(tenant_id,id)
);

CREATE TABLE guest_abuse_events (
  tenant_id TEXT,
  id TEXT NOT NULL,
  branch_id TEXT,
  signal_type TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW','CHALLENGE','BLOCK')),
  reason TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX idx_public_profile_restaurant ON public_branch_profiles(restaurant_slug,publicly_enabled,public_status);
CREATE INDEX idx_guest_session_token ON guest_sessions(token_hash,status,expires_at);
CREATE INDEX idx_guest_session_cleanup ON guest_sessions(status,expires_at);
CREATE UNIQUE INDEX idx_active_table_qr ON table_qr_tokens(tenant_id,branch_id,table_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX idx_active_table_session ON guest_table_sessions(tenant_id,branch_id,table_id)
  WHERE status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING');

CREATE TRIGGER guest_order_submission_requires_open_table_session
BEFORE INSERT ON guest_order_submissions
WHEN NEW.table_session_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM guest_table_sessions s
   WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.table_session_id
     AND s.branch_id=NEW.branch_id
     AND s.status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')
 )
BEGIN
  SELECT RAISE(ABORT,'guest table session is closed');
END;
CREATE INDEX idx_guest_service_open ON guest_service_requests(tenant_id,branch_id,status,created_at);
CREATE INDEX idx_guest_quote_session ON guest_checkout_quotes(tenant_id,guest_session_id,status,expires_at);
CREATE INDEX idx_guest_order_tracking ON guest_order_submissions(tracking_token_hash,status);
CREATE UNIQUE INDEX idx_guest_feedback_order_once
  ON customer_feedback(tenant_id,order_id)
  WHERE source='GUEST_DIGITAL' AND order_id IS NOT NULL;
CREATE INDEX idx_reservation_branch_time ON reservations(tenant_id,branch_id,starts_at,status);
CREATE INDEX idx_reservation_business_date ON reservations(tenant_id,branch_id,business_date,status);
CREATE INDEX idx_reservation_lock_owner ON reservation_capacity_locks(tenant_id,owner_type,owner_id);
CREATE INDEX idx_reservation_hold_expiry ON reservation_holds(tenant_id,status,expires_at);
CREATE INDEX idx_reservation_deposit_status ON reservation_deposits(tenant_id,branch_id,status);
CREATE INDEX idx_waitlist_branch ON waitlist_entries(tenant_id,branch_id,status,joined_at);
CREATE INDEX idx_waitlist_expiry ON waitlist_entries(tenant_id,status,expires_at);
CREATE INDEX idx_delivery_zone_branch ON delivery_zones(tenant_id,branch_id,active);
CREATE INDEX idx_guest_address_retention ON guest_addresses(tenant_id,retention_expires_at);
CREATE INDEX idx_guest_notification_due ON guest_notification_events(tenant_id,status,scheduled_at);
CREATE INDEX idx_guest_funnel_period ON guest_funnel_events(tenant_id,branch_id,funnel_type,occurred_at);
CREATE INDEX idx_guest_abuse_scope ON guest_abuse_events(scope_hash,signal_type,created_at);

CREATE TRIGGER table_qr_event_no_update BEFORE UPDATE ON table_qr_token_events
BEGIN SELECT RAISE(ABORT,'QR token events are append-only'); END;
CREATE TRIGGER table_qr_event_no_delete BEFORE DELETE ON table_qr_token_events
BEGIN SELECT RAISE(ABORT,'QR token events are append-only'); END;
CREATE TRIGGER guest_table_event_no_update BEFORE UPDATE ON guest_table_session_events
BEGIN SELECT RAISE(ABORT,'table session events are append-only'); END;
CREATE TRIGGER guest_table_event_no_delete BEFORE DELETE ON guest_table_session_events
BEGIN SELECT RAISE(ABORT,'table session events are append-only'); END;
CREATE TRIGGER reservation_event_no_update BEFORE UPDATE ON reservation_events
BEGIN SELECT RAISE(ABORT,'reservation events are append-only'); END;
CREATE TRIGGER reservation_event_no_delete BEFORE DELETE ON reservation_events
BEGIN SELECT RAISE(ABORT,'reservation events are append-only'); END;
CREATE TRIGGER deposit_application_no_update BEFORE UPDATE ON reservation_deposit_applications
BEGIN SELECT RAISE(ABORT,'deposit applications are append-only'); END;
CREATE TRIGGER deposit_application_no_delete BEFORE DELETE ON reservation_deposit_applications
BEGIN SELECT RAISE(ABORT,'deposit applications are append-only'); END;
CREATE TRIGGER waitlist_event_no_update BEFORE UPDATE ON waitlist_events
BEGIN SELECT RAISE(ABORT,'waitlist events are append-only'); END;
CREATE TRIGGER waitlist_event_no_delete BEFORE DELETE ON waitlist_events
BEGIN SELECT RAISE(ABORT,'waitlist events are append-only'); END;
CREATE TRIGGER guest_notification_no_update AFTER UPDATE ON guest_notification_events
WHEN OLD.id<>NEW.id OR OLD.tenant_id<>NEW.tenant_id OR OLD.source_id<>NEW.source_id
BEGIN SELECT RAISE(ABORT,'notification event identity is immutable'); END;
CREATE TRIGGER guest_funnel_no_update BEFORE UPDATE ON guest_funnel_events
BEGIN SELECT RAISE(ABORT,'guest funnel events are append-only'); END;
CREATE TRIGGER guest_funnel_no_delete BEFORE DELETE ON guest_funnel_events
BEGIN SELECT RAISE(ABORT,'guest funnel events are append-only'); END;

INSERT INTO schema_migrations (version,name,checksum,applied_at)
VALUES (12,'digital_guest_reservations','pass11-0012-v1',CURRENT_TIMESTAMP);
