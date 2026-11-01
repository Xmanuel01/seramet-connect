import {
  box,
  centered,
  clean,
  columnsFor,
  fields,
  fromCents,
  money,
  quantity,
  sum,
  table,
  times,
  toCents,
  type Cell,
  type Column,
} from "./ruled";
import type {
  BusinessIdentity,
  EtimsStatus,
  MobileMoneyDetails,
  Payment,
  PrintContext,
  QrCode,
  SaleLine,
  TaxSettings,
} from "./types";

export function widthOf(ctx: PrintContext) {
  return columnsFor(ctx.paper);
}

export function currency(ctx: PrintContext) {
  return clean(ctx.currency ?? "KES") || "KES";
}

/** Centered business block for customer-facing documents. */
export function businessHeader(
  business: BusinessIdentity,
  width: number,
  withPin = true,
): string[] {
  const parts = [
    business.phone && `Tel ${business.phone}`,
    withPin && business.taxPin && `PIN ${business.taxPin}`,
  ].filter((part): part is string => Boolean(part));
  const joined = parts.join(" / ");
  const contact =
    joined.length <= width
      ? centered(joined, width)
      : parts.flatMap((part) => centered(part, width));
  return [
    ...centered(business.name, width),
    ...centered([business.branch, business.address].filter(Boolean).join(", "), width),
    ...contact,
    ...centered(business.email, width),
  ];
}

/**
 * Centered document title. No rules around it: every rule on the page belongs
 * to a table, so nothing prints as a bare edge-to-edge line. Titles
 * printing-core already treats as strong (BILL, RECEIPT, TAX INVOICE) print
 * bold on raster printers.
 */
export function titleBar(title: string, width: number, subtitle?: string): string[] {
  return [...centered(title, width), ...centered(subtitle, width)];
}

export function copyLine(ctx: PrintContext, width: number): string[] {
  if (!ctx.copy) return [];
  const by = ctx.copy.by ? ` by ${ctx.copy.by}` : "";
  return centered(`REPRINT #${ctx.copy.number} ${ctx.copy.at}${by}`, width);
}

/** "Amounts in KES" on A4 only; thermal paper skips the line. */
export function currencyNote(width: number, ctx: PrintContext): string[] {
  return width >= 70 ? centered(`Amounts in ${currency(ctx)}`, width) : [];
}

export function footer(width: number, ...messages: Array<string | undefined>): string[] {
  return messages.filter(Boolean).flatMap((message) => centered(message, width));
}

// ---------------------------------------------------------------------------
// Sales lines and tax

export function lineAmount(line: SaleLine) {
  return times(line.quantity, line.unitPrice);
}

export function lineDetails(line: SaleLine, upper = false): string[] {
  const text = (value: string) => (upper ? value.toUpperCase() : value);
  return [
    ...(line.modifiers ?? []).map((modifier) => `- ${text(modifier)}`),
    ...(line.note ? [`Note: ${text(line.note)}`] : []),
  ];
}

/** Column widths shared by item tables and the totals under them, so their rules line up. */
export function saleColumns(width: number) {
  const amount = width >= 70 ? 12 : width >= 40 ? 11 : 10;
  const qty = width >= 40 ? 4 : 3;
  return { amount, qty, totals: amount + qty + 1 };
}

/**
 * Item | Qty | Amount, with modifiers inside the item cell. The unit price is
 * shown only when it differs from the amount (quantity above one).
 */
export function saleItemsTable(width: number, lines: SaleLine[]) {
  const { amount, qty } = saleColumns(width);
  const columns: Column[] = [
    { min: 10 },
    { width: qty, align: "right" },
    { width: amount, align: "right" },
  ];
  const itemWidth = width - 4 - qty - amount;
  const describe = (line: SaleLine) => {
    if (line.quantity === 1) return [line.name];
    const price = `@ ${money(line.unitPrice)}`;
    // Keep the price on the name's line when it fits; otherwise give it its own line.
    return clean(line.name).length + 1 + price.length <= itemWidth
      ? [`${line.name} ${price}`]
      : [line.name, price];
  };
  return table(
    width,
    columns,
    lines.map((line) => [
      [...describe(line), ...lineDetails(line)],
      quantity(line.quantity),
      money(lineAmount(line)),
    ]),
    { header: ["Item", "Qty", "Amount"] },
  );
}

export interface SaleTotals {
  subtotal: number;
  serviceCharge: number;
  discount: number;
  /** VAT-exclusive base, when the business is VAT registered or has levies. */
  net?: number;
  vat?: number;
  vatRate?: number;
  levies: Array<{ label: string; amount: number }>;
  total: number;
}

