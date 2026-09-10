PRAGMA foreign_keys = ON;

INSERT INTO permissions (code,description) VALUES
  ('intelligence.ask','Ask Seramet using authorized evidence'),
  ('intelligence.management','Use management intelligence evidence'),
  ('intelligence.finance','Use finance intelligence evidence'),
  ('intelligence.inventory','Use inventory and procurement intelligence evidence'),
  ('intelligence.staff','Use staff operational intelligence evidence'),
  ('intelligence.owner','Use authorized multi-branch owner intelligence'),
  ('intelligence.briefs.view','View generated intelligence briefs'),
  ('intelligence.briefs.manage','Configure and generate intelligence briefs'),
  ('intelligence.actions.suggest','Confirm eligible low-risk intelligence actions'),
  ('intelligence.usage.view','View intelligence usage and provider health'),
  ('intelligence.admin','Manage intelligence configuration')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

CREATE TABLE intelligence_provider_configs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  model_identifier TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('CONFIGURED','DISABLED','DEGRADED','UNAVAILABLE')),
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  secret_reference TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 15000 CHECK (timeout_ms BETWEEN 1000 AND 60000),
  max_input_units INTEGER NOT NULL DEFAULT 12000 CHECK (max_input_units BETWEEN 100 AND 1000000),
  max_output_units INTEGER NOT NULL DEFAULT 2000 CHECK (max_output_units BETWEEN 100 AND 100000),
  per_minute_limit INTEGER NOT NULL DEFAULT 20 CHECK (per_minute_limit BETWEEN 1 AND 10000),
  daily_request_limit INTEGER NOT NULL DEFAULT 200 CHECK (daily_request_limit BETWEEN 1 AND 1000000),
  monthly_request_limit INTEGER NOT NULL DEFAULT 3000 CHECK (monthly_request_limit BETWEEN 1 AND 10000000),
  per_user_daily_limit INTEGER NOT NULL DEFAULT 50 CHECK (per_user_daily_limit BETWEEN 1 AND 100000),
  retention_mode TEXT NOT NULL DEFAULT 'SHORT' CHECK (retention_mode IN ('EPHEMERAL','SHORT','STANDARD')),
  allowed_features_json TEXT NOT NULL DEFAULT '[]',
  allowed_role_ids_json TEXT NOT NULL DEFAULT '[]',
  prompt_version TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,provider_key,model_identifier)
);

CREATE TABLE intelligence_sessions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  branch_scope_json TEXT NOT NULL,
  permission_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED','EXPIRED')),
  retention_mode TEXT NOT NULL CHECK (retention_mode IN ('EPHEMERAL','SHORT','STANDARD')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE intelligence_messages (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER','ASSISTANT','SYSTEM_EVENT')),
  intent TEXT,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETE','REJECTED','FAILED')),
  provider_key TEXT,
  model_identifier TEXT,
  prompt_version TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,session_id) REFERENCES intelligence_sessions(tenant_id,id)
);

CREATE TABLE intelligence_evidence_refs (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  branch_id TEXT,
  tool_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA','COMPLETE','PARTIAL')),
  evidence_watermark TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,message_id,tool_key,source_type,source_id),
  FOREIGN KEY (tenant_id,session_id) REFERENCES intelligence_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,message_id) REFERENCES intelligence_messages(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE intelligence_usage_events (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  branch_id TEXT,
  request_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  model_identifier TEXT NOT NULL,
  input_units INTEGER NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units INTEGER NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  provider_cost_minor INTEGER,
  cost_currency TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('RESERVED','SUCCEEDED','REJECTED','FAILED','LIMITED')),
  error_category TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,request_id,status),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE intelligence_briefs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  brief_type TEXT NOT NULL CHECK (brief_type IN ('MORNING','EOD','OWNER','MANAGEMENT')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','GENERATING','READY','PARTIAL','FAILED')),
  quality TEXT NOT NULL CHECK (quality IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA','COMPLETE','PARTIAL')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  answer_json TEXT,
  generation_key TEXT NOT NULL,
  provider_key TEXT,
  model_identifier TEXT,
  prompt_version TEXT,
  correlation_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,generation_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE intelligence_feedback (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('HELPFUL','NOT_HELPFUL','INCORRECT_OR_MISSING_EVIDENCE')),
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,message_id,user_id),
  FOREIGN KEY (tenant_id,message_id) REFERENCES intelligence_messages(tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE intelligence_answer_cache (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cache_key TEXT NOT NULL,
  intent TEXT NOT NULL,
  branch_scope_hash TEXT NOT NULL,
  permission_fingerprint TEXT NOT NULL,
  evidence_watermark TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,cache_key)
);

CREATE TABLE intelligence_prompt_versions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  template_hash TEXT NOT NULL,
  service_version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,version)
);

