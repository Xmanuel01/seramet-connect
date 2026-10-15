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
        expect(fixture.content).toContain(width === 32 ? "|QTY|ITEM" : "|QTY|DESCRIPTION");
        if (fixture.documentType === "INVOICE") {
          expect(fixture.content).toContain("INVOICE");
          expect(fixture.content).toContain("Unit:");
          expect(fixture.content).toContain("TEST-PIN-ONLY");
        }
        if (fixture.name.includes("copy")) expect(fixture.content).toContain("DUPLICATE COPY");
      } else {
        expect(fixture.content).toContain("STATION:");
        expect(fixture.content).toContain(
          fixture.documentType === "BAR_TICKET" ? "BAR ORDER" : "KITCHEN ORDER",
        );
        if (fixture.name.includes("copy")) expect(fixture.content).toContain("REPRINT");
      }
    });
  }

  for (const paper of ["58mm", "80mm", "A4"] as const) {
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
});
