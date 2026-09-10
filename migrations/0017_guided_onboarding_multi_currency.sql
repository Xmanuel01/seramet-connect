PRAGMA foreign_keys = ON;

INSERT INTO permissions (code,description) VALUES
  ('payments.fx.view','View accepted currencies and exchange-rate evidence'),
  ('payments.fx.manage','Manage accepted currencies and authorized exchange rates')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'payments.fx.view' FROM role_permissions WHERE permission_code='setup.view'
ON CONFLICT(tenant_id,role_id,permission_code) DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'payments.fx.manage' FROM role_permissions WHERE permission_code='setup.accounting.manage'
ON CONFLICT(tenant_id,role_id,permission_code) DO NOTHING;

CREATE TABLE currency_reference (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  minor_digits INTEGER NOT NULL CHECK (minor_digits BETWEEN 0 AND 3),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

INSERT INTO currency_reference (code,name,symbol,minor_digits,active) VALUES
  ('XXX','Currency not selected','',2,0),
  ('KES','Kenyan Shilling','KSh',2,1),
  ('USD','US Dollar','$',2,1),
  ('EUR','Euro','EUR',2,1),
  ('GBP','Pound Sterling','GBP',2,1),
  ('TZS','Tanzanian Shilling','TSh',2,1),
  ('UGX','Ugandan Shilling','USh',0,1),
  ('RWF','Rwandan Franc','FRw',0,1),
  ('BIF','Burundian Franc','FBu',0,1),
  ('ETB','Ethiopian Birr','Br',2,1),
  ('SOS','Somali Shilling','Sh.So.',2,1),
  ('ZAR','South African Rand','R',2,1),
  ('NGN','Nigerian Naira','NGN',2,1),
  ('GHS','Ghanaian Cedi','GHs',2,1),
  ('AED','UAE Dirham','AED',2,1),
  ('INR','Indian Rupee','INR',2,1),
  ('CAD','Canadian Dollar','CA$',2,1),
  ('AUD','Australian Dollar','A$',2,1)
ON CONFLICT(code) DO UPDATE SET
  name=excluded.name,symbol=excluded.symbol,minor_digits=excluded.minor_digits,active=excluded.active;

CREATE TABLE country_reference (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  administrative_level_1_label TEXT NOT NULL,
  default_currency_code TEXT NOT NULL REFERENCES currency_reference(code),
  calling_code TEXT NOT NULL,
  default_timezone TEXT NOT NULL,
  default_locale TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

INSERT INTO country_reference
  (code,name,administrative_level_1_label,default_currency_code,calling_code,default_timezone,default_locale,active)
VALUES
  ('KE','Kenya','County','KES','+254','Africa/Nairobi','en-KE',1),
  ('TZ','Tanzania','Region','TZS','+255','Africa/Dar_es_Salaam','en-TZ',1),
  ('UG','Uganda','Region','UGX','+256','Africa/Kampala','en-UG',1),
  ('RW','Rwanda','Province','RWF','+250','Africa/Kigali','en-RW',1),
  ('BI','Burundi','Province','BIF','+257','Africa/Bujumbura','fr-BI',1),
  ('ET','Ethiopia','Region','ETB','+251','Africa/Addis_Ababa','en-ET',1),
  ('SO','Somalia','Region','SOS','+252','Africa/Mogadishu','so-SO',1),
  ('ZA','South Africa','Province','ZAR','+27','Africa/Johannesburg','en-ZA',1),
  ('NG','Nigeria','State','NGN','+234','Africa/Lagos','en-NG',1),
  ('GH','Ghana','Region','GHS','+233','Africa/Accra','en-GH',1),
  ('US','United States','State','USD','+1','America/New_York','en-US',1),
  ('GB','United Kingdom','Country / region','GBP','+44','Europe/London','en-GB',1),
  ('AE','United Arab Emirates','Emirate','AED','+971','Asia/Dubai','en-AE',1),
  ('IN','India','State','INR','+91','Asia/Kolkata','en-IN',1),
  ('CA','Canada','Province / territory','CAD','+1','America/Toronto','en-CA',1),
  ('AU','Australia','State / territory','AUD','+61','Australia/Sydney','en-AU',1)
ON CONFLICT(code) DO UPDATE SET
  name=excluded.name,
  administrative_level_1_label=excluded.administrative_level_1_label,
  default_currency_code=excluded.default_currency_code,
  calling_code=excluded.calling_code,
  default_timezone=excluded.default_timezone,
  default_locale=excluded.default_locale,
  active=excluded.active;

CREATE TABLE onboarding_wizard_progress (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  current_step INTEGER NOT NULL DEFAULT 5 CHECK (current_step BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  completed_steps_json TEXT NOT NULL DEFAULT '[1,2,3,4]',
  responses_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE onboarding_wizard_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  step INTEGER NOT NULL CHECK (step BETWEEN 1 AND 20),
  action TEXT NOT NULL CHECK (action IN ('SAVED','CONFIRMED','INVALIDATED','COMPLETED')),
  response_json TEXT NOT NULL DEFAULT '{}',
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id)
);

CREATE INDEX onboarding_wizard_events_scope_idx
  ON onboarding_wizard_events(tenant_id,step,created_at);

CREATE TABLE tenant_business_locations (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  country_code TEXT NOT NULL REFERENCES country_reference(code),
  administrative_level_1 TEXT,
  administrative_level_2 TEXT,
  city TEXT NOT NULL,
  address_line TEXT NOT NULL,
  postal_code TEXT,
  latitude_microdegrees INTEGER,
  longitude_microdegrees INTEGER,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED')),
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (latitude_microdegrees IS NULL OR latitude_microdegrees BETWEEN -90000000 AND 90000000),
  CHECK (longitude_microdegrees IS NULL OR longitude_microdegrees BETWEEN -180000000 AND 180000000)
);

CREATE TABLE tenant_accepted_currencies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  currency_code TEXT NOT NULL REFERENCES currency_reference(code),
  is_base INTEGER NOT NULL DEFAULT 0 CHECK (is_base IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  payment_eligible INTEGER NOT NULL DEFAULT 1 CHECK (payment_eligible IN (0,1)),
  cash_eligible INTEGER NOT NULL DEFAULT 1 CHECK (cash_eligible IN (0,1)),
  digital_payment_eligible INTEGER NOT NULL DEFAULT 0 CHECK (digital_payment_eligible IN (0,1)),
  exchange_rate_policy TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (exchange_rate_policy IN ('MANUAL','PROVIDER','HQ','LEGAL_ENTITY')),
  rate_freshness_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (rate_freshness_minutes > 0),
  rounding_policy TEXT NOT NULL DEFAULT 'HALF_UP' CHECK (rounding_policy IN ('HALF_UP','UP','DOWN')),
  change_policy TEXT NOT NULL DEFAULT 'TENDER_CURRENCY'
    CHECK (change_policy IN ('TENDER_CURRENCY','BASE_CURRENCY','NO_CHANGE')),
  branch_ids_json TEXT NOT NULL DEFAULT '[]',
  payment_method_ids_json TEXT NOT NULL DEFAULT '[]',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,currency_code),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX tenant_one_base_currency_idx
  ON tenant_accepted_currencies(tenant_id) WHERE is_base=1 AND status='ACTIVE';

CREATE TABLE fx_rate_sources (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('MANUAL','PROVIDER','HQ','LEGAL_ENTITY')),
  provider_key TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','SPEC_REQUIRED','UNAVAILABLE')),
  configuration_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id)
);

