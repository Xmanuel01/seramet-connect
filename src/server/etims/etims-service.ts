// KRA eTIMS for a branch: settings, OSCU activation, item registration and
// signing each receipt before it prints (TIS specification, Article 10: no
// receipt is printed until the OSCU has answered).
//
// Nothing here invents fiscal data. A receipt carries eTIMS details only from
// KRA's signed response, stored per receipt so reprints show the same
// signature without signing the sale again.

import type { D1Database } from "@/server/database/d1";
import type { SerametEnv, ServerActor } from "@/lib/seramet-auth";
import type { ProductionRuntimeEnv } from "@/server/environment";
import { createSecretStore } from "@/server/secrets";
import {
  createOscuClient,
  OscuError,
  type OscuClient,
  type OscuEnvironment,
  type OscuSale,
  type OscuSignature,
} from "@/integrations/fiscal/etims/oscu-client";
import {
  buildOscuSale,
  dashEvery4,
  EtimsMappingError,
  etimsItemCode,
  etimsTaxTable,
  taxTypeForRate,
  type EtimsSaleLine,
  type EtimsTaxType,
} from "@/integrations/fiscal/etims/sale-mapping";

export type EtimsSettings = {
  environment: OscuEnvironment;
  enabled: boolean;
  tin: string;
  bhfId: string;
  deviceSerial: string;
  itemClassCode: string;
  untaxedTaxType: "A" | "C" | "D";
  qrFormat: "KRA_LINK" | "SCU_DATA";
  sdcId?: string;
  mrcNo?: string;
  taxpayerName?: string;
  cmcKeyRef?: string;
  initializedAt?: string;
};

/** What a receipt prints from KRA's signature (TIS specification 6.23). */
export type EtimsReceiptFiscal = {
  status: "SIGNED";
  sandbox: boolean;
  pin: string;
  cuSerial: string;
  cuInvoiceNumber: string;
  receiptCounter: string;
  internalData: string;
  signature: string;
  scuDateTime: string;
  verifyUrl: string;
  taxTable: { label: string; taxable: number; tax: number }[];
};

export class EtimsError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
    this.name = "EtimsError";
  }
}

type SettingsRow = {
  environment: OscuEnvironment;
  enabled: number;
  tin: string;
  bhf_id: string;
  device_serial: string;
  item_class_code: string;
  untaxed_tax_type: "A" | "C" | "D";
  qr_format: "KRA_LINK" | "SCU_DATA";
  sdc_id: string | null;
  mrc_no: string | null;
  taxpayer_name: string | null;
  cmc_key_ref: string | null;
  initialized_at: string | null;
};

export async function loadEtimsSettings(
  db: D1Database,
  tenantId: string,
  branchId: string,
): Promise<EtimsSettings | undefined> {
  const row = await db
    .prepare("SELECT * FROM etims_branch_settings WHERE tenant_id=? AND branch_id=?")
    .bind(tenantId, branchId)
    .first<SettingsRow>();
  if (!row) return undefined;
  return {
    environment: row.environment,
    enabled: row.enabled === 1,
    tin: row.tin,
    bhfId: row.bhf_id,
    deviceSerial: row.device_serial,
    itemClassCode: row.item_class_code,
    untaxedTaxType: row.untaxed_tax_type,
    qrFormat: row.qr_format,
    ...(row.sdc_id ? { sdcId: row.sdc_id } : {}),
    ...(row.mrc_no ? { mrcNo: row.mrc_no } : {}),
    ...(row.taxpayer_name ? { taxpayerName: row.taxpayer_name } : {}),
    ...(row.cmc_key_ref ? { cmcKeyRef: row.cmc_key_ref } : {}),
    ...(row.initialized_at ? { initializedAt: row.initialized_at } : {}),
  };
}

export type EtimsSettingsInput = {
  environment: OscuEnvironment;
  tin: string;
  bhfId: string;
  deviceSerial: string;
  itemClassCode: string;
  untaxedTaxType: "A" | "C" | "D";
  qrFormat: "KRA_LINK" | "SCU_DATA";
  enabled: boolean;
};

