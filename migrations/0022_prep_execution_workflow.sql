PRAGMA foreign_keys = ON;

ALTER TABLE production_prep_recommendations ADD COLUMN target_quantity_minor INTEGER;
ALTER TABLE production_prep_recommendations ADD COLUMN warehouse_id TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN production_batch_id TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN adjustment_reason TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN approved_by TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN approved_at TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN started_at TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN completed_at TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN dismissed_by TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN dismissed_at TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN dismissal_reason TEXT;
ALTER TABLE production_prep_recommendations ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX idx_prep_production_batch
  ON production_prep_recommendations(tenant_id,production_batch_id)
  WHERE production_batch_id IS NOT NULL;

CREATE INDEX idx_prep_branch_business_status
  ON production_prep_recommendations(tenant_id,branch_id,business_date,status);

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (22,'prep_execution_workflow','prep-execution-workflow-0022-v1',CURRENT_TIMESTAMP);
