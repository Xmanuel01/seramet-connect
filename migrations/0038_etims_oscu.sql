-- KRA eTIMS through an Online Sales Control Unit (OSCU), per KRA's OSCU
-- Specification v2.0 and TIS Technical Specification v2.0.
--
-- etims_branch_settings: one OSCU per branch (KRA treats each place of supply as
--   a branch with its own bhfId and its own receipt sequence). The
--   communication key (cmcKey) returned by device activation is a secret: it is
--   kept in the encrypted secret store and only its reference is stored here.
-- etims_items: the eTIMS item code issued for each sold item, registered with
--   KRA (/saveItem) before its first sale.
-- etims_sales: one row per receipt sent to KRA (/saveTrnsSalesOsdc). invc_no is
--   the branch's uninterrupted ascending sequence. The signed response
--   (receipt numbers, internal data, signature, SCU time) is stored so a
--   reprint shows the same fiscal data without signing the sale twice.
PRAGMA foreign_keys = ON;

CREATE TABLE etims_branch_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  tin TEXT NOT NULL,
  bhf_id TEXT NOT NULL,
  device_serial TEXT NOT NULL,
  item_class_code TEXT NOT NULL,
  untaxed_tax_type TEXT NOT NULL DEFAULT 'D' CHECK (untaxed_tax_type IN ('A','C','D')),
  qr_format TEXT NOT NULL DEFAULT 'KRA_LINK' CHECK (qr_format IN ('KRA_LINK','SCU_DATA')),
  sdc_id TEXT,
  mrc_no TEXT,
  taxpayer_name TEXT,
  cmc_key_ref TEXT,
  initialized_at TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE TABLE etims_items (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_cd TEXT NOT NULL,
  item_seq INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('A','B','C','D','E')),
  item_type TEXT NOT NULL CHECK (item_type IN ('1','2','3')),
  registered_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, item_key),
  UNIQUE (tenant_id, branch_id, item_cd),
  UNIQUE (tenant_id, branch_id, item_seq)
);

CREATE TABLE etims_sales (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  invc_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SIGNED','FAILED')),
  request_json TEXT NOT NULL,
  result_cd TEXT,
  result_msg TEXT,
  cur_rcpt_no INTEGER,
  tot_rcpt_no INTEGER,
  intrl_data TEXT,
  rcpt_sign TEXT,
  sdc_date_time TEXT,
  sdc_id TEXT,
  mrc_no TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  signed_at TEXT,
  PRIMARY KEY (tenant_id, branch_id, receipt_id),
  UNIQUE (tenant_id, branch_id, invc_no)
);

CREATE INDEX idx_etims_sales_status ON etims_sales (tenant_id, branch_id, status, created_at);

-- POSTGRES_ONLY: ALTER TABLE etims_branch_settings ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE etims_items ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE etims_sales ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(38,'etims_oscu','etims-oscu-0038-v1',CURRENT_TIMESTAMP);