/** KRA PINs: a letter, nine digits, a letter (e.g. P051234567X). */
export function validateEtimsSettings(input: EtimsSettingsInput) {
  if (!/^[A-Z]\d{9}[A-Z]$/.test(input.tin))
    throw new EtimsError("Enter the KRA PIN, e.g. P051234567X", 400);
  if (!/^\d{2}$/.test(input.bhfId))
    throw new EtimsError("The branch ID is two digits, e.g. 00", 400);
  if (!input.deviceSerial.trim() || input.deviceSerial.length > 100)
    throw new EtimsError("Enter the device serial number KRA approved", 400);
  if (!/^\d{1,10}$/.test(input.itemClassCode))
    throw new EtimsError("Enter the KRA item classification code for your items", 400);
}

export async function saveEtimsSettings(
  db: D1Database,
  actor: ServerActor,
  branchId: string,
  input: EtimsSettingsInput,
) {
  validateEtimsSettings(input);
  const current = await loadEtimsSettings(db, actor.tenantId, branchId);
  if (input.enabled && !current?.cmcKeyRef)
    throw new EtimsError("Activate the OSCU with KRA before turning eTIMS on", 400);
  // A different PIN, branch, device or server is a different OSCU: activate again.
  const sameDevice =
    current &&
    current.tin === input.tin &&
    current.bhfId === input.bhfId &&
    current.deviceSerial === input.deviceSerial.trim() &&
    current.environment === input.environment;
  await db
    .prepare(
      `INSERT INTO etims_branch_settings
        (tenant_id,branch_id,environment,enabled,tin,bhf_id,device_serial,item_class_code,
         untaxed_tax_type,qr_format,updated_by,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tenant_id,branch_id) DO UPDATE SET
         environment=excluded.environment, enabled=excluded.enabled, tin=excluded.tin,
         bhf_id=excluded.bhf_id, device_serial=excluded.device_serial,
         item_class_code=excluded.item_class_code, untaxed_tax_type=excluded.untaxed_tax_type,
         qr_format=excluded.qr_format, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    )
    .bind(
      actor.tenantId,
      branchId,
      input.environment,
      sameDevice && input.enabled ? 1 : 0,
      input.tin,
      input.bhfId,
      input.deviceSerial.trim(),
      input.itemClassCode,
      input.untaxedTaxType,
      input.qrFormat,
      actor.id,
      new Date().toISOString(),
    )
    .run();
  if (!sameDevice && current?.cmcKeyRef)
    await db
      .prepare(
        `UPDATE etims_branch_settings SET sdc_id=NULL,mrc_no=NULL,cmc_key_ref=NULL,initialized_at=NULL
         WHERE tenant_id=? AND branch_id=?`,
      )
      .bind(actor.tenantId, branchId)
      .run();
  return loadEtimsSettings(db, actor.tenantId, branchId);
}

export type EtimsDependencies = {
  client?: (environment: OscuEnvironment) => OscuClient;
  secrets?: {
    resolve(reference: string): Promise<{ value: string }>;
    store?(reference: string, value: string): Promise<unknown>;
  };
  now?: () => Date;
};

function clientFor(deps: EtimsDependencies, environment: OscuEnvironment) {
  return deps.client ? deps.client(environment) : createOscuClient({ environment });
}

function secretsFor(env: SerametEnv, deps: EtimsDependencies) {
  return deps.secrets ?? createSecretStore(env as ProductionRuntimeEnv);
}

/** /selectInitOsdcInfo: activates the branch's OSCU and keeps its communication key. */
export async function initializeEtimsDevice(
  env: SerametEnv,
  db: D1Database,
  actor: ServerActor,
  branchId: string,
  deps: EtimsDependencies = {},
) {
  const settings = await loadEtimsSettings(db, actor.tenantId, branchId);
  if (!settings) throw new EtimsError("Save the eTIMS settings first", 400);
  const secrets = secretsFor(env, deps);
  if (!secrets.store)
    throw new EtimsError(
      "The server secret store cannot keep the eTIMS key; configure managed secrets",
      503,
    );
  let device;
  try {
    device = await clientFor(deps, settings.environment).initialize({
      tin: settings.tin,
      bhfId: settings.bhfId,
      dvcSrlNo: settings.deviceSerial,
    });
  } catch (error) {
    throw new EtimsError(
      error instanceof OscuError && error.code === "902"
        ? "KRA says this device is already activated. Its key cannot be fetched again; ask KRA to reset the device or use the key from the first activation."
        : error instanceof Error
          ? error.message
          : "KRA eTIMS activation failed",
    );
  }
  const reference = `etims-cmc-key/${actor.tenantId}/${branchId}/${settings.environment}`;
  await secrets.store(reference, device.cmcKey);
  await db
    .prepare(
      `UPDATE etims_branch_settings SET sdc_id=?,mrc_no=?,taxpayer_name=?,cmc_key_ref=?,initialized_at=?,
         updated_by=?,updated_at=? WHERE tenant_id=? AND branch_id=?`,
    )
    .bind(
      device.sdcId,
      device.mrcNo ?? null,
      device.taxpayerName ?? null,
      reference,
      (deps.now?.() ?? new Date()).toISOString(),
      actor.id,
      (deps.now?.() ?? new Date()).toISOString(),
      actor.tenantId,
      branchId,
    )
    .run();
  return loadEtimsSettings(db, actor.tenantId, branchId);
}

// ---------------------------------------------------------------------------
// Signing a receipt

export type FiscalReceiptLine = {
  /** Menu item id when known; the name otherwise. */
  productId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type FiscalReceiptInput = {
  receiptId: string;
  receiptNumber: string;
  issuedAt: string;
  timeZone: string;
  lines: FiscalReceiptLine[];
  serviceCharge: number;
  deliveryCharge: number;
  discount: number;
  total: number;
  paymentMethods: string[];
  customerName?: string;
  cashier: { id: string; name: string };
  tradeName?: string;
  address?: string;
};

type TaxRule = { rateBps: number; mode: "INCLUSIVE" | "EXCLUSIVE" };

async function itemTaxRules(db: D1Database, tenantId: string, productIds: string[]) {
  const rules = new Map<string, TaxRule | undefined>();
  if (!productIds.length) return rules;
  const rows = await db
    .prepare(
      `SELECT m.id, r.rate_bps, r.calculation_mode
       FROM menu_catalog_items m
       LEFT JOIN tax_service_rules r ON r.tenant_id=m.tenant_id AND r.id=m.tax_rule_id
         AND r.rule_type='TAX' AND r.active=1
       WHERE m.tenant_id=? AND m.id IN (${productIds.map(() => "?").join(",")})`,
    )
    .bind(tenantId, ...productIds)
    .all<{
      id: string;
      rate_bps: number | null;
      calculation_mode: "INCLUSIVE" | "EXCLUSIVE" | null;
    }>();
  for (const row of rows.results ?? [])
    rules.set(
      row.id,
      row.rate_bps === null || row.rate_bps === undefined
        ? undefined
        : { rateBps: Number(row.rate_bps), mode: row.calculation_mode ?? "INCLUSIVE" },
    );
  return rules;
}

async function branchVatRates(db: D1Database, tenantId: string, branchId: string) {
  const now = new Date().toISOString();
  const rows = await db
    .prepare(
      `SELECT DISTINCT rate_bps FROM tax_service_rules
       WHERE tenant_id=? AND rule_type='TAX' AND active=1 AND (branch_id=? OR branch_id IS NULL)
         AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`,
    )
    .bind(tenantId, branchId, now, now)
    .all<{ rate_bps: number }>();
  return (rows.results ?? []).map((row) => Number(row.rate_bps)).filter((rate) => rate > 0);
}

/** The eTIMS item code for an item, registering it with KRA (/saveItem) first when needed. */
async function ensureItem(
  db: D1Database,
  client: OscuClient,
  auth: { tin: string; bhfId: string; cmcKey: string },
  actor: ServerActor,
  branchId: string,
  settings: EtimsSettings,
  item: { key: string; name: string; type: "2" | "3"; taxType: EtimsTaxType; price: number },
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO etims_items (tenant_id,branch_id,item_key,item_cd,item_seq,item_name,tax_type,item_type,created_at)
       SELECT ?,?,?,'PENDING-'||?,COALESCE(MAX(item_seq),0)+1,?,?,?,?
       FROM etims_items WHERE tenant_id=? AND branch_id=?
       ON CONFLICT(tenant_id,branch_id,item_key) DO NOTHING`,
    )
    .bind(
      actor.tenantId,
      branchId,
      item.key,
      item.key,
      item.name,
      item.taxType,
      item.type,
      now,
      actor.tenantId,
      branchId,
    )
    .run();
  const row = await db
    .prepare(
      "SELECT item_cd,item_seq,tax_type,item_type,registered_at FROM etims_items WHERE tenant_id=? AND branch_id=? AND item_key=?",
    )
    .bind(actor.tenantId, branchId, item.key)
    .first<{
      item_cd: string;
      item_seq: number;
      tax_type: string;
      item_type: string;
      registered_at: string | null;
    }>();
  if (!row) throw new EtimsError("Could not allocate an eTIMS item code");
  const code = etimsItemCode(row.item_type as "2" | "3", Number(row.item_seq));
  if (row.registered_at && row.tax_type === item.taxType && row.item_cd === code) return code;
  await client.saveItem(auth, {
    itemCd: code,
    itemClsCd: settings.itemClassCode,
    itemTyCd: row.item_type as "2" | "3",
    itemNm: item.name.slice(0, 200),
    orgnNatCd: "KE",
    pkgUnitCd: "NT",
    qtyUnitCd: "U",
    taxTyCd: item.taxType,
    dftPrc: Math.round(item.price * 100) / 100,
    isrcAplcbYn: "N",
    useYn: "Y",
    regrId: actor.id.slice(0, 20),
    regrNm: actor.name.slice(0, 60),
    modrId: actor.id.slice(0, 20),
    modrNm: actor.name.slice(0, 60),
  });
  await db
    .prepare(
      "UPDATE etims_items SET item_cd=?,tax_type=?,item_name=?,registered_at=? WHERE tenant_id=? AND branch_id=? AND item_key=?",
    )
    .bind(code, item.taxType, item.name, now, actor.tenantId, branchId, item.key)
    .run();
  return code;
}

