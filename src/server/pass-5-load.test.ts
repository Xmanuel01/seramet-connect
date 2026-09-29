import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-development";
const branchId = "branch-development";
const connectionId = "connection-load";
const stamp = "2026-08-30T12:00:00.000Z";

describe.sequential("Pass 5 reproducible local load baseline", () => {
  let database: SqliteD1TestDatabase;

  beforeEach(async () => {
    database = createMigratedTestDatabase();
    database.sqlite.exec(
      readFileSync(resolve(process.cwd(), "migrations", "seed", "development.sql"), "utf8"),
    );
    await seedOperationalReferences(database);
  });

  afterEach(() => database.close());

  it("measures lunch-rush, callback-burst, availability and EOD query paths", async () => {
    const metrics = {
      create50PosOrdersMs: 0,
      loadActiveOrdersMs: 0,
      cashPaymentMs: 0,
      paymentConfirmationMs: 0,
      kdsUpdateMs: 0,
      inventoryLookupMs: 0,
      marketplaceWebhookBurstMs: 0,
      paymentCallbackBurstMs: 0,
      availabilityUpdateBurstMs: 0,
      eodAggregateQueryMs: 0,
    };

    metrics.create50PosOrdersMs = await timed(async () => {
      await Promise.all(Array.from({ length: 50 }, (_, index) => insertOrder(database, index)));
    });

    metrics.loadActiveOrdersMs = await timed(async () => {
      const rows = await database
        .prepare(
          `SELECT id,status,total_minor FROM orders
           WHERE tenant_id=? AND branch_id=? AND status IN ('OPEN','KITCHEN')
           ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(tenantId, branchId)
        .all();
      expect(rows.results).toHaveLength(50);
    });

    metrics.cashPaymentMs = await timed(async () => {
      await database.batch([
        database
          .prepare(
            `INSERT INTO payment_transactions
            (tenant_id,id,branch_id,payment_method_id,direction,amount_minor,
             unallocated_amount_minor,currency,status,merchant_reference,correlation_id,
             payload_json,occurred_at,confirmed_at,created_at)
           VALUES (?,?,?,?,'COLLECTION',1000,1000,'KES','CONFIRMED',?,?,'{}',?,?,?)`,
          )
          .bind(
            tenantId,
            "cash-load",
            branchId,
            "payment-cash",
            "cash-merchant-load",
            "cash-correlation-load",
            stamp,
            stamp,
            stamp,
          ),
        database
          .prepare(
            `INSERT INTO cash_movements
            (tenant_id,id,branch_id,drawer_session_id,movement_type,amount_minor,currency,
             idempotency_key,payload_json,created_at)
           VALUES (?,?,?,?,'SALE',1000,'KES',?,'{}',?)`,
          )
          .bind(
            tenantId,
            "cash-movement-load",
            branchId,
            "drawer-load",
            "cash-command-load",
            stamp,
          ),
      ]);
    });

    metrics.paymentConfirmationMs = await timed(async () => {
      await database
        .prepare(
          `INSERT INTO payment_transactions
          (tenant_id,id,branch_id,payment_method_id,provider_connection_id,direction,
           amount_minor,unallocated_amount_minor,currency,status,provider_transaction_id,
           merchant_reference,correlation_id,payload_json,occurred_at,confirmed_at,created_at)
         VALUES (?,?,?,?,?,'COLLECTION',1000,1000,'KES','CONFIRMED',?,?,?,'{}',?,?,?)`,
        )
        .bind(
          tenantId,
          "digital-load",
          branchId,
          "payment-digital",
          connectionId,
          "provider-load-ref",
          "digital-merchant-load",
          "digital-correlation-load",
          stamp,
          stamp,
          stamp,
        )
        .run();
    });

    metrics.kdsUpdateMs = await timed(async () => {
      await database
        .prepare(
          `INSERT INTO order_station_status
          (tenant_id,order_id,station_id,status,version,updated_at,payload_json)
         VALUES (?,?,?,'READY',1,?,'{}')`,
        )
        .bind(tenantId, "order-load-0", "station-load", stamp)
        .run();
    });

    metrics.inventoryLookupMs = await timed(async () => {
      const row = await database
        .prepare(
          `SELECT quantity_minor FROM inventory_balances
         WHERE tenant_id=? AND branch_id=? AND warehouse_id=? AND item_id=?`,
        )
        .bind(tenantId, branchId, "warehouse-load", "item-load")
        .first<{ quantity_minor: number }>();
      expect(row?.quantity_minor).toBe(250000);
    });

    metrics.marketplaceWebhookBurstMs = await timed(() =>
      insertProviderBurst(database, "ORDER", 100),
    );
    metrics.paymentCallbackBurstMs = await timed(() =>
      insertProviderBurst(database, "PAYMENT", 100),
    );

    metrics.availabilityUpdateBurstMs = await timed(async () => {
      await database.batch(
        Array.from({ length: 200 }, (_, index) =>
          database
            .prepare(
              `INSERT INTO authoritative_records
              (tenant_id,entity_type,entity_id,branch_id,status,payload_json,version,created_at,updated_at)
             VALUES (?,'integration:availability',?,?, 'READY',?,1,?,?)`,
            )
            .bind(
              tenantId,
              `availability-${index}`,
              branchId,
              JSON.stringify({ itemId: `item-${index}`, available: index % 7 !== 0 }),
              stamp,
              stamp,
            ),
        ),
      );
    });

    metrics.eodAggregateQueryMs = await timed(async () => {
      const row = await database
        .prepare(
          `SELECT
           (SELECT COUNT(*) FROM orders WHERE tenant_id=? AND branch_id=?) AS orders,
           (SELECT COALESCE(SUM(amount_minor),0) FROM payment_transactions
             WHERE tenant_id=? AND branch_id=? AND status='CONFIRMED') AS collections,
           (SELECT COALESCE(SUM(amount_minor),0) FROM cash_movements
             WHERE tenant_id=? AND branch_id=?) AS cash`,
        )
        .bind(tenantId, branchId, tenantId, branchId, tenantId, branchId)
        .first<{ orders: number; collections: number; cash: number }>();
      expect(row).toEqual({ orders: 50, collections: 2000, cash: 1000 });
    });

    expect(Math.max(...Object.values(metrics))).toBeLessThan(10_000);
    console.info(`PASS5_LOAD_METRICS ${JSON.stringify(metrics)}`);
  });
});

async function seedOperationalReferences(database: SqliteD1TestDatabase) {
  await database
    .prepare(
      `INSERT INTO provider_connections
      (tenant_id,id,branch_id,provider_id,environment,status,payload_json,created_at,updated_at)
     VALUES (?,?,?,'test-provider','SANDBOX','DISABLED','{}',?,?)`,
    )
    .bind(tenantId, connectionId, branchId, stamp, stamp)
    .run();
  await database
    .prepare(
      `INSERT INTO payment_methods
      (tenant_id,id,code,category,active,payload_json)
     VALUES (?,?,'CASH','CASH',1,'{}')`,
    )
    .bind(tenantId, "payment-cash")
    .run();
  await database
    .prepare(
      `INSERT INTO payment_methods
      (tenant_id,id,code,category,provider_connection_id,active,payload_json)
     VALUES (?,?,'DIGITAL','DIGITAL_WALLET',?,1,'{}')`,
    )
    .bind(tenantId, "payment-digital", connectionId)
    .run();
  await database
    .prepare(
      `INSERT INTO stations
      (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
     VALUES (?,?,?,'KITCHEN','Kitchen','KITCHEN',1,'{}')`,
    )
    .bind(tenantId, "station-load", branchId)
    .run();
  await database
    .prepare(
      `INSERT INTO warehouses
      (tenant_id,id,branch_id,code,name,active,payload_json)
     VALUES (?,?,?,'MAIN','Main store',1,'{}')`,
    )
    .bind(tenantId, "warehouse-load", branchId)
    .run();
  await database
    .prepare(
      `INSERT INTO inventory_items
      (tenant_id,id,sku,name,unit,active,payload_json)
     VALUES (?,?,'LOAD-ITEM','Load item','g',1,'{}')`,
    )
    .bind(tenantId, "item-load")
    .run();
  await database
    .prepare(
      `INSERT INTO inventory_balances
      (tenant_id,branch_id,warehouse_id,item_id,quantity_minor,version,updated_at,payload_json)
     VALUES (?,?,?,?,250000,1,?,'{}')`,
    )
    .bind(tenantId, branchId, "warehouse-load", "item-load", stamp)
    .run();
  await database
    .prepare(
      `INSERT INTO cash_drawer_sessions
      (tenant_id,id,branch_id,employee_id,status,opening_float_minor,expected_cash_minor,
       version,payload_json,opened_at)
     VALUES (?,?,?,'user-development-admin','OPEN',5000,5000,1,'{}',?)`,
    )
    .bind(tenantId, "drawer-load", branchId, stamp)
    .run();
}

async function insertOrder(database: SqliteD1TestDatabase, index: number) {
  return database
    .prepare(
      `INSERT INTO orders
      (tenant_id,id,branch_id,display_number,status,business_date,currency,total_minor,
       correlation_id,version,payload_json,created_at,updated_at)
     VALUES (?,?,?,?, 'OPEN','2026-08-30','KES',1000,?,1,'{}',?,?)`,
    )
    .bind(
      tenantId,
      `order-load-${index}`,
      branchId,
      `ORD-LOAD-${String(index + 1).padStart(4, "0")}`,
      `order-correlation-${index}`,
      stamp,
      stamp,
    )
    .run();
}

async function insertProviderBurst(
  database: SqliteD1TestDatabase,
  prefix: "ORDER" | "PAYMENT",
  count: number,
) {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      database
        .prepare(
          `INSERT INTO provider_events
          (tenant_id,id,branch_id,connection_id,provider_id,direction,event_type,
           provider_event_id,correlation_id,idempotency_key,payload_json,payload_hash,
           received_at,status,attempt_count,created_at)
         VALUES (?,?,?,?,?,'INBOUND',?,?,?,?, '{}',?,?, 'RECEIVED',0,?)`,
        )
        .bind(
          tenantId,
          `${prefix.toLowerCase()}-event-${index}`,
          branchId,
          connectionId,
          "test-provider",
          `${prefix}_RECEIVED`,
          `${prefix}-external-${index}`,
          `${prefix}-correlation-${index}`,
          `${prefix}-idempotency-${index}`,
          `${prefix}-hash-${index}`,
          stamp,
          stamp,
        )
        .run(),
    ),
  );
}

async function timed(operation: () => Promise<unknown>) {
  const started = performance.now();
  await operation();
  return Number((performance.now() - started).toFixed(2));
}
