// The approved KOT, BOT, invoice and receipt as rich documents: the typeset
// form printed by raster (image) printers and shown in print previews. The
// ruled text built in approved.ts stays the form for text-mode printers.
//
// Every value comes from the same input the text form prints; nothing here
// computes money. QR codes are drawn only from a real payload (an M-Pesa
// dynamic QR or a KRA eTIMS verification URL).

import QRCode from "qrcode";
import type {
  RichBlock,
  RichDocument,
  RichPaper,
  RichRun,
  RichStyle,
} from "../../../printing-core/rich-render.mjs";
import { clean, money, quantity } from "./ruled";
import { lineAmount } from "./shared";
import type {
  ApprovedInvoiceInput,
  ApprovedReceiptInput,
  DocumentBusiness,
  DocumentTotals,
  OrderTicketInput,
} from "./approved";
import type { EtimsStatus, Payment, SaleLine } from "./types";

export type { RichDocument };

const run = (s: RichStyle, text: string): RichRun => ({ s, text: clean(text) });
/** Fixed wording that keeps its trailing space (labels) or symbols (the phone sign). */
const raw = (s: RichStyle, text: string): RichRun => ({ s, text });
const text = (
  runs: RichRun[],
  extra: Partial<Extract<RichBlock, { t: "text" }>> = {},
): RichBlock => ({
  t: "text",
  runs,
  ...extra,
});
const centred = (s: RichStyle, value: string, pad?: number): RichBlock =>
  text([run(s, value)], { align: "center", ...(pad !== undefined ? { pad } : {}) });
const solid: RichBlock = { t: "rule", style: "solid" };
const dashed: RichBlock = { t: "rule", style: "dashed" };
const field = (
  label: string,
  value: string,
  l: RichStyle = "label",
  v: RichStyle = "value",
  pad = 3,
) => text([raw(l, `${label}: `), run(v, value)], { pad });

/** QR modules as rows of 0/1, from a real payload only. */
export function qrModules(payload: string): string[] {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const rows: string[] = [];
  for (let r = 0; r < modules.size; r++) {
    let row = "";
    for (let c = 0; c < modules.size; c++) row += modules.get(r, c) ? "1" : "0";
    rows.push(row);
  }
  return rows;
}

function indentFor(paper: RichPaper) {
  return paper === "80mm" ? 40 : 26;
}

// ---------------------------------------------------------------------------
// KOT and BOT

const STATUS: Record<OrderTicketInput["status"], string> = {
  NEW: "NEW ORDER",
  ADDITION: "ADDED ITEMS",
  VOID: "CANCELLED",
  REPRINT: "REPRINT",
};

