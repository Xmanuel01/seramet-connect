import {
  box,
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

type Station = "KITCHEN" | "BAR";

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
  const title = bar ? "BAR ORDER" : "KITCHEN ORDER";
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
  return { kind: bar ? "BOT" : "KOT", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Void / cancellation and order amendment tickets

export interface VoidTicketInput {
  station: Station;
  voidNumber: string;
  cancelsTicket: string;
  orderNumber: string;
  table?: string;
  at: DisplayTime;
  lines: ProductionLine[];
  reason: string;
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
      input.station === "BAR" ? "Bar" : "Kitchen",
      input.table && `Table ${input.table}`,
      `Cancels ${input.cancelsTicket}`,
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
        ["Reason", input.reason],
        ["Requested by", input.requestedBy],
        ["Authorised by", input.authorisedBy ?? ""],
      ],
      { keepEmpty: ["Authorised by"] },
    ),
    signatures(width, [input.station === "BAR" ? "Bar ack." : "Kitchen ack."], 1),
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
}

export interface AmendmentTicketInput {
  station: Station;
  ticketNumber: string;
  amendsTicket: string;
  orderNumber: string;
  table?: string;
  server?: string;
  at: DisplayTime;
  changes: AmendmentChange[];
  reason?: string;
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
      `Amends ${input.amendsTicket}`,
      `Order ${input.orderNumber}`,
      input.at,
      input.server && `Server ${input.server}`,
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
        ],
      ]),
      { header: ["Action", "Qty", "Item"], rowRules: true },
    ),
    input.reason && fields(width, [["Reason", input.reason]]),
    spread("Prepare the changes only", `Printed ${input.at}`, width),
  ]);
  return { kind: "AMENDMENT_TICKET", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Customer bill (pre-payment / proforma)

export interface CustomerBillInput {
  business: BusinessIdentity;
  tax: TaxSettings;
  billNumber: string;
  orderNumber: string;
  table?: string;
  covers?: number;
  server?: string;
  issuedAt: DisplayTime;
  lines: SaleLine[];
  serviceCharge?: number;
  discount?: number;
  payment?: MobileMoneyDetails;
  footerMessage?: string;
}

export function renderCustomerBill(input: CustomerBillInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const qrCodes: QrCode[] = [];
  const totals = computeSaleTotals(input.lines, input.tax, input);
  const payment = input.payment && { account: input.billNumber, ...input.payment };
  const content = compose(width, [
    businessHeader(input.business, width, false),
    titleBar("BILL", width, "Not a receipt"),
    copyLine(ctx, width),
    grid(width, [
      `Bill ${input.billNumber}`,
      input.table && `Table ${input.table}`,
      `Order ${input.orderNumber}`,
      input.covers !== undefined && `Covers ${input.covers}`,
      input.server && `Server ${input.server}`,
      input.issuedAt,
    ]),
    saleItemsTable(width, input.lines),
    saleTotalsTable(width, totals, ctx),
    mobileMoneyBlock(width, payment, totals.total, qrCodes),
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
  table?: string;
  server?: string;
  cashier?: string;
  issuedAt: DisplayTime;
  lines: SaleLine[];
  serviceCharge?: number;
  discount?: number;
  payments: Payment[];
  etims?: EtimsStatus;
  footerMessage?: string;
}

export function renderSalesReceipt(input: SalesReceiptInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const qrCodes: QrCode[] = [];
  const totals = computeSaleTotals(input.lines, input.tax, input);
  const paid = sum(input.payments.map((payment) => payment.amount));
  const change = paid > totals.total ? sum([paid, -totals.total]) : 0;
  const vatNote = input.tax.vatRegistered ? "Prices include VAT." : undefined;
  const content = compose(width, [
    businessHeader(input.business, width),
    titleBar("RECEIPT", width),
    copyLine(ctx, width),
    grid(width, [
      `Receipt ${input.receiptNumber}`,
      input.issuedAt,
      input.billNumber && `Bill ${input.billNumber}`,
      input.table && `Table ${input.table}`,
      input.server && `Served by ${input.server}`,
      input.cashier && `Cashier ${input.cashier}`,
    ]),
    saleItemsTable(width, input.lines),
    saleTotalsTable(width, totals, ctx),
    paymentsTable(width, input.payments, change),
    paid < totals.total && box(width, [`BALANCE DUE ${money(sum([totals.total, -paid]))}`]),
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
  lines: InvoiceLine[];
  discount?: number;
  paidToDate?: number;
  payment?: MobileMoneyDetails & { bank?: string; bankAccount?: string };
  etims?: EtimsStatus;
  terms?: string;
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
  const totals = computeSaleTotals(input.lines, input.tax, { discount: input.discount });
  const paid = input.paidToDate ?? 0;
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
      ],
    ),
    invoiceItemsTable(width, input.lines, totals.vatRate ? `${totals.vatRate}%` : undefined),
    amountsTable(width, [
      totals.discount !== 0 && ["Discount", `(${money(totals.discount)})`],
      totals.net !== undefined && ["Net (excl. VAT)", money(totals.net)],
      totals.vat !== undefined && [`VAT ${totals.vatRate}%`, money(totals.vat)],
      ...levyRows(totals),
      ["TOTAL", money(totals.total)],
      paid !== 0 && ["Paid to date", `(${money(paid)})`],
      paid !== 0 && ["BALANCE DUE", money(balance)],
    ]),
    currencyNote(width, ctx),
    balance > 0 && mobileMoneyBlock(width, payment, balance, qrCodes),
    balance > 0 &&
      input.payment?.bank &&
      fields(width, [
        ["Bank", input.payment.bank],
        ["Account", input.payment.bankAccount],
      ]),
    etimsBlock(width, input.etims, qrCodes),
    signatures(width, ["Prepared by", "Received by"]),
    footer(width, terms),
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
