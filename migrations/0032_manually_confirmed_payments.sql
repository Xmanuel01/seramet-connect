-- A payment the cashier confirms (a card machine payment, or an M-Pesa / bank transfer code
-- entered at the till) is stored as MANUALLY_CONFIRMED. The allocation guard only accepted
-- provider-CONFIRMED payments, so every non-cash payment was refused when saved. Accept both;
-- unverified payments still can't be allocated to an invoice.
DROP TRIGGER IF EXISTS payment_allocation_capacity;

CREATE TRIGGER payment_allocation_capacity
BEFORE INSERT ON payment_allocations
BEGIN
  SELECT CASE
    WHEN NEW.currency <> (SELECT currency FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_transaction_id)
      THEN RAISE(ABORT, 'PAYMENT_CURRENCY_MISMATCH')
    WHEN (SELECT status FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_transaction_id) NOT IN ('CONFIRMED', 'MANUALLY_CONFIRMED')
      THEN RAISE(ABORT, 'PAYMENT_NOT_CONFIRMED')
    WHEN NEW.amount_minor + COALESCE((
      SELECT SUM(amount_minor) FROM payment_allocations
      WHERE tenant_id = NEW.tenant_id AND payment_transaction_id = NEW.payment_transaction_id
    ), 0) > (SELECT amount_minor FROM payment_transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_transaction_id)
      THEN RAISE(ABORT, 'PAYMENT_ALLOCATION_EXCEEDS_CAPACITY')
  END;
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(32,'manually_confirmed_payments','manually-confirmed-payments-0032-v1',CURRENT_TIMESTAMP);