CREATE TABLE intelligence_action_proposals (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  branch_id TEXT,
  action_type TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROPOSED','CONFIRMED','REJECTED','EXPIRED','BLOCKED')),
  confirmation_token_hash TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL,
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,session_id) REFERENCES intelligence_sessions(tenant_id,id),
  FOREIGN KEY (tenant_id,message_id) REFERENCES intelligence_messages(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE intelligence_provider_health (
  tenant_id TEXT NOT NULL,
  provider_config_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','UNAVAILABLE','UNKNOWN')),
  observed_latency_ms INTEGER,
  failure_code TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,provider_config_id),
  FOREIGN KEY (tenant_id,provider_config_id) REFERENCES intelligence_provider_configs(tenant_id,id)
);

CREATE INDEX idx_intelligence_sessions_user
  ON intelligence_sessions(tenant_id,user_id,updated_at DESC);
CREATE INDEX idx_intelligence_messages_session
  ON intelligence_messages(tenant_id,session_id,created_at);
CREATE INDEX idx_intelligence_evidence_message
  ON intelligence_evidence_refs(tenant_id,message_id,tool_key);
CREATE INDEX idx_intelligence_evidence_branch_date
  ON intelligence_evidence_refs(tenant_id,branch_id,calculated_at DESC);
CREATE INDEX idx_intelligence_usage_tenant_date
  ON intelligence_usage_events(tenant_id,created_at DESC,status);
CREATE INDEX idx_intelligence_usage_user_date
  ON intelligence_usage_events(tenant_id,user_id,created_at DESC);
CREATE INDEX idx_intelligence_briefs_period
  ON intelligence_briefs(tenant_id,branch_id,brief_type,period_end DESC);
CREATE INDEX idx_intelligence_provider_status
  ON intelligence_provider_configs(tenant_id,enabled,status);
CREATE INDEX idx_intelligence_cache_expiry
  ON intelligence_answer_cache(tenant_id,expires_at);

CREATE TRIGGER intelligence_usage_no_update
BEFORE UPDATE ON intelligence_usage_events
BEGIN
  SELECT RAISE(ABORT,'INTELLIGENCE_USAGE_IMMUTABLE');
END;

CREATE TRIGGER intelligence_usage_no_delete
BEFORE DELETE ON intelligence_usage_events
BEGIN
  SELECT RAISE(ABORT,'INTELLIGENCE_USAGE_IMMUTABLE');
END;

CREATE TRIGGER intelligence_evidence_no_update
BEFORE UPDATE ON intelligence_evidence_refs
BEGIN
  SELECT RAISE(ABORT,'INTELLIGENCE_EVIDENCE_IMMUTABLE');
END;

CREATE TRIGGER intelligence_evidence_no_delete
BEFORE DELETE ON intelligence_evidence_refs
BEGIN
  SELECT RAISE(ABORT,'INTELLIGENCE_EVIDENCE_IMMUTABLE');
END;

CREATE TRIGGER intelligence_prompt_version_no_update
BEFORE UPDATE ON intelligence_prompt_versions
BEGIN
  SELECT RAISE(ABORT,'INTELLIGENCE_PROMPT_VERSION_IMMUTABLE');
END;

CREATE TRIGGER intelligence_prompt_version_no_delete
BEFORE DELETE ON intelligence_prompt_versions
BEGIN
  SELECT RAISE(ABORT,'INTELLIGENCE_PROMPT_VERSION_IMMUTABLE');
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (10,'seramet_intelligence_copilot','pass9-0010-v1',CURRENT_TIMESTAMP);
