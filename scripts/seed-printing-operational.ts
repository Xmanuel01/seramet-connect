import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createLocalDevelopmentDatabase } from "../src/server/database/local-development-database";

if (process.env.SERAMET_E2E !== "true" || process.env.CI !== "true")
  throw new Error("Disposable local acceptance only");
const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8"));
if (!/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)) throw new Error("Disposable tenant required");
const db = createLocalDevelopmentDatabase();
try {
  await db
    .prepare(
      "INSERT INTO pos_security_policies(tenant_id,updated_by,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO NOTHING",
    )
    .bind(fixture.tenantId, "system:disposable-acceptance", new Date().toISOString())
    .run();
  const role = await db
    .prepare("SELECT id FROM roles WHERE tenant_id=? AND code='PILOT_MANAGER'")
    .bind(fixture.tenantId)
    .first<{ id: string }>();
  for (const [id, code, name] of [
    ["cash-on-hand", "CASH", "Cash on hand"],
    ["customer-receivable", "RECEIVABLE", "Customer receivable"],
  ]) {
    await db
      .prepare(
        "INSERT INTO accounts(tenant_id,id,code,name,account_type,currency,active,payload_json) VALUES (?,?,?,?,'ASSET','KES',1,'{}')",
      )
      .bind(fixture.tenantId, id, code, name)
      .run();
  }
  await db
    .prepare(
      "UPDATE payment_methods SET receivable_account_id='customer-receivable',settlement_account_id='cash-on-hand' WHERE tenant_id=? AND category='CASH'",
    )
    .bind(fixture.tenantId)
    .run();
  const products = [];
  for (const [code, name, price, stationType] of [
    ["MAIN", "Slow braised kitchen meal with distinguishing extra details", 12345, "KITCHEN"],
    ["GRILL", "Grilled chicken plate", 27890, "KITCHEN"],
    ["BAR", "Fresh passion juice", 8825, "BAR"],
  ] as const) {
    let station = await db
      .prepare("SELECT id FROM stations WHERE tenant_id=? AND branch_id=? AND code=?")
      .bind(fixture.tenantId, fixture.firstBranchId, code)
      .first<{ id: string }>();
    if (!station) {
      station = { id: randomUUID() };
      await db
        .prepare(
          "INSERT INTO stations(tenant_id,id,branch_id,code,name,station_type,active,payload_json) VALUES (?,?,?,?,?,?,1,'{}')",
        )
        .bind(fixture.tenantId, station.id, fixture.firstBranchId, code, code, stationType)
        .run();
    }
    const id = randomUUID(),
      stamp = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO menu_catalog_items(tenant_id,id,code,sku,name,category_code,description,selling_price_minor,currency,station_id,sellable,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,'MAIN_MEALS','Disposable operational acceptance',?,'KES',?,1,1,'{}',?,?)",
      )
      .bind(fixture.tenantId, id, id, id, name, price, station.id, stamp, stamp)
      .run();
    await db
      .prepare(
        "INSERT INTO menu_item_branch_settings(tenant_id,branch_id,menu_item_id,selling_price_minor,available,channel_availability_json,updated_at) VALUES (?,?,?,?,1,'{}',?)",
      )
      .bind(fixture.tenantId, fixture.firstBranchId, id, price, stamp)
      .run();
    products.push({ id, name, station: code, priceMinor: price });
  }
  writeFileSync(
    ".seramet/printing-operational-fixture.json",
    JSON.stringify({ roleId: role!.id, products }),
  );
  console.log("Disposable operational catalog prepared");
} finally {
  db.close();
}
