import { beforeAll, describe, expect, it } from "vitest";
import { SOLID_RULE_GLYPHS, solidRules } from "../../printing-core/solid-rules.mjs";
import { renderAllSamples } from "./documents/samples";
import { printingAcceptanceFixtures } from "../../scripts/printing-acceptance-fixtures";
import { receiptRecordToPrintOrder } from "@/lib/print-order-adapter";
import { SerametPrintService, type OrderForPrint } from "@/lib/seramet-print-service";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

const UP = new Set("│├┤┴┼└┘╞╡╧╪╘╛");
const DOWN = new Set("│├┤┬┼┌┐╞╡╤╪╒╕");

/** Every vertical stroke continues into the line above and below it. */
function assertJoined(solid: string) {
  const lines = solid.split("\n");
  lines.forEach((line, y) => {
    [...line].forEach((glyph, x) => {
      const above = lines[y - 1]?.[x] ?? " ";
      const below = lines[y + 1]?.[x] ?? " ";
      if (UP.has(glyph)) expect(DOWN.has(above), `${y}:${x} ${glyph} under ${above}`).toBe(true);
      if (DOWN.has(glyph)) expect(UP.has(below), `${y}:${x} ${glyph} over ${below}`).toBe(true);
    });
  });
}

describe("solid table rules", () => {
  it("draws corners, tees and the double totals rule; cell text keeps its |", () => {
    const solid = solidRules(
      [
        "+------+---+",
        "|a | b |  1|",
        "+------+---+",
        "|TOTAL |  1|",
        "+======+===+",
        "plain - text | here",
      ].join("\n"),
    );
    expect(solid).toBe(
      [
        "┌──────┬───┐",
        "│a | b │  1│",
        "├──────┼───┤",
        "│TOTAL │  1│",
        "╘══════╧═══╛",
        "plain - text | here",
      ].join("\n"),
    );
  });

  it("joins tables of different column layouts on one merged rule", () => {
    const solid = solidRules(
      ["+---+---+", "|a  |  b|", "+---+-+-+", "|c    |d|", "+-----+-+"].join("\n"),
    );
    expect(solid.split("\n")[2]).toBe("├───┴─┬─┤");
    assertJoined(solid);
  });

  for (const paper of ["58mm", "80mm", "A4"] as const)
    it(`renders every ${paper} template with joined borders and no ASCII rules`, () => {
      for (const document of renderAllSamples(paper)) {
        const solid = solidRules(document.content);
        assertJoined(solid);
        for (const line of solid.split("\n")) {
          expect(line, document.kind).not.toMatch(/^[+|]|^[─═]*[+]/);
          if (/^[│┌├└╞╘]/.test(line))
            expect([...line].filter((c) => SOLID_RULE_GLYPHS.includes(c)).length).toBeGreaterThan(
              1,
            );
        }
      }
    });

  it("renders every live POS fixture with joined borders", () => {
    for (const fixture of printingAcceptanceFixtures()) assertJoined(solidRules(fixture.content));
  });
});

