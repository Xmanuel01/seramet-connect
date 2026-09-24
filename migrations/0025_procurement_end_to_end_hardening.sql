PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoices_supplier_number
  ON supplier_invoices(tenant_id,supplier_id,invoice_number);

CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_branch_status_created
  ON purchase_requisitions(tenant_id,branch_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch_status_created
  ON purchase_orders(tenant_id,branch_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_branch_received
  ON goods_receipts(tenant_id,branch_id,received_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_branch_due
  ON supplier_invoices(tenant_id,branch_id,due_date,status);

CREATE INDEX IF NOT EXISTS idx_procurement_matches_invoice
  ON procurement_matches(tenant_id,supplier_invoice_id,status);

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (25,'procurement_end_to_end_hardening','procurement-end-to-end-hardening-0025-v1',CURRENT_TIMESTAMP);
