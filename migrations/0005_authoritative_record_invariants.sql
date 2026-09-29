-- Constraints for the record-level authoritative repository used by the current transaction engine.
CREATE UNIQUE INDEX uq_authoritative_provider_transaction_reference
ON authoritative_records(
  tenant_id,
  json_extract(payload_json, '$.providerConnectionId'),
  upper(json_extract(payload_json, '$.providerTransactionId'))
)
WHERE entity_type = 'payments:transactions'
  AND json_extract(payload_json, '$.providerConnectionId') IS NOT NULL
  AND json_extract(payload_json, '$.providerTransactionId') IS NOT NULL;

CREATE UNIQUE INDEX uq_authoritative_payment_intent_idempotency
ON authoritative_records(tenant_id, json_extract(payload_json, '$.idempotencyKey'))
WHERE entity_type = 'payments:intents'
  AND json_extract(payload_json, '$.idempotencyKey') IS NOT NULL;

CREATE UNIQUE INDEX uq_authoritative_marketplace_external_order
ON authoritative_records(
  tenant_id,
  json_extract(payload_json, '$.externalSource.connectionId'),
  json_extract(payload_json, '$.externalSource.externalOrderId')
)
WHERE entity_type = 'state:orders'
  AND json_extract(payload_json, '$.externalSource.connectionId') IS NOT NULL
  AND json_extract(payload_json, '$.externalSource.externalOrderId') IS NOT NULL;

CREATE UNIQUE INDEX uq_authoritative_settlement_external_id
ON authoritative_records(
  tenant_id,
  json_extract(payload_json, '$.connectionId'),
  json_extract(payload_json, '$.externalSettlementId')
)
WHERE entity_type = 'payments:settlementBatches'
  AND json_extract(payload_json, '$.externalSettlementId') IS NOT NULL;

CREATE UNIQUE INDEX uq_authoritative_stock_movement_reference
ON authoritative_records(tenant_id, json_extract(payload_json, '$.branchId'), json_extract(payload_json, '$.reference'))
WHERE entity_type = 'state:stockMovements'
  AND json_extract(payload_json, '$.reference') IS NOT NULL;

CREATE UNIQUE INDEX uq_authoritative_receipt_identity
ON authoritative_records(tenant_id, json_extract(payload_json, '$.branchId'), json_extract(payload_json, '$.id'))
WHERE entity_type = 'state:receipts';

INSERT INTO schema_migrations(version, name, checksum, applied_at)
VALUES (5, 'authoritative_record_invariants', 'pass5-0005-v1', CURRENT_TIMESTAMP);
