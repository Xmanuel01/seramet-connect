-- Pass 12 final hardening: module/action permission separation and cache revisioning.

CREATE TABLE access_control_revisions (
  tenant_id TEXT NOT NULL PRIMARY KEY REFERENCES tenants(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO access_control_revisions (tenant_id,revision,updated_at)
SELECT id,1,CURRENT_TIMESTAMP FROM tenants;

INSERT INTO permissions (code,description) VALUES
  ('pos.access','Open and use the point of sale'),
  ('orders.view','View orders'),
  ('invoice.view','View invoices'),
  ('invoice.create','Create invoices'),
  ('invoice.reprint','Reprint invoices'),
  ('invoice.cancel','Cancel invoices'),
  ('receipt.view','View receipts'),
  ('receipt.reprint','Reprint receipts'),
  ('finance.view','View finance'),
  ('accounting.view','View accounting'),
  ('kitchen.view','View kitchen operations'),
  ('procurement.view','View procurement'),
  ('production.view','View production'),
  ('staff.view','View staff operations'),
  ('users.view','View users and role assignments'),
  ('users.manage','Manage users'),
  ('settings.view','View settings'),
  ('settings.organisation.view','View organisation settings'),
  ('settings.branch.view','View branch settings'),
  ('settings.warehouse.view','View warehouse settings'),
  ('settings.hardware.view','View hardware settings'),
  ('integrations.view','View integrations'),
  ('marketing.view','View marketing')
ON CONFLICT(code) DO NOTHING;

-- Preserve existing deployments while making future grants independently controllable.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'pos.access' FROM role_permissions WHERE permission_code='orders.create'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'orders.view' FROM role_permissions
WHERE permission_code IN ('orders.create','orders.update','orders.serve')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'invoice.view' FROM role_permissions WHERE permission_code='invoices.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'invoice.create' FROM role_permissions WHERE permission_code='invoices.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'invoice.reprint' FROM role_permissions WHERE permission_code='invoices.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'invoice.cancel' FROM role_permissions WHERE permission_code='invoices.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'receipt.view' FROM role_permissions WHERE permission_code='invoices.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'receipt.reprint' FROM role_permissions WHERE permission_code='invoices.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'finance.view' FROM role_permissions WHERE permission_code='finance.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'accounting.view' FROM role_permissions WHERE permission_code='finance.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'kitchen.view' FROM role_permissions WHERE permission_code='kitchen.operate'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'procurement.view' FROM role_permissions
WHERE permission_code LIKE 'procurement.%'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'production.view' FROM role_permissions
WHERE permission_code LIKE 'production.%' OR permission_code='kitchen.operate'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'staff.view' FROM role_permissions
WHERE permission_code IN ('staff.manage','attendance.use','payroll.manage')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'users.view' FROM role_permissions
WHERE permission_code IN ('staff.manage','settings.role.manage')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'users.manage' FROM role_permissions WHERE permission_code='settings.role.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'settings.view' FROM role_permissions WHERE permission_code LIKE 'settings.%'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'settings.organisation.view' FROM role_permissions
WHERE permission_code='settings.organisation.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'settings.branch.view' FROM role_permissions
WHERE permission_code='settings.branch.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'settings.warehouse.view' FROM role_permissions
WHERE permission_code='settings.warehouse.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'settings.hardware.view' FROM role_permissions
WHERE permission_code='settings.hardware.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'integrations.view' FROM role_permissions
WHERE permission_code LIKE 'integrations.%' OR permission_code='settings.integration.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'marketing.view' FROM role_permissions WHERE permission_code='marketing.manage'
ON CONFLICT DO NOTHING;

CREATE TRIGGER access_revision_role_permission_insert
AFTER INSERT ON role_permissions BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_role_permission_delete
AFTER DELETE ON role_permissions BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (OLD.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_user_role_insert
AFTER INSERT ON user_roles BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_user_role_delete
AFTER DELETE ON user_roles BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (OLD.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_user_branch_insert
AFTER INSERT ON user_branches BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_user_branch_delete
AFTER DELETE ON user_branches BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (OLD.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_enterprise_assignment_insert
AFTER INSERT ON enterprise_role_assignments BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_enterprise_assignment_update
AFTER UPDATE ON enterprise_role_assignments BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_enterprise_assignment_delete
AFTER DELETE ON enterprise_role_assignments BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (OLD.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_delegation_insert
AFTER INSERT ON delegated_admin_policies BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_delegation_update
AFTER UPDATE ON delegated_admin_policies BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_delegation_delete
AFTER DELETE ON delegated_admin_policies BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (OLD.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (14,'enterprise_module_access','pass12-0014-v1',CURRENT_TIMESTAMP);
