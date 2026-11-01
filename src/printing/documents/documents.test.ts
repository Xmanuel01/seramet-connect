import { describe, expect, it } from "vitest";
import { buildThermalLayout, isStrongLine } from "../../../printing-core/thermal-layout.mjs";
import { compose, fields, table, vatFromInclusive } from "./ruled";
import { computeSaleTotals } from "./shared";
import { renderAllSamples } from "./samples";
import { renderSalesReceipt, renderCustomerBill } from "./front-of-house";
import { renderShiftReport } from "./back-office";
import type { PrintContext } from "./types";

const RULE = /^\+[+\-=]+\+$/;

const PAPERS = [
  ["58mm", 32],
  ["80mm", 42],
  ["A4", 78],
] as const;

function assertRuled(content: string, width: number) {
  for (const line of content.split("\n")) {
    expect(line.length, line).toBeLessThanOrEqual(width);
    expect(line, line).toMatch(/^[\x20-\x7e]*$/);
    if (line.startsWith("|") || line.startsWith("+")) expect(line.length, line).toBe(width);
  }
  expect(content).not.toMatch(/\.{6,}/); // no dotted separators
  expect(content).not.toMatch(/^ *-{6,} *$/m); // no bare dashed separators outside tables
}

describe("Seramet printed documents", () => {
  for (const [paper, width] of PAPERS) {
    describe(paper, () => {
      const documents = renderAllSamples(paper);

      it("renders all sixteen document kinds", () => {
        expect(new Set(documents.map((d) => d.kind)).size).toBe(16);
      });

      for (const document of documents) {
        it(`${document.kind} fits ${width} columns with continuous ruled tables`, () => {
          assertRuled(document.content, width);
          if (paper !== "A4") {
            // The bridge accepts it, and every table row lines up with the rule above it.
            const layout = buildThermalLayout(document.content, paper);
            for (const row of layout.rows.filter((r) => r.kind === "table")) {
              expect(row.borders[0]).toBe(0);
              expect(row.borders.at(-1)).toBe(width - 1);
            }
          }
        });
      }
    });
  }

  it("never prints two rules in a row: stacked tables share one border", () => {
    for (const document of renderAllSamples("80mm")) {
      const lines = document.content.split("\n");
      for (let i = 1; i < lines.length; i++)
        expect(
          RULE.test(lines[i - 1]) && RULE.test(lines[i]),
          `${document.kind}: ${lines[i]}`,
        ).toBe(false);
    }
  });

  it("merges the junctions of stacked tables so every column line continues", () => {
    const merged = compose(20, [
      table(20, [{}, {}], [["a", "b"]]),
      table(20, [{ width: 4 }, {}], [["c", "d"]]),
    ]);
    const rules = merged.split("\n").filter((l) => l.startsWith("+"));
    expect(rules).toHaveLength(3);
    expect(rules[1]).toBe("+----+----+--------+");
  });

  it("drops empty optional fields instead of printing blanks", () => {
    const content = compose(42, [
      fields(42, [
        ["Phone", undefined],
        ["Table", "T-12"],
      ]),
    ]);
    expect(content).not.toContain("Phone");
    expect(content).toContain("T-12");
  });

  it("prints titles and totals that printing-core makes bold", () => {
    const [kot, , bill, receipt] = renderAllSamples("80mm");
    expect(isStrongLine(kot.content.split("\n")[0], 0)).toBe(true);
    expect(bill.content.split("\n").some((l) => l.trim() === "BILL")).toBe(true);
    expect(receipt.content.split("\n").some((l) => l.trim() === "RECEIPT")).toBe(true);
    expect(receipt.content).toMatch(/^\|TOTAL\s+\|\s+2,850\.00\|$/m);
    const allergyBold = kot.content
      .split("\n")
      .some((line, i) => /ALLERG/.test(line.toUpperCase()) && isStrongLine(line, i));
    expect(allergyBold).toBe(true);
  });
});

describe("amounts", () => {
  it("splits VAT out of inclusive restaurant prices to the cent", () => {
    expect(vatFromInclusive(2850, 16)).toBe(393.1);
    expect(vatFromInclusive(45300, 16)).toBe(6248.28);
    const totals = computeSaleTotals([{ name: "x", quantity: 1, unitPrice: 2850 }], {
      vatRegistered: true,
      vatRate: 16,
    });
    expect(totals).toMatchObject({ net: 2456.9, vat: 393.1, total: 2850 });
  });

  it("adds a catering levy without changing an inclusive total", () => {
    const totals = computeSaleTotals([{ name: "x", quantity: 1, unitPrice: 1180 }], {
      vatRegistered: true,
      vatRate: 16,
      levies: [{ label: "Catering levy 2%", ratePercent: 2 }],
    });
    expect(totals.total).toBe(1180);
    expect(totals.net).toBe(1000);
    expect(totals.vat).toBe(160);
    expect(totals.levies[0].amount).toBe(20);
  });

  it("charges VAT on top when prices exclude it", () => {
    const totals = computeSaleTotals([{ name: "x", quantity: 2, unitPrice: 0.1 }], {
      vatRegistered: true,
      vatRate: 16,
      pricesIncludeVat: false,
    });
    expect(totals).toMatchObject({ net: 0.2, vat: 0.03, total: 0.23 });
  });

  it("omits VAT lines for restaurants that are not VAT registered", () => {
    const receipt = renderSalesReceipt(
      {
        business: { name: "Small Cafe" },
        tax: { vatRegistered: false },
        receiptNumber: "R-1",
        issuedAt: "now",
        lines: [{ name: "Tea", quantity: 2, unitPrice: 60 }],
        payments: [{ method: "Cash", amount: 200 }],
      },
      { paper: "58mm" },
    );
    expect(receipt.content).not.toContain("VAT");
    expect(receipt.content).toMatch(/\|Change\s*\|\s*\|\s*80\.00\|/);
  });
});

