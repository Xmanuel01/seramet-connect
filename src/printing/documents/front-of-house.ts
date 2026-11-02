import {
  box,
  clean,
  centered,
  compose,
  fieldPanels,
  fields,
  grid,
  money,
  quantity,
  signatures,
  spread,
  sum,
  table,
  times,
  type Column,
} from "./ruled";
import {
  amountsTable,
  businessHeader,
  computeSaleTotals,
  copyLine,
  currencyNote,
  etimsBlock,
  footer,
  itemCount,
  levyRows,
  lineAmount,
  mobileMoneyBlock,
  paymentsTable,
  saleColumns,
  saleItemsTable,
  saleTotalsTable,
  type SaleTotals,
  titleBar,
  widthOf,
} from "./shared";
import type {
  BusinessIdentity,
  DisplayTime,
  EtimsStatus,
  MobileMoneyDetails,
  Party,
  Payment,
  PrintContext,
  PrintedDocument,
  ProductionLine,
  QrCode,
  SaleLine,
  TaxSettings,
} from "./types";

type Station = "KITCHEN" | "BAR" | "DISPATCH";

const STATION_LABEL: Record<Station, string> = {
  KITCHEN: "Kitchen",
  BAR: "Bar",
  DISPATCH: "Dispatch",
};

function ticketPrefix(station: Station) {
  return station === "BAR" ? "BOT" : "KOT";
}

function modifierLines(modifiers: string[] | undefined, upper = false) {
  return (modifiers ?? []).map((modifier) => `- ${upper ? modifier.toUpperCase() : modifier}`);
}

// ---------------------------------------------------------------------------
// Production tickets: KOT and BOT

export interface ProductionTicketInput {
  station: Station;
  ticketNumber: string;
  orderNumber: string;
  orderType: string;
  table?: string;
  covers?: number;
  round?: number;
  server?: string;
  /** Sub-station such as GRILL or FRYER when a kitchen routes by station. */
  stationName?: string;
  branch?: string;
  /** Who sent the order, when it is not the server. */
  sentBy?: string;
  /** How the ticket reached this printer when not the station's own, e.g. "POS front printer". */
  via?: string;
  printedAt: DisplayTime;
  lines: ProductionLine[];
  note?: string;
}