export function computeSaleTotals(
  lines: SaleLine[],
  tax: TaxSettings,
  extras: { serviceCharge?: number; discount?: number } = {},
): SaleTotals {
  const subtotal = sum(lines.map(lineAmount));
  const serviceCharge = extras.serviceCharge ?? 0;
  const discount = extras.discount ?? 0;
  const charged = toCents(subtotal) + toCents(serviceCharge) - toCents(discount);
  const vatRate = tax.vatRegistered ? (tax.vatRate ?? 16) : 0;
  const levyRates = tax.levies ?? [];
  if (vatRate === 0 && levyRates.length === 0)
    return { subtotal, serviceCharge, discount, levies: [], total: fromCents(charged) };

  const base = { subtotal, serviceCharge, discount };
  const vatFields = (vatCents: number) => ({
    vat: tax.vatRegistered ? fromCents(vatCents) : undefined,
    vatRate: tax.vatRegistered ? vatRate : undefined,
  });
  const levySum = levyRates.reduce((total, levy) => total + levy.ratePercent, 0);

  if (tax.pricesIncludeVat !== false) {
    // Menu prices already include tax: split VAT and levies out of the total.
    const divisor = 100 + vatRate + levySum;
    const vat = Math.round((charged * vatRate) / divisor);
    const levies = levyRates.map((levy) => ({
      label: levy.label,
      cents: Math.round((charged * levy.ratePercent) / divisor),
    }));
    const net = charged - vat - levies.reduce((total, levy) => total + levy.cents, 0);
    return {
      ...base,
      net: fromCents(net),
      ...vatFields(vat),
      levies: levies.map((levy) => ({ label: levy.label, amount: fromCents(levy.cents) })),
      total: fromCents(charged),
    };
  }

  // Prices exclude tax: charge VAT and levies on top.
  const vat = Math.round((charged * vatRate) / 100);
  const levies = levyRates.map((levy) => ({
    label: levy.label,
    cents: Math.round((charged * levy.ratePercent) / 100),
  }));
  return {
    ...base,
    net: fromCents(charged),
    ...vatFields(vat),
    levies: levies.map((levy) => ({ label: levy.label, amount: fromCents(levy.cents) })),
    total: fromCents(charged + vat + levies.reduce((total, levy) => total + levy.cents, 0)),
  };
}

export type AmountRow = [label: string, amount: string] | false | undefined;

/** Label | amount table. A row labelled exactly "TOTAL" prints bold on raster printers. */
export function amountsTable(
  width: number,
  rows: AmountRow[],
  doubleEnd = true,
  amount = saleColumns(width).totals,
) {
  const body = rows.filter((row): row is [string, string] => Boolean(row));
  return table(
    width,
    [{ min: 8 }, { width: amount, align: "right" }],
    body.map(([label, value]) => ({ cells: [label, value], ruleBefore: label === "TOTAL" })),
    { doubleEnd },
  );
}

export function levyRows(totals: SaleTotals): AmountRow[] {
  return totals.levies.map((levy): AmountRow => [levy.label, money(levy.amount)]);
}

export function saleTotalsTable(width: number, totals: SaleTotals, ctx: PrintContext) {
  const extras = totals.serviceCharge !== 0 || totals.discount !== 0;
  // Tax added on top of the subtotal needs the subtotal shown to add up.
  const taxOnTop = totals.vat !== undefined && totals.net === undefined;
  const vatLabel = totals.vatRate !== undefined ? `VAT ${totals.vatRate}%` : "VAT";
  return [
    ...amountsTable(width, [
      (extras || taxOnTop) && ["Subtotal", money(totals.subtotal)],
      totals.serviceCharge !== 0 && ["Service charge", money(totals.serviceCharge)],
      totals.discount !== 0 && ["Discount", `(${money(totals.discount)})`],
      totals.net !== undefined && ["Net (excl. VAT)", money(totals.net)],
      totals.vat !== undefined && [vatLabel, money(totals.vat)],
      ...levyRows(totals),
      ["TOTAL", money(totals.total)],
    ]),
    ...currencyNote(width, ctx),
  ];
}

export function paymentsTable(width: number, payments: Payment[], change?: number) {
  const amount = width >= 40 ? 12 : 10;
  const method = width >= 40 ? 12 : 8;
  const rows: Array<{ cells: Cell[] }> = payments.map((payment) => ({
    cells: [payment.method, payment.reference ?? "", money(payment.amount)],
  }));
  if (change !== undefined && change !== 0) rows.push({ cells: ["Change", "", money(change)] });
  return table(width, [{ width: method }, { min: 6 }, { width: amount, align: "right" }], rows, {
    header: ["Paid by", "Ref", "Amount"],
  });
}

/** Manual payment details plus a QR when the restaurant generates dynamic QRs. */
export function mobileMoneyBlock(
  width: number,
  details: MobileMoneyDetails | undefined,
  amount: number,
  qrCodes: QrCode[],
): string[] {
  if (!details || (!details.till && !details.paybill)) return [];
  if (details.qrPayload)
    qrCodes.push({
      payload: details.qrPayload,
      caption: "Scan to pay with M-Pesa",
      purpose: "PAYMENT",
    });
  const heading = details.qrPayload
    ? "PAY WITH M-PESA - scan the QR below or pay manually"
    : "PAY WITH M-PESA";
  return [
    ...box(width, [heading]),
    ...fields(width, [
      ["Till", details.till],
      ["Paybill", details.paybill],
      ["Account", details.account],
      ["Amount", money(amount)],
    ]),
  ];
}

/** eTIMS details. Returns nothing when eTIMS is off for the restaurant. */
export function etimsBlock(
  width: number,
  etims: EtimsStatus | undefined,
  qrCodes: QrCode[],
  label = "CU Inv No",
): string[] {
  if (!etims) return [];
  if (etims.status === "PENDING") {
    const queued = etims.queuedAt ? ` (queued ${etims.queuedAt})` : "";
    return box(width, [
      "eTIMS PENDING",
      `Not yet signed by KRA${queued}. It will be sent automatically.`,
    ]);
  }
  if (etims.verifyUrl)
    qrCodes.push({
      payload: etims.verifyUrl,
      caption: "Scan to verify on KRA eTIMS",
      purpose: "ETIMS_VERIFY",
    });
  return fields(width, [
    ["KRA eTIMS", etims.verifyUrl ? "Scan the QR below to verify" : "Signed"],
    ["CU Serial", etims.cuSerial],
    [label, etims.cuInvoiceNumber],
    ["Linked CU Inv", etims.relatedCuInvoiceNumber],
  ]);
}

export function itemCount(lines: Array<{ quantity: number }>) {
  const items = lines.reduce((total, line) => total + line.quantity, 0);
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${plural(Number(quantity(items)), "item")} / ${plural(lines.length, "line")}`;
}
