PRAGMA foreign_keys = ON;

CREATE TRIGGER invoice_allocation_capacity
BEFORE INSERT ON payment_allocations
BEGIN
  SELECT CASE
    WHEN NEW.currency <> (
      SELECT currency FROM invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id
    ) THEN RAISE(ABORT, 'INVOICE_CURRENCY_MISMATCH')
    WHEN NEW.amount_minor + COALESCE((
      SELECT SUM(amount_minor) FROM payment_allocations
      WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.invoice_id
    ), 0) > (
      SELECT total_minor FROM invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id
    ) THEN RAISE(ABORT, 'INVOICE_ALLOCATION_EXCEEDS_BALANCE')
  END;
END;

CREATE UNIQUE INDEX uq_payment_refund_correlation
ON payment_refunds(tenant_id, correlation_id);

CREATE TRIGGER journal_must_begin_draft
BEFORE INSERT ON journal_entries
WHEN NEW.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_MUST_BEGIN_DRAFT');
END;

CREATE TRIGGER settlement_post_transition
BEFORE UPDATE OF status ON settlement_batches
WHEN NEW.status = 'POSTED' AND OLD.status <> 'MATCHED'
BEGIN
  SELECT RAISE(ABORT, 'INVALID_SETTLEMENT_POST_TRANSITION');
END;

INSERT INTO schema_migrations(version, name, checksum, applied_at)
VALUES (6, 'concurrency_guards', 'pass5-0006-v1', CURRENT_TIMESTAMP);
