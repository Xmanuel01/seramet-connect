import { describe, expect, it, vi } from "vitest";
import {
  createOscuClient,
  OscuError,
  OSCU_BASE_URLS,
  type OscuClient,
  type OscuSale,
} from "./oscu-client";
import {
  buildOscuSale,
  dashEvery4,
  EtimsMappingError,
  etimsDate,
  etimsItemCode,
  etimsTaxTable,
  paymentTypeCode,
  taxTypeForRate,
  type EtimsSaleInput,
} from "./sale-mapping";
import { createMigratedTestDatabase } from "@/server/database/sqlite-test-adapter";
import type { ServerActor } from "@/lib/seramet-auth";
import {
  EtimsError,
  etimsQrContent,
  fiscalizeReceipt,
  initializeEtimsDevice,
  loadEtimsSettings,
  saveEtimsSettings,
  type FiscalReceiptInput,
} from "@/server/etims/etims-service";

const sale = (overrides: Partial<EtimsSaleInput> = {}): EtimsSaleInput => ({
  invcNo: 1,
  trdInvcNo: "RCP-0386S",
  issuedAt: new Date("2026-11-22T08:36:05.000Z"),
  timeZone: "Africa/Nairobi",
  lines: [
    {
      itemCd: "KE2NTU0000001",
      itemClsCd: "5020230100",
      name: "Mbuzi Stew + Rice",
      quantity: 2,
      unitPrice: 1150,
      taxType: "B",
      pricing: "INCLUSIVE",
    },
    {
      itemCd: "KE2NTU0000002",
      itemClsCd: "5020230100",
      name: "Ugali",
      quantity: 3,
      unitPrice: 150,
      taxType: "B",
      pricing: "INCLUSIVE",
    },
  ],
  discount: 0,
  recordedTotal: 2750,
  paymentMethods: ["MPESA"],
  cashier: { id: "user-1", name: "Emmanuel O." },
  ...overrides,
});