export function orderTicketRich(input: OrderTicketInput, paper: RichPaper): RichDocument {
  const kind = input.station === "BAR" ? "BAR" : "KITCHEN";
  // Tickets breathe more than the financial documents, as in the approved design.
  const big = paper === "80mm";
  const line: RichBlock = { t: "rule", style: "dashed", pad: big ? 16 : 11 };
  const meta = (label: string, value: string) => field(label, value, "label", "value", big ? 7 : 5);
  const voided = input.status === "VOID";
  const indent = indentFor(paper);
  const items = input.lines.flatMap((item, i): RichBlock[] => [
    ...(i > 0 ? [line] : []),
    text([run("item", `${quantity(item.quantity)} x  ${item.name}`)], {
      hang: indent,
      pad: big ? 6 : 4,
    }),
    ...(item.modifiers ?? [])
      .filter((m) => clean(m))
      .map((m) => text([run("note", `- ${m}`)], { indent, pad: 1 })),
    ...(clean(item.note)
      ? [text([run("note", `Item instructions: ${clean(item.note)}`)], { indent, pad: 4 })]
      : []),
  ]);
  const general = clean(input.generalInstructions);
  const fill = "______________";
  const orderNumber = clean(input.orderNumber).replace(/^#?(?:ORD(?:ER)?[\s#:-]*)?#?/i, "");
  return {
    v: 1,
    paper,
    blocks: [
      { t: "gap", h: big ? 14 : 8 },
      centred("title", `${kind} ORDER`, big ? 10 : 6),
      {
        t: "spread",
        left: [run("status", STATUS[input.status])],
        right: [run("status", kind)],
        pad: big ? 10 : 6,
      },
      { t: "rule", style: "solid", pad: big ? 10 : 7 },
      text([run("orderNo", `ORDER #${orderNumber}`)], { pad: big ? 8 : 5 }),
      meta("DATE", input.date),
      meta("TIME", input.time),
      line,
      meta("CUSTOMER", clean(input.customer) || "Walk-in"),
      ...(clean(input.table) ? [meta("TABLE", clean(input.table))] : []),
      line,
      ...(voided ? [centred("banner", "DO NOT PREPARE THESE ITEMS", 4)] : []),
      ...items,
      line,
      ...(general
        ? [
            centred("section", "GENERAL INSTRUCTIONS", big ? 6 : 4),
            { t: "box", runs: [run("box", general)] } as RichBlock,
            line,
          ]
        : []),
      meta("REQUESTED BY", input.requestedBy),
      ...(voided
        ? [
            meta("REASON", clean(input.voidReason) || fill),
            meta("APPROVED BY", clean(input.voidApprovedBy) || fill),
          ]
        : []),
      line,
      centred("section", `END OF ${kind} ORDER`, big ? 8 : 5),
      { t: "gap", h: big ? 10 : 6 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Invoice and receipt

const TRADE_WORDS =
  /^(restaurant|cafe|bar|grill|hotel|lounge|kitchen|bistro|eatery|pizzeria|bakery)$/i;

/** "MONA SWAHILI" over "--- RESTAURANT ---" when the name ends in a trade word. */
function headerBlocks(business: DocumentBusiness): RichBlock[] {
  const words = clean(business.name).toUpperCase().split(" ").filter(Boolean);
  const sub = words.length > 1 && TRADE_WORDS.test(words.at(-1)!) ? words.pop()! : undefined;
  return [
    centred("name", words.join(" "), 0),
    ...(sub
      ? [{ t: "flanked", runs: [run("nameSub", sub)], tracking: 6, pad: 0 } as RichBlock]
      : []),
    ...(clean(business.address) ? [centred("address", clean(business.address), 1)] : []),
    ...(clean(business.phone)
      ? [text([raw("phone", `\u260e ${clean(business.phone)}`)], { align: "center", pad: 1 })]
      : []),
    { t: "rule", style: "solid", weight: "heavy", pad: 8 },
  ];
}

function infoColumns(
  number: string,
  customer: string,
  date: string,
  time: string,
  extra: Array<[string, string]>,
): RichBlock {
  return {
    t: "columns",
    divider: true,
    cols: [
      {
        w: 60,
        valign: "middle",
        blocks: [
          text([run("docNo", number)], { pad: 4 }),
          { t: "gap", h: 6 },
          field("CUSTOMER", customer, "infoLabel", "infoValue"),
          ...extra.map(([label, value]) => field(label, value, "infoLabel", "infoValue")),
        ],
      },
      {
        w: 40,
        blocks: [
          text([run("infoLabel", "DATE:")], { pad: 1 }),
          text([run("infoValue", date)], { pad: 1, indent: 4 }),
          text([run("infoLabel", "TIME:")], { pad: 1 }),
          text([run("infoValue", time)], { pad: 1, indent: 4 }),
        ],
      },
    ],
  };
}

function itemsTable(lines: SaleLine[], currency: string, paper: RichPaper): RichBlock {
  const mods = (line: SaleLine) =>
    (line.modifiers ?? []).filter((m) => clean(m)).map((m) => `- ${clean(m)}`);
  if (paper === "80mm")
    return {
      t: "table",
      cols: [
        { w: 10, align: "center" },
        { w: 40 },
        { w: 24, align: "right" },
        { w: 26, align: "right" },
      ],
      head: ["QTY", "ITEM", `UNIT (${currency})`, `TOTAL (${currency})`],
      rows: lines.map((line) => [
        quantity(line.quantity),
        [clean(line.name), ...mods(line)],
        money(line.unitPrice),
        money(lineAmount(line)),
      ]),
    };
  return {
    t: "table",
    cols: [{ w: 12, align: "center" }, { w: 55 }, { w: 33, align: "right" }],
    head: ["QTY", "ITEM", `TOTAL (${currency})`],
    rows: lines.map((line) => [
      quantity(line.quantity),
      [clean(line.name), `@ ${money(line.unitPrice)}`, ...mods(line)],
      money(lineAmount(line)),
    ]),
  };
}

function totalsBlocks(totals: DocumentTotals, currency: string): RichBlock[] {
  const rows: Array<[string, string]> = [["SUBTOTAL", money(totals.subtotal)]];
  if (totals.serviceCharge) rows.push(["SERVICE CHARGE", money(totals.serviceCharge)]);
  if (totals.discount) rows.push(["DISCOUNT", `(${money(totals.discount)})`]);
  if (totals.vat !== undefined) rows.push([totals.vatLabel ?? "VAT", money(totals.vat)]);
  if (totals.deliveryCharge) rows.push(["DELIVERY CHARGE", money(totals.deliveryCharge)]);
  return [
    { t: "amounts", rows },
    { t: "rule", style: "solid", pad: 6 },
    {
      t: "spread",
      left: [run("grand", "GRAND TOTAL")],
      right: [run("grand", `${currency} ${money(totals.total)}`)],
      pad: 4,
    },
    { t: "rule", style: "solid", pad: 6 },
  ];
}

export function invoiceRich(
  input: ApprovedInvoiceInput,
  paper: RichPaper,
  currency: string,
): RichDocument {
  const paid = input.paid ?? 0;
  const balance = Math.max(0, Math.round((input.totals.total - paid) * 100) / 100);
  const till = clean(input.mpesa?.till);
  const paybill = clean(input.mpesa?.paybill);
  const payload = clean(input.mpesa?.qrPayload);
  const details: RichBlock[] = [
    ...(till ? [text([raw("payText", "Till No. "), run("payText", till)], { pad: 3 })] : []),
    ...(paybill ? [field("Paybill", paybill, "payText", "payText")] : []),
    ...(paybill && clean(input.mpesa?.account)
      ? [field("Account", clean(input.mpesa?.account), "payText", "payText")]
      : []),
    field("Amount", `${currency} ${money(balance)}`, "payText", "payText"),
  ];
  const pay: RichBlock[] =
    (till || paybill) && balance > 0
      ? payload
        ? [
            {
              t: "columns",
              divider: true,
              cols: [
                {
                  w: 38,
                  blocks: [
                    { t: "qr", modules: qrModules(payload), size: paper === "80mm" ? 190 : 130 },
                  ],
                },
                {
                  w: 62,
                  valign: "middle",
                  blocks: [
                    text([run("payHead", "SCAN TO PAY")], { pad: 1 }),
                    text([run("payHead", "WITH M-PESA")], { pad: 3 }),
                    ...details,
                  ],
                },
              ],
            },
          ]
        : [
            text([run("payHead", "PAY WITH M-PESA")], { pad: 3 }),
            ...details,
            text([run("small", "Scan-to-pay QR is not available yet.")], { pad: 3 }),
          ]
      : [];
  const instructions =
    balance > 0 ? (input.paymentInstructions ?? []).map(clean).filter(Boolean) : [];
  const extra: Array<[string, string]> = [];
  if (clean(input.table)) extra.push(["TABLE", clean(input.table)]);
  if (clean(input.deliverTo)) extra.push(["DELIVER TO", clean(input.deliverTo)]);
  return {
    v: 1,
    paper,
    blocks: [
      ...headerBlocks(input.business),
      centred("title", "INVOICE", 2),
      infoColumns(
        displayNo("INV", input.invoiceNumber),
        clean(input.customer) || "Walk-in",
        input.date,
        input.time,
        extra,
      ),
      dashed,
      itemsTable(input.lines, currency, paper),
      ...totalsBlocks(input.totals, currency),
      ...(paid > 0
        ? [
            {
              t: "amounts",
              rows: [
                ["AMOUNT PAID", money(paid)],
                ["BALANCE DUE", money(balance)],
              ],
            } as RichBlock,
          ]
        : []),
      ...pay,
      ...instructions.map((line) => text([run("payText", line)], { pad: 1 })),
      { t: "gap", h: paper === "80mm" ? 12 : 8 },
    ],
  };
}

function paymentBlocks(
  payments: Payment[],
  change: number | undefined,
  balance: number,
  currency: string,
) {
  const blocks: RichBlock[] = [text([run("payHead", "PAYMENT DETAILS")], { pad: 3 })];
  payments.forEach((payment, i) => {
    if (i > 0) blocks.push({ t: "gap", h: 6 });
    blocks.push(field("Method", clean(payment.method), "payText", "payText"));
    if (clean(payment.reference))
      blocks.push(field("Reference", clean(payment.reference), "payText", "payText"));
    blocks.push(field("Amount Paid", `${currency} ${money(payment.amount)}`, "payText", "payText"));
  });
  if (change) blocks.push(field("Change", `${currency} ${money(change)}`, "payText", "payText"));
  if (balance > 0)
    blocks.push(field("Balance Due", `${currency} ${money(balance)}`, "payText", "payText"));
  return blocks;
}

function etimsBlocks(etims: EtimsStatus, paper: RichPaper): RichBlock[] {
  if (etims.status === "PENDING")
    return [centred("payHead", "eTIMS PENDING", 3), centred("small", "Awaiting KRA signature.", 1)];
  return [
    centred("payHead", "eTIMS VERIFY", 3),
    ...(etims.verifyUrl
      ? [
          {
            t: "qr",
            modules: qrModules(etims.verifyUrl),
            size: paper === "80mm" ? 150 : 120,
          } as RichBlock,
        ]
      : []),
    centred("small", `CU: ${clean(etims.cuSerial)}`, 1),
    centred("small", `Inv: ${clean(etims.cuInvoiceNumber)}`, 1),
  ];
}

export function receiptRich(
  input: ApprovedReceiptInput,
  paper: RichPaper,
  currency: string,
): RichDocument {
  const settled = input.paid + 0.005 >= input.totals.total;
  const balance = Math.max(0, Math.round((input.totals.total - input.paid) * 100) / 100);
  const payments = paymentBlocks(input.payments, input.change, balance, currency);
  const loyalty = input.loyalty;
  const points = (value: number | undefined) =>
    value === undefined ? undefined : value.toLocaleString("en-US");
  const loyaltyBlocks: RichBlock[] = loyalty
    ? (
        [
          ["Member", loyalty.memberCode],
          ["Points earned", points(loyalty.pointsEarned)],
          ["Points balance", points(loyalty.pointsBalance)],
          ["Reward used", loyalty.rewardUsed],
          ["Voucher used", loyalty.voucherUsed],
        ] as Array<[string, string | undefined]>
      )
        .filter(([, value]) => clean(value))
        .map(([label, value]) => field(label, clean(value), "payText", "payText"))
        .concat(clean(loyalty.message) ? [centred("small", clean(loyalty.message), 2)] : [])
    : [];
  return {
    v: 1,
    paper,
    blocks: [
      ...headerBlocks(input.business),
      {
        t: "spread",
        left: [run("title", "RECEIPT")],
        right: settled ? [run("pill", "PAID")] : [],
        rightBox: settled,
        pad: 2,
      },
      infoColumns(
        displayNo("RCPT", input.receiptNumber),
        clean(input.customer) || "Walk-in",
        input.date,
        input.time,
        clean(input.table) ? [["TABLE", clean(input.table)]] : [],
      ),
      dashed,
      itemsTable(input.lines, currency, paper),
      ...totalsBlocks(input.totals, currency),
      ...(input.etims
        ? [
            {
              t: "columns",
              divider: true,
              cols: [
                { w: 56, blocks: payments },
                { w: 44, blocks: etimsBlocks(input.etims, paper) },
              ],
            } as RichBlock,
          ]
        : payments),
      ...(loyaltyBlocks.length ? [dashed, ...loyaltyBlocks] : []),
      { t: "rule", style: "solid", pad: 8 },
      centred("thanks", "THANK YOU FOR YOUR BUSINESS", 4),
    ],
  };
}

function displayNo(prefix: "INV" | "RCPT", value: string) {
  const strip = prefix === "INV" ? /^INV(?:OICE)?[\s#:-]*/i : /^(?:RCPT|RCP|REC)[\s#:-]*/i;
  return `${prefix} #${clean(value).replace(strip, "").replace(/^#/, "")}`;
}

/** A banner above the document, e.g. DUPLICATE COPY or PRINTER TEST. */
export function bannerRich(doc: RichDocument, title: string, detail?: string): RichDocument {
  return {
    ...doc,
    blocks: [
      centred("banner", title, 2),
      ...(clean(detail) ? [centred("small", clean(detail), 1)] : []),
      { t: "rule", style: "dashed" },
      ...doc.blocks,
    ],
  };
}

/** A reprint carries a DUPLICATE COPY banner, as the text form does. */
export function duplicateRich(doc: RichDocument, operator?: string): RichDocument {
  return bannerRich(
    doc,
    "DUPLICATE COPY",
    clean(operator) ? `Reprinted by: ${clean(operator)}` : undefined,
  );
}
