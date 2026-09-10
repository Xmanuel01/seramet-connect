PRAGMA foreign_keys = ON;

CREATE INDEX idx_orders_tenant_branch_created ON orders(tenant_id, branch_id, created_at DESC);
CREATE INDEX idx_orders_tenant_branch_status ON orders(tenant_id, branch_id, status, business_date);
CREATE INDEX idx_invoices_tenant_branch_status ON invoices(tenant_id, branch_id, status, business_date);
CREATE INDEX idx_payments_tenant_branch_status ON payment_transactions(tenant_id, branch_id, status, occurred_at DESC);
CREATE INDEX idx_payments_provider_reference ON payment_transactions(provider_connection_id, provider_transaction_id);
CREATE INDEX idx_payment_allocations_invoice ON payment_allocations(tenant_id, invoice_id);
CREATE INDEX idx_cash_movements_drawer ON cash_movements(tenant_id, drawer_session_id, created_at);
CREATE INDEX idx_bank_transactions_date ON bank_transactions(tenant_id, account_id, transaction_date DESC);
CREATE INDEX idx_receivables_status ON marketplace_receivables(tenant_id, branch_id, status, updated_at);
CREATE INDEX idx_settlements_status ON settlement_batches(tenant_id, connection_id, status, period_end DESC);
CREATE INDEX idx_reconciliation_status ON reconciliation_sessions(tenant_id, status, business_date DESC);
CREATE INDEX idx_journal_business_date ON journal_entries(tenant_id, branch_id, business_date, status);
CREATE INDEX idx_journal_source ON journal_entries(tenant_id, source_type, source_id);
CREATE INDEX idx_inventory_balance_branch ON inventory_balances(tenant_id, branch_id, item_id);
CREATE INDEX idx_inventory_movements_item ON inventory_movements(tenant_id, branch_id, item_id, created_at DESC);
CREATE INDEX idx_audit_tenant_created ON audit_events(tenant_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_events(tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX idx_provider_events_received ON provider_events(tenant_id, connection_id, received_at DESC);
CREATE INDEX idx_provider_events_status ON provider_events(tenant_id, status, received_at);
CREATE INDEX idx_outbox_due ON integration_outbox(status, next_attempt_at, lease_expires_at);
CREATE INDEX idx_worker_jobs_due ON worker_jobs(status, scheduled_at, lease_expires_at);
CREATE INDEX idx_offline_commands_device ON offline_commands(tenant_id, device_id, client_sequence);
CREATE INDEX idx_offline_commands_status ON offline_commands(tenant_id, branch_id, sync_status, received_at);
CREATE INDEX idx_sessions_lookup ON auth_sessions(tenant_id, user_id, revoked_at, expires_at);
CREATE INDEX idx_devices_branch_status ON hardware_devices(tenant_id, branch_id, trust_status);

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

CREATE TRIGGER confirmed_payment_immutable
BEFORE UPDATE ON payment_transactions
WHEN OLD.status IN ('CONFIRMED', 'REVERSED')
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED_PAYMENT_IMMUTABLE');
END;

CREATE TRIGGER payment_transaction_no_delete
BEFORE DELETE ON payment_transactions
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_TRANSACTION_IMMUTABLE');
END;

CREATE TRIGGER payment_allocation_no_update
BEFORE UPDATE ON payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_ALLOCATION_IMMUTABLE');
END;

CREATE TRIGGER payment_allocation_no_delete
BEFORE DELETE ON payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_ALLOCATION_IMMUTABLE');
END;

CREATE TRIGGER payment_allocation_capacity
BEFORE INSERT ON payment_allocations
BEGIN
  SELECT CASE
    WHEN NEW.currency <> (SELECT currency FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_transaction_id)
      THEN RAISE(ABORT, 'PAYMENT_CURRENCY_MISMATCH')
    WHEN (SELECT status FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_transaction_id) <> 'CONFIRMED'
      THEN RAISE(ABORT, 'PAYMENT_NOT_CONFIRMED')
    WHEN NEW.amount_minor + COALESCE((
      SELECT SUM(amount_minor) FROM payment_allocations
      WHERE tenant_id = NEW.tenant_id AND payment_transaction_id = NEW.payment_transaction_id
    ), 0) > (SELECT amount_minor FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_transaction_id)
      THEN RAISE(ABORT, 'PAYMENT_ALLOCATION_EXCEEDS_CAPACITY')
  END;
END;

CREATE TRIGGER refund_capacity
BEFORE INSERT ON payment_refunds
BEGIN
  SELECT CASE
    WHEN NEW.currency <> (SELECT currency FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.original_transaction_id)
      THEN RAISE(ABORT, 'REFUND_CURRENCY_MISMATCH')
    WHEN NEW.amount_minor + COALESCE((
      SELECT SUM(amount_minor) FROM payment_refunds
      WHERE tenant_id = NEW.tenant_id
        AND original_transaction_id = NEW.original_transaction_id
        AND status IN ('REQUESTED', 'PROCESSING', 'CONFIRMED')
    ), 0) > (SELECT amount_minor FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.original_transaction_id AND status = 'CONFIRMED')
      THEN RAISE(ABORT, 'REFUND_EXCEEDS_REFUNDABLE_AMOUNT')
  END;
END;

CREATE TRIGGER posted_journal_immutable
BEFORE UPDATE ON journal_entries
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER posted_journal_no_delete
BEFORE DELETE ON journal_entries
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER posted_journal_lines_immutable_update
BEFORE UPDATE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE tenant_id = OLD.tenant_id AND id = OLD.journal_entry_id) = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER posted_journal_lines_immutable_delete
BEFORE DELETE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE tenant_id = OLD.tenant_id AND id = OLD.journal_entry_id) = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER journal_must_balance_before_post
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'POSTED' AND OLD.status <> 'POSTED'
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT SUM(debit_minor) FROM journal_lines WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.id), 0)
       <> COALESCE((SELECT SUM(credit_minor) FROM journal_lines WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.id), 0)
      THEN RAISE(ABORT, 'JOURNAL_NOT_BALANCED')
    WHEN NOT EXISTS (SELECT 1 FROM journal_lines WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.id)
      THEN RAISE(ABORT, 'JOURNAL_HAS_NO_LINES')
  END;