type SaleRow = {
  invc_no: number;
  status: "PENDING" | "SIGNED" | "FAILED";
  request_json: string;
  result_cd: string | null;
  cur_rcpt_no: number | null;
  tot_rcpt_no: number | null;
  intrl_data: string | null;
  rcpt_sign: string | null;
  sdc_date_time: string | null;
  sdc_id: string | null;
};

/** "yyyyMMddHHmmss" from the SCU as "dd/mm/yyyy hh:mm:ss". */
function scuDisplay(value: string) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : value;
}

/** The QR content: KRA's receipt verification link, or the TIS 6.23.8 data string. */
export function etimsQrContent(
  settings: Pick<EtimsSettings, "environment" | "qrFormat" | "tin" | "bhfId">,
  sdcId: string,
  signature: OscuSignature,
) {
  if (settings.qrFormat === "SCU_DATA") {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(signature.sdcDateTime);
    const date = m ? `${m[3]}${m[2]}${m[1]}` : signature.sdcDateTime.slice(0, 8);
    const time = m ? `${m[4]}${m[5]}${m[6]}` : signature.sdcDateTime.slice(8, 14);
    return `${date}#${time}#${sdcId}#${signature.curRcptNo}#${signature.intrlData}#${signature.rcptSign}`;
  }
  const host = settings.environment === "SANDBOX" ? "etims-sbx.kra.go.ke" : "etims.kra.go.ke";
  return `https://${host}/common/link/etims/receipt/indexEtimsReceiptData?Data=${settings.tin}${settings.bhfId}${signature.rcptSign}`;
}

