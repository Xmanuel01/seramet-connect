-- Store issues: stock leaving a store to a department (kitchen, bar, housekeeping...).
-- Two ways in:
--   REQUEST: staff ask for items; a storekeeper or manager approves and issues them.
--            Stock moves only when the items are issued.
--   DIRECT:  staff record items they already took; stock moves at once and a storekeeper or
--            manager reviews it afterwards. Rejecting a direct issue puts the stock back.
-- Each issued line is one STORE_ISSUE inventory movement at the store's weighted average cost,
-- posted through the normal inventory journal (debit the issue expense account, credit
-- inventory), so stock on hand, stock value, usage forecasts, P&L and expense reports all
-- read the same movements. No second ledger.
PRAGMA foreign_keys = ON;

CREATE TABLE store_issues (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  issue_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('REQUEST','DIRECT')),
  status TEXT NOT NULL CHECK (status IN
    ('REQUESTED','APPROVED','ISSUED','PENDING_REVIEW','REVIEWED','REJECTED','CANCELLED')),
  department_id TEXT,
  department_code TEXT NOT NULL,
  department_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  idempotency_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  issued_by TEXT,
  reviewed_by TEXT,
  rejected_by TEXT,
  cancelled_by TEXT,
  decision_reason TEXT,
  total_cost_minor INTEGER NOT NULL DEFAULT 0,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  issued_at TEXT,
  decided_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  UNIQUE (tenant_id,branch_id,issue_number),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id),
  FOREIGN KEY (tenant_id,department_id) REFERENCES departments(tenant_id,id)
);

CREATE TABLE store_issue_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  store_issue_id TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  inventory_item_id TEXT NOT NULL,
  requested_quantity_minor INTEGER NOT NULL CHECK (requested_quantity_minor > 0),
  approved_quantity_minor INTEGER CHECK (approved_quantity_minor IS NULL OR approved_quantity_minor >= 0),
  issued_quantity_minor INTEGER NOT NULL DEFAULT 0 CHECK (issued_quantity_minor >= 0),
  unit_cost_minor INTEGER,
  total_cost_minor INTEGER NOT NULL DEFAULT 0,
  movement_id TEXT,
  reversal_movement_id TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,store_issue_id,line_number),
  UNIQUE (tenant_id,store_issue_id,inventory_item_id),
  FOREIGN KEY (tenant_id,store_issue_id) REFERENCES store_issues(tenant_id,id),
  FOREIGN KEY (tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id)
);

-- Optional account for issued stock. When empty, issues post to the mapping's COGS account.
ALTER TABLE inventory_account_mappings ADD COLUMN store_issue_account_id TEXT;

CREATE INDEX idx_store_issues_branch_status
  ON store_issues(tenant_id,branch_id,status,created_at DESC);
CREATE INDEX idx_store_issues_requester
  ON store_issues(tenant_id,branch_id,requested_by,created_at DESC);
CREATE INDEX idx_store_issue_lines_item
  ON store_issue_lines(tenant_id,inventory_item_id);

-- POSTGRES_ONLY: ALTER TABLE store_issues ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE store_issue_lines ENABLE ROW LEVEL SECURITY;

INSERT INTO permissions (code,description) VALUES
  ('inventory.issue.request','Request items from the store and record items taken from it'),
  ('inventory.issue.approve','Approve, issue and review store issues'),
  ('inventory.issue.view','View all store issues and their history')
ON CONFLICT(code) DO NOTHING;

-- Existing roles keep working: anyone who could ask for stock or log wastage can request,
-- inventory approvers can approve and issue, and inventory viewers can see the history.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT DISTINCT tenant_id,role_id,'inventory.issue.request'
FROM role_permissions
WHERE permission_code IN ('procurement.requisition.create','inventory.wastage.record','inventory.adjust.approve')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT DISTINCT tenant_id,role_id,'inventory.issue.approve'
FROM role_permissions
WHERE permission_code IN ('inventory.adjust.approve','inventory.wastage.approve')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT DISTINCT tenant_id,role_id,'inventory.issue.view'
FROM role_permissions
WHERE permission_code IN ('inventory.view','inventory.adjust.approve','inventory.wastage.approve')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(35,'store_issues','store-issues-0035-v1',CURRENT_TIMESTAMP);
