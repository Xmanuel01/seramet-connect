-- Tenant/branch-scoped corporate catering and customer relationship pipeline.
-- Leads are not revenue or customer transaction records. Closed WON is a recorded
-- agreement stage, not an assertion of paid orders or realized revenue.
CREATE TABLE crm_leads (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT,
  contact_name TEXT NOT NULL,
  company_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  source TEXT NOT NULL,
  owner_actor_id TEXT NOT NULL,
  owner_display_name TEXT NOT NULL,
  estimated_value_minor INTEGER NOT NULL DEFAULT 0 CHECK (estimated_value_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  stage TEXT NOT NULL DEFAULT 'NEW'
    CHECK (stage IN ('NEW','CONTACTED','QUALIFIED','PROPOSAL','WON','LOST')),
  next_action TEXT,
  due_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,request_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE INDEX idx_crm_leads_by_branch ON crm_leads(tenant_id,branch_id,stage,due_at,created_at);

CREATE TABLE crm_lead_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  note TEXT,
  action_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,lead_id,request_key),
  FOREIGN KEY (tenant_id,lead_id) REFERENCES crm_leads(tenant_id,id)
);
CREATE INDEX idx_crm_lead_events_history ON crm_lead_events(tenant_id,lead_id,created_at);
CREATE TRIGGER crm_lead_events_no_update BEFORE UPDATE ON crm_lead_events
BEGIN SELECT RAISE(ABORT,'lead events are immutable'); END;
CREATE TRIGGER crm_lead_events_no_delete BEFORE DELETE ON crm_lead_events
BEGIN SELECT RAISE(ABORT,'lead events are immutable'); END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (26,'crm_lead_pipeline','crm-lead-pipeline-0026-v1',CURRENT_TIMESTAMP);
