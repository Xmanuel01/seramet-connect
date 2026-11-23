// The approved Seramet thermal layouts: kitchen order (KOT), bar order (BOT),
// invoice and receipt. They print on the same ruled text grid as every other
// template (32 columns on 58mm, 42 on 80mm), so the bridge, raster renderer,
// previews and reprint flow need no changes.
//
// Separators follow the approved design:
//   - a thin solid line is a full-width run of "-" (printing-core draws it solid)
//   - a dashed line is "- - -", which prints as dashes in every mode
// Item tables use the existing `+---+` / `|cell|` format with thin borders and
// no filled header. Nothing here ever prints a placeholder: optional details
// that are missing are left out.

import { centered, clean, compose, money, quantity, spread, table, wrap } from "./ruled";
import type { Column } from "./ruled";
import type { LoyaltyDetails } from "./front-of-house";
import { invoiceRich, orderTicketRich, receiptRich } from "./approved-rich";
import { currency as currencyCode, lineAmount, widthOf } from "./shared";
import type {
  EtimsStatus,
  Payment,
  PrintContext,
  PrintedDocument,
  ProductionLine,
  QrCode,
  SaleLine,
} from "./types";

// ---------------------------------------------------------------------------
// Shared pieces

/** Thin full-width line. A run of dashes is a rule to printing-core, so it prints solid. */
export function solidSeparator(width: number) {
  return "-".repeat(width);
}

/** Dashed separator. The spaces keep it out of printing-core's rule pattern. */
export function dashedSeparator(width: number) {
  return "- ".repeat(Math.floor((width + 1) / 2)).trimEnd();
}

/** Text wrapped to the width with continuation lines indented. */
function hanging(text: string, width: number, indent: number, firstIndent = 0): string[] {
  const value = clean(text);
  if (!value) return [];
  const first = wrap(value, width - firstIndent);
  const [head, ...rest] = first;
  const remainder = rest.join(" ");
  return [
    " ".repeat(firstIndent) + head,
    ...(remainder ? wrap(remainder, width - indent).map((line) => " ".repeat(indent) + line) : []),
  ];
}

/** "LABEL: value", wrapping under the value. Nothing when the value is blank. */
function labelled(label: string, value: string | undefined, width: number): string[] {
  const text = clean(value);
  if (!text) return [];
  const prefix = `${label}: `;
  if (prefix.length > width / 2) return [...wrap(label + ":", width), ...wrap(text, width)];
  const lines = wrap(text, width - prefix.length);
  return lines.map((line, i) => (i === 0 ? prefix : " ".repeat(prefix.length)) + line);
}

/** Two blocks side by side with a thin "|" divider, as in the approved headers. */
function besideEachOther(
  left: string[],
  right: string[],
  width: number,
  rightWidth: number,
): string[] {
  const leftWidth = width - rightWidth - 3;
  const rows = Math.max(left.length, right.length);
  return Array.from({ length: rows }, (_, i) => {
    const l = (left[i] ?? "").padEnd(leftWidth);
    const r = right[i] ?? "";
    return `${l} | ${r}`.trimEnd();
  });
}

export interface DocumentBusiness {
  name: string;
  address?: string;
  phone?: string;
}

/** Restaurant name, address and contact number, centred. Never the M-Pesa till. */
function restaurantHeader(business: DocumentBusiness, width: number, pin?: string): string[] {
  return [
    ...centered(clean(business.name).toUpperCase(), width),
    ...centered(business.address, width),
    ...centered(clean(business.phone) ? `Tel: ${clean(business.phone)}` : undefined, width),
    // A KRA eTIMS receipt shows the supplier's PIN (TIS specification, Article 3).
    ...centered(clean(pin) ? `PIN: ${clean(pin)}` : undefined, width),
  ];
}

/** KRA's SCU information block and per-rate tax table (TIS specification 6.21-6.23). */
export function etimsDetailLines(etims: EtimsStatus | undefined, width: number, code: string) {
  if (etims?.status !== "SIGNED" || !etims.signature) return [];
  const rows = (etims.taxTable ?? []).map((row) =>
    spread(row.label, `${money(row.taxable)}  VAT ${money(row.tax)}`, width),
  );
  return [
    dashedSeparator(width),
    ...(rows.length ? [`TAX (${code})`, ...rows.flat()] : []),
    "SCU INFORMATION",
    ...labelled("Date", etims.scuDateTime, width),
    ...labelled("CU ID", etims.cuSerial, width),
    ...labelled("CU Inv No", etims.cuInvoiceNumber, width),
    ...labelled("Receipt", etims.receiptCounter, width),
    ...wrap("Internal Data:", width),
    ...wrap(etims.internalData, width),
    ...wrap("Receipt Signature:", width),
    ...wrap(etims.signature, width),
  ];
}

