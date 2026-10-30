import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DayClose } from "@/payments/types";
import {
  formatMinor,
  majorFromMinor,
  minorDigits,
  parseMajorAmount,
  sumMinor,
} from "@/payments/money";
import { summarizeInvoiceComponents } from "@/payments/invoice-components";
import { mpesaChannelLabels } from "@/payments/mpesa-day-summary";
import { QUANTITY_SCALE } from "@/inventory/quantity";

export type ClosingSnapshot = NonNullable<DayClose["snapshot"]>;
export type ClosingReportSection = { title: string; rows: Array<[string, string]> };

export function closingReportSections(snapshot: ClosingSnapshot): ClosingReportSection[] {
  const report = snapshot.dailyReport;
  if (!report) throw new Error("This historical close has no unified report snapshot");
  const money = (amount: number) => formatMinor(amount, snapshot.currency);
  const sections: ClosingReportSection[] = [
    {
      title: "Closing details",
      rows: [
        ["Reference", report.reference],
        ["Business date", snapshot.businessDate],
        ["Supervisor", report.operatorNames?.[report.supervisorId] ?? report.supervisorId],
        ["Closing mode", report.mode.replaceAll("_", " ")],
        [
          "Closed",
          new Intl.DateTimeFormat("en-GB", {
            timeZone: report.timeZone,
            dateStyle: "medium",
            timeStyle: "long",
          }).format(new Date(snapshot.closedAt)),
        ],
        [
          "Timezone / cutoff",
          `${report.timeZone} / ${Math.floor(report.cutoffMinutes / 60)
            .toString()
            .padStart(2, "0")}:${(report.cutoffMinutes % 60).toString().padStart(2, "0")}`,
        ],
      ],
    },
    {
      title: "Authoritative financial summary",
      rows: [
        ["Ordered", money(snapshot.orderedMinor)],
        ["Invoiced (including tax)", money(snapshot.invoicedMinor)],
        ["Settled invoices", money(snapshot.settledMinor)],
        ["Collections", money(snapshot.collectedMinor)],
        ["Settled revenue before tax", money(snapshot.netRevenueMinor)],
        ["Tax on settled invoices", money(snapshot.taxMinor)],
        ["Completed refunds", money(snapshot.refundsMinor)],
        ["Cash variance", money(snapshot.cashVarianceMinor)],
        ["Invoices / receipts", `${snapshot.invoiceCount} / ${snapshot.receiptCount}`],
        ["Voided invoices", String(report.voidedInvoiceIds.length)],
      ],
    },
    {
      title: "Collections by payment method",
      rows: snapshot.tenders.map((t) => [t.method, money(t.amountMinor)]),
    },
  ];
  for (const drawer of report.drawers) {
    sections.push({
      title: `Cashier ${report.operatorNames?.[drawer.employeeId] ?? drawer.employeeId}`,
      rows: [
        ["Drawer / session", drawer.id],
        [
          "Opened",
          new Intl.DateTimeFormat("en-GB", {
            timeZone: report.timeZone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(drawer.openedAt)),
        ],
        [
          "Finalized",
          drawer.closedAt
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone: report.timeZone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(drawer.closedAt))
            : "Not recorded",
        ],
        ["Status", drawer.status],
        ...Object.entries(drawer.currencyBalances).flatMap(
          ([currency, balance]): Array<[string, string]> => [
            [`${currency} opening float`, formatMinor(balance.openingFloatMinor, currency)],
            [`${currency} expected cash`, formatMinor(balance.expectedCashMinor, currency)],
            [
              `${currency} counted cash`,
              balance.countedCashMinor === undefined
                ? "Not recorded"
                : formatMinor(balance.countedCashMinor, currency),
            ],
            [
              `${currency} variance`,
              balance.varianceMinor === undefined
                ? "Not recorded"
                : formatMinor(balance.varianceMinor, currency),
            ],
          ],
        ),
        ...(drawer.varianceReason
          ? [["Variance explanation", drawer.varianceReason] as [string, string]]
          : []),
        ...(drawer.approvedBy
          ? [["Variance approved by", drawer.approvedBy] as [string, string]]
          : []),
      ],
    });
  }
  sections.push({
    title: "Recorded cash refunds, payouts and adjustments",
    rows: report.cashMovements
      .filter((m) => !["SALE", "OPENING_FLOAT"].includes(m.type))
      .map((m) => [
        `${m.type} / ${m.drawerSessionId} / ${m.actor}`,
        `${formatMinor(m.amountMinor, m.currency)} - ${m.reason}`,
      ]),
  });
  if (report.mpesa) {
    const mpesa = report.mpesa;
    const mpesaMoney = (amount: number) => formatMinor(amount, mpesa.currency);
    sections.push({
      title: "M-Pesa",
      rows: [
        ["Received", `${mpesaMoney(mpesa.receivedMinor)} (${mpesa.count} payments)`],
        ...mpesa.channels.map((row): [string, string] => [
          mpesaChannelLabels[row.channel],
          `${mpesaMoney(row.amountMinor)} (${row.count})`,
        ]),
        ["On bills", mpesaMoney(mpesa.onBillsMinor)],
        [
          "Not on a bill yet (all days)",
          `${mpesaMoney(mpesa.stillToMatchMinor)} (${mpesa.stillToMatch.length})`,
        ],
        ...(report.mpesaCarryOverReason
          ? [["Carried over because", report.mpesaCarryOverReason] as [string, string]]
          : []),
        ["Failed payment prompts", String(mpesa.failedPrompts.length)],
      ],
    });
    sections.push({
      title: "M-Pesa payments not on a bill yet",
      rows: mpesa.stillToMatch.map((row) => [
        [row.receipt ?? row.transactionId, row.payerName, row.businessDate]
          .filter(Boolean)
          .join(" / "),
        mpesaMoney(row.unallocatedMinor),
      ]),
    });
    sections.push({
      title: "Failed M-Pesa prompts",
      rows: mpesa.failedPrompts.map((row) => [
        `${row.invoiceId ?? row.intentId} / ${mpesaMoney(row.amountMinor)}`,
        row.reason,
      ]),
    });
  }
  sections.push({
    title: "Outstanding invoices (not silently settled)",
    rows: report.outstandingInvoices.map((i) => [i.id, money(i.balanceMinor)]),
  });
  sections.push({
    title: "Reported nonblocking obligations",
    rows: report.nonblocking.map((i) => [i.sourceId, i.message]),
  });
  sections.push({
    title: "Invoiced sales before tax",
    rows: [
      [
        "Invoice subtotals",
        money(
          sumMinor(report.invoices.map((i) => parseMajorAmount(i.subtotal, snapshot.currency))),
        ),
      ],
      [
        "Invoice tax",
        money(sumMinor(report.invoices.map((i) => parseMajorAmount(i.tax, snapshot.currency)))),
      ],
    ],
  });
  const components = summarizeInvoiceComponents(report.invoices, snapshot.currency);
  sections.push({
    title: "Invoiced economic components (before refunds)",
    rows:
      components.status === "COMPLETE"
        ? [
            ["Gross sales before discounts", money(components.totals.grossSalesMinor)],
            ["Discounts", money(components.totals.discountsMinor)],
            ["Net sales excluding service and tax", money(components.totals.netSalesMinor)],
            ["Service charges", money(components.totals.serviceChargeMinor)],
            ["Tax", money(components.totals.taxMinor)],
            ["Invoice total", money(components.totals.totalMinor)],
          ]
        : [
            [
              "Breakdown unavailable",
              `${components.missing} of ${components.invoiceCount} invoices lack a recorded breakdown. No gross, discount or service amounts inferred.`,
            ],
          ],
  });
  const products = new Map<string, { name: string; quantityMicro: number }>();
  for (const invoice of report.invoices)
    for (const line of invoice.lines) {
      const key = line.productId ?? line.name;
      const current = products.get(key) ?? { name: line.name, quantityMicro: 0 };
      const quantityMicro = Math.round(line.quantity * QUANTITY_SCALE);
      if (!Number.isSafeInteger(quantityMicro) || quantityMicro < 0)
        throw new Error("Report quantity exceeds supported precision");
      current.quantityMicro = sumMinor([current.quantityMicro, quantityMicro]);
      products.set(key, current);
    }
  const ranked = [...products.values()]
    .filter((product) => product.quantityMicro > 0)
    .sort((a, b) => b.quantityMicro - a.quantityMicro || a.name.localeCompare(b.name));
  const quantities = (rows: typeof ranked): Array<[string, string]> =>
    rows.map((product) => [
      product.name,
      new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(
        product.quantityMicro / QUANTITY_SCALE,
      ),
    ]);
  sections.push({
    title: "Highest-volume invoiced products (units)",
    rows: quantities(ranked.slice(0, 5)),
  });
  sections.push({
    title: "Lowest-volume sold products (units; not profit ranking)",
    rows: quantities([...ranked].reverse().slice(0, 5)),
  });
  return sections;
}

