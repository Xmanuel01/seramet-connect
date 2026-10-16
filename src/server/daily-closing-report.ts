import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DayClose } from "@/payments/types";
import { formatMinor, parseMajorAmount, sumMinor } from "@/payments/money";

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
        ["Supervisor", report.supervisorId],
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
      title: `Cashier ${drawer.employeeId} / ${drawer.id}`,
      rows: [
        ["Opened", drawer.openedAt],
        ["Finalized", drawer.closedAt ?? "Not recorded"],
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
      [
        "Discount / service breakdown",
        "Not separately recorded by the current invoice ledger; no amounts inferred.",
      ],
    ],
  });
  return sections;
}

export async function renderDailyClosingPdf(snapshot: ClosingSnapshot): Promise<Uint8Array> {
  const report = snapshot.dailyReport;
  if (!report) throw new Error("Unified closing snapshot is required");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Daily Closing Report - ${report.reference}`);
  pdf.setSubject(report.reference);
  pdf.setCreationDate(new Date(snapshot.closedAt));
  pdf.setModificationDate(new Date(snapshot.closedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 800;
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
  const wrap = (value: string, width: number, size = 10) => {
    const lines: string[] = [];
    let line = "";
    for (const char of safe(value)) {
      if (regular.widthOfTextAtSize(line + char, size) > width && line) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
    return lines;
  };
  function space(height: number) {
    if (y - height < 55) {
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
  }
  function heading(text: string, size: number) {
    for (const line of wrap(text, 507, size)) {
      space(size + 12);
      page.drawText(line, { x: 44, y, size, font: bold, color: rgb(0.06, 0.3, 0.27) });
      y -= size + 8;
    }
  }
  heading(report.restaurant, 21);
  heading(report.branch, 13);
  heading("DAILY CLOSING REPORT", 16);
  for (const section of closingReportSections(snapshot)) {
    space(60);
    y -= 12;
    heading(section.title, 11);
    const rows = section.rows.length ? section.rows : [["None recorded", ""]];
    for (const [label, value] of rows) {
      const left = wrap(label!, 180),
        right = wrap(value!, 307);
      const lines = Math.max(left.length, right.length);
      for (let i = 0; i < lines; i++) {
        space(19);
        if (left[i]) page.drawText(left[i]!, { x: 44, y, size: 10, font: regular });
        if (right[i]) page.drawText(right[i]!, { x: 236, y, size: 10, font: regular });
        y -= 15;
      }
      page.drawLine({
        start: { x: 44, y: y + 8 },
        end: { x: 551, y: y + 8 },
        thickness: 0.3,
        color: rgb(0.8, 0.83, 0.83),
      });
      y -= 6;
    }
  }
  const pages = pdf.getPages();
  for (const [index, printed] of pages.entries())
    printed.drawText(`SERAMET | ${safe(report.reference)} | ${index + 1}/${pages.length}`, {
      x: 44,
      y: 25,
      size: 8,
      font: regular,
    });
  return pdf.save();
}
