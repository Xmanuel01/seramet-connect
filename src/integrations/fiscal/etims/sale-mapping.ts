// Maps a Seramet receipt to KRA's OSCU sales request (TrnsSalesSaveWrReq).
//
// eTIMS amounts are tax-inclusive: each item's taxable amount is what the
// customer pays for it, and its VAT is taxable x rate / (100 + rate). Seramet
// records prices either with VAT inside (INCLUSIVE rules) or VAT added on top
// (EXCLUSIVE rules); both are converted to what the customer paid. A sale whose
// items do not add up to the receipt's recorded total is never sent.

import type { OscuSale, OscuSaleItem } from "./oscu-client";

export type EtimsTaxType = "A" | "B" | "C" | "D" | "E";

/** Rates of KRA's tax types (OSCU specification 4.1). */
export const ETIMS_TAX_RATES: Record<EtimsTaxType, number> = { A: 0, B: 16, C: 0, D: 0, E: 8 };

export const ETIMS_TAX_LABELS: Record<EtimsTaxType, string> = {
  A: "A-Exempt",
  B: "B-16%",
  C: "C-0%",
  D: "D-Non-VAT",
  E: "E-8%",
};

/** The eTIMS tax type for a Seramet VAT rule rate. Rates KRA has no type for are refused. */
export function taxTypeForRate(
  rateBps: number | undefined,
  untaxed: "A" | "C" | "D",
): EtimsTaxType {
  if (rateBps === undefined || rateBps === 0) return untaxed;
  if (rateBps === 1600) return "B";
  if (rateBps === 800) return "E";
  throw new EtimsMappingError(
    `VAT rate ${rateBps / 100}% has no KRA eTIMS tax type (16% is B, 8% is E)`,
  );
}

export class EtimsMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtimsMappingError";
  }
}

export type EtimsSaleLine = {
  itemCd: string;
  itemClsCd: string;
  name: string;
  quantity: number;
  /** Unit price as recorded on the order. */
  unitPrice: number;
  taxType: EtimsTaxType;
  /** How the recorded price relates to VAT. */
  pricing: "INCLUSIVE" | "EXCLUSIVE";
};