CREATE TABLE fx_rates (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  base_currency TEXT NOT NULL REFERENCES currency_reference(code),
  tender_currency TEXT NOT NULL REFERENCES currency_reference(code),
  rate_numerator INTEGER NOT NULL CHECK (rate_numerator > 0),
  rate_denominator INTEGER NOT NULL CHECK (rate_denominator > 0),
  rate_scale INTEGER NOT NULL DEFAULT 1 CHECK (rate_scale > 0),
  quality TEXT NOT NULL CHECK (quality IN ('CURRENT','STALE','MANUAL','PROVIDER_UNAVAILABLE')),
  source_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_until TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,source_id) REFERENCES fx_rate_sources(tenant_id,id),
  CHECK (base_currency<>tender_currency),
  CHECK (effective_until>effective_from)
);

CREATE INDEX fx_rates_lookup_idx
  ON fx_rates(tenant_id,base_currency,tender_currency,effective_from,effective_until);

CREATE TABLE fx_payment_quotes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  payment_method_id TEXT NOT NULL,
  base_currency TEXT NOT NULL REFERENCES currency_reference(code),
  tender_currency TEXT NOT NULL REFERENCES currency_reference(code),
  base_amount_minor INTEGER NOT NULL CHECK (base_amount_minor > 0),
  tender_amount_minor INTEGER NOT NULL CHECK (tender_amount_minor > 0),
  rate_numerator INTEGER NOT NULL CHECK (rate_numerator > 0),
  rate_denominator INTEGER NOT NULL CHECK (rate_denominator > 0),
  base_minor_digits INTEGER NOT NULL CHECK (base_minor_digits BETWEEN 0 AND 3),
  tender_minor_digits INTEGER NOT NULL CHECK (tender_minor_digits BETWEEN 0 AND 3),
  converted_base_amount_minor INTEGER NOT NULL CHECK (converted_base_amount_minor > 0),
  rounding_adjustment_minor INTEGER NOT NULL,
  rate_id TEXT NOT NULL,
  rate_source_id TEXT NOT NULL,
  rate_timestamp TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED','CANCELLED')),
  expires_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_by_transaction_id TEXT,
  consumed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,payment_method_id) REFERENCES payment_methods(tenant_id,id),
  FOREIGN KEY (tenant_id,rate_id) REFERENCES fx_rates(tenant_id,id),
  FOREIGN KEY (tenant_id,rate_source_id) REFERENCES fx_rate_sources(tenant_id,id),
  CHECK (base_currency<>tender_currency),
  CHECK ((status='CONSUMED' AND consumed_by_transaction_id IS NOT NULL AND consumed_at IS NOT NULL)
      OR (status<>'CONSUMED' AND consumed_by_transaction_id IS NULL AND consumed_at IS NULL))
);