export const closingPdfLayout = Object.freeze({
  width: 595.28,
  height: 841.89,
  margin: 72,
  bodySize: 12,
  lineHeight: 24,
  pages: 3,
});

export async function renderDailyClosingPdf(snapshot: ClosingSnapshot): Promise<Uint8Array> {
  const report = snapshot.dailyReport;
  if (!report) throw new Error("Unified closing snapshot is required");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Daily Closing Report - ${report.reference}`);
  pdf.setSubject(report.reference);
  pdf.setCreationDate(new Date(snapshot.closedAt));
  pdf.setModificationDate(new Date(snapshot.closedAt));
  pdf.setKeywords(["Seramet", report.restaurant, report.branch, report.reference]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height, margin, bodySize, lineHeight } = closingPdfLayout;
  const usable = width - margin * 2;
  const green = rgb(0.06, 0.3, 0.27);
  const attention = rgb(0.68, 0.12, 0.15);
  const ink = rgb(0.09, 0.14, 0.18);
  const muted = rgb(0.32, 0.38, 0.4);
  const rule = rgb(0.8, 0.85, 0.84);
  const tint = rgb(0.94, 0.97, 0.96);
  let page = pdf.addPage([width, height]);
  let y = 620;
  const safe = (value: string) =>
    [...value.replace(/[\r\n\t]/g, " ")]
      .map((c) => {
        try {
          regular.encodeText(c);
          return c;
        } catch {
          return `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`;
        }
      })
      .join("");
  const wrap = (value: string, available: number, size: number = bodySize, font = regular) => {
    const lines: string[] = [];
    let line = "";
    for (const char of safe(value)) {
      if (font.widthOfTextAtSize(line + char, size) > available && line) {
        const boundary = line.lastIndexOf(" ");
        if (boundary > 0) {
          lines.push(line.slice(0, boundary));
          line = line.slice(boundary + 1);
        } else {
          lines.push(line);
          line = "";
        }
      }
      line = (line + char).trimStart();
    }
    lines.push(line);
    return lines;
  };
  const fit = (value: string, available: number, size: number = bodySize, font = regular) => {
    const text = safe(value);
    if (font.widthOfTextAtSize(text, size) <= available) return text;
    let end = text.length;
    while (end > 0 && font.widthOfTextAtSize(`${text.slice(0, end)}...`, size) > available) end--;
    return `${text.slice(0, end).trimEnd()}...`;
  };
  const text = (
    value: string,
    x: number,
    baseline: number,
    strong = false,
    size: number = bodySize,
    tone?: ReturnType<typeof rgb>,
  ) =>
    page.drawText(safe(value), {
      x,
      y: baseline,
      size,
      font: strong ? bold : regular,
      color: tone ?? (strong ? green : ink),
    });
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: report.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const header = (title: string) => {
    text("SERAMET", margin, height - margin, true, 18);
    page.drawRectangle({
      x: width - margin - 102,
      y: height - margin - 4,
      width: 102,
      height: 24,
      color: tint,
    });
    text("Confidential", width - margin - 91, height - margin + 3);
    text(title, margin, 734, true, 20);
    text(fit(report.restaurant, usable, bodySize, bold), margin, 706, true);
    text(fit(report.branch, usable), margin, 682);
    text(`Business date: ${snapshot.businessDate}`, margin, 658);
    const closed = date(snapshot.closedAt);
    text(closed, width - margin - regular.widthOfTextAtSize(closed, bodySize), 658);
    page.drawLine({
      start: { x: margin, y: 644 },
      end: { x: width - margin, y: 644 },
      thickness: 0.6,
      color: rule,
    });
    y = 620;
  };
  function heading(title: string) {
    text(fit(title, usable, 14, bold), margin, y, true, 14);
    y -= 28;
  }
  function row(label: string, value: string, strong = false) {
    // Financial values wrap at the requested font size; they are never ellipsized.
    const values = wrap(value, 161);
    if (y - values.length * lineHeight < margin - 12)
      throw new Error("Closing summary exceeds the three-page layout");
    text(fit(label, usable - 177, bodySize, strong ? bold : regular), margin, y, strong);
    for (const [index, line] of values.entries())
      text(
        line,
        width - margin - 161,
        y - index * lineHeight,
        strong,
        bodySize,
        label === "Cash variance" && snapshot.cashVarianceMinor !== 0 ? attention : undefined,
      );
    y -= values.length * lineHeight;
    page.drawLine({
      start: { x: margin, y: y + 12 },
      end: { x: width - margin, y: y + 12 },
      thickness: 0.35,
      color: rule,
    });
  }
  function note(value: string) {
    text(fit(value, usable), margin, y);
    y -= lineHeight;
  }
  function selectedRows(rows: Array<[string, string]>, limit: number) {
    if (!rows.length) return note("None recorded");
    for (const [label, value] of rows.slice(0, limit)) row(label, value);
    if (rows.length > limit)
      note(`${rows.length - limit} more entries in the saved closing record.`);
  }
  function metric(label: string, value: string, x: number) {
    const cardWidth = (usable - 12) / 2;
    page.drawRectangle({
      x,
      y: y - 64,
      width: cardWidth,
      height: 64,
      color: tint,
      borderColor: rule,
      borderWidth: 0.5,
    });
    text(label, x + 12, y - 20);
    text(value, x + 12, y - 44, true);
  }
  const sections = closingReportSections(snapshot);
  const section = (title: string) => sections.find((entry) => entry.title === title)!.rows;
  const money = (amount: number) => formatMinor(amount, snapshot.currency);
  const components = summarizeInvoiceComponents(report.invoices, snapshot.currency);

  header("Daily End of Day Report");
  heading("Management summary");
  metric(
    "Invoice gross sales",
    components.status === "COMPLETE" ? money(components.totals.grossSalesMinor) : "Not recorded",
    margin,
  );
  metric(
    "Invoice net sales",
    components.status === "COMPLETE" ? money(components.totals.netSalesMinor) : "Not recorded",
    margin + (usable + 12) / 2,
  );
  y -= 84;
  heading("Sales summary");
  for (const [label, value] of section("Authoritative financial summary").slice(0, 8))
    row(label, value, label === "Invoiced (including tax)");
  row(
    "Invoices / receipts / voids",
    `${snapshot.invoiceCount} / ${snapshot.receiptCount} / ${report.voidedInvoiceIds.length}`,
  );
  row(
    "Invoice discounts",
    components.status === "COMPLETE" ? money(components.totals.discountsMinor) : "Not recorded",
  );
  row(
    "Invoice service charges",
    components.status === "COMPLETE" ? money(components.totals.serviceChargeMinor) : "Not recorded",
  );
  heading("Payment breakdown");
  const tenders = snapshot.tenders;
  const paymentRows: Array<[string, string]> = tenders
    .slice(0, tenders.length > 4 ? 3 : 4)
    .map((t) => [t.method, money(t.amountMinor)]);
  if (tenders.length > 4)
    paymentRows.push([
      `Other methods (${tenders.length - 3})`,
      money(sumMinor(tenders.slice(3).map((t) => t.amountMinor))),
    ]);
  selectedRows(paymentRows, 4);
  // The three-page summary has room for one line; the full M-Pesa breakdown, unmatched list and
  // carry-over reason stay in the saved closing record and the emailed report.
  if (report.mpesa)
    row(
      "M-Pesa not on a bill",
      `${formatMinor(report.mpesa.stillToMatchMinor, report.mpesa.currency)} (${report.mpesa.stillToMatch.length})`,
      report.mpesa.stillToMatch.length > 0,
    );

  page = pdf.addPage([width, height]);
  header("Cash Reconciliation & Exceptions");
  heading(`Cash reconciliation (${snapshot.currency})`);
  const balances = report.drawers.flatMap((drawer) =>
    drawer.currencyBalances[snapshot.currency] ? [drawer.currencyBalances[snapshot.currency]!] : [],
  );
  if (balances.length) {
    row("Opening float", money(sumMinor(balances.map((b) => b.openingFloatMinor))));
    row("Expected closing cash", money(sumMinor(balances.map((b) => b.expectedCashMinor))));
    row(
      "Counted closing cash",
      balances.some((b) => b.countedCashMinor === undefined)
        ? "Not recorded for all drawers"
        : money(sumMinor(balances.map((b) => b.countedCashMinor!))),
    );
    row("Cash variance", money(snapshot.cashVarianceMinor), true);
  } else note("No drawer recorded for this currency.");
  const otherCurrencies = new Set(
    report.drawers
      .flatMap((drawer) => Object.keys(drawer.currencyBalances))
      .filter((currency) => currency !== snapshot.currency),
  );
  if (otherCurrencies.size)
    note(`${otherCurrencies.size} other currencies recorded; no conversion applied.`);
  heading(`Cashier reconciliations (${snapshot.currency})`);
  const decimal = (amount: number | undefined) =>
    amount === undefined
      ? "Not recorded"
      : new Intl.NumberFormat("en", {
          minimumFractionDigits: minorDigits(snapshot.currency),
          maximumFractionDigits: minorDigits(snapshot.currency),
        }).format(majorFromMinor(amount, snapshot.currency));
  text("Cashier", margin, y, true);
  text("Counted", margin + 184, y, true);
  text("Variance", margin + 320, y, true);
  y -= lineHeight;
  for (const drawer of report.drawers.slice(0, 2)) {
    text(fit(report.operatorNames?.[drawer.employeeId] ?? drawer.employeeId, 174), margin, y);
    const balance = drawer.currencyBalances[snapshot.currency];
    text(decimal(balance?.countedCashMinor), margin + 184, y);
    text(
      decimal(balance?.varianceMinor),
      margin + 320,
      y,
      false,
      bodySize,
      balance?.varianceMinor ? attention : undefined,
    );
    y -= lineHeight;
  }
  if (!report.drawers.length) note("None recorded");
  if (report.drawers.length > 2)
    note(`${report.drawers.length - 2} more reconciliations in the closing record.`);
  heading("Variance explanations");
  const reasons = report.drawers.filter((drawer) => drawer.varianceReason);
  if (!reasons.length) note("None recorded");
  else {
    note(
      `${report.operatorNames?.[reasons[0]!.employeeId] ?? reasons[0]!.employeeId}: ${reasons[0]!.varianceReason}`,
    );
    if (reasons.length > 1) note(`${reasons.length - 1} more explanations in the closing record.`);
  }
  heading("Cash refunds, payouts & adjustments");
  const movements = new Map<string, number[]>();
  for (const movement of report.cashMovements.filter(
    (m) => !["SALE", "OPENING_FLOAT"].includes(m.type),
  )) {
    const key = `${movement.type} / ${movement.currency}`;
    movements.set(key, [...(movements.get(key) ?? []), movement.amountMinor]);
  }
  selectedRows(
    [...movements].map(([key, amounts]): [string, string] => {
      const [type, currency] = key.split(" / ") as [string, string];
      const label = type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " ");
      return [`${label} / ${currency}`, formatMinor(sumMinor(amounts), currency)];
    }),
    1,
  );
  heading("Outstanding obligations");
  row(
    `Unpaid invoices (${report.outstandingInvoices.length})`,
    money(sumMinor(report.outstandingInvoices.map((i) => i.balanceMinor))),
  );
  row("Other reported exceptions", String(report.nonblocking.length));
  const cutoff = section("Closing details").find(([label]) => label === "Timezone / cutoff")![1];
  note(`Timezone / cutoff: ${cutoff}`);
  note(
    `Closing mode: ${report.mode === "SUPERVISOR_DAILY_CLOSE" ? "Supervisor daily close" : "Multiple cashier shifts"}`,
  );

  page = pdf.addPage([width, height]);
  header("Product Performance & Sign-off");
  heading("Top-selling items (invoiced units)");
  selectedRows(section("Highest-volume invoiced products (units)"), 5);
  heading("Lowest-volume sold items (units)");
  selectedRows(section("Lowest-volume sold products (units; not profit ranking)"), 5);
  for (const [label, value] of section("Invoiced sales before tax")) row(label, value);
  heading("Manager notes");
  note(snapshot.overrideReason ?? "No additional closing note recorded.");
  if (components.status !== "COMPLETE")
    note(`${components.missing} invoices lack gross/discount/service detail.`);
  heading("Review sign-off");
  row("Prepared by", fit(report.operatorNames?.[report.supervisorId] ?? report.supervisorId, 161));
  row("Branch manager", "____________________");
  row("Finance review", "____________________");

  const pages = pdf.getPages();
  for (const [index, printed] of pages.entries()) {
    printed.drawLine({
      start: { x: margin, y: 64 },
      end: { x: width - margin, y: 64 },
      thickness: 0.5,
      color: rule,
    });
    printed.drawText(fit(report.reference, usable - 80), {
      x: margin,
      y: 44,
      size: bodySize,
      font: regular,
      color: muted,
    });
    printed.drawText(`${index + 1} / ${pages.length}`, {
      x: width - margin - 32,
      y: 44,
      size: bodySize,
      font: regular,
      color: muted,
    });
    printed.drawText("Summary only. Full details and labels remain in the saved closing record.", {
      x: margin,
      y: 20,
      size: bodySize,
      font: regular,
      color: muted,
    });
  }
  return pdf.save();
}
