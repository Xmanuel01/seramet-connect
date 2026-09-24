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

CREATE TRIGGER IF NOT EXISTS purchase_order_status_transition_guard
BEFORE UPDATE OF status ON purchase_orders
WHEN NEW.status <> OLD.status
 AND NOT (
   (OLD.status='DRAFT' AND NEW.status IN ('SUBMITTED','CANCELLED')) OR
   (OLD.status='SUBMITTED' AND NEW.status IN ('APPROVED','CANCELLED')) OR
   (OLD.status='APPROVED' AND NEW.status IN ('PARTIALLY_RECEIVED','RECEIVED','CANCELLED')) OR
   (OLD.status='PARTIALLY_RECEIVED' AND NEW.status='RECEIVED')
 )
BEGIN
  SELECT RAISE(ABORT,'invalid purchase order status transition');
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES (25,'procurement_end_to_end_hardening','procurement-end-to-end-hardening-0025-v1',CURRENT_TIMESTAMP);