/**
 * Document number on the left with the customer under it, and DATE / TIME
 * stacked on the right, divided by a thin vertical line.
 */
function documentInfo(
  width: number,
  numberLabel: string,
  customer: string,
  date: string,
  time: string,
  extra: string[] = [],
): string[] {
  const rightWidth = Math.max(clean(date).length, clean(time).length, 5);
  const leftWidth = width - rightWidth - 3;
  const top = wrap(numberLabel, leftWidth);
  const bottom = [
    ...labelled("CUSTOMER", customer, leftWidth),
    ...extra.flatMap((line) => wrap(line, leftWidth)),
  ];
  // The number sits beside DATE and the customer beside TIME, as in the design.
  const gap = Array.from({ length: Math.max(0, 2 - top.length) }, () => "");
  const left = [...top, ...gap, ...bottom];
  const right = ["DATE:", clean(date), "TIME:", clean(time)];
  return besideEachOther(left, right, width, rightWidth);
}

// ---------------------------------------------------------------------------
// Kitchen and bar order tickets

export type OrderTicketStatus = "NEW" | "ADDITION" | "VOID" | "REPRINT";

export interface OrderTicketInput {
  station: "KITCHEN" | "BAR";
  status: OrderTicketStatus;
  orderNumber: string;
  date: string;
  time: string;
  /** Customer name or marketplace (e.g. Uber Eats). Defaults to Walk-in. */
  customer?: string;
  table?: string;
  /** Only the items routed to this station. */
  lines: ProductionLine[];
  /** Order-level instructions, printed once under all items. */
  generalInstructions?: string;
  requestedBy: string;
  /** Cancellations only. Missing values print as a line to fill in by hand. */
  voidReason?: string;
  voidApprovedBy?: string;
}

const STATUS_LABEL: Record<OrderTicketStatus, string> = {
  NEW: "NEW ORDER",
  ADDITION: "ADDED ITEMS",
  VOID: "CANCELLED",
  REPRINT: "REPRINT",
};