export function renderProductionTicket(
  input: ProductionTicketInput,
  ctx: PrintContext,
): PrintedDocument {
  const width = widthOf(ctx);
  const bar = input.station === "BAR";
  const title = `${STATION_LABEL[input.station].toUpperCase()} ORDER`;
  const content = compose(width, [
    // First line prints bold; the title also matches printing-core's strong titles.
    spread(title, `${ticketPrefix(input.station)} ${input.ticketNumber}`, width),
    copyLine(ctx, width),
    grid(width, [
      input.table && `Table ${input.table}`,
      input.covers !== undefined && `Covers ${input.covers}`,
      `Order ${input.orderNumber}`,
      `${input.orderType}${input.round ? ` / Round ${input.round}` : ""}`,
      input.server && `Server ${input.server}`,
      input.stationName && `Station ${input.stationName}`,
      input.branch && `Branch ${input.branch}`,
      input.sentBy && `Sent by ${input.sentBy}`,
      input.via && `Via ${input.via}`,
    ]),
    table(
      width,
      [{ width: 4, align: "right" }, { min: 10 }],
      input.lines.map((line) => [
        quantity(line.quantity),
        [
          line.name.toUpperCase(),
          ...modifierLines(line.modifiers, true),
          ...(line.note ? [`NOTE: ${line.note.toUpperCase()}`] : []),
        ],
      ]),
      { header: ["Qty", bar ? "Drink" : "Item"], rowRules: true },
    ),
    input.note && box(width, [`SPECIAL REQUEST: ${input.note}`]),
    spread(itemCount(input.lines), `Printed ${input.printedAt}`, width),
  ]);
  const kind = bar ? "BOT" : input.station === "DISPATCH" ? "DISPATCH_TICKET" : "KOT";
  return { kind, paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Void / cancellation and order amendment tickets

export interface VoidTicketInput {
  station: Station;
  voidNumber: string;
  cancelsTicket?: string;
  orderNumber: string;
  table?: string;
  at: DisplayTime;
  lines: ProductionLine[];
  /** Left blank to fill in by hand when the till has no recorded reason. */
  reason?: string;
  requestedBy: string;
  authorisedBy?: string;
}

export function renderVoidTicket(input: VoidTicketInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const content = compose(width, [
    centered("VOID - DO NOT PREPARE", width),
    copyLine(ctx, width),
    grid(width, [
      `Void ${input.voidNumber}`,
      STATION_LABEL[input.station],
      input.table && `Table ${input.table}`,
      input.cancelsTicket && `Cancels ${input.cancelsTicket}`,
      `Order ${input.orderNumber}`,
      input.at,
    ]),
    table(
      width,
      [{ width: 4, align: "right" }, { min: 10 }],
      input.lines.map((line) => [
        `-${quantity(line.quantity)}`,
        [`${line.name.toUpperCase()} - CANCELLED`, ...modifierLines(line.modifiers)],
      ]),
      { header: ["Qty", "Item cancelled"], rowRules: true },
    ),
    fields(
      width,
      [
        ["Reason", input.reason ?? ""],
        ["Requested by", input.requestedBy],
        ["Authorised by", input.authorisedBy ?? ""],
      ],
      { keepEmpty: ["Reason", "Authorised by"] },
    ),
    signatures(width, [`${STATION_LABEL[input.station]} ack.`], 1),
    spread("Logged in void report", `Printed ${input.at}`, width),
  ]);
  return { kind: "VOID_TICKET", paper: ctx.paper, content, qrCodes: [] };
}

export interface AmendmentChange {
  action: "ADD" | "REMOVE" | "CHANGE";
  quantity: number;
  item: string;
  /** For CHANGE: what it was and what it is now. */
  was?: string;
  now?: string;
  modifiers?: string[];
  note?: string;
}

export interface AmendmentTicketInput {
  station: Station;
  ticketNumber: string;
  amendsTicket?: string;
  orderNumber: string;
  table?: string;
  server?: string;
  stationName?: string;
  branch?: string;
  at: DisplayTime;
  changes: AmendmentChange[];
  reason?: string;
  note?: string;
}

function signedQuantity(change: AmendmentChange) {
  const value = quantity(change.quantity);
  if (change.action === "ADD") return `+${value}`;
  if (change.action === "REMOVE") return `-${value}`;
  return value;
}

export function renderAmendmentTicket(
  input: AmendmentTicketInput,
  ctx: PrintContext,
): PrintedDocument {
  const width = widthOf(ctx);
  const content = compose(width, [
    spread("ORDER CHANGE", `${ticketPrefix(input.station)} ${input.ticketNumber}`, width),
    copyLine(ctx, width),
    grid(width, [
      input.table && `Table ${input.table}`,
      input.amendsTicket && `Amends ${input.amendsTicket}`,
      `Order ${input.orderNumber}`,
      input.at,
      input.server && `Server ${input.server}`,
      input.stationName && `Station ${input.stationName}`,
      input.branch && `Branch ${input.branch}`,
    ]),
    table(
      width,
      [{ width: 6 }, { width: 4, align: "right" }, { min: 10 }],
      input.changes.map((change) => [
        change.action,
        signedQuantity(change),
        [
          change.item.toUpperCase(),
          ...(change.was ? [`Was: ${change.was}`] : []),
          ...(change.now ? [`Now: ${change.now}`] : []),
          ...modifierLines(change.modifiers, true),
          ...(change.note ? [`NOTE: ${change.note.toUpperCase()}`] : []),
        ],
      ]),
      { header: ["Action", "Qty", "Item"], rowRules: true },
    ),
    input.note && box(width, [`SPECIAL REQUEST: ${input.note}`]),
    input.reason && fields(width, [["Reason", input.reason]]),
    spread("Prepare the changes only", `Printed ${input.at}`, width),
  ]);
  return { kind: "AMENDMENT_TICKET", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Customer bill (pre-payment / proforma)

export interface CustomerDetails {
  name?: string;
  phone?: string;
  email?: string;
}

export interface LoyaltyDetails {
  memberCode?: string;
  tier?: string;
  pointsEarned?: number;
  pointsBalance?: number;
  rewardUsed?: string;
  voucherUsed?: string;
  message?: string;
}

function customerFields(width: number, customer: CustomerDetails | undefined) {
  if (!customer) return [];
  return fields(width, [
    ["Customer", customer.name],
    ["Phone", customer.phone],
    ["Email", customer.email],
  ]);
}

function loyaltyFields(width: number, loyalty: LoyaltyDetails | undefined) {
  if (!loyalty) return [];
  const points = (value: number | undefined) =>
    value === undefined ? undefined : value.toLocaleString("en-US");
  return [
    ...fields(width, [
      ["Member", loyalty.memberCode],
      ["Tier", loyalty.tier],
      ["Points earned", points(loyalty.pointsEarned)],
      ["Points balance", points(loyalty.pointsBalance)],
      ["Reward used", loyalty.rewardUsed],
      ["Voucher used", loyalty.voucherUsed],
    ]),
    ...footer(width, loyalty.message),
  ];
}

export interface CustomerBillInput {
  business: BusinessIdentity;
  tax: TaxSettings;
  billNumber: string;
  orderNumber: string;
  orderType?: string;
  table?: string;
  covers?: number;
  server?: string;
  cashier?: string;
  customer?: CustomerDetails;
  issuedAt: DisplayTime;
  lines: SaleLine[];
  serviceCharge?: number;
  discount?: number;
  /** Totals already settled by the till. Printed as given instead of being recomputed from lines. */
  totals?: SaleTotals;
  payment?: MobileMoneyDetails;
  /** Free-text payment options (bank, card, etc.) printed in a box under the totals. */
  paymentInstructions?: string[];
  footerMessage?: string;
}

export function renderCustomerBill(input: CustomerBillInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const qrCodes: QrCode[] = [];
  const totals = input.totals ?? computeSaleTotals(input.lines, input.tax, input);
  const payment = input.payment && { account: input.billNumber, ...input.payment };
  const instructions = (input.paymentInstructions ?? []).filter((line) => clean(line));
  const content = compose(width, [
    businessHeader(input.business, width, false),
    titleBar("BILL", width, "Not a receipt"),
    copyLine(ctx, width),
    grid(width, [
      `Bill ${input.billNumber}`,
      input.table && `Table ${input.table}`,
      `Order ${input.orderNumber}`,
      input.orderType,
      input.covers !== undefined && `Covers ${input.covers}`,
      input.server && `Server ${input.server}`,
      input.cashier && `Cashier ${input.cashier}`,
      input.issuedAt,
    ]),
    customerFields(width, input.customer),
    saleItemsTable(width, input.lines),
    saleTotalsTable(width, totals, ctx),
    mobileMoneyBlock(width, payment, totals.total, qrCodes),
    instructions.length > 0 && box(width, ["PAYMENT OPTIONS", ...instructions]),
    footer(width, input.footerMessage ?? "Show your payment message to the cashier."),
  ]);
  return { kind: "BILL", paper: ctx.paper, content, qrCodes };
}

// ---------------------------------------------------------------------------
// Sales receipt (paid), with eTIMS when the restaurant has it on

export interface SalesReceiptInput {
  business: BusinessIdentity;
  tax: TaxSettings;
  receiptNumber: string;
  billNumber?: string;
  orderNumber?: string;
  orderType?: string;
  table?: string;
  server?: string;
  cashier?: string;
  customer?: CustomerDetails;
  issuedAt: DisplayTime;
  lines: SaleLine[];
  serviceCharge?: number;
  discount?: number;
  /** Totals already settled by the till. Printed as given instead of being recomputed from lines. */
  totals?: SaleTotals;
  payments: Payment[];
  loyalty?: LoyaltyDetails;
  etims?: EtimsStatus;
  footerMessage?: string;
}

export function renderSalesReceipt(input: SalesReceiptInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const qrCodes: QrCode[] = [];
  const totals = input.totals ?? computeSaleTotals(input.lines, input.tax, input);
  const paid = sum(input.payments.map((payment) => payment.amount));
  const change = paid > totals.total ? sum([paid, -totals.total]) : 0;
  const vatNote =
    input.tax.vatRegistered && input.tax.pricesIncludeVat !== false
      ? "Prices include VAT."
      : undefined;
  const content = compose(width, [
    businessHeader(input.business, width),
    titleBar("RECEIPT", width, paid >= totals.total ? "PAID" : undefined),
    copyLine(ctx, width),
    grid(width, [
      `Receipt ${input.receiptNumber}`,
      input.issuedAt,
      input.billNumber && `Bill ${input.billNumber}`,
      input.orderNumber && `Order ${input.orderNumber}`,
      input.orderType,
      input.table && `Table ${input.table}`,
      input.server && `Served by ${input.server}`,
      input.cashier && `Cashier ${input.cashier}`,
    ]),
    customerFields(width, input.customer),
    saleItemsTable(width, input.lines),
    saleTotalsTable(width, totals, ctx),
    paymentsTable(width, input.payments, change),
    paid < totals.total && box(width, [`BALANCE DUE ${money(sum([totals.total, -paid]))}`]),
    loyaltyFields(width, input.loyalty),
    footer(width, input.footerMessage ?? "Thank you!", vatNote),
    etimsBlock(width, input.etims, qrCodes),
  ]);
  return { kind: "RECEIPT", paper: ctx.paper, content, qrCodes };
}

// ---------------------------------------------------------------------------
// Tax invoice (credit sales, events, corporate) - A4 or thermal

export interface InvoiceLine extends SaleLine {
  /** Shown under the description, e.g. the event date. */
  detail?: string;
}

export interface TaxInvoiceInput {
  business: BusinessIdentity;
  tax: TaxSettings;
  client: Party;
  invoiceNumber: string;
  issueDate: DisplayTime;
  dueDate?: DisplayTime;
  reference?: string;
  orderNumber?: string;
  orderType?: string;
  table?: string;
  cashier?: string;
  lines: InvoiceLine[];
  serviceCharge?: number;
  discount?: number;
  /** Totals already settled by the till. Printed as given instead of being recomputed from lines. */
  totals?: SaleTotals;
  paidToDate?: number;
  /** Payments already taken against the invoice, listed under the totals. */
  payments?: Payment[];
  payment?: MobileMoneyDetails & { bank?: string; bankAccount?: string };
  /** Free-text payment options printed in a box when a balance is due. */
  paymentInstructions?: string[];
  etims?: EtimsStatus;
  terms?: string;
  footerMessage?: string;
}

/** # | Description | Qty | Unit price | VAT | Amount on A4; the receipt layout on thermal paper. */
export function invoiceItemsTable(width: number, lines: InvoiceLine[], vatLabel?: string) {
  if (width < 70) return saleItemsTable(width, lines);
  const columns: Column[] = [
    { width: 3, align: "right" },
    { min: 16 },
    { width: 6, align: "right" },
    { width: 12, align: "right" },
    ...(vatLabel ? [{ width: 5, align: "right" as const }] : []),
    { width: saleColumns(width).totals, align: "right" },
  ];
  return table(
    width,
    columns,
    lines.map((line, index) => [
      String(index + 1),
      [line.name, ...(line.detail ? [line.detail] : []), ...modifierLines(line.modifiers)],
      quantity(line.quantity),
      money(line.unitPrice),
      ...(vatLabel ? [vatLabel] : []),
      money(lineAmount(line)),
    ]),
    { header: ["#", "Description", "Qty", "Unit price", ...(vatLabel ? ["VAT"] : []), "Amount"] },
  );
}

export function renderTaxInvoice(input: TaxInvoiceInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const qrCodes: QrCode[] = [];
  const totals = input.totals ?? computeSaleTotals(input.lines, input.tax, input);
  const paid = input.paidToDate ?? 0;
  const instructions = (input.paymentInstructions ?? []).filter((line) => clean(line));
  const extras = totals.serviceCharge !== 0 || totals.discount !== 0;
  // Tax added on top of the subtotal needs the subtotal shown to add up.
  const taxOnTop = totals.vat !== undefined && totals.net === undefined;
  const balance = sum([totals.total, -paid]);
  const payment = input.payment && { account: input.invoiceNumber, ...input.payment };
  const terms =
    input.terms ??
    (input.dueDate ? `Please pay by ${input.dueDate}. Quote ${input.invoiceNumber}.` : undefined);
  const content = compose(width, [
    businessHeader(input.business, width),
    titleBar(input.tax.vatRegistered ? "TAX INVOICE" : "INVOICE", width),
    copyLine(ctx, width),
    fieldPanels(
      width,
      [
        ["Bill to", input.client.name],
        ["Address", input.client.address],
        ["Client PIN", input.client.taxPin],
        ["Contact", input.client.contact],
      ],
      [
        ["Invoice no.", input.invoiceNumber],
        ["Issue date", input.issueDate],
        ["Due date", input.dueDate],
        ["LPO / Ref", input.reference],
        ["Order", input.orderNumber],
        [
          "Service",
          [input.orderType, input.table && `Table ${input.table}`].filter(Boolean).join(" / "),
        ],
        ["Cashier", input.cashier],
      ],
    ),
    invoiceItemsTable(width, input.lines, totals.vatRate ? `${totals.vatRate}%` : undefined),
    amountsTable(width, [
      (extras || taxOnTop) && ["Subtotal", money(totals.subtotal)],
      totals.serviceCharge !== 0 && ["Service charge", money(totals.serviceCharge)],
      totals.discount !== 0 && ["Discount", `(${money(totals.discount)})`],
      totals.net !== undefined && ["Net (excl. VAT)", money(totals.net)],
      totals.vat !== undefined && [
        totals.vatRate !== undefined ? `VAT ${totals.vatRate}%` : "VAT",
        money(totals.vat),
      ],
      ...levyRows(totals),
      ["TOTAL", money(totals.total)],
      paid !== 0 && ["Paid to date", `(${money(paid)})`],
      paid !== 0 && ["BALANCE DUE", money(balance)],
    ]),
    currencyNote(width, ctx),
    input.payments && input.payments.length > 0 && paymentsTable(width, input.payments),
    balance > 0 && mobileMoneyBlock(width, payment, balance, qrCodes),
    balance > 0 &&
      input.payment?.bank &&
      fields(width, [
        ["Bank", input.payment.bank],
        ["Account", input.payment.bankAccount],
      ]),
    balance > 0 && instructions.length > 0 && box(width, ["PAYMENT OPTIONS", ...instructions]),
    etimsBlock(width, input.etims, qrCodes),
    signatures(width, ["Prepared by", "Received by"]),
    footer(width, terms, input.footerMessage),
  ]);
  return { kind: "TAX_INVOICE", paper: ctx.paper, content, qrCodes };
}

// ---------------------------------------------------------------------------
// Payment receipt (payment against an invoice or account)

export interface PaymentReceiptInput {
  business: BusinessIdentity;
  receiptNumber: string;
  issuedAt: DisplayTime;
  receivedFrom: Party;
  invoiceNumber: string;
  invoiceTotal: number;
  previouslyPaid: number;
  payments: Payment[];
  amountInWords?: string;
  receivedBy?: string;
}

export function renderPaymentReceipt(
  input: PaymentReceiptInput,
  ctx: PrintContext,
): PrintedDocument {
  const width = widthOf(ctx);
  const thisPayment = sum(input.payments.map((payment) => payment.amount));
  const balance = sum([input.invoiceTotal, -input.previouslyPaid, -thisPayment]);
  const content = compose(width, [
    businessHeader(input.business, width),
    titleBar("PAYMENT RECEIPT", width),
    copyLine(ctx, width),
    fields(width, [
      ["Receipt no.", input.receiptNumber],
      ["Date", input.issuedAt],
      ["Received from", input.receivedFrom.name],
      ["Client PIN", input.receivedFrom.taxPin],
    ]),
    amountsTable(width, [
      [`${input.invoiceNumber} total`, money(input.invoiceTotal)],
      ["Previously paid", `(${money(input.previouslyPaid)})`],
      ["THIS PAYMENT", money(thisPayment)],
      [balance < 0 ? "Overpaid (credit)" : "Balance remaining", money(Math.abs(balance))],
    ]),
    paymentsTable(width, input.payments),
    fields(width, [
      ["In words", input.amountInWords],
      ["Received by", input.receivedBy],
    ]),
    footer(width, `Confirms payment only. Tax invoice: ${input.invoiceNumber}.`),
  ]);
  return { kind: "PAYMENT_RECEIPT", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Credit note

export interface CreditNoteInput {
  business: BusinessIdentity;
  tax: TaxSettings;
  client: Party;
  creditNoteNumber: string;
  date: DisplayTime;
  originalInvoiceNumber: string;
  originalInvoiceDate?: DisplayTime;
  reason: string;
  lines: InvoiceLine[];
  account?: { invoiceTotal: number; paidToDate: number };
  etims?: EtimsStatus;
}

export function renderCreditNote(input: CreditNoteInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const qrCodes: QrCode[] = [];
  const totals = computeSaleTotals(input.lines, input.tax);
  const account = input.account;
  const original = input.originalInvoiceDate
    ? `${input.originalInvoiceNumber} (${input.originalInvoiceDate})`
    : input.originalInvoiceNumber;
  const content = compose(width, [
    businessHeader(input.business, width),
    titleBar("CREDIT NOTE", width),
    copyLine(ctx, width),
    fieldPanels(
      width,
      [
        ["Issued to", input.client.name],
        ["Address", input.client.address],
        ["Client PIN", input.client.taxPin],
      ],
      [
        ["Credit note", input.creditNoteNumber],
        ["Date", input.date],
        ["Original inv.", original],
      ],
    ),
    fields(width, [["Reason", input.reason]]),
    invoiceItemsTable(width, input.lines, totals.vatRate ? `${totals.vatRate}%` : undefined),
    amountsTable(width, [
      totals.net !== undefined && ["Net (excl. VAT)", money(totals.net)],
      totals.vat !== undefined && [`VAT ${totals.vatRate}%`, money(totals.vat)],
      ...levyRows(totals),
      ["TOTAL", money(totals.total)],
    ]),
    account &&
      amountsTable(width, [
        ["Invoice total", money(account.invoiceTotal)],
        ["Paid to date", `(${money(account.paidToDate)})`],
        ["This credit", `(${money(totals.total)})`],
        ["New balance due", money(sum([account.invoiceTotal, -account.paidToDate, -totals.total]))],
      ]),
    currencyNote(width, ctx),
    etimsBlock(width, input.etims, qrCodes, "CU Credit No"),
    signatures(width, ["Authorised by", "Client ack."]),
    footer(width, "Reduces the balance on the original invoice. Not a cash refund."),
  ]);
  return { kind: "CREDIT_NOTE", paper: ctx.paper, content, qrCodes };
}

// ---------------------------------------------------------------------------
// Dispatch / delivery ticket

export interface DispatchTicketInput {
  orderNumber: string;
  channel: string;
  platformCode?: string;
  customer?: string;
  phone?: string;
  address?: string;
  orderedAt: DisplayTime;
  readyBy?: DisplayTime;
  lines: SaleLine[];
  /** "Paid - Uber Eats", "Cash on delivery", ... */
  paymentLabel: string;
  /** Cash the rider must collect; 0 when prepaid. */
  collect: number;
  rider?: string;
}

function dispatchItems(width: number, lines: SaleLine[]) {
  const qty: Column = { width: 3, align: "right" };
  const packed: Column = { width: 4, align: "center" };
  if (width < 40) {
    // 58mm: the amount moves under the item name to keep the packed-tick column.
    return table(
      width,
      [qty, { min: 10 }, packed],
      lines.map((line) => [
        quantity(line.quantity),
        [line.name, money(lineAmount(line)), ...modifierLines(line.modifiers)],
        "",
      ]),
      { header: ["Qty", "Item", "Pkd"], rowRules: true },
    );
  }
  return table(
    width,
    [qty, { min: 10 }, { width: 11, align: "right" }, packed],
    lines.map((line) => [
      quantity(line.quantity),
      [line.name, ...modifierLines(line.modifiers)],
      money(lineAmount(line)),
      "",
    ]),
    { header: ["Qty", "Item", "Amount", "Pkd"], rowRules: true },
  );
}

export function renderDispatchTicket(
  input: DispatchTicketInput,
  ctx: PrintContext,
): PrintedDocument {
  const width = widthOf(ctx);
  const total = sum(input.lines.map((line) => times(line.quantity, line.unitPrice)));
  const content = compose(width, [
    spread("DISPATCH", input.orderNumber, width),
    copyLine(ctx, width),
    fields(width, [
      ["Channel", input.channel],
      ["Platform", input.platformCode],
      ["Customer", input.customer],
      ["Phone", input.phone],
      ["Deliver to", input.address],
      ["Ordered", input.orderedAt],
      ["Ready by", input.readyBy],
      ["Rider", input.rider],
    ]),
    dispatchItems(width, input.lines),
    amountsTable(width, [
      ["Order total", money(total)],
      ["Payment", input.paymentLabel],
      [input.collect > 0 ? "RIDER COLLECTS" : "Rider collects", money(input.collect)],
    ]),
    signatures(width, ["Packed by", "Picked up"], 1),
    centered("Attach to bag", width),
  ]);
  return { kind: "DISPATCH_TICKET", paper: ctx.paper, content, qrCodes: [] };
}
