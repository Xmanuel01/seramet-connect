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
      // Table cells wrap, so compare with cell borders and line breaks collapsed.
      const flat = fixture.content.replace(/[\s|]+/g, " ");
      // Thin solid separators, as in the approved design.
      expect(fixture.content).toMatch(/^-+$/m);
      // The approved documents never print placeholders.
      expect(fixture.content).not.toMatch(/\[if provided\]|\[Transaction ref\]|\[Fiscal/);
      if (["BILL", "RECEIPT", "INVOICE"].includes(fixture.documentType)) {
        const lines = fixture.content.split("\n");
        // A duplicate copy opens with its DUPLICATE COPY banner, then the original document.
        const name = lines.findIndex((line) => line.trim() === "DISPOSABLE TEST RESTAURANT");
        if (fixture.name.includes("copy")) expect(name).toBeGreaterThan(0);
        else expect(name).toBe(0);
        expect(flat).toContain("Test-only address");
        expect(flat).toContain("Tel: 0000000000");
        expect(fixture.content).toMatch(/\|\s*2\s*\|/);
        expect(fixture.content).toContain("- No onion");
        // Kitchen instructions stay on the kitchen ticket.
        expect(fixture.content).not.toContain("Separate sauce");
        for (const value of [
          "246.90",
          "32.00",
          "283.90",
          "SERVICE CHARGE",
          "DISCOUNT",
          "10.00",
          "(5.00)",
        ])
          expect(fixture.content).toContain(value);
        expect(fixture.content).toMatch(
          fixture.width === "80mm"
            ? /^\|QTY\|ITEM\s*\|UNIT \(KES\)\|TOTAL \(KES\)\|$/m
            : /^\|QTY\|ITEM\s*\|TOTAL \(KES\)\|$/m,
        );
        if (fixture.width === "58mm") expect(fixture.content).toContain("@ 123.45");
        else expect(fixture.content).toMatch(/\|\s*123\.45\|\s*246\.90\|/);
        // GRAND TOTAL sits between thin solid lines, never on a filled bar.
        const grand = lines.findIndex((line) => line.startsWith("GRAND TOTAL"));
        expect(lines[grand]).toMatch(/^GRAND TOTAL\s+KES 283\.90$/);
        expect(lines[grand - 1]).toMatch(/^-+$/);
        expect(lines[grand + 1]).toMatch(/^-+$/);
        expect(fixture.content).not.toContain("UNPAID");
        expect(fixture.content).not.toContain("TEST-PIN-ONLY");
        if (fixture.documentType === "RECEIPT") {
          expect(fixture.content).toMatch(/^RECEIPT\s+\[ PAID \]$/m);
          expect(flat).toContain("RCPT #TEST-ONLY");
          expect(flat).toContain("PAYMENT DETAILS");
          expect(flat).toContain("Method: Cash");
          expect(fixture.content).toContain("THANK YOU FOR YOUR BUSINESS");
        } else {
          expect(lines.some((line) => line.trim() === "INVOICE")).toBe(true);
          expect(flat).toContain("INV #TEST-ONLY");
          expect(fixture.content).not.toMatch(/Due date/i);
        }
        if (fixture.name.includes("copy")) expect(fixture.content).toContain("DUPLICATE COPY");
      } else {
        const lines = fixture.content.split("\n");
        const station = fixture.documentType === "BAR_TICKET" ? "BAR" : "KITCHEN";
        expect(lines[0]!.trim()).toBe(`${station} ORDER`);
        expect(lines[1]).toMatch(
          new RegExp(`^${fixture.name.includes("copy") ? "REPRINT" : "NEW ORDER"}\\s+${station}$`),
        );
        expect(lines[2]).toMatch(/^-+$/);
        for (const value of [
          "ORDER #ACCEPTANCE",
          "DATE: 15 Oct 2026",
          "TIME:",
          "CUSTOMER: Walk-in",
          "- No onion",
          "GENERAL INSTRUCTIONS",
          "No salt. Allergy test only.",
          `END OF ${station} ORDER`,
        ])
          expect(flat).toContain(value);
        expect(flat).toContain("2 x Long named kitchen meal with distinguishing extra details");
        expect(flat).toContain("Item instructions: Separate sauce");
        expect(flat).toContain(
          `REQUESTED BY: ${fixture.name.includes("copy") ? "Disposable reprint operator" : "Disposable operator"}`,
        );
        for (const clutter of [
          "Disposable Test Restaurant",
          "DISPOSABLE TEST RESTAURANT",
          "Disposable branch",
          "TEST-PIN-ONLY",
          "contact@example.invalid",
          "Tel:",
          "123.45",
          "246.90",
          "283.90",
          "Service",
        ])
          expect(fixture.content).not.toContain(clutter);
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
      // A4 keeps the tax invoice; thermal paper prints the approved INVOICE layout.
      const title = paper === "A4" ? "TAX INVOICE" : "INVOICE";
      expect(content.split("\n").some((line) => line.replace(/\|/g, "").trim() === title)).toBe(
        true,
      );
      expect(content).not.toMatch(/\|\s*INVOICE\s*\|/);
      expect(content).not.toContain("Due Date:");
      const number = paper === "A4" ? "INV-TAX-TEST" : "INV #TAX-TEST";
      for (const value of [number, "100.00", "16.00", "116.00", "Taxable meal"])
        expect(content).toContain(value);
      if (paper !== "A4") expect(content).toMatch(/^\s+VAT\s+16\.00$/m);
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
    expect(bill.split("\n")[0].trim()).toBe("MERCHANT TRADING NAME");
    for (const absent of [
      "SERAMET",
      "Tel:",
      "PIN:",
      "Due Date:",
      "not configured",
      "Service charge",
      "Discount",
    ])
      expect(bill).not.toContain(absent);
    expect(bill).toContain("100.00");
    const production = SerametPrintService.createProductionTicketJobs(
      profile,
      order,
      [],
      "REPRINT",
    ).jobs.find((job) => job.kitchenDelivery !== "KDS_DISPLAY")!.content;
    const plain = production.replace(/\s+/g, " ");
    expect(production.split("\n")[1]).toMatch(/^REPRINT\s+KITCHEN$/);
    expect(plain).toContain("REQUESTED BY: Recovery Manager");
    expect(plain).not.toContain("Original Cashier");
    expect(production).not.toMatch(/Merchant Trading Name/i);
    expect(production).toMatch(/^2 x Side$/m);
    expect(production).toMatch(/^1 x Meal\n {4}- No nuts$/m);
    expect(production).toContain("    Item instructions: Sauce separate");
    const copy = SerametPrintService.formatDuplicateCopy(bill, "80mm", "Recovery Manager");
    expect(copy).toContain("DUPLICATE COPY");
    expect(copy).toContain("Reprinted by: Recovery Manager");
  });
});
