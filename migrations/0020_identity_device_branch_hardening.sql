PRAGMA foreign_keys = ON;

ALTER TABLE branches ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (lifecycle_state IN ('DRAFT','CONFIGURING','ACTIVE','SUSPENDED','CLOSED'));
ALTER TABLE branches ADD COLUMN is_bootstrap INTEGER NOT NULL DEFAULT 0
  CHECK (is_bootstrap IN (0,1));
ALTER TABLE branches ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

-- Reconcile only empty tenants that have not completed onboarding. Existing trading branches remain active.
UPDATE branches
SET lifecycle_state='DRAFT',is_bootstrap=1
WHERE id=(SELECT MIN(candidate.id) FROM branches candidate WHERE candidate.tenant_id=branches.tenant_id)
  AND tenant_id IN (SELECT tenant_id FROM onboarding_wizard_progress WHERE status<>'COMPLETED')
  AND NOT EXISTS (SELECT 1 FROM orders WHERE orders.tenant_id=branches.tenant_id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM invoices WHERE invoices.tenant_id=branches.tenant_id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE payment_transactions.tenant_id=branches.tenant_id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE inventory_movements.tenant_id=branches.tenant_id LIMIT 1);

ALTER TABLE hardware_devices ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVATION_PENDING'
  CHECK (lifecycle_state IN ('UNREGISTERED','ACTIVATION_PENDING','ACTIVE','LOCKED','REVOKED','RETIRED'));
ALTER TABLE hardware_devices ADD COLUMN activated_at TEXT;
ALTER TABLE hardware_devices ADD COLUMN activated_by TEXT;
ALTER TABLE hardware_devices ADD COLUMN locked_at TEXT;
ALTER TABLE hardware_devices ADD COLUMN retired_at TEXT;
ALTER TABLE hardware_devices ADD COLUMN app_version TEXT;
ALTER TABLE hardware_devices ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0 CHECK (credential_version >= 0);

UPDATE hardware_devices SET lifecycle_state=CASE trust_status
  WHEN 'ACTIVE' THEN 'ACTIVE'
  WHEN 'REVOKED' THEN 'REVOKED'
  ELSE 'ACTIVATION_PENDING'
END;