export function renderOrderTicket(input: OrderTicketInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const dashed = dashedSeparator(width);
  const kind = input.station === "BAR" ? "BAR" : "KITCHEN";
  const voided = input.status === "VOID";
  const items = input.lines.flatMap((line, index) => {
    const head = `${quantity(line.quantity)} x `;
    return [
      ...(index > 0 ? [dashed] : []),
      ...hanging(`${head}${line.name}`, width, head.length),
      ...(line.modifiers ?? []).flatMap((modifier) => hanging(`- ${modifier}`, width, 6, 4)),
      ...(clean(line.note) ? hanging(`Item instructions: ${clean(line.note)}`, width, 4, 4) : []),
    ];
  });
  const fill = "_".repeat(Math.max(6, width - 15));
  const general = clean(input.generalInstructions);
  const content = compose(width, [
    centered(`${kind} ORDER`, width),
    spread(STATUS_LABEL[input.status], kind, width),
    solidSeparator(width),
    wrap(`ORDER #${clean(input.orderNumber).replace(/^#?(?:ORD(?:ER)?[\s#:-]*)?#?/i, "")}`, width),
    labelled("DATE", input.date, width),
    labelled("TIME", input.time, width),
    dashed,
    labelled("CUSTOMER", clean(input.customer) || "Walk-in", width),
    labelled("TABLE", input.table, width),
    dashed,
    voided && centered("DO NOT PREPARE THESE ITEMS", width),
    items,
    dashed,
    general && [
      ...centered("GENERAL INSTRUCTIONS", width),
      ...table(width, [{ align: "center", min: 8 }], [[general]]),
      dashed,
    ],
    labelled("REQUESTED BY", input.requestedBy, width),
    voided &&
      (labelled("REASON", input.voidReason, width).length
        ? labelled("REASON", input.voidReason, width)
        : [`REASON: ${fill}`.slice(0, width)]),
    voided &&
      (labelled("APPROVED BY", input.voidApprovedBy, width).length
        ? labelled("APPROVED BY", input.voidApprovedBy, width)
        : [`APPROVED BY: ${fill}`.slice(0, width)]),
    dashed,
    centered(`END OF ${kind} ORDER`, width),
  ]);
  const documentKind = voided
    ? "VOID_TICKET"
    : input.status === "ADDITION"
      ? "AMENDMENT_TICKET"
      : kind === "BAR"
        ? "BOT"
        : "KOT";
  return {
    kind: documentKind,
    paper: ctx.paper,
    content,
    qrCodes: [],
    ...(ctx.paper !== "A4" ? { rich: orderTicketRich(input, ctx.paper) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Item table and totals shared by the invoice and receipt

/** QTY | ITEM | UNIT | TOTAL on 80mm; QTY | ITEM (with @ unit) | TOTAL on 58mm. */
export function approvedItemsTable(width: number, lines: SaleLine[], ctx: PrintContext) {
  const code = currencyCode(ctx);
  const details = (line: SaleLine) => (line.modifiers ?? []).map((modifier) => `- ${modifier}`);
  if (width >= 40) {
    const columns: Column[] = [
      { width: 3, align: "center" },
      { min: 8 },
      { width: 10, align: "right" },
      { width: 11, align: "right" },
    ];
    return table(
      width,
      columns,
      lines.map((line) => [
        quantity(line.quantity),
        [line.name, ...details(line)],
        money(line.unitPrice),
        money(lineAmount(line)),
      ]),
      { header: ["QTY", "ITEM", `UNIT (${code})`, `TOTAL (${code})`], rowRules: true },
    );
  }
  return table(
    width,
    [{ width: 3, align: "center" }, { min: 8 }, { width: 11, align: "right" }],
    lines.map((line) => [
      quantity(line.quantity),
      [line.name, `@ ${money(line.unitPrice)}`, ...details(line)],
      money(lineAmount(line)),
    ]),
    { header: ["QTY", "ITEM", `TOTAL (${code})`], rowRules: true },
  );
}

export interface DocumentTotals {
  subtotal: number;
  /** Tax recorded on the transaction. Omit when the business charges no VAT. */
  vat?: number;
  /** "VAT", "VAT (16%)" or "VAT (incl.)"; never a made-up rate. */
  vatLabel?: string;
  deliveryCharge?: number;
  serviceCharge?: number;
  discount?: number;
  total: number;
}

function amountRows(width: number, rows: Array<[string, string] | false | undefined>) {
  const present = rows.filter((row): row is [string, string] => Boolean(row));
  // Amounts share one right-aligned column, widened for large values.
  const amount = Math.max(width >= 40 ? 13 : 11, ...present.map(([, value]) => value.length));
  return present.flatMap(([label, value]) => {
    const text = clean(label);
    const room = width - amount - 1;
    if (text.length <= room) return [`${text.padStart(room)} ${value.padStart(amount)}`];
    return spread(text, value, width);
  });
}

/** SUBTOTAL, VAT, charges, then GRAND TOTAL between thin solid lines on white. */
function totalsBlock(width: number, totals: DocumentTotals, ctx: PrintContext): string[] {
  const code = currencyCode(ctx);
  return [
    ...amountRows(width, [
      ["SUBTOTAL", money(totals.subtotal)],
      !!totals.serviceCharge && ["SERVICE CHARGE", money(totals.serviceCharge)],
      !!totals.discount && ["DISCOUNT", `(${money(totals.discount)})`],
      totals.vat !== undefined && [totals.vatLabel ?? "VAT", money(totals.vat)],
      !!totals.deliveryCharge && ["DELIVERY CHARGE", money(totals.deliveryCharge)],
    ]),
    solidSeparator(width),
    ...spread("GRAND TOTAL", `${code} ${money(totals.total)}`, width),
    solidSeparator(width),
  ];
}

// ---------------------------------------------------------------------------
// Invoice

export interface InvoicePaymentDetails {
  till?: string;
  paybill?: string;
  account?: string;
  /** Payload from a configured M-Pesa dynamic QR integration. Never invented. */
  qrPayload?: string;
  /**
   * Module rows of the QR image Safaricom issued (Daraja Dynamic QR), when the
   * payload itself is not available. Drawn as issued.
   */
  qrModules?: string[];
}

export interface ApprovedInvoiceInput {
  business: DocumentBusiness;
  /** Invoice number as stored, e.g. INV-0633U. Printed as "INV #0633U". */
  invoiceNumber: string;
  date: string;
  time: string;
  customer?: string;
  table?: string;
  /** Delivery recipient line(s), only for delivery orders. */
  deliverTo?: string;
  lines: SaleLine[];
  totals: DocumentTotals;
  /** Payments already recorded against the invoice. */
  paid?: number;
  mpesa?: InvoicePaymentDetails;
  /** Other configured payment options that the M-Pesa block does not already show. */
  paymentInstructions?: string[];
}

/** "INV #0633U" / "RCPT #0386S" from the stored number, without doubling the prefix. */
export function displayNumber(prefix: "INV" | "RCPT", value: string) {
  const strip = prefix === "INV" ? /^INV(?:OICE)?[\s#:-]*/i : /^(?:RCPT|RCP|REC)[\s#:-]*/i;
  const bare = clean(value).replace(strip, "").replace(/^#/, "");
  return `${prefix} #${bare}`;
}

export function renderApprovedInvoice(
  input: ApprovedInvoiceInput,
  ctx: PrintContext,
  kind: "BILL" | "TAX_INVOICE" = "TAX_INVOICE",
): PrintedDocument {
  const width = widthOf(ctx);
  const code = currencyCode(ctx);
  const qrCodes: QrCode[] = [];
  const paid = input.paid ?? 0;
  const balance = Math.max(0, Math.round((input.totals.total - paid) * 100) / 100);
  const till = clean(input.mpesa?.till);
  const paybill = clean(input.mpesa?.paybill);
  const payload = clean(input.mpesa?.qrPayload);
  const hasMpesa = Boolean(till || paybill);
  if (hasMpesa && payload && balance > 0)
    qrCodes.push({ payload, caption: "Scan to pay with M-Pesa", purpose: "PAYMENT" });
  const mpesa =
    hasMpesa && balance > 0
      ? [
          ...wrap(payload ? "SCAN TO PAY WITH M-PESA" : "PAY WITH M-PESA", width),
          ...labelled("Till No.", till, width).map((line) => line.replace("Till No.:", "Till No.")),
          ...labelled("Paybill", paybill, width),
          ...(paybill ? labelled("Account", input.mpesa?.account, width) : []),
          ...labelled("Amount", `${code} ${money(balance)}`, width),
          // Honest fallback: no QR is printed unless the integration supplied a real one.
          ...(payload ? [] : wrap("Dynamic QR payment unavailable.", width)),
        ]
      : [];
  const instructions = (input.paymentInstructions ?? []).map(clean).filter(Boolean);
  const content = compose(width, [
    restaurantHeader(input.business, width),
    solidSeparator(width),
    centered("INVOICE", width),
    documentInfo(
      width,
      displayNumber("INV", input.invoiceNumber),
      clean(input.customer) || "Walk-in",
      input.date,
      input.time,
      [
        clean(input.table) && `TABLE: ${clean(input.table)}`,
        clean(input.deliverTo) && `DELIVER TO: ${clean(input.deliverTo)}`,
      ].filter((line): line is string => Boolean(line)),
    ),
    dashedSeparator(width),
    approvedItemsTable(width, input.lines, ctx),
    totalsBlock(width, input.totals, ctx),
    paid > 0 &&
      amountRows(width, [
        ["AMOUNT PAID", money(paid)],
        ["BALANCE DUE", money(balance)],
      ]),
    mpesa.length > 0 && mpesa,
    balance > 0 && instructions.length > 0 && instructions.flatMap((line) => wrap(line, width)),
  ]);
  return {
    kind,
    paper: ctx.paper,
    content,
    qrCodes,
    ...(ctx.paper !== "A4" ? { rich: invoiceRich(input, ctx.paper, code) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Receipt

export interface ApprovedReceiptInput {
  business: DocumentBusiness;
  receiptNumber: string;
  date: string;
  time: string;
  customer?: string;
  table?: string;
  lines: SaleLine[];
  totals: DocumentTotals;
  /** Payments recorded on the transaction, as tendered. */
  payments: Payment[];
  change?: number;
  /** Amount applied to the bill. PAID prints only when it covers the total. */
  paid: number;
  /** Real eTIMS data from the fiscal integration. Omitted when there is none. */
  etims?: EtimsStatus;
  loyalty?: LoyaltyDetails;
}

function paymentLines(input: ApprovedReceiptInput, width: number, code: string) {
  const lines = input.payments.flatMap((payment, index) => [
    ...(index > 0 ? [""] : []),
    ...labelled("Method", payment.method, width),
    ...labelled("Reference", payment.reference, width),
    ...labelled("Amount Paid", `${code} ${money(payment.amount)}`, width),
  ]);
  const balance = Math.round((input.totals.total - input.paid) * 100) / 100;
  return [
    "PAYMENT DETAILS",
    ...lines,
    ...(input.change ? labelled("Change", `${code} ${money(input.change)}`, width) : []),
    ...(balance > 0 ? labelled("Balance Due", `${code} ${money(balance)}`, width) : []),
  ];
}

function etimsLines(etims: EtimsStatus | undefined, width: number, qrCodes: QrCode[]) {
  if (!etims) return [];
  if (etims.status === "PENDING")
    return ["eTIMS PENDING", ...wrap("Awaiting KRA signature.", width)];
  if (etims.verifyUrl)
    qrCodes.push({
      payload: etims.verifyUrl,
      caption: "Scan to verify on KRA eTIMS",
      purpose: "ETIMS_VERIFY",
    });
  return [
    "eTIMS VERIFY",
    ...wrap("CU Serial:", width),
    ...wrap(etims.cuSerial, width),
    ...wrap("CU Inv No:", width),
    ...wrap(etims.cuInvoiceNumber, width),
  ];
}

export function renderApprovedReceipt(
  input: ApprovedReceiptInput,
  ctx: PrintContext,
): PrintedDocument {
  const width = widthOf(ctx);
  const code = currencyCode(ctx);
  const qrCodes: QrCode[] = [];
  const settled = input.paid + 0.005 >= input.totals.total;
  // Payment details with the eTIMS section beside them on 80mm; stacked on 58mm.
  const etimsWidth = 20;
  const sideBySide = width >= 40 && Boolean(input.etims);
  const payments = paymentLines(input, sideBySide ? width - etimsWidth - 3 : width, code);
  const fiscal = etimsLines(input.etims, sideBySide ? etimsWidth : width, qrCodes);
  const loyalty = input.loyalty;
  const points = (value: number | undefined) =>
    value === undefined ? undefined : value.toLocaleString("en-US");
  const signed = input.etims?.status === "SIGNED" ? input.etims : undefined;
  const content = compose(width, [
    restaurantHeader(input.business, width, signed?.pin),
    solidSeparator(width),
    signed?.sandbox && centered("eTIMS SANDBOX - NOT A VALID TAX RECEIPT", width),
    spread("RECEIPT", settled ? "[ PAID ]" : "", width),
    documentInfo(
      width,
      displayNumber("RCPT", input.receiptNumber),
      clean(input.customer) || "Walk-in",
      input.date,
      input.time,
      clean(input.table) ? [`TABLE: ${clean(input.table)}`] : [],
    ),
    dashedSeparator(width),
    approvedItemsTable(width, input.lines, ctx),
    totalsBlock(width, input.totals, ctx),
    sideBySide
      ? besideEachOther(payments, fiscal, width, etimsWidth)
      : [...payments, ...(fiscal.length ? [dashedSeparator(width), ...fiscal] : [])],
    etimsDetailLines(input.etims, width, code),
    loyalty && [
      dashedSeparator(width),
      ...labelled("Member", loyalty.memberCode, width),
      ...labelled("Points earned", points(loyalty.pointsEarned), width),
      ...labelled("Points balance", points(loyalty.pointsBalance), width),
      ...labelled("Reward used", loyalty.rewardUsed, width),
      ...labelled("Voucher used", loyalty.voucherUsed, width),
      ...centered(loyalty.message, width),
    ],
    solidSeparator(width),
    centered("THANK YOU FOR YOUR BUSINESS", width),
  ]);
  return {
    kind: "RECEIPT",
    paper: ctx.paper,
    content,
    qrCodes,
    ...(ctx.paper !== "A4" ? { rich: receiptRich(input, ctx.paper, code) } : {}),
  };
}
