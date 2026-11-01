import {
  box,
  centered,
  compose,
  deduction,
  fieldPanels,
  fields,
  money,
  quantity,
  signatures,
  sum,
  table,
  times,
  vatFromInclusive,
  vatOnExclusive,
  type Cell,
  type Column,
} from "./ruled";
import {
  amountsTable,
  businessHeader,
  copyLine,
  currencyNote,
  footer,
  saleColumns,
  titleBar,
  widthOf,
} from "./shared";
import type { BusinessIdentity, DisplayTime, Party, PrintContext, PrintedDocument } from "./types";

const right = (width: number): Column => ({ width, align: "right" });

function branchLine(business: BusinessIdentity, width: number) {
  return centered([business.name, business.branch].filter(Boolean).join(" / "), width);
}

// ---------------------------------------------------------------------------
// Rider cash collection slip

export interface RiderCashSlipInput {
  business: BusinessIdentity;
  slipNumber: string;
  rider: string;
  vehicle?: string;
  businessDate: DisplayTime;
  settledAt: DisplayTime;
  orders: Array<{ orderNumber: string; channel: string; due: number }>;
  handedOver: Array<{ method: string; reference?: string; amount: number }>;
}

export function renderRiderCashSlip(input: RiderCashSlipInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const due = sum(input.orders.map((order) => order.due));
  const received = sum(input.handedOver.map((item) => item.amount));
  const variance = sum([due, -received]);
  const amountWidth = saleColumns(width).totals;
  const wide = width >= 40;
  const content = compose(width, [
    branchLine(input.business, width),
    titleBar("RIDER CASH COLLECTION", width),
    copyLine(ctx, width),
    fields(width, [
      ["Slip no.", input.slipNumber],
      ["Rider", [input.rider, input.vehicle].filter(Boolean).join(" / ")],
      ["Business date", input.businessDate],
      ["Settled at", input.settledAt],
    ]),
    table(
      width,
      [{ width: wide ? 10 : 8 }, { min: 6 }, right(wide ? amountWidth : 10)],
      [
        ...input.orders.map((order) => [order.orderNumber, order.channel, money(order.due)]),
        { cells: [`${input.orders.length} orders`, "Total due", money(due)], ruleBefore: true },
      ],
      { header: ["Order", "Channel", "Due"] },
    ),
    table(
      width,
      [{ min: 10 }, right(amountWidth)],
      [
        ...input.handedOver.map((item): Cell[] => [
          [item.method, ...(item.reference ? [item.reference] : [])],
          money(item.amount),
        ]),
        { cells: ["Total received", money(received)], ruleBefore: true },
        { cells: [variance >= 0 ? "SHORT" : "OVER", money(Math.abs(variance))], ruleBefore: true },
      ],
      { header: ["Handed over", "Amount"], doubleEnd: true },
    ),
    signatures(width, ["Rider", "Cashier"]),
    footer(width, variance > 0 ? "Shortage is posted to the rider's account." : undefined),
  ]);
  return { kind: "RIDER_CASH_SLIP", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Shift reports: X (interim, counters kept) and Z (close, counters reset)

export interface ShiftReportInput {
  type: "X" | "Z";
  business: BusinessIdentity;
  reportNumber?: string;
  businessDate: DisplayTime;
  shiftOpened: DisplayTime;
  /** Close time for Z, print time for X. */
  shiftEnd: DisplayTime;
  cashier: string;
  approvedBy?: string;
  grossSales: number;
  discounts: number;
  creditNotes?: number;
  vatRate?: number;
  categories?: Array<{ name: string; amount: number }>;
  payments: Array<{ method: string; count?: number; amount: number }>;
  drawer: { openingFloat: number; payouts?: number; counted?: number };
  orders: number;
  covers?: number;
  voids?: { count: number; amount: number };
  riderShortages?: number;
  receiptRange?: string;
  etimsPending?: number;
}

export function renderShiftReport(input: ShiftReportInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const z = input.type === "Z";
  const net = sum([input.grossSales, -input.discounts, -(input.creditNotes ?? 0)]);
  const vat = input.vatRate ? vatFromInclusive(net, input.vatRate) : undefined;
  const paymentsTotal = sum(input.payments.map((payment) => payment.amount));
  const transactions = input.payments.reduce((count, payment) => count + (payment.count ?? 0), 0);
  const cash = sum(
    input.payments.filter((payment) => /^cash$/i.test(payment.method)).map((p) => p.amount),
  );
  const expected = sum([input.drawer.openingFloat, cash, -(input.drawer.payouts ?? 0)]);
  const counted = input.drawer.counted;
  const variance = counted === undefined ? undefined : sum([counted, -expected]);
  // Same right-hand column as every other amounts table, so stacked rules line up.
  const amountWidth = saleColumns(width).totals;
  const title = z
    ? `Z REPORT - SHIFT CLOSE${input.reportNumber ? ` ${input.reportNumber}` : ""}`
    : "X REPORT - INTERIM";
  const covers = input.covers !== undefined ? ` / ${input.covers} covers` : "";

  const content = compose(width, [
    branchLine(input.business, width),
    centered(input.business.taxPin && `PIN ${input.business.taxPin}`, width),
    titleBar(title, width, z ? undefined : "Shift still open. Counters not reset."),
    copyLine(ctx, width),
    fields(width, [
      ["Business date", input.businessDate],
      ["Shift", `${input.shiftOpened} - ${input.shiftEnd}`],
      [z ? "Closed by" : "Cashier", input.cashier],
      ["Approved by", z ? input.approvedBy : undefined],
    ]),
    amountsTable(
      width,
      [
        ["Gross sales", money(input.grossSales)],
        ["Discounts", deduction(input.discounts)],
        input.creditNotes !== undefined && ["Credit notes", deduction(input.creditNotes)],
        ["Net sales", money(net)],
        vat !== undefined && ["Net excl. VAT", money(sum([net, -vat]))],
        vat !== undefined && [`VAT ${input.vatRate}%`, money(vat)],
      ],
      false,
    ),
    Boolean(input.categories?.length) &&
      table(
        width,
        [{ min: 8 }, right(amountWidth)],
        (input.categories ?? []).map((category) => [category.name, money(category.amount)]),
        { header: ["By category", "Amount"] },
      ),
    table(
      width,
      [{ min: 8 }, right(5), right(amountWidth - 6)],
      [
        ...input.payments.map((payment) => [
          payment.method,
          payment.count === undefined ? "" : String(payment.count),
          money(payment.amount),
        ]),
        {
          cells: ["Total", transactions ? String(transactions) : "", money(paymentsTotal)],
          ruleBefore: true,
        },
      ],
      { header: ["By payment", "Txns", "Amount"] },
    ),
    paymentsTotal !== net &&
      box(width, [`CHECK: payments differ from net sales by ${money(sum([paymentsTotal, -net]))}`]),
    amountsTable(width, [
      ["Opening float", money(input.drawer.openingFloat)],
      ["Cash sales", money(cash)],
      input.drawer.payouts !== undefined && ["Payouts", deduction(input.drawer.payouts)],
      ["Expected cash", money(expected)],
      counted !== undefined && ["Counted cash", money(counted)],
      variance !== undefined && ["VARIANCE", variance < 0 ? deduction(variance) : money(variance)],
    ]),
    fields(width, [
      ["Orders", `${input.orders}${covers}`],
      ["Average ticket", input.orders ? money(net / input.orders) : undefined],
      [
        "Voids (not in sales)",
        input.voids && `${input.voids.count} / ${money(input.voids.amount)}`,
      ],
      [
        "Rider shortages",
        input.riderShortages !== undefined ? money(input.riderShortages) : undefined,
      ],
      ["Receipts", input.receiptRange],
      ["eTIMS pending", input.etimsPending !== undefined ? String(input.etimsPending) : undefined],
    ]),
    z && signatures(width, ["Cashier", "Supervisor"]),
    footer(width, z ? `Counters reset. Printed ${input.shiftEnd}.` : "Interim report only."),
  ]);
  return { kind: z ? "Z_REPORT" : "X_REPORT", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Purchase order

export interface PurchaseOrderInput {
  business: BusinessIdentity;
  supplier: Party;
  poNumber: string;
  orderDate: DisplayTime;
  deliverBy?: DisplayTime;
  deliverTo?: string;
  paymentTerms?: string;
  /** VAT charged on top of VAT-exclusive prices; omit for suppliers not registered for VAT. */
  vatRate?: number;
  lines: Array<{ name: string; unit: string; quantity: number; unitPrice: number }>;
  instructions?: string;
}

export function renderPurchaseOrder(input: PurchaseOrderInput, ctx: PrintContext): PrintedDocument {
  const width = widthOf(ctx);
  const amount = (line: PurchaseOrderInput["lines"][number]) =>
    times(line.quantity, line.unitPrice);
  const subtotal = sum(input.lines.map(amount));
  const vat = input.vatRate ? vatOnExclusive(subtotal, input.vatRate) : 0;
  const items =
    width >= 70
      ? table(
          width,
          [
            right(3),
            { min: 16 },
            { width: 12 },
            right(5),
            right(11),
            right(saleColumns(width).totals),
          ],
          input.lines.map((line, index) => [
            String(index + 1),
            line.name,
            line.unit,
            quantity(line.quantity),
            money(line.unitPrice),
            money(amount(line)),
          ]),
          { header: ["#", "Item", "Unit", "Qty", "Unit price", "Amount"] },
        )
      : table(
          width,
          [{ min: 10 }, right(4), right(width >= 40 ? 11 : 10)],
          input.lines.map((line) => [
            [line.name, `${line.unit} @ ${money(line.unitPrice)}`],
            quantity(line.quantity),
            money(amount(line)),
          ]),
          { header: ["Item", "Qty", "Amount"] },
        );
  const instructions =
    input.instructions ??
    `Quote ${input.poNumber} on the delivery note and invoice. Goods are checked against this order on a GRN.`;
  const content = compose(width, [
    businessHeader(input.business, width),
    titleBar("PURCHASE ORDER", width),
    copyLine(ctx, width),
    fieldPanels(
      width,
      [
        ["Supplier", input.supplier.name],
        ["Address", input.supplier.address],
        ["Supplier PIN", input.supplier.taxPin],
        ["Contact", input.supplier.contact],
      ],
      [
        ["PO no.", input.poNumber],
        ["Order date", input.orderDate],
        ["Deliver by", input.deliverBy],
        ["Deliver to", input.deliverTo],
        ["Terms", input.paymentTerms],
      ],
    ),
    items,
    amountsTable(width, [
      ["Subtotal excl. VAT", money(subtotal)],
      input.vatRate !== undefined && [`VAT ${input.vatRate}%`, money(vat)],
      ["TOTAL", money(sum([subtotal, vat]))],
    ]),
    currencyNote(width, ctx),
    box(width, [instructions]),
    signatures(width, ["Requested by", "Approved by", "Supplier"]),
  ]);
  return { kind: "PURCHASE_ORDER", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Goods received note

export interface GoodsReceivedLine {
  name: string;
  unit: string;
  ordered: number;
  received: number;
  rejected?: number;
  unitPrice: number;
  remarks?: string;
}

export interface GoodsReceivedNoteInput {
  business: BusinessIdentity;
  supplier: Party;
  grnNumber: string;
  poNumber?: string;
  deliveryNote?: string;
  supplierInvoice?: string;
  receivedAt: DisplayTime;
  receivedInto?: string;
  vatRate?: number;
  lines: GoodsReceivedLine[];
  returnNote?: string;
}

function receivedItems(width: number, lines: GoodsReceivedLine[]) {
  const accepted = (line: GoodsReceivedLine) => line.received - (line.rejected ?? 0);
  const value = (line: GoodsReceivedLine) => money(times(accepted(line), line.unitPrice));
  const remarks = (line: GoodsReceivedLine) => (line.remarks ? [line.remarks] : []);
  const counts = (line: GoodsReceivedLine) =>
    `Ord ${quantity(line.ordered)} / Rec ${quantity(line.received)} / Rej ${quantity(line.rejected ?? 0)}`;
  const priced = (line: GoodsReceivedLine) => `${line.unit} @ ${money(line.unitPrice)}`;
  const options = { rowRules: true };

  if (width >= 70)
    return table(
      width,
      [
        right(3),
        { min: 14 },
        right(4),
        right(4),
        right(4),
        right(4),
        right(10),
        right(saleColumns(width).totals),
      ],
      lines.map((line, index) => [
        String(index + 1),
        [line.name, line.unit, ...remarks(line)],
        quantity(line.ordered),
        quantity(line.received),
        quantity(line.rejected ?? 0),
        quantity(accepted(line)),
        money(line.unitPrice),
        value(line),
      ]),
      { ...options, header: ["#", "Item", "Ord", "Rec", "Rej", "Acc", "Unit price", "Amount"] },
    );
  if (width >= 40)
    return table(
      width,
      [{ min: 10 }, right(3), right(3), right(3), right(10)],
      lines.map((line) => [
        [line.name, priced(line), ...remarks(line)],
        quantity(line.ordered),
        quantity(line.received),
        quantity(accepted(line)),
        value(line),
      ]),
      { ...options, header: ["Item", "Ord", "Rec", "Acc", "Amount"] },
    );
  // 58mm: ordered/received/rejected move under the item name.
  return table(
    width,
    [{ min: 10 }, right(3), right(10)],
    lines.map((line) => [
      [line.name, priced(line), counts(line), ...remarks(line)],
      quantity(accepted(line)),
      value(line),
    ]),
    { ...options, header: ["Item", "Acc", "Amount"] },
  );
}

export function renderGoodsReceivedNote(
  input: GoodsReceivedNoteInput,
  ctx: PrintContext,
): PrintedDocument {
  const width = widthOf(ctx);
  const subtotal = sum(
    input.lines.map((line) => times(line.received - (line.rejected ?? 0), line.unitPrice)),
  );
  const vat = input.vatRate ? vatOnExclusive(subtotal, input.vatRate) : 0;
  const content = compose(width, [
    businessHeader(input.business, width),
    titleBar("GOODS RECEIVED NOTE", width),
    copyLine(ctx, width),
    fieldPanels(
      width,
      [
        ["Supplier", input.supplier.name],
        ["Delivery note", input.deliveryNote],
        ["Supplier inv.", input.supplierInvoice],
      ],
      [
        ["GRN no.", input.grnNumber],
        ["Against PO", input.poNumber],
        ["Received", input.receivedAt],
        ["Received at", input.receivedInto],
      ],
    ),
    receivedItems(width, input.lines),
    amountsTable(width, [
      ["Accepted excl. VAT", money(subtotal)],
      input.vatRate !== undefined && [`VAT ${input.vatRate}%`, money(vat)],
      ["TOTAL", money(sum([subtotal, vat]))],
    ]),
    currencyNote(width, ctx),
    input.returnNote && fields(width, [["Return note", input.returnNote]]),
    signatures(width, ["Received by", "Checked by", "Driver"]),
    footer(width, "Only accepted quantities are posted to stock and payable."),
  ]);
  return { kind: "GOODS_RECEIVED_NOTE", paper: ctx.paper, content, qrCodes: [] };
}

// ---------------------------------------------------------------------------
// Stock transfer note

export interface StockTransferNoteInput {
  business: BusinessIdentity;
  stnNumber: string;
  date: DisplayTime;
  from: string;
  to: string;
  reason?: string;
  transport?: string;
  lines: Array<{
    name: string;
    unit: string;
    quantity: number;
    unitCost: number;
    remarks?: string;
  }>;
}

export function renderStockTransferNote(
  input: StockTransferNoteInput,
  ctx: PrintContext,
): PrintedDocument {
  const width = widthOf(ctx);
  const value = (line: StockTransferNoteInput["lines"][number]) =>
    times(line.quantity, line.unitCost);
  const total = sum(input.lines.map(value));
  const remarks = (line: StockTransferNoteInput["lines"][number]) =>
    line.remarks ? [line.remarks] : [];
  // "Received" stays blank: the receiving branch fills it in by hand.
  const items =
    width >= 70
      ? table(
          width,
          [
            right(3),
            { min: 14 },
            { width: 12 },
            right(5),
            { width: 8 },
            right(10),
            right(saleColumns(width).totals),
          ],
          input.lines.map((line, index) => [
            String(index + 1),
            [line.name, ...remarks(line)],
            line.unit,
            quantity(line.quantity),
            "",
            money(line.unitCost),
            money(value(line)),
          ]),
          {
            header: ["#", "Item", "Unit", "Sent", "Received", "Unit cost", "Value"],
            rowRules: true,
          },
        )
      : table(
          width,
          [{ min: 10 }, right(4), { width: width >= 40 ? 5 : 4 }, right(width >= 40 ? 11 : 9)],
          input.lines.map((line) => [
            [line.name, line.unit, ...remarks(line)],
            quantity(line.quantity),
            "",
            money(value(line)),
          ]),
          { header: ["Item", "Sent", "Rcvd", "Value"], rowRules: true },
        );
  const content = compose(width, [
    centered(input.business.name, width),
    titleBar("STOCK TRANSFER NOTE", width),
    copyLine(ctx, width),
    fields(width, [
      ["STN no.", input.stnNumber],
      ["Date", input.date],
      ["From", input.from],
      ["To", input.to],
      ["Reason", input.reason],
      ["Transport", input.transport],
    ]),
    items,
    amountsTable(width, [["Total value at cost", money(total)]]),
    signatures(width, ["Issued by", "Transported by", "Received by"]),
    footer(
      width,
      "Receiving branch fills in Received and signs. Variances are flagged in Seramet.",
    ),
  ]);
  return { kind: "STOCK_TRANSFER_NOTE", paper: ctx.paper, content, qrCodes: [] };
}