CREATE INDEX fx_payment_quotes_status_idx
  ON fx_payment_quotes(tenant_id,branch_id,status,expires_at);

CREATE TABLE payment_currency_snapshots (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  payment_transaction_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL CHECK (base_amount_minor > 0),
  tender_currency TEXT NOT NULL,
  tender_amount_minor INTEGER NOT NULL CHECK (tender_amount_minor > 0),
  cash_tendered_minor INTEGER,
  change_given_minor INTEGER,
  change_currency TEXT,
  rate_numerator INTEGER NOT NULL CHECK (rate_numerator > 0),
  rate_denominator INTEGER NOT NULL CHECK (rate_denominator > 0),
  rate_source_id TEXT NOT NULL,
  rate_timestamp TEXT NOT NULL,
  rounding_adjustment_minor INTEGER NOT NULL,
  refund_rate_policy TEXT NOT NULL DEFAULT 'ORIGINAL_RATE'
    CHECK (refund_rate_policy IN ('ORIGINAL_RATE','CURRENT_RATE','MANAGER_REVIEW')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,payment_transaction_id),
  UNIQUE (tenant_id,quote_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,quote_id) REFERENCES fx_payment_quotes(tenant_id,id),
  CHECK (cash_tendered_minor IS NULL OR cash_tendered_minor>=tender_amount_minor),
  CHECK (change_given_minor IS NULL OR change_given_minor>=0),
  CHECK ((change_given_minor IS NULL AND change_currency IS NULL)
      OR (change_given_minor IS NOT NULL AND change_currency IS NOT NULL))
);

CREATE TABLE cash_drawer_currency_counts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  drawer_session_id TEXT NOT NULL,
  currency_code TEXT NOT NULL REFERENCES currency_reference(code),
  opening_float_minor INTEGER NOT NULL DEFAULT 0,
  expected_cash_minor INTEGER NOT NULL DEFAULT 0,
  counted_cash_minor INTEGER,
  variance_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','REVIEW_REQUIRED','APPROVED')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,drawer_session_id,currency_code),
  FOREIGN KEY (tenant_id,drawer_session_id) REFERENCES cash_drawer_sessions(tenant_id,id)
);

INSERT INTO tenant_accepted_currencies
  (tenant_id,currency_code,is_base,status,payment_eligible,cash_eligible,digital_payment_eligible,
   exchange_rate_policy,rate_freshness_minutes,rounding_policy,change_policy,branch_ids_json,
   payment_method_ids_json,effective_from,effective_to,created_by,created_at,updated_by,updated_at)
SELECT t.id,t.default_currency,1,'ACTIVE',1,1,1,'LEGAL_ENTITY',1440,'HALF_UP','TENDER_CURRENCY',
       '[]','[]',CURRENT_TIMESTAMP,NULL,'migration-0017',CURRENT_TIMESTAMP,'migration-0017',CURRENT_TIMESTAMP
FROM tenants t JOIN currency_reference c ON c.code=t.default_currency AND c.active=1
WHERE 1=1
ON CONFLICT(tenant_id,currency_code) DO NOTHING;

INSERT INTO onboarding_wizard_progress
  (tenant_id,current_step,status,completed_steps_json,responses_json,version,created_by,created_at,
   updated_by,updated_at,completed_at)
SELECT id,5,'IN_PROGRESS','[1,2,3,4]','{}',1,'migration-0017',CURRENT_TIMESTAMP,
       'migration-0017',CURRENT_TIMESTAMP,NULL
FROM tenants
WHERE 1=1
ON CONFLICT(tenant_id) DO NOTHING;

CREATE TRIGGER onboarding_wizard_event_no_update
BEFORE UPDATE ON onboarding_wizard_events
BEGIN SELECT RAISE(ABORT,'onboarding event history is append-only'); END;

CREATE TRIGGER onboarding_wizard_event_no_delete
BEFORE DELETE ON onboarding_wizard_events
BEGIN SELECT RAISE(ABORT,'onboarding event history is append-only'); END;

