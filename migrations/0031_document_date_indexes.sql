-- Invoice and receipt lists are read one branch and business date at a time,
-- newest first (src/server/documents-api.ts). These indexes serve that read
-- directly instead of scanning a branch's whole history.
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_branch_date
  ON invoices(tenant_id, branch_id, business_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant_branch_date
  ON receipts(tenant_id, branch_id, business_date, created_at, id);
INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(31,'document_date_indexes','document-date-indexes-0031-v1',CURRENT_TIMESTAMP);