export type EtimsSaleInput = {
  invcNo: number;
  /** Seramet's receipt number. */
  trdInvcNo: string;
  issuedAt: Date;
  timeZone: string;
  lines: EtimsSaleLine[];
  /** Invoice-level discount (major units), shared across item lines by value. */
  discount: number;
  /** The total the receipt records; the mapped sale must equal it. */
  recordedTotal: number;
  paymentMethods: string[];
  customerName?: string;
  customerTin?: string;
  cashier: { id: string; name: string };
  tradeName?: string;
  address?: string;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const cents = (value: number) => Math.round(value * 100);
const cut = (value: string | undefined, length: number) =>
  value === undefined ? undefined : value.trim().slice(0, length);

/** yyyyMMddHHmmss and yyyyMMdd in the branch's time zone. */
export function etimsDate(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const day = `${parts.year}${parts.month}${parts.day}`;
  return { dateTime: `${day}${parts.hour}${parts.minute}${parts.second}`, date: day };
}

/** pmtTyCd (specification 4.11) from the receipt's payment methods. */
export function paymentTypeCode(methods: string[]): OscuSale["pmtTyCd"] {
  const codes = new Set(
    methods.map((method) => {
      const value = method.toLowerCase();
      if (/cash/.test(value)) return "01";
      if (/credit|account|invoice/.test(value)) return "02";
      if (/cheque|check/.test(value)) return "04";
      if (/card|visa|mastercard|pdq/.test(value)) return "05";
      if (/m-?pesa|mobile|airtel|t-?kash|money/.test(value)) return "06";
      return "07";
    }),
  );
  if (codes.size === 1) return [...codes][0] as OscuSale["pmtTyCd"];
  if (codes.size === 2 && codes.has("01") && codes.has("02")) return "03";
  return "07";
}

export function buildOscuSale(input: EtimsSaleInput): OscuSale {
  if (!input.lines.length)
    throw new EtimsMappingError("A receipt with no items cannot be sent to eTIMS");
  if (!Number.isInteger(input.invcNo) || input.invcNo < 1)
    throw new EtimsMappingError("eTIMS invoice numbers start at 1");
  // What the customer paid for each line, VAT included.
  const gross = input.lines.map((line) => {
    if (!(line.quantity > 0)) throw new EtimsMappingError(`${line.name} has no quantity`);
    const amount = line.quantity * line.unitPrice;
    const rate = ETIMS_TAX_RATES[line.taxType];
    return round2(line.pricing === "EXCLUSIVE" ? amount * (1 + rate / 100) : amount);
  });
  // The invoice discount shared by line value; the rounding remainder goes to the largest line.
  const totalGross = gross.reduce((sum, value) => sum + value, 0);
  const discountCents = cents(input.discount);
  if (discountCents < 0 || discountCents > cents(totalGross))
    throw new EtimsMappingError("The discount is larger than the items it applies to");
  const shares = gross.map((value) =>
    totalGross > 0 ? Math.floor((cents(value) * discountCents) / cents(totalGross)) : 0,
  );
  const remainder = discountCents - shares.reduce((sum, value) => sum + value, 0);
  const largest = gross.indexOf(Math.max(...gross));
  shares[largest] = (shares[largest] ?? 0) + remainder;

  const items: OscuSaleItem[] = input.lines.map((line, i) => {
    const supply = gross[i]!;
    const dcAmt = shares[i]! / 100;
    const total = round2(supply - dcAmt);
    const rate = ETIMS_TAX_RATES[line.taxType];
    return {
      itemSeq: i + 1,
      itemCd: line.itemCd,
      itemClsCd: line.itemClsCd,
      itemNm: cut(line.name, 200)!,
      pkgUnitCd: "NT",
      pkg: line.quantity,
      qtyUnitCd: "U",
      qty: line.quantity,
      prc: round2(supply / line.quantity),
      splyAmt: supply,
      dcRt: supply > 0 ? round2((dcAmt / supply) * 100) : 0,
      dcAmt,
      taxTyCd: line.taxType,
      taxblAmt: total,
      taxAmt: rate ? round2((total * rate) / (100 + rate)) : 0,
      totAmt: total,
    };
  });

  const totAmt = round2(items.reduce((sum, item) => sum + item.totAmt, 0));
  // Rounding a few lines can move the total by a cent or two, no more.
  if (Math.abs(cents(totAmt) - cents(input.recordedTotal)) > Math.max(2, items.length))
    throw new EtimsMappingError(
      `The items total ${totAmt.toFixed(2)} but the receipt records ${input.recordedTotal.toFixed(2)}; it was not sent to eTIMS`,
    );
  const byType = (type: EtimsTaxType, key: "taxblAmt" | "taxAmt") =>
    round2(items.filter((item) => item.taxTyCd === type).reduce((sum, item) => sum + item[key], 0));
  const { dateTime, date } = etimsDate(input.issuedAt, input.timeZone);
  const cashierId = cut(input.cashier.id, 20) || "SERAMET";
  const cashierName = cut(input.cashier.name, 60) || "Cashier";
  const customer = cut(input.customerName, 60);
  const tin = cut(input.customerTin, 11);
  return {
    trdInvcNo: cut(input.trdInvcNo, 50)!,
    invcNo: input.invcNo,
    orgInvcNo: 0,
    ...(tin ? { custTin: tin } : {}),
    ...(customer ? { custNm: customer } : {}),
    rcptTyCd: "S",
    pmtTyCd: paymentTypeCode(input.paymentMethods),
    salesSttsCd: "02",
    cfmDt: dateTime,
    salesDt: date,
    totItemCnt: items.length,
    taxblAmtA: byType("A", "taxblAmt"),
    taxblAmtB: byType("B", "taxblAmt"),
    taxblAmtC: byType("C", "taxblAmt"),
    taxblAmtD: byType("D", "taxblAmt"),
    taxblAmtE: byType("E", "taxblAmt"),
    taxRtA: ETIMS_TAX_RATES.A,
    taxRtB: ETIMS_TAX_RATES.B,
    taxRtC: ETIMS_TAX_RATES.C,
    taxRtD: ETIMS_TAX_RATES.D,
    taxRtE: ETIMS_TAX_RATES.E,
    taxAmtA: byType("A", "taxAmt"),
    taxAmtB: byType("B", "taxAmt"),
    taxAmtC: byType("C", "taxAmt"),
    taxAmtD: byType("D", "taxAmt"),
    taxAmtE: byType("E", "taxAmt"),
    totTaxblAmt: totAmt,
    totTaxAmt: round2(items.reduce((sum, item) => sum + item.taxAmt, 0)),
    totAmt,
    prchrAcptcYn: "N",
    regrId: cashierId,
    regrNm: cashierName,
    modrId: cashierId,
    modrNm: cashierName,
    receipt: {
      ...(tin ? { custTin: tin } : {}),
      rcptPbctDt: dateTime,
      ...(input.tradeName ? { trdeNm: cut(input.tradeName, 20) } : {}),
      ...(input.address ? { adrs: cut(input.address, 200) } : {}),
      prchrAcptcYn: "N",
    },
    itemList: items,
  };
}

/** The per-rate tax table a receipt prints (TIS specification 6.21-6.22). */
export function etimsTaxTable(sale: OscuSale) {
  return (
    (["A", "B", "C", "D", "E"] as const)
      .map((type) => ({
        type,
        label: ETIMS_TAX_LABELS[type],
        taxable: sale[`taxblAmt${type}`],
        tax: sale[`taxAmt${type}`],
      }))
      // Rates above zero always print; zero-rate types only when something was sold at them.
      .filter((row) => ETIMS_TAX_RATES[row.type] > 0 || row.taxable !== 0)
  );
}

/** "ABCD-EFGH-..." as the TIS specification prints internal data and signatures. */
export function dashEvery4(value: string) {
  return (value.match(/.{1,4}/g) ?? []).join("-");
}

/** eTIMS item code, specification 4.19: KE + item type + packaging + quantity unit + sequence. */
export function etimsItemCode(itemType: "1" | "2" | "3", sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9_999_999)
    throw new EtimsMappingError("eTIMS item sequence out of range");
  return `KE${itemType}NTU${String(sequence).padStart(7, "0")}`;
}