CREATE TRIGGER fx_rate_no_update
BEFORE UPDATE ON fx_rates
BEGIN SELECT RAISE(ABORT,'FX rate evidence is append-only'); END;

CREATE TRIGGER fx_rate_no_delete
BEFORE DELETE ON fx_rates
BEGIN SELECT RAISE(ABORT,'FX rate evidence is append-only'); END;

CREATE TRIGGER payment_currency_snapshot_no_update
BEFORE UPDATE ON payment_currency_snapshots
BEGIN SELECT RAISE(ABORT,'payment currency snapshot is immutable'); END;

CREATE TRIGGER payment_currency_snapshot_no_delete
BEFORE DELETE ON payment_currency_snapshots
BEGIN SELECT RAISE(ABORT,'payment currency snapshot is immutable'); END;

CREATE TRIGGER payment_currency_snapshot_quote_guard
BEFORE INSERT ON payment_currency_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM fx_payment_quotes q
  WHERE q.tenant_id=NEW.tenant_id AND q.id=NEW.quote_id AND q.branch_id=NEW.branch_id
    AND q.invoice_id=NEW.invoice_id AND q.base_currency=NEW.base_currency
    AND q.tender_currency=NEW.tender_currency AND q.base_amount_minor=NEW.base_amount_minor
    AND q.tender_amount_minor=NEW.tender_amount_minor AND q.rate_numerator=NEW.rate_numerator
    AND q.rate_denominator=NEW.rate_denominator AND q.rate_source_id=NEW.rate_source_id
    AND q.status='ACTIVE' AND q.expires_at>NEW.created_at
)
BEGIN SELECT RAISE(ABORT,'FX_QUOTE_INVALID_OR_EXPIRED'); END;

CREATE TRIGGER payment_currency_snapshot_consume_quote
AFTER INSERT ON payment_currency_snapshots
BEGIN
  UPDATE fx_payment_quotes
  SET status='CONSUMED',consumed_by_transaction_id=NEW.payment_transaction_id,
      consumed_at=NEW.created_at
  WHERE tenant_id=NEW.tenant_id AND id=NEW.quote_id AND status='ACTIVE';
END;

CREATE TRIGGER tenant_base_currency_lock
BEFORE UPDATE OF default_currency ON tenants
WHEN OLD.default_currency<>NEW.default_currency AND (
  EXISTS (SELECT 1 FROM invoices WHERE tenant_id=OLD.id LIMIT 1) OR
  EXISTS (SELECT 1 FROM payment_transactions WHERE tenant_id=OLD.id LIMIT 1) OR
  EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id=OLD.id LIMIT 1) OR
  EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id=OLD.id LIMIT 1) OR
  EXISTS (SELECT 1 FROM opening_stock_batches WHERE tenant_id=OLD.id LIMIT 1) OR
  EXISTS (SELECT 1 FROM supplier_invoices WHERE tenant_id=OLD.id LIMIT 1) OR
  EXISTS (SELECT 1 FROM gift_card_ledger WHERE tenant_id=OLD.id LIMIT 1)
  OR EXISTS (
    SELECT 1 FROM authoritative_records
    WHERE tenant_id=OLD.id AND entity_type IN
      ('state:bills','state:payments','payments:transactions','payments:journals') LIMIT 1
  )
)
BEGIN SELECT RAISE(ABORT,'base currency is locked after financial activity'); END;

CREATE TRIGGER legal_entity_base_currency_lock
BEFORE UPDATE OF base_currency ON legal_entities
WHEN OLD.base_currency<>NEW.base_currency AND (
  EXISTS (SELECT 1 FROM invoices WHERE tenant_id=OLD.tenant_id LIMIT 1) OR
  EXISTS (SELECT 1 FROM payment_transactions WHERE tenant_id=OLD.tenant_id LIMIT 1) OR
  EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id=OLD.tenant_id LIMIT 1) OR
  EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id=OLD.tenant_id LIMIT 1) OR
  EXISTS (SELECT 1 FROM opening_stock_batches WHERE tenant_id=OLD.tenant_id LIMIT 1) OR
  EXISTS (SELECT 1 FROM supplier_invoices WHERE tenant_id=OLD.tenant_id LIMIT 1) OR
  EXISTS (SELECT 1 FROM gift_card_ledger WHERE tenant_id=OLD.tenant_id LIMIT 1)
  OR EXISTS (
    SELECT 1 FROM authoritative_records
    WHERE tenant_id=OLD.tenant_id AND entity_type IN
      ('state:bills','state:payments','payments:transactions','payments:journals') LIMIT 1
  )
)
BEGIN SELECT RAISE(ABORT,'base currency is locked after financial activity'); END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (17,'guided_onboarding_multi_currency','guided-onboarding-fx-0017-v1',CURRENT_TIMESTAMP);