function fiscalFrom(settings: EtimsSettings, row: SaleRow): EtimsReceiptFiscal {
  const sale = JSON.parse(row.request_json) as OscuSale;
  const signature: OscuSignature = {
    curRcptNo: Number(row.cur_rcpt_no),
    totRcptNo: Number(row.tot_rcpt_no),
    intrlData: row.intrl_data!,
    rcptSign: row.rcpt_sign!,
    sdcDateTime: row.sdc_date_time!,
  };
  const sdcId = row.sdc_id ?? settings.sdcId ?? "";
  return {
    status: "SIGNED",
    sandbox: settings.environment === "SANDBOX",
    pin: settings.tin,
    cuSerial: sdcId,
    cuInvoiceNumber: `${sdcId}/${signature.curRcptNo}`,
    receiptCounter: `${signature.curRcptNo}/${signature.totRcptNo} NS`,
    internalData: dashEvery4(signature.intrlData),
    signature: dashEvery4(signature.rcptSign),
    scuDateTime: scuDisplay(signature.sdcDateTime),
    verifyUrl: etimsQrContent(settings, sdcId, signature),
    taxTable: etimsTaxTable(sale).map(({ label, taxable, tax }) => ({ label, taxable, tax })),
  };
}

/**
 * KRA's signature for a receipt: from the stored record when it was already
 * signed, otherwise by sending the sale now. Undefined when eTIMS is off for
 * the branch. Throws when KRA does not sign; the receipt must then not print.
 */
