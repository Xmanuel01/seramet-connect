PRAGMA foreign_keys = ON;

ALTER TABLE cookbook_recipe_content_versions ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX idx_cookbook_content_idempotency
  ON cookbook_recipe_content_versions(tenant_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_cookbook_content_current_lookup
  ON cookbook_recipe_content_versions(
    tenant_id,recipe_id,recipe_version_id,status,revision DESC
  );

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (22,'cookbook_shared_workflow','cookbook-shared-workflow-0022-v1',CURRENT_TIMESTAMP);