END;

CREATE TRIGGER posted_settlement_immutable
BEFORE UPDATE ON settlement_batches
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_SETTLEMENT_IMMUTABLE');
END;

CREATE TRIGGER posted_settlement_no_delete
BEFORE DELETE ON settlement_batches
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_SETTLEMENT_IMMUTABLE');
END;

CREATE TRIGGER settlement_line_posted_lock_insert
BEFORE INSERT ON settlement_lines
WHEN (SELECT status FROM settlement_batches WHERE tenant_id = NEW.tenant_id AND id = NEW.settlement_batch_id) = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_SETTLEMENT_IMMUTABLE');
END;

CREATE TRIGGER settlement_line_posted_lock_update
BEFORE UPDATE ON settlement_lines
WHEN (SELECT status FROM settlement_batches WHERE tenant_id = OLD.tenant_id AND id = OLD.settlement_batch_id) = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_SETTLEMENT_IMMUTABLE');
END;

CREATE TRIGGER settlement_line_posted_lock_delete
BEFORE DELETE ON settlement_lines
WHEN (SELECT status FROM settlement_batches WHERE tenant_id = OLD.tenant_id AND id = OLD.settlement_batch_id) = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'POSTED_SETTLEMENT_IMMUTABLE');
END;

CREATE TRIGGER cash_movement_open_drawer
BEFORE INSERT ON cash_movements
WHEN (SELECT status FROM cash_drawer_sessions WHERE tenant_id = NEW.tenant_id AND id = NEW.drawer_session_id) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'CASH_DRAWER_NOT_OPEN');
END;

CREATE TRIGGER cash_drawer_close_once
BEFORE UPDATE OF status ON cash_drawer_sessions
WHEN OLD.status <> 'OPEN' AND NEW.status IN ('CLOSED', 'REVIEW_REQUIRED', 'APPROVED')
BEGIN
  SELECT RAISE(ABORT, 'CASH_DRAWER_ALREADY_CLOSED');
END;

CREATE TRIGGER inventory_movement_no_update
BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_MOVEMENT_IMMUTABLE');
END;

CREATE TRIGGER inventory_movement_no_delete
BEFORE DELETE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_MOVEMENT_IMMUTABLE');
END;

CREATE TRIGGER closed_day_financial_lock_invoice
BEFORE UPDATE ON invoices
WHEN EXISTS (
  SELECT 1 FROM day_closes
  WHERE tenant_id = OLD.tenant_id AND branch_id = OLD.branch_id
    AND business_date = OLD.business_date AND status = 'CLOSED'
)
BEGIN
  SELECT RAISE(ABORT, 'BUSINESS_DATE_CLOSED');
END;

CREATE TRIGGER document_identity_no_delete
BEFORE DELETE ON document_identities
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_IDENTITY_IMMUTABLE');
END;

INSERT INTO schema_migrations(version, name, checksum, applied_at)
VALUES (3, 'constraints_indexes', 'pass5-0003-v1', CURRENT_TIMESTAMP);
