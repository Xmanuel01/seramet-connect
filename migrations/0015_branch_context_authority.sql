-- Branch context hardening: separate reporting scope from operational branch switching.

INSERT INTO permissions (code,description) VALUES
  ('branches.switch','Switch the active operating branch among assigned branches')
ON CONFLICT(code) DO NOTHING;

-- Preserve existing all-branch operators while making future grants independently controllable.
INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'scope.branches.all'
FROM role_permissions
WHERE permission_code='tenant.scope.all_branches'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'branches.switch'
FROM role_permissions
WHERE permission_code IN ('scope.branches.all','tenant.scope.all_branches')
ON CONFLICT DO NOTHING;

CREATE TABLE user_primary_branches (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (tenant_id,user_id),
  UNIQUE (tenant_id,user_id,branch_id),
  FOREIGN KEY (tenant_id,user_id,branch_id)
    REFERENCES user_branches(tenant_id,user_id,branch_id) ON DELETE CASCADE
);

-- Existing assignment insertion order is the least surprising migration default.
INSERT INTO user_primary_branches
  (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason)
SELECT ub.tenant_id,ub.user_id,ub.branch_id,'system:migration',CURRENT_TIMESTAMP,
       'Primary branch derived from the earliest existing assignment'
FROM user_branches ub
WHERE ub.rowid = (
  SELECT MIN(candidate.rowid)
  FROM user_branches candidate
  WHERE candidate.tenant_id=ub.tenant_id AND candidate.user_id=ub.user_id
);

CREATE INDEX idx_user_primary_branches_branch
ON user_primary_branches(tenant_id,branch_id,user_id);

CREATE TRIGGER access_revision_user_primary_branch_insert
AFTER INSERT ON user_primary_branches BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_user_primary_branch_update
AFTER UPDATE ON user_primary_branches BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (NEW.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER access_revision_user_primary_branch_delete
AFTER DELETE ON user_primary_branches BEGIN
  INSERT INTO access_control_revisions (tenant_id,revision,updated_at)
  VALUES (OLD.tenant_id,1,CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id) DO UPDATE SET revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (15,'branch_context_authority','branch-context-0015-v1',CURRENT_TIMESTAMP);