ALTER TABLE users ADD COLUMN employee_code TEXT;
ALTER TABLE users ADD COLUMN normalized_email TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN job_title TEXT;
ALTER TABLE users ADD COLUMN employment_status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (employment_status IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED'));
ALTER TABLE users ADD COLUMN effective_from TEXT;
ALTER TABLE users ADD COLUMN effective_until TEXT;

UPDATE users SET normalized_email=LOWER(TRIM(email)) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX uq_users_normalized_email
  ON users(tenant_id,normalized_email) WHERE normalized_email IS NOT NULL;
CREATE UNIQUE INDEX uq_users_employee_code
  ON users(tenant_id,employee_code) WHERE employee_code IS NOT NULL;
CREATE UNIQUE INDEX uq_branches_normalized_code
  ON branches(tenant_id,UPPER(TRIM(code)));
CREATE INDEX idx_branches_lifecycle ON branches(tenant_id,lifecycle_state,is_bootstrap);

CREATE TABLE account_owners (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','TRANSFERRED','REVOKED')),
  granted_by TEXT,
  granted_at TEXT NOT NULL,
  ended_at TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

INSERT INTO account_owners (tenant_id,user_id,status,granted_by,granted_at,reason)
SELECT i.tenant_id,MIN(i.user_id),'ACTIVE','system:migration',CURRENT_TIMESTAMP,
       'Initial owner derived from verified identity account'
FROM identity_accounts i GROUP BY i.tenant_id;

CREATE TRIGGER account_owner_final_update_guard
BEFORE UPDATE OF status ON account_owners
WHEN OLD.status='ACTIVE' AND NEW.status<>'ACTIVE' AND
  (SELECT COUNT(*) FROM account_owners candidate
   WHERE candidate.tenant_id=OLD.tenant_id AND candidate.status='ACTIVE')<=1
BEGIN SELECT RAISE(ABORT,'tenant must retain at least one active account owner'); END;

CREATE TRIGGER account_owner_final_delete_guard
BEFORE DELETE ON account_owners
WHEN OLD.status='ACTIVE' AND
  (SELECT COUNT(*) FROM account_owners candidate
   WHERE candidate.tenant_id=OLD.tenant_id AND candidate.status='ACTIVE')<=1
BEGIN SELECT RAISE(ABORT,'tenant must retain at least one active account owner'); END;

CREATE TRIGGER account_owner_final_user_disable_guard
BEFORE UPDATE OF active ON users
WHEN OLD.active=1 AND NEW.active=0
 AND EXISTS (SELECT 1 FROM account_owners owner
             WHERE owner.tenant_id=OLD.tenant_id AND owner.user_id=OLD.id AND owner.status='ACTIVE')
 AND (SELECT COUNT(*) FROM account_owners candidate
      JOIN users owner_user ON owner_user.tenant_id=candidate.tenant_id AND owner_user.id=candidate.user_id
      WHERE candidate.tenant_id=OLD.tenant_id AND candidate.status='ACTIVE' AND owner_user.active=1)<=1
BEGIN SELECT RAISE(ABORT,'tenant must retain at least one active account owner'); END;

CREATE TABLE pos_security_policies (
  tenant_id TEXT NOT NULL PRIMARY KEY REFERENCES tenants(id),
  pin_length INTEGER NOT NULL DEFAULT 6 CHECK (pin_length IN (4,6)),
  allow_employee_tiles INTEGER NOT NULL DEFAULT 0 CHECK (allow_employee_tiles IN (0,1)),
  inactivity_lock_minutes INTEGER NOT NULL DEFAULT 15 CHECK (inactivity_lock_minutes BETWEEN 1 AND 480),
  maximum_failures INTEGER NOT NULL DEFAULT 5 CHECK (maximum_failures BETWEEN 3 AND 20),
  lockout_minutes INTEGER NOT NULL DEFAULT 15 CHECK (lockout_minutes BETWEEN 1 AND 1440),
  credential_history_count INTEGER NOT NULL DEFAULT 3 CHECK (credential_history_count BETWEEN 0 AND 12),
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO pos_security_policies (tenant_id,updated_by,updated_at)
SELECT id,'system:migration',CURRENT_TIMESTAMP FROM tenants;

CREATE TABLE employee_pin_credentials (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('PBKDF2-SHA256')),
  algorithm_version INTEGER NOT NULL DEFAULT 1 CHECK (algorithm_version > 0),
  iterations INTEGER NOT NULL CHECK (iterations >= 310000),
  salt_base64 TEXT NOT NULL,
  hash_base64 TEXT NOT NULL,
  pin_length INTEGER NOT NULL CHECK (pin_length IN (4,6)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  temporary INTEGER NOT NULL DEFAULT 0 CHECK (temporary IN (0,1)),
  must_change INTEGER NOT NULL DEFAULT 0 CHECK (must_change IN (0,1)),
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE employee_pin_history (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  algorithm TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  salt_base64 TEXT NOT NULL,
  hash_base64 TEXT NOT NULL,
  replaced_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,user_id,version),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE device_credentials (
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  token_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  rotated_from_version INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id,device_id,version),
  UNIQUE (token_hash),
  FOREIGN KEY (tenant_id,device_id) REFERENCES hardware_devices(tenant_id,id)
);

CREATE INDEX idx_device_credentials_lookup ON device_credentials(token_hash,revoked_at,expires_at);

CREATE TABLE pos_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  auth_level TEXT NOT NULL DEFAULT 'POS_PIN' CHECK (auth_level='POS_PIN'),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  inactivity_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  credential_version INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,device_id) REFERENCES hardware_devices(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE INDEX idx_pos_sessions_lookup ON pos_sessions(token_hash,revoked_at,expires_at);
CREATE INDEX idx_pos_sessions_subject ON pos_sessions(tenant_id,user_id,device_id,revoked_at);

CREATE TABLE authentication_attempts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  device_id TEXT,
  user_id TEXT,
  network_hash TEXT,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('ACCOUNT','EMPLOYEE_PIN','DEVICE')),
  result TEXT NOT NULL CHECK (result IN ('SUCCESS','FAILURE','THROTTLED','LOCKED','REVOKED')),
  reason_code TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

CREATE INDEX idx_auth_attempts_scope
  ON authentication_attempts(tenant_id,device_id,user_id,occurred_at DESC);

CREATE TABLE credential_reset_records (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reset_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  temporary INTEGER NOT NULL CHECK (temporary IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE employee_creation_attempts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,idempotency_key)
);

CREATE TABLE branch_creation_attempts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  branch_id TEXT,
  response_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE branch_duplicate_reviews (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  candidate_branch_id TEXT NOT NULL,
  existing_branch_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','CONFIRMED_DISTINCT','DEACTIVATED_EMPTY','BLOCKED_HAS_DATA')),
  evidence_json TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,candidate_branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,existing_branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE onboarding_readiness_tasks (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  branch_id TEXT,
  section_code TEXT NOT NULL,
  requirement TEXT NOT NULL CHECK (requirement IN ('BLOCKING','OPTIONAL')),
  status TEXT NOT NULL CHECK (status IN ('INCOMPLETE','DEFERRED','BLOCKED','COMPLETED')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,branch_id,section_code),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

INSERT INTO permissions (code,description) VALUES
  ('ownership.transfer','Transfer account ownership'),
  ('device.activate','Activate and revoke POS devices'),
  ('employee.credentials.manage','Create and reset employee POS credentials'),
  ('branches.reconcile','Review likely duplicate branches')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,id,'ownership.transfer' FROM roles WHERE code IN ('ACCOUNT_OWNER','TENANT_ADMINISTRATOR')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'device.activate' FROM role_permissions WHERE permission_code='settings.hardware.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'employee.credentials.manage' FROM role_permissions WHERE permission_code='users.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'branches.reconcile' FROM role_permissions WHERE permission_code='settings.branch.manage'
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (20,'identity_device_branch_hardening','identity-device-branch-0020-v3',CURRENT_TIMESTAMP);