describe("eTIMS sale mapping (OSCU TrnsSalesSaveWrReq)", () => {
  it("reports tax-inclusive amounts with VAT extracted per item", () => {
    const s = buildOscuSale(sale());
    expect(s.itemList[0]).toMatchObject({
      itemSeq: 1,
      prc: 1150,
      qty: 2,
      splyAmt: 2300,
      dcAmt: 0,
      taxTyCd: "B",
      taxblAmt: 2300,
      taxAmt: 317.24, // 2300 x 16 / 116
      totAmt: 2300,
      pkgUnitCd: "NT",
      qtyUnitCd: "U",
    });
    expect(s.taxblAmtB).toBe(2750);
    expect(s.taxAmtB).toBe(379.31);
    expect(s.totAmt).toBe(2750);
    expect(s.totTaxAmt).toBe(379.31);
    expect(s.taxRtB).toBe(16);
    expect(s.taxRtE).toBe(8);
    expect(s).toMatchObject({
      rcptTyCd: "S",
      salesSttsCd: "02",
      pmtTyCd: "06",
      orgInvcNo: 0,
      prchrAcptcYn: "N",
      // 08:36:05 UTC is 11:36:05 in Nairobi.
      cfmDt: "20261122113605",
      salesDt: "20261122",
      totItemCnt: 2,
    });
    expect(s.receipt.rcptPbctDt).toBe("20261122113605");
  });

  it("adds VAT on top for exclusive prices and shares an invoice discount by value", () => {
    const s = buildOscuSale(
      sale({
        lines: sale().lines.map((line) => ({ ...line, pricing: "EXCLUSIVE" as const })),
        // 2750 net + 16% = 3190, less 190 discount = 3000.
        discount: 190,
        recordedTotal: 3000,
      }),
    );
    expect(s.itemList.map((item) => item.splyAmt)).toEqual([2668, 522]);
    expect(s.itemList.reduce((sum, item) => sum + item.dcAmt, 0)).toBeCloseTo(190, 2);
    expect(s.totAmt).toBe(3000);
    expect(s.totTaxAmt).toBeCloseTo(413.79, 2);
  });

  it("refuses a sale that does not add up to the recorded receipt", () => {
    expect(() => buildOscuSale(sale({ recordedTotal: 2850 }))).toThrow(EtimsMappingError);
    expect(() => buildOscuSale(sale({ lines: [] }))).toThrow(/no items/);
    expect(() => buildOscuSale(sale({ discount: 99999 }))).toThrow(/discount/);
  });

  it("maps VAT rule rates to KRA tax types and refuses rates KRA has no type for", () => {
    expect(taxTypeForRate(1600, "D")).toBe("B");
    expect(taxTypeForRate(800, "D")).toBe("E");
    expect(taxTypeForRate(undefined, "A")).toBe("A");
    expect(taxTypeForRate(0, "C")).toBe("C");
    expect(() => taxTypeForRate(1400, "D")).toThrow(/no KRA eTIMS tax type/);
  });

  it("follows the specification's code tables", () => {
    expect(paymentTypeCode(["Cash"])).toBe("01");
    expect(paymentTypeCode(["Card"])).toBe("05");
    expect(paymentTypeCode(["M-Pesa"])).toBe("06");
    expect(paymentTypeCode(["Cash", "Credit account"])).toBe("03");
    expect(paymentTypeCode(["Cash", "M-Pesa"])).toBe("07");
    expect(etimsItemCode("2", 12)).toBe("KE2NTU0000012");
    expect(etimsItemCode("3", 1)).toBe("KE3NTU0000001");
    expect(dashEvery4("ABCDEFGHIJ")).toBe("ABCD-EFGH-IJ");
    expect(etimsDate(new Date("2026-12-31T21:30:00Z"), "Africa/Nairobi")).toEqual({
      dateTime: "20270101003000",
      date: "20270101",
    });
  });

  it("prints every positive rate and zero-rate types only when used", () => {
    const table = etimsTaxTable(buildOscuSale(sale()));
    expect(table.map((row) => row.label)).toEqual(["B-16%", "E-8%"]);
    expect(table[0]).toMatchObject({ taxable: 2750, tax: 379.31 });
  });
});

describe("eTIMS OSCU client", () => {
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ resultCd: "000", resultMsg: "It is succeeded", data }), {
      status: 200,
    });

  it("sends tin, bhfId and cmcKey as headers and body fields to the right server", async () => {
    const fetch = vi.fn(async () =>
      ok({
        curRcptNo: 7,
        totRcptNo: 9,
        intrlData: "INTERNALDATA0001",
        rcptSign: "SIGNATURE0000001",
        sdcDateTime: "20261122113610",
      }),
    );
    const client = createOscuClient({ environment: "SANDBOX", fetch: fetch as never });
    const auth = { tin: "P051234567X", bhfId: "00", cmcKey: "KEY" };
    const signature = await client.saveSale(auth, buildOscuSale(sale()));
    expect(signature).toEqual({
      curRcptNo: 7,
      totRcptNo: 9,
      intrlData: "INTERNALDATA0001",
      rcptSign: "SIGNATURE0000001",
      sdcDateTime: "20261122113610",
    });
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`${OSCU_BASE_URLS.SANDBOX}/saveTrnsSalesOsdc`);
    expect(init.headers).toMatchObject({ tin: "P051234567X", bhfId: "00", cmcKey: "KEY" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ tin: "P051234567X", bhfId: "00", cmcKey: "KEY", invcNo: 1 });
  });

  it("reports KRA result codes and network failures, never treating them as success", async () => {
    const refusing = createOscuClient({
      environment: "PRODUCTION",
      fetch: (async () =>
        new Response(
          JSON.stringify({ resultCd: "910", resultMsg: "Request parameter error" }),
        )) as never,
    });
    const auth = { tin: "P051234567X", bhfId: "00", cmcKey: "KEY" };
    await expect(refusing.saveSale(auth, buildOscuSale(sale()))).rejects.toMatchObject({
      code: "910",
      retryable: false,
    });
    const offline = createOscuClient({
      environment: "SANDBOX",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as never,
    });
    await expect(offline.saveSale(auth, buildOscuSale(sale()))).rejects.toMatchObject({
      code: "894",
      retryable: true,
    });
    const unsigned = createOscuClient({
      environment: "SANDBOX",
      fetch: (async () => ok({})) as never,
    });
    await expect(unsigned.saveSale(auth, buildOscuSale(sale()))).rejects.toThrow(/no signature/);
  });

  it("reads the device activation response", async () => {
    const client = createOscuClient({
      environment: "SANDBOX",
      fetch: (async () =>
        ok({
          info: {
            tin: "P051234567X",
            taxprNm: "MONA SWAHILI LTD",
            bhfId: "00",
            dvcId: "9999911111",
            sdcId: "KRACU0100000001",
            mrcNo: "WIS00000001",
            cmcKey: "COMMUNICATION-KEY",
          },
        })) as never,
    });
    expect(
      await client.initialize({ tin: "P051234567X", bhfId: "00", dvcSrlNo: "SERAMET-01" }),
    ).toEqual({
      cmcKey: "COMMUNICATION-KEY",
      sdcId: "KRACU0100000001",
      mrcNo: "WIS00000001",
      deviceId: "9999911111",
      taxpayerName: "MONA SWAHILI LTD",
    });
  });
});

