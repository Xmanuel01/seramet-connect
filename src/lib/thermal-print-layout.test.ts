import { describe, expect, it } from "vitest";
import { printingAcceptanceFixtures } from "../../scripts/printing-acceptance-fixtures";
import { SerametPrintService, type OrderForPrint } from "./seramet-print-service";
import { DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID } from "@/platform/demo/default-demo-data";

function bounded(content: string, width: number) {
  for (const line of content.split("\n")) {
    expect(line.length, line).toBeLessThanOrEqual(width);
    expect(line).toMatch(/^[\x20-\x7e]*$/);
    if (line.startsWith("|") || line.startsWith("+")) expect(line.length, line).toBe(width);
  }
}

describe("ruled thermal document layouts", () => {
  for (const fixture of printingAcceptanceFixtures()) {
    it(`${fixture.name} preserves columns, details and authoritative totals`, () => {
      const width = fixture.width === "58mm" ? 32 : 42;
      bounded(fixture.content, width);
      expect(fixture.content).toContain("Disposable branch");
      expect(fixture.content).toMatch(/\|\s*2\|/);
      expect(fixture.content).toContain(
        ["FOOD_KOT", "BAR_TICKET"].includes(fixture.documentType) ? "NO ONION" : "No onion",
      );
      expect(fixture.content).toMatch(/Separate sauce|SEPARATE SAUCE/);
      if (["BILL", "RECEIPT", "INVOICE"].includes(fixture.documentType)) {
        for (const value of ["246.90", "32.00", "283.90", "SERVICE", "DISCOUNT", "10.00", "5.00"])
          expect(fixture.content).toContain(value);
        expect(fixture.content).toContain("|QTY|ITEM");
        expect(fixture.content).toContain(width === 32 ? "AMT" : "AMOUNT");
        expect(fixture.content).not.toContain("ORDER DETAILS");
        if (fixture.documentType === "INVOICE") {
          expect(fixture.content).toContain("TAX INVOICE");
          expect(fixture.content).not.toContain("Due Date:");
          expect(fixture.content).toContain("Unit:");
          expect(fixture.content).toContain("TEST-PIN-ONLY");
        }
        if (fixture.name.includes("copy")) expect(fixture.content).toContain("DUPLICATE COPY");
      } else {
        expect(fixture.content.split("\n")[0]).toMatch(/^(KITCHEN ORDER KOT|BAR ORDER BAR) /);
        for (const clutter of [
          "Disposable Test Restaurant",
          "TEST-PIN-ONLY",
          "contact@example.invalid",
          "Tel:",
          "NEW ORDER",
          "KITCHEN TICKET",
          "BAR TICKET",
        ])
          expect(fixture.content).not.toContain(clutter);
        expect(fixture.content).toContain("STATION:");
        expect(fixture.content).toContain(
          fixture.documentType === "BAR_TICKET" ? "BAR ORDER" : "KITCHEN ORDER",
        );
        if (fixture.name.includes("copy")) expect(fixture.content).toContain("REPRINT");
      }
    });
  }

  for (const paper of ["58mm", "80mm", "A4"] as const) {
    it(`${paper} retains tax-invoice semantics without inventing a due date`, () => {
      printingAcceptanceFixtures();
      const profile = SerametPrintService.getBranchHardwareProfile(
        DEMO_WESTLANDS_BRANCH_ID,
        DEMO_TENANT_ID,
      );
      profile.templateSettings.INVOICE.width = paper;
      const order: OrderForPrint = {
        orderId: "#TAX-TEST",
        invoiceNumber: "INV-TAX-TEST",
        branch: profile.branch,
        terminalId: "test",
        requestedBy: "Test operator",
        cashier: "Test operator",
        waiter: "Test operator",
        createdAt: "2026-10-15T10:00:00Z",
        orderType: "Takeaway",
        subtotal: 100,
        tax: 16,
        total: 116,
        lines: [
          {
            id: "tax-line",
            name: "Taxable meal",
            category: "Test",
            quantity: 1,
            unitPrice: 100,
            productionStation: "MAIN KITCHEN",
          },
        ],
      };
      const content = SerametPrintService.createDocumentJob(profile, order, "INVOICE").content;
      bounded(content, paper === "58mm" ? 32 : paper === "80mm" ? 42 : 78);
      expect(
        content.split("\n").some((line) => line.replace(/\|/g, "").trim() === "TAX INVOICE"),
      ).toBe(true);
      expect(content).not.toMatch(/\|\s*INVOICE\s*\|/);
      expect(content).not.toContain("Due Date:");
      for (const value of ["INV-TAX-TEST", "100.00", "16.00", "116.00", "Taxable meal"])
        expect(content).toContain(value);
    });

    it(`${paper} wraps unbroken identifiers and all optional details without dropping data`, () => {
      printingAcceptanceFixtures();
      const profile = SerametPrintService.getBranchHardwareProfile(
        DEMO_WESTLANDS_BRANCH_ID,
        DEMO_TENANT_ID,
      );
      profile.templateSettings.RECEIPT.width = paper;
      const token = "UNBROKEN".repeat(12);
      profile.printIdentity.businessName = token;
      profile.printIdentity.footerMessage = token;
      const order: OrderForPrint = {
        orderId: token,
        branch: profile.branch,
        terminalId: "test",
        requestedBy: token,
        cashier: token,
        waiter: token,
        createdAt: "2026-10-15T10:00:00Z",
        orderType: "Takeaway",
        subtotal: 1234567.89,
        tax: 0,
        total: 1234567.89,
        paid: 1234567.89,
        paymentReference: token,
        loyaltySummary: { memberCode: token, rewardUsed: token },
        lines: [
          {
            id: "one",
            name: token,
            category: "test",
            quantity: 1,
            unitPrice: 1234567.89,
            productionStation: "MAIN KITCHEN",
            itemNote: token,
            modifiers: [token],
          },
        ],
      };
      const content = SerametPrintService.createDocumentJob(profile, order, "RECEIPT").content;
      bounded(content, paper === "58mm" ? 32 : paper === "80mm" ? 42 : 78);
      expect(content.replace(/[|+\s-]/g, "")).toContain(token);
      expect(content).toContain("1,234,567.89");
    });
  }

  it("uses merchant branding, omits empty configuration and keeps reprint operator distinct", () => {
    printingAcceptanceFixtures();
    const profile = SerametPrintService.getBranchHardwareProfile(
      DEMO_WESTLANDS_BRANCH_ID,
      DEMO_TENANT_ID,
    );
    profile.printIdentity.receiptBrand = "SERAMET";
    profile.printIdentity.businessName = "Merchant Trading Name";
    profile.printIdentity.address = "";
    profile.printIdentity.phone = "";
    profile.printIdentity.email = "";
    profile.printIdentity.pin = "";
    profile.printIdentity.paymentInstructions = [];
    const order: OrderForPrint = {
      orderId: "#MERCHANT",
      branch: profile.branch,
      terminalId: "test",
      requestedBy: "Recovery Manager",
      cashier: "Original Cashier",
      waiter: "Original Server",
      createdAt: "2026-10-15T10:00:00Z",
      orderType: "Takeaway",
      subtotal: 100,
      tax: 0,
      total: 100,
      paid: 100,
      serviceCharge: 0,
      discount: 0,
      lines: [
        {
          id: "one",
          name: "Meal",
          category: "Test",
          quantity: 1,
          unitPrice: 40,
          productionStation: "MAIN KITCHEN",
          modifiers: ["No nuts"],
        },
        {
          id: "two",
          name: "Side",
          category: "Test",
          quantity: 2,
          unitPrice: 30,
          productionStation: "MAIN KITCHEN",
          itemNote: "Sauce separate",
        },
      ],
    };
    const bill = SerametPrintService.createDocumentJob(profile, order, "BILL").content;
    expect(bill.split("\n")[0].trim()).toBe("Merchant Trading Name");
    for (const absent of [
      "SERAMET",
      "Tel:",
      "PIN:",
      "Due Date:",
      "not configured",
      "SERVICE",
      "DISCOUNT",
    ])
      expect(bill).not.toContain(absent);
    expect(bill).toContain("100.00");
    const production = SerametPrintService.createProductionTicketJobs(profile, order, [], "REPRINT")
      .jobs[0]!.content;
    const plain = production.replace(/\s+/g, " ");
    expect(plain).toContain("Reprinted by: Recovery Manager");
    expect(plain).not.toContain("Reprinted by: Original Cashier");
    expect(production).not.toContain("Merchant Trading Name");
    expect(production).toMatch(/\|\s*2\|SIDE/);
    expect(production).toContain("SAUCE SEPARATE");
    const copy = SerametPrintService.formatDuplicateCopy(bill, "80mm", "Recovery Manager");
    expect(copy).toContain("DUPLICATE COPY");
    expect(copy).toContain("Reprinted by: Recovery Manager");
    expect(copy).toContain("Original Cashier");
  });
});
