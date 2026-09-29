PRAGMA foreign_keys = ON;

CREATE TABLE cookbook_recipe_content_versions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  recipe_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  prep_minutes INTEGER NOT NULL DEFAULT 0 CHECK (prep_minutes >= 0),
  cook_minutes INTEGER NOT NULL DEFAULT 0 CHECK (cook_minutes >= 0),
  portion_label TEXT,
  image_url TEXT,
  chef_notes TEXT,
  method_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '[]',
  source_document TEXT,
  source_reference TEXT,
  change_summary TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,recipe_version_id,revision),
  FOREIGN KEY (tenant_id,recipe_id) REFERENCES recipes(tenant_id,id),
  FOREIGN KEY (tenant_id,recipe_version_id) REFERENCES recipe_versions(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id)
);

CREATE INDEX idx_cookbook_content_recipe
  ON cookbook_recipe_content_versions(tenant_id,recipe_id,recipe_version_id,revision DESC);

CREATE INDEX idx_cookbook_content_status
  ON cookbook_recipe_content_versions(tenant_id,status,created_at DESC);

INSERT INTO permissions (code,description) VALUES
  ('cookbook.view','View cookbook recipes and kitchen methods'),
  ('cookbook.manage','Edit cookbook recipe content and kitchen methods'),
  ('cookbook.publish','Publish cookbook recipe content')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT DISTINCT tenant_id,role_id,'cookbook.view'
FROM role_permissions
WHERE permission_code IN ('kitchen.view','kitchen.operate','costcontrol.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'cookbook.manage'
FROM role_permissions
WHERE permission_code='costcontrol.manage'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id,role_id,permission_code)
SELECT tenant_id,role_id,'cookbook.publish'
FROM role_permissions
WHERE permission_code='costcontrol.manage'
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (21,'cookbook_shared_backend','cookbook-shared-backend-0021-v1',CURRENT_TIMESTAMP);