describe("eTIMS receipt signing (service on the migrated schema)", () => {
  const tenantId = "tenant-etims";
  const branchId = "branch-westlands";
  const actor = {
    id: "manager-1",
    name: "Manuel",
    tenantId,
    branchId,
    permissions: [],
  } as unknown as ServerActor;

  function setup() {
    const db = createMigratedTestDatabase();
    const stamp = "2026-11-01T00:00:00.000Z";
    db.sqlite
      .prepare(
        "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,'Africa/Nairobi','en-KE',1,'{}',?,?)",
      )
      .run(tenantId, "mona", "Mona Swahili Ltd", "Mona Swahili", "KES", stamp, stamp);
    db.sqlite
      .prepare(
        `INSERT INTO tax_service_rules (tenant_id,id,rule_type,code,name,rate_bps,calculation_mode,effective_from,active,updated_by,updated_at)
         VALUES (?,?,'TAX','VAT16','VAT 16%',1600,'INCLUSIVE',?,1,'test',?)`,
      )
      .run(tenantId, "vat16", stamp, stamp);
    for (const [id, name, price] of [
      ["mbuzi", "Mbuzi Stew + Rice", 115000],
      ["ugali", "Ugali", 15000],
    ] as const)
      db.sqlite
        .prepare(
          `INSERT INTO menu_catalog_items (tenant_id,id,code,name,category_code,selling_price_minor,currency,tax_rule_id,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,'MAINS',?,'KES','vat16','{}',?,?)`,
        )
        .run(tenantId, id, id.toUpperCase(), name, price, stamp, stamp);
    const calls: { items: string[]; sales: OscuSale[] } = { items: [], sales: [] };
    let failNext = false;
    const client: OscuClient = {
      environment: "SANDBOX",
      initialize: async () => ({
        cmcKey: "CMC-KEY",
        sdcId: "KRACU0100000001",
        mrcNo: "WIS01",
        taxpayerName: "MONA SWAHILI LTD",
      }),
      saveItem: async (_auth, item) => {
        calls.items.push(`${item.itemCd}:${item.taxTyCd}:${item.itemNm}`);
      },
      saveSale: async (_auth, request) => {
        calls.sales.push(request);
        if (failNext) {
          failNext = false;
          throw new OscuError("894", "Could not reach KRA eTIMS", true);
        }
        return {
          curRcptNo: calls.sales.length,
          totRcptNo: calls.sales.length,
          intrlData: "WLQ2KGAQBUXZYMJ2ZFPUG4WLKI",
          rcptSign: "CVEQAIRCUQEMZ7GP",
          sdcDateTime: "20261122113610",
        };
      },
    };
    const store = new Map<string, string>();
    const deps = {
      client: () => client,
      secrets: {
        resolve: async (reference: string) => ({ value: store.get(reference)! }),
        store: async (reference: string, value: string) => store.set(reference, value),
      },
    };
    return { db, calls, deps, store, failOnce: () => (failNext = true) };
  }

  const receipt = (id: string): FiscalReceiptInput => ({
    receiptId: id,
    receiptNumber: `RCP-${id}`,
    issuedAt: "2026-11-22T08:36:05.000Z",
    timeZone: "Africa/Nairobi",
    lines: [
      { productId: "mbuzi", name: "Mbuzi Stew + Rice", quantity: 2, unitPrice: 1150 },
      { productId: "ugali", name: "Ugali", quantity: 3, unitPrice: 150 },
    ],
    serviceCharge: 0,
    deliveryCharge: 100,
    discount: 0,
    total: 2850,
    paymentMethods: ["MPESA"],
    customerName: "Walk-in Customer",
    cashier: { id: "cashier-1", name: "Emmanuel O." },
  });

  const settings = {
    environment: "SANDBOX" as const,
    tin: "P051234567X",
    bhfId: "00",
    deviceSerial: "SERAMET-WEST-01",
    itemClassCode: "5020230100",
    untaxedTaxType: "D" as const,
    qrFormat: "KRA_LINK" as const,
  };

  it("validates settings and only turns on after KRA activation", async () => {
    const { db, deps, store } = setup();
    await expect(
      saveEtimsSettings(db, actor, branchId, { ...settings, tin: "12345", enabled: false }),
    ).rejects.toThrow(/KRA PIN/);
    await expect(
      saveEtimsSettings(db, actor, branchId, { ...settings, enabled: true }),
    ).rejects.toThrow(/Activate/);
    await saveEtimsSettings(db, actor, branchId, { ...settings, enabled: false });
    // Off: receipts print without eTIMS and nothing is sent.
    expect(await fiscalizeReceipt({}, db, actor, branchId, receipt("1"), deps)).toBeUndefined();
    const active = await initializeEtimsDevice({}, db, actor, branchId, deps);
    expect(active).toMatchObject({ sdcId: "KRACU0100000001", taxpayerName: "MONA SWAHILI LTD" });
    // The key is in the secret store; the database only has its reference.
    expect([...store.values()]).toEqual(["CMC-KEY"]);
    const row = db.sqlite.prepare("SELECT * FROM etims_branch_settings").get() as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(row)).not.toContain("CMC-KEY");
    expect(
      (await saveEtimsSettings(db, actor, branchId, { ...settings, enabled: true }))?.enabled,
    ).toBe(true);
    // Changing the device needs a new activation and switches signing off.
    const moved = await saveEtimsSettings(db, actor, branchId, {
      ...settings,
      deviceSerial: "OTHER",
      enabled: true,
    });
    expect(moved).toMatchObject({ enabled: false });
    expect(moved?.cmcKeyRef).toBeUndefined();
  });

  it("registers items, signs each receipt once and reuses the signature on reprint", async () => {
    const { db, deps, calls } = setup();
    await saveEtimsSettings(db, actor, branchId, { ...settings, enabled: false });
    await initializeEtimsDevice({}, db, actor, branchId, deps);
    await saveEtimsSettings(db, actor, branchId, { ...settings, enabled: true });

    const first = await fiscalizeReceipt({}, db, actor, branchId, receipt("A"), deps);
    expect(calls.items).toEqual([
      "KE2NTU0000001:B:Mbuzi Stew + Rice",
      "KE2NTU0000002:B:Ugali",
      // The delivery charge is a service item at the branch's single VAT rate.
      "KE3NTU0000003:B:Delivery charge",
    ]);
    expect(calls.sales).toHaveLength(1);
    expect(calls.sales[0]).toMatchObject({
      invcNo: 1,
      trdInvcNo: "RCP-A",
      totAmt: 2850,
      totItemCnt: 3,
    });
    expect(calls.sales[0]!.custNm).toBeUndefined();
    expect(first).toMatchObject({
      status: "SIGNED",
      sandbox: true,
      pin: "P051234567X",
      cuSerial: "KRACU0100000001",
      cuInvoiceNumber: "KRACU0100000001/1",
      receiptCounter: "1/1 NS",
      internalData: "WLQ2-KGAQ-BUXZ-YMJ2-ZFPU-G4WL-KI",
      signature: "CVEQ-AIRC-UQEM-Z7GP",
      scuDateTime: "22/11/2026 11:36:10",
      verifyUrl:
        "https://etims-sbx.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567X00CVEQAIRCUQEMZ7GP",
    });
    expect(first!.taxTable[0]).toMatchObject({ label: "B-16%", taxable: 2850, tax: 393.1 });

    // A reprint: same signature, nothing sent to KRA again, no new item registrations.
    expect(await fiscalizeReceipt({}, db, actor, branchId, receipt("A"), deps)).toEqual(first);
    expect(calls.sales).toHaveLength(1);
    expect(calls.items).toHaveLength(3);

    // The next receipt takes the next invoice number.
    await fiscalizeReceipt({}, db, actor, branchId, receipt("B"), deps);
    expect(calls.sales[1]).toMatchObject({ invcNo: 2 });
  });

  it("blocks printing when KRA does not sign, and retries with the same invoice number", async () => {
    const { db, deps, calls, failOnce } = setup();
    await saveEtimsSettings(db, actor, branchId, { ...settings, enabled: false });
    await initializeEtimsDevice({}, db, actor, branchId, deps);
    await saveEtimsSettings(db, actor, branchId, { ...settings, enabled: true });
    failOnce();
    await expect(
      fiscalizeReceipt({}, db, actor, branchId, receipt("C"), deps),
    ).rejects.toBeInstanceOf(EtimsError);
    const failed = db.sqlite.prepare("SELECT status,invc_no,result_cd FROM etims_sales").get();
    expect(failed).toEqual({ status: "FAILED", invc_no: 1, result_cd: "894" });
    const signed = await fiscalizeReceipt({}, db, actor, branchId, receipt("C"), deps);
    expect(signed?.status).toBe("SIGNED");
    expect(calls.sales.map((s) => s.invcNo)).toEqual([1, 1]);
    // A total that does not match the items is never sent.
    await expect(
      fiscalizeReceipt({}, db, actor, branchId, { ...receipt("D"), total: 9999 }, deps),
    ).rejects.toThrow(/not sent to eTIMS/);
    expect(calls.sales).toHaveLength(2);
  });

  it("builds the verification QR in either supported format from the real signature", () => {
    const signature = {
      curRcptNo: 12,
      totRcptNo: 40,
      intrlData: "INTERNAL",
      rcptSign: "SIGN",
      sdcDateTime: "20261122113610",
    };
    expect(etimsQrContent({ ...settings, environment: "PRODUCTION" }, "KRACU01", signature)).toBe(
      "https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567X00SIGN",
    );
    expect(etimsQrContent({ ...settings, qrFormat: "SCU_DATA" }, "KRACU01", signature)).toBe(
      "22112026#113610#KRACU01#12#INTERNAL#SIGN",
    );
  });

  it("keeps settings per branch", async () => {
    const { db } = setup();
    await saveEtimsSettings(db, actor, branchId, { ...settings, enabled: false });
    expect(await loadEtimsSettings(db, tenantId, "another-branch")).toBeUndefined();
  });
});
