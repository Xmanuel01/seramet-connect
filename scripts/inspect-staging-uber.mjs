import pg from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { Client } = pg;

export async function inspectStagingUberConnection(db) {
  await db.query("BEGIN READ ONLY");
  try {
    const result = await db.query(
      `SELECT c.id,c.environment,c.status,c.branch_id,c.secret_reference,c.payload_json,
              EXISTS (
                SELECT 1 FROM provider_mappings m
                WHERE m.tenant_id=c.tenant_id AND m.connection_id=c.id
                  AND m.resource_type='STORE' AND m.status='MAPPED'
              ) AS store_mapping_configured
       FROM provider_connections c
       WHERE c.provider_id='provider-delivery-uber-eats'
       ORDER BY c.created_at,c.id`,
    );
    return result.rows.map((row) => {
      const payload = parsePayload(row.payload_json);
      const configuration = asRecord(payload.configuration);
      return {
        connectionId: String(row.id),
        environment: String(row.environment),
        status: String(row.status),
        branchConfigured: Boolean(row.branch_id),
        secretReferenceConfigured: Boolean(row.secret_reference),
        externalStoreConfigured: Boolean(configuration.externalStoreId),
        storeMappingConfigured: Boolean(row.store_mapping_configured),
        callbackUrl: typeof payload.callbackUrl === "string" ? payload.callbackUrl : null,
      };
    });
  } finally {
    await db.query("ROLLBACK");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.env.SERAMET_ENVIRONMENT !== "staging") {
    throw new Error("Refusing Uber inspection without SERAMET_ENVIRONMENT=staging");
  }
  if (!process.env.SERAMET_POSTGRES_URL?.trim()) {
    throw new Error("Staging PostgreSQL connection is required for read-only inspection");
  }
  const db = new Client({ connectionString: process.env.SERAMET_POSTGRES_URL });
  await db.connect();
  try {
    const connections = await inspectStagingUberConnection(db);
    console.log("Non-sensitive Uber staging connection metadata:", JSON.stringify(connections));
  } finally {
    await db.end();
  }
}

function parsePayload(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed = JSON.parse(value);
  return asRecord(parsed);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