export async function fiscalizeReceipt(
  env: SerametEnv,
  db: D1Database,
  actor: ServerActor,
  branchId: string,
  input: FiscalReceiptInput,
  deps: EtimsDependencies = {},
): Promise<EtimsReceiptFiscal | undefined> {
  const settings = await loadEtimsSettings(db, actor.tenantId, branchId);
  if (!settings?.enabled) return undefined;
  if (!settings.cmcKeyRef || !settings.sdcId)
    throw new EtimsError("eTIMS is on but the OSCU is not activated for this branch");
  const existing = await db
    .prepare("SELECT * FROM etims_sales WHERE tenant_id=? AND branch_id=? AND receipt_id=?")
    .bind(actor.tenantId, branchId, input.receiptId)
    .first<SaleRow>();
  if (existing?.status === "SIGNED") return fiscalFrom(settings, existing);
  if (existing?.result_cd === "994")
    throw new EtimsError(
      "KRA already holds this receipt's sale but Seramet has no signature for it. Reconcile it on the eTIMS portal before printing.",
    );

  const cmcKey = (await secretsFor(env, deps).resolve(settings.cmcKeyRef)).value;
  const auth = { tin: settings.tin, bhfId: settings.bhfId, cmcKey };
  const client = clientFor(deps, settings.environment);
  let sale: OscuSale;
  try {
    // Tax type of every item from its VAT rule; charges follow the branch's single VAT rate.
    const ids = [
      ...new Set(input.lines.map((l) => l.productId).filter((id): id is string => !!id)),
    ];
    const rules = await itemTaxRules(db, actor.tenantId, ids);
    const rates = await branchVatRates(db, actor.tenantId, branchId);
    const chargeType = taxTypeForRate(
      rates.length === 1 ? rates[0] : undefined,
      settings.untaxedTaxType,
    );
    const lines: EtimsSaleLine[] = [];
    for (const line of input.lines) {
      const rule = line.productId ? rules.get(line.productId) : undefined;
      const taxType = taxTypeForRate(rule?.rateBps, settings.untaxedTaxType);
      const itemCd = await ensureItem(db, client, auth, actor, branchId, settings, {
        key: line.productId ? `item:${line.productId}` : `name:${line.name.toLowerCase()}`,
        name: line.name,
        type: "2",
        taxType,
        price: line.unitPrice,
      });
      lines.push({
        itemCd,
        itemClsCd: settings.itemClassCode,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxType,
        pricing: rule?.mode ?? "INCLUSIVE",
      });
    }
    for (const [key, name, amount] of [
      ["charge:service", "Service charge", input.serviceCharge],
      ["charge:delivery", "Delivery charge", input.deliveryCharge],
    ] as const) {
      if (!(amount > 0)) continue;
      const itemCd = await ensureItem(db, client, auth, actor, branchId, settings, {
        key,
        name,
        type: "3",
        taxType: chargeType,
        price: amount,
      });
      lines.push({
        itemCd,
        itemClsCd: settings.itemClassCode,
        name,
        quantity: 1,
        unitPrice: amount,
        taxType: chargeType,
        pricing: "INCLUSIVE",
      });
    }
    // The branch's next invoice number, kept for this receipt across retries.
    await db
      .prepare(
        `INSERT INTO etims_sales (tenant_id,branch_id,receipt_id,invc_no,status,request_json,created_at)
         SELECT ?,?,?,COALESCE(MAX(invc_no),0)+1,'PENDING','{}',?
         FROM etims_sales WHERE tenant_id=? AND branch_id=?
         ON CONFLICT(tenant_id,branch_id,receipt_id) DO NOTHING`,
      )
      .bind(
        actor.tenantId,
        branchId,
        input.receiptId,
        new Date().toISOString(),
        actor.tenantId,
        branchId,
      )
      .run();
    const reserved = await db
      .prepare("SELECT invc_no FROM etims_sales WHERE tenant_id=? AND branch_id=? AND receipt_id=?")
      .bind(actor.tenantId, branchId, input.receiptId)
      .first<{ invc_no: number }>();
    sale = buildOscuSale({
      invcNo: Number(reserved!.invc_no),
      trdInvcNo: input.receiptNumber,
      issuedAt: new Date(input.issuedAt),
      timeZone: input.timeZone,
      lines,
      discount: input.discount,
      recordedTotal: input.total,
      paymentMethods: input.paymentMethods,
      ...(input.customerName && !/^walk[\s-]?in/i.test(input.customerName)
        ? { customerName: input.customerName }
        : {}),
      cashier: input.cashier,
      ...(input.tradeName ? { tradeName: input.tradeName } : {}),
      ...(input.address ? { address: input.address } : {}),
    });
  } catch (error) {
    if (error instanceof EtimsMappingError || error instanceof EtimsError)
      throw new EtimsError(error.message, error instanceof EtimsError ? error.status : 422);
    if (error instanceof OscuError) throw new EtimsError(error.message);
    throw error;
  }

  await db
    .prepare(
      "UPDATE etims_sales SET request_json=?,attempts=attempts+1 WHERE tenant_id=? AND branch_id=? AND receipt_id=?",
    )
    .bind(JSON.stringify(sale), actor.tenantId, branchId, input.receiptId)
    .run();
  let signature: OscuSignature;
  try {
    signature = await client.saveSale(auth, sale);
  } catch (error) {
    const code = error instanceof OscuError ? error.code : "999";
    const message = error instanceof Error ? error.message : "KRA eTIMS did not sign the receipt";
    await db
      .prepare(
        "UPDATE etims_sales SET status='FAILED',result_cd=?,result_msg=? WHERE tenant_id=? AND branch_id=? AND receipt_id=?",
      )
      .bind(code, message, actor.tenantId, branchId, input.receiptId)
      .run();
    throw new EtimsError(`${message}. The receipt was not printed; try again.`);
  }
  await db
    .prepare(
      `UPDATE etims_sales SET status='SIGNED',result_cd='000',result_msg=NULL,cur_rcpt_no=?,tot_rcpt_no=?,
         intrl_data=?,rcpt_sign=?,sdc_date_time=?,sdc_id=?,mrc_no=?,signed_at=?
       WHERE tenant_id=? AND branch_id=? AND receipt_id=?`,
    )
    .bind(
      signature.curRcptNo,
      signature.totRcptNo,
      signature.intrlData,
      signature.rcptSign,
      signature.sdcDateTime,
      settings.sdcId,
      settings.mrcNo ?? null,
      new Date().toISOString(),
      actor.tenantId,
      branchId,
      input.receiptId,
    )
    .run();
  const signed = await db
    .prepare("SELECT * FROM etims_sales WHERE tenant_id=? AND branch_id=? AND receipt_id=?")
    .bind(actor.tenantId, branchId, input.receiptId)
    .first<SaleRow>();
  return fiscalFrom(settings, signed!);
}
