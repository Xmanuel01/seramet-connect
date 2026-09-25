-- A receipt must not create more than one supplier payable, even when an invoice is disputed.
-- If historical duplicate rows exist this migration fails deliberately for manual reconciliation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoice_receipt
  ON supplier_invoices (tenant_id, goods_receipt_id)
  WHERE goods_receipt_id IS NOT NULL;

INSERT INTO schema_migrations (version, description, applied_at)
VALUES (25, 'supplier invoice receipt uniqueness', CURRENT_TIMESTAMP);