describe("eTIMS and payment QR codes", () => {
  const base = {
    business: { name: "Cafe" },
    tax: { vatRegistered: true, vatRate: 16 },
    receiptNumber: "R-9",
    issuedAt: "now",
    lines: [{ name: "Tea", quantity: 1, unitPrice: 116 }],
    payments: [{ method: "Cash", amount: 116 }],
  };
  const ctx: PrintContext = { paper: "80mm" };

  it("prints no eTIMS block when eTIMS is off", () => {
    const receipt = renderSalesReceipt(base, ctx);
    expect(receipt.content).not.toContain("eTIMS");
    expect(receipt.qrCodes).toEqual([]);
  });

  it("marks receipts that KRA has not signed yet", () => {
    const receipt = renderSalesReceipt({ ...base, etims: { status: "PENDING" } }, ctx);
    expect(receipt.content).toContain("eTIMS PENDING");
    expect(receipt.qrCodes).toEqual([]);
  });

  it("returns the KRA verification QR for signed receipts", () => {
    const receipt = renderSalesReceipt(
      {
        ...base,
        etims: {
          status: "SIGNED",
          cuSerial: "CU1",
          cuInvoiceNumber: "99",
          verifyUrl: "https://kra.example/v",
        },
      },
      ctx,
    );
    expect(receipt.content).toContain("CU1");
    expect(receipt.qrCodes).toEqual([
      expect.objectContaining({ purpose: "ETIMS_VERIFY", payload: "https://kra.example/v" }),
    ]);
  });

  it("puts a scan-to-pay QR and manual details on bills, using the bill number as account", () => {
    const bill = renderCustomerBill(
      {
        business: { name: "Cafe" },
        tax: { vatRegistered: false },
        billNumber: "B-77",
        orderNumber: "A-1",
        issuedAt: "now",
        lines: [{ name: "Tea", quantity: 1, unitPrice: 100 }],
        payment: { till: "123456", qrPayload: "QR-DATA" },
      },
      ctx,
    );
    expect(bill.content).toMatch(/Account\s*\|B-77/);
    expect(bill.qrCodes).toEqual([
      expect.objectContaining({ purpose: "PAYMENT", payload: "QR-DATA" }),
    ]);
  });
});

describe("reprints and shift reports", () => {
  it("marks every reprint so copies cannot pass as originals", () => {
    const [kot] = renderAllSamples("58mm");
    expect(kot.content).not.toContain("REPRINT");
    const receipt = renderSalesReceipt(
      {
        business: { name: "Cafe" },
        tax: { vatRegistered: false },
        receiptNumber: "R-1",
        issuedAt: "now",
        lines: [{ name: "Tea", quantity: 1, unitPrice: 50 }],
        payments: [{ method: "Cash", amount: 50 }],
      },
      { paper: "58mm", copy: { number: 2, at: "23:10", by: "Ann" } },
    );
    expect(receipt.content).toContain("REPRINT #2 23:10 by Ann");
  });

  it("reconciles the Z report drawer and flags payments that do not match sales", () => {
    const z = renderAllSamples("80mm").find((d) => d.kind === "Z_REPORT")!;
    expect(z.content).toMatch(/Expected cash\s*\|\s*36,250\.00\|/);
    expect(z.content).toMatch(/VARIANCE\s*\|\s*\(150\.00\)\|/);
    expect(z.content).not.toContain("CHECK:");

    const mismatch = renderShiftReport(
      {
        type: "X",
        business: { name: "Cafe" },
        businessDate: "today",
        shiftOpened: "08:00",
        shiftEnd: "12:00",
        cashier: "A",
        grossSales: 1000,
        discounts: 0,
        payments: [{ method: "Cash", amount: 900 }],
        drawer: { openingFloat: 0 },
        orders: 3,
      },
      { paper: "58mm" },
    );
    expect(mismatch.content.replace(/[|\n ]+/g, " ")).toContain(
      "CHECK: payments differ from net sales by -100.00",
    );
  });
});