describe("printed totals and payments", () => {
  let profile: ReturnType<typeof SerametPrintService.getBranchHardwareProfile>;
  const lines: OrderForPrint["lines"] = [
    {
      id: "a",
      name: "Grilled tilapia",
      category: "Mains",
      quantity: 2,
      unitPrice: 1250,
      productionStation: "MAIN KITCHEN",
    },
    {
      id: "b",
      name: "Chapati",
      category: "Sides",
      quantity: 12,
      unitPrice: 40,
      productionStation: "PACKING",
    },
  ];
  const bill = {
    id: "INV-00490",
    orderIds: ["#10490"],
    branch: "",
    customer: "Walk-in Customer",
    status: "PAID",
    paymentStatus: "PAID",
    issuedAt: "2026-11-01T17:30:00.000Z",
    dueAt: "2026-11-01T17:30:00.000Z",
    lines,
    subtotal: 2980,
    tax: 0,
    total: 2980,
    paid: 2980,
  };
  const receipt = {
    id: "RC-00490",
    orderId: "#10490",
    invoiceId: "INV-00490",
    branch: "",
    cashier: "Amina",
    customer: "Walk-in Customer",
    issuedAt: bill.issuedAt,
    total: 2980,
    paidAmount: 2980,
    change: 0,
    paymentBreakdown: [{ method: "MPESA", amount: 2980, reference: "SKL4Q7ZP9X" }],
    reprints: [],
  };
  const print = (r: object, b: object = bill) =>
    SerametPrintService.createDocumentJob(
      profile,
      receiptRecordToPrintOrder(
        r as never,
        { bills: [b], orders: [], payments: [], receipts: [] } as never,
      )!,
      "RECEIPT",
    ).content;

  beforeAll(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    profile = SerametPrintService.getBranchHardwareProfile(
      DEMO_WESTLANDS_BRANCH_ID,
      DEMO_TENANT_ID,
    );
    profile.kitchenMode = "PRINTER_ONLY";
    bill.branch = receipt.branch = profile.branch;
    for (const template of Object.values(profile.templateSettings)) template.width = "80mm";
    for (const route of Object.values(profile.documentRoutes)) route.template = "80mm";
  });

  it("shows the discount and service charge that make the lines add up to the total", () => {
    // Gross 2,980.00 - discount 200.00 + 10% service 278.00 = 3,058.00. The bill's
    // own subtotal (net + service) is 3,058.00, which used to print with no rows.
    const components = {
      version: 1,
      currency: "KES",
      grossSalesMinor: 298000,
      discountsMinor: 20000,
      netSalesMinor: 278000,
      serviceChargeMinor: 27800,
      taxMinor: 0,
      totalMinor: 305800,
    };
    const guest = {
      ...bill,
      subtotal: 3058,
      total: 3058,
      paid: 3058,
      financialComponents: components,
    };
    const content = print(
      {
        ...receipt,
        total: 3058,
        paidAmount: 3058,
        paymentBreakdown: [{ ...receipt.paymentBreakdown[0], amount: 3058 }],
      },
      guest,
    );
    expect(content).toMatch(/\|Subtotal\s+\|\s+2,980\.00\|/);
    expect(content).toMatch(/\|Service charge\s+\|\s+278\.00\|/);
    expect(content).toMatch(/\|Discount\s+\|\s+\(200\.00\)\|/);
    expect(content).toMatch(/\|TOTAL\s+\|\s+3,058\.00\|/);
  });

  it("prints the cash handed over and the change returned", () => {
    const content = print({
      ...receipt,
      change: 2020,
      paymentBreakdown: [{ method: "CASH", amount: 2980, reference: "CASH-INV-00490-1" }],
    });
    expect(content).toMatch(/\|CASH\s+\|\s*\|\s+5,000\.00\|/);
    expect(content).toMatch(/\|Change\s+\|\s*\|\s+2,020\.00\|/);
    expect(content).not.toContain("CASH-INV");
    expect(content).toContain("PAID");
  });

  it("keeps mixed payments as recorded, with their references", () => {
    const content = print({
      ...receipt,
      paymentBreakdown: [
        { method: "MPESA", amount: 2000, reference: "SKL4Q7ZP9X" },
        { method: "CASH", amount: 980, reference: "CASH-INV-00490-2" },
      ],
    });
    expect(content).toMatch(/\|MPESA\s+\|SKL4Q7ZP9X\s+\|\s+2,000\.00\|/);
    expect(content).toMatch(/\|CASH\s+\|\s*\|\s+980\.00\|/);
    expect(content).not.toContain("Change");
  });

  it("titles dispatch-station tickets as dispatch orders on the station template", () => {
    profile.stationRoutes = { ...profile.stationRoutes, PACKING: "DISPATCH" };
    const order = {
      ...receiptRecordToPrintOrder(
        receipt as never,
        {
          bills: [bill],
          orders: [],
          payments: [],
          receipts: [],
        } as never,
      )!,
      lines: [lines[1]!],
    };
    const [job] = SerametPrintService.createProductionTicketJobs(profile, order, [], "NEW").jobs;
    expect(job!.documentType).toBe("DISPATCH_TICKET");
    expect(job!.content.split("\n")[0]).toMatch(/^DISPATCH ORDER\s+KOT #/);
    expect(job!.content).toMatch(/\|\s+12\|CHAPATI\s+\|/);
    expect(job!.content).not.toContain("KITCHEN ORDER");
  });
});
